import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { endpointByMetaPage, endpointByToken, ingestLead, type Endpoint } from "@/lib/inbound/ingest";
import { fetchMetaLead } from "@/lib/inbound/meta";
import { fromGoogleLeadForm, fromMetaLead, fromWebsiteForm, googleLeadPayload, metaWebhook, type InboundLead } from "@/lib/inbound/normalize";
import { safeEqual, verifyMetaSignature } from "@/lib/inbound/tokens";

/**
 * POST /api/v1/webhooks/inbound/[source]
 *   website  website forms (JSON or form-encoded), token in `x-stratos-token` or `?t=`, CORS open
 *   google   Google Ads lead form webhook, token = the form's google_key
 *   meta     Meta Lead Ads (Facebook and Instagram), signed with the app secret, tenant found by page id
 * GET /api/v1/webhooks/inbound/meta answers Meta's subscription check.
 *
 * Errors never echo request data, and logs never contain lead details.
 */
export const maxDuration = 30;

const SOURCES = ["website", "google", "meta"] as const;
type Source = (typeof SOURCES)[number];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-stratos-token",
  "Access-Control-Max-Age": "86400",
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers });
const reject = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  json(status, { ok: false, error: { code, message } }, headers);

function clientIp(req: Request) {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** Stores the lead; a concurrent retry of the same provider id is reported as a duplicate, not an error. */
async function store(endpoint: Endpoint, lead: InboundLead, req: Request) {
  if (lead.source !== endpoint.source && !(endpoint.source === "facebook_lead_ads" && lead.source === "instagram_lead_ads")) {
    // The endpoint decides the source family; an Instagram lead on a Facebook page endpoint is fine.
    lead = { ...lead, source: endpoint.source };
  }
  try {
    return await ingestLead(endpoint, lead, { ip: clientIp(req) });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return { status: "duplicate" as const, leadId: null, enrolled: false };
    throw err;
  }
}

export async function OPTIONS(_req: Request, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  return new NextResponse(null, { status: source === "website" ? 204 : 405, headers: source === "website" ? CORS : {} });
}

export async function GET(req: Request, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  if (source !== "meta") return reject(405, "method_not_allowed", "Use POST");
  const q = new URL(req.url).searchParams;
  if (q.get("hub.mode") === "subscribe" && safeEqual(q.get("hub.verify_token") ?? "", env.metaVerifyToken())) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return reject(403, "forbidden", "Verification failed");
}

export async function POST(req: Request, { params }: { params: Promise<{ source: string }> }) {
  const { source: raw } = await params;
  if (!SOURCES.includes(raw as Source)) return reject(404, "unknown_source", "Unknown lead source");
  const source = raw as Source;
  try {
    if (source === "website") return await website(req);
    if (source === "google") return await google(req);
    return await meta(req);
  } catch (err) {
    console.error(`[inbound:${source}] failed`, err instanceof Error ? err.message : "unknown error");
    return reject(500, "internal_error", "Could not store the lead", source === "website" ? CORS : {});
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await req.json()) as Record<string, unknown>;
  if (type.includes("form")) return Object.fromEntries((await req.formData()).entries());
  throw new Error("unsupported content type");
}

async function website(req: Request) {
  const token = req.headers.get("x-stratos-token") ?? new URL(req.url).searchParams.get("t");
  if (!token) return reject(401, "missing_token", "Missing endpoint token", CORS);
  const endpoint = await endpointByToken(token);
  if (!endpoint || endpoint.source !== "website_form") return reject(401, "invalid_token", "Unknown or inactive endpoint", CORS);
  let body: Record<string, unknown>;
  try { body = await readBody(req); } catch { return reject(400, "invalid_body", "Send JSON or form data", CORS); }
  const lead = fromWebsiteForm(body);
  if ("spam" in lead) return json(200, { ok: true, data: { status: "accepted" } }, CORS); // don't tell bots
  if (!lead.email && !lead.phone) return reject(422, "missing_contact", "Give an email or a phone number", CORS);
  const result = await store(endpoint, lead, req);
  return json(200, { ok: true, data: { status: result.status } }, CORS);
}

async function google(req: Request) {
  let payload: z.output<typeof googleLeadPayload>;
  try { payload = googleLeadPayload.parse(await req.json()); } catch { return reject(400, "invalid_body", "Not a Google lead form payload"); }
  const endpoint = await endpointByToken(payload.google_key);
  if (!endpoint || endpoint.source !== "google_ads_lead_form") return reject(401, "invalid_key", "Unknown or inactive google_key");
  const lead = fromGoogleLeadForm(payload);
  if (!lead.email && !lead.phone) return json(200, { ok: true, data: { status: "ignored" } });
  const result = await store(endpoint, lead, req);
  return json(200, { ok: true, data: { status: result.status } });
}

/**
 * Verifies the signature, then fetches each lead from the Graph API and stores it before answering. A failure answers
 * 500 so Meta retries the delivery; leads already stored are skipped on the retry (same leadgen id).
 */
async function meta(req: Request) {
  const rawBody = await req.text();
  if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), env.metaAppSecret())) {
    return reject(401, "invalid_signature", "Signature check failed");
  }
  let parsed: z.output<typeof metaWebhook>;
  try { parsed = metaWebhook.parse(JSON.parse(rawBody)); } catch { return reject(400, "invalid_body", "Not a Meta webhook payload"); }
  const changes = parsed.entry.flatMap((e) => e.changes.filter((c) => c.field === "leadgen").map((c) => c.value));
  let stored = 0, unrouted = 0;
  for (const change of changes) {
    const endpoint = await endpointByMetaPage(change.page_id);
    // A page no tenant has connected: acknowledge, or Meta keeps retrying something we will never accept.
    if (!endpoint) { unrouted++; continue; }
    await store(endpoint, fromMetaLead(await fetchMetaLead(change.leadgen_id), change), req);
    stored++;
  }
  if (unrouted) console.warn(`[inbound:meta] ${unrouted} lead(s) for pages with no active endpoint`);
  return json(200, { ok: true, data: { stored, unrouted } });
}
