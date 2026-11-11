import { env } from "@/lib/env";
import type { MetaGraphLead } from "./normalize";

/**
 * Reads one lead from the Graph API with the developer profile's system-user token (one token for every client
 * page the agency manages, so no per-tenant Meta app or per-seat middleware).
 */
export async function fetchMetaLead(leadgenId: string): Promise<MetaGraphLead> {
  const url = new URL(`${env.metaGraphBaseUrl()}/${encodeURIComponent(leadgenId)}`);
  url.searchParams.set("fields", "id,created_time,field_data,platform,is_organic,campaign_id");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.metaAccessToken()}` },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as MetaGraphLead & { error?: { message?: string; code?: number } };
  if (!res.ok || body.error) throw new Error(`Graph API ${res.status}: ${body.error?.message ?? "lead fetch failed"}`);
  return body;
}
