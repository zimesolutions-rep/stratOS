import { z } from "zod";
import { toE164 } from "@/lib/leads/phone";
import type { LeadSource } from "@/lib/stratos/types";

/** What every source is turned into before ingestion. No free-text PII goes into `meta`. */
export type InboundLead = {
  source: LeadSource;
  /** The provider's own id, for idempotent retries. */
  source_ref: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  /** The enquiry text, kept as the lead's first interaction. */
  message: string | null;
  /** True when the person asked to be contacted (an ad lead form, or a ticked consent box). */
  consent: boolean;
  consent_text: string | null;
  meta: Record<string, string>;
  is_test: boolean;
};

const clean = (v: unknown, max = 200): string | null => {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const email = (v: unknown) => {
  const s = clean(v, 254)?.toLowerCase() ?? null;
  return s && z.email().safeParse(s).success ? s : null;
};
const truthy = (v: unknown) => ["true", "1", "yes", "on", "y", "agree", "agreed", "i agree"].includes(String(v ?? "").trim().toLowerCase());
const joinName = (first: unknown, last: unknown) => clean([clean(first), clean(last)].filter(Boolean).join(" "));

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "page_url", "form_name"];

/**
 * Website forms: JSON or form-encoded, common field names. A hidden `website` field is a honeypot: real people
 * leave it empty, bots fill it in.
 */
export function fromWebsiteForm(body: Record<string, unknown>): InboundLead | { spam: true } {
  if (clean(body.website ?? body._hp)) return { spam: true };
  const meta: Record<string, string> = {};
  for (const k of UTM_KEYS) { const v = clean(body[k], 500); if (v) meta[k] = v; }
  return {
    source: "website_form",
    source_ref: clean(body.submission_id ?? body.id, 120),
    full_name: clean(body.full_name ?? body.name) ?? joinName(body.first_name, body.last_name),
    email: email(body.email),
    phone: toE164(clean(body.phone ?? body.mobile ?? body.phone_number, 40)),
    company: clean(body.company ?? body.organisation ?? body.organization),
    job_title: clean(body.job_title ?? body.title ?? body.designation),
    message: clean(body.message ?? body.enquiry ?? body.inquiry ?? body.comments, 4000),
    consent: truthy(body.consent ?? body.gdpr ?? body.agree),
    consent_text: clean(body.consent_text, 1000),
    meta,
    is_test: truthy(body.is_test),
  };
}

/**
 * Google Ads lead form webhook. Google posts { lead_id, user_column_data: [{ column_id, string_value }], google_key,
 * form_id, campaign_id, is_test, ... } and expects a 200. The google_key is the endpoint's token.
 */
export const googleLeadPayload = z.object({
  lead_id: z.string().min(1),
  google_key: z.string().min(1),
  user_column_data: z.array(z.object({ column_id: z.string().optional(), column_name: z.string().optional(), string_value: z.string().optional() })).default([]),
  form_id: z.union([z.string(), z.number()]).optional(),
  campaign_id: z.union([z.string(), z.number()]).optional(),
  adgroup_id: z.union([z.string(), z.number()]).optional(),
  gcl_id: z.string().optional(),
  is_test: z.boolean().optional(),
});

export function fromGoogleLeadForm(p: z.output<typeof googleLeadPayload>): InboundLead {
  const col = (...ids: string[]) => p.user_column_data.find((c) => c.column_id && ids.includes(c.column_id.toUpperCase()))?.string_value;
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries({ form_id: p.form_id, campaign_id: p.campaign_id, adgroup_id: p.adgroup_id, gclid: p.gcl_id })) {
    if (v != null) meta[k] = String(v);
  }
  return {
    source: "google_ads_lead_form",
    source_ref: p.lead_id,
    full_name: clean(col("FULL_NAME")) ?? joinName(col("FIRST_NAME"), col("LAST_NAME")),
    email: email(col("EMAIL", "WORK_EMAIL")),
    phone: toE164(clean(col("PHONE_NUMBER", "WORK_PHONE"), 40)),
    company: clean(col("COMPANY_NAME")),
    job_title: clean(col("JOB_TITLE")),
    message: null,
    consent: true, // submitting an ad lead form is a request to be contacted
    consent_text: "Submitted a Google Ads lead form",
    meta,
    is_test: !!p.is_test,
  };
}

/** Meta Lead Ads webhook: { object: "page", entry: [{ id, changes: [{ field: "leadgen", value: {...} }] }] }. */
export const metaWebhook = z.object({
  object: z.string(),
  entry: z.array(z.object({
    id: z.string(),
    changes: z.array(z.object({
      field: z.string(),
      value: z.object({
        leadgen_id: z.union([z.string(), z.number()]).transform(String),
        page_id: z.union([z.string(), z.number()]).transform(String),
        form_id: z.union([z.string(), z.number()]).transform(String).optional(),
        ad_id: z.union([z.string(), z.number()]).transform(String).optional(),
        adgroup_id: z.union([z.string(), z.number()]).transform(String).optional(),
      }).passthrough(),
    }).passthrough()).default([]),
  }).passthrough()).default([]),
});
export type MetaLeadgenChange = { leadgen_id: string; page_id: string; form_id?: string; ad_id?: string; adgroup_id?: string };

/** The lead as Graph API returns it: GET /{leadgen_id}?fields=created_time,field_data,platform,... */
export type MetaGraphLead = {
  id: string;
  created_time?: string;
  platform?: string;
  is_organic?: boolean;
  campaign_id?: string;
  field_data?: { name: string; values?: string[] }[];
};

export function fromMetaLead(lead: MetaGraphLead, change: MetaLeadgenChange): InboundLead {
  const f = (...names: string[]) => lead.field_data?.find((d) => names.includes(d.name.toLowerCase()))?.values?.[0];
  const meta: Record<string, string> = { page_id: change.page_id };
  for (const [k, v] of Object.entries({ form_id: change.form_id, ad_id: change.ad_id, campaign_id: lead.campaign_id, platform: lead.platform })) {
    if (v) meta[k] = String(v);
  }
  return {
    source: lead.platform?.toLowerCase() === "ig" ? "instagram_lead_ads" : "facebook_lead_ads",
    source_ref: lead.id,
    full_name: clean(f("full_name", "name")) ?? joinName(f("first_name"), f("last_name")),
    email: email(f("email", "work_email")),
    phone: toE164(clean(f("phone_number", "phone", "work_phone_number"), 40)),
    company: clean(f("company_name", "company")),
    job_title: clean(f("job_title")),
    message: null,
    consent: true,
    consent_text: "Submitted a Meta lead form",
    meta,
    is_test: false,
  };
}
