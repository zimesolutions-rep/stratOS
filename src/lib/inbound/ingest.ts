import { createHash } from "node:crypto";
import { asService, type Db } from "@/lib/db";
import type { LeadSource } from "@/lib/stratos/types";
import { hashToken } from "./tokens";
import type { InboundLead } from "./normalize";

export type Endpoint = {
  id: string;
  tenant_id: string;
  source: LeadSource;
  config: { page_id?: string; cadence_key?: string; owner_id?: string };
};

export type IngestResult = { status: "created" | "duplicate" | "re_enquiry"; leadId: string; enrolled: boolean };

/** Endpoint for a token sent by a website form or as Google's google_key. Inactive endpoints never match. */
export async function endpointByToken(token: string): Promise<Endpoint | null> {
  return asService(async (db) => (await db.query<Endpoint>(
    `update stratos.inbound_endpoints set last_used_at = now()
      where token_hash = $1 and active returning id, tenant_id, source, config`, [hashToken(token)])).rows[0] ?? null);
}

/** Meta sends one webhook for the whole app; the page id says which tenant it belongs to. */
export async function endpointByMetaPage(pageId: string): Promise<Endpoint | null> {
  return asService(async (db) => (await db.query<Endpoint>(
    `update stratos.inbound_endpoints set last_used_at = now()
      where config ->> 'page_id' = $1 and active returning id, tenant_id, source, config`, [pageId])).rows[0] ?? null);
}

const ipHash = (ip: string | null) => (ip ? createHash("sha256").update(ip).digest("hex").slice(0, 16) : null);

/**
 * Stores an inbound lead for the endpoint's tenant (trusted service path, so tenant_id is set explicitly here).
 *   - The same provider id again (a webhook retry) changes nothing.
 *   - A person already in the tenant (same email or phone) gets a re-enquiry logged instead of a duplicate lead.
 *   - Otherwise a new lead: baseline score from the channel (trigger), consent with its evidence, the enquiry text
 *     as the first interaction, and enrolment in the endpoint's cadence when the person asked to be contacted.
 */
export async function ingestLead(endpoint: Endpoint, lead: InboundLead, ctx: { ip?: string | null } = {}): Promise<IngestResult> {
  return asService(async (db) => {
    const t = endpoint.tenant_id;
    if (lead.source_ref) {
      const seen = (await db.query<{ id: string }>(
        "select id from stratos.leads where tenant_id = $1 and source = $2 and source_ref = $3",
        [t, lead.source, lead.source_ref])).rows[0];
      if (seen) return { status: "duplicate", leadId: seen.id, enrolled: false };
    }

    const existing = (lead.email || lead.phone) ? (await db.query<{ id: string }>(
      `select id from stratos.leads where tenant_id = $1
          and (($2::text is not null and lower(email) = $2) or ($3::text is not null and phone = $3))
        order by created_at limit 1`, [t, lead.email, lead.phone])).rows[0] : undefined;

    if (existing) {
      await logEnquiry(db, t, existing.id, lead);
      await db.query("select stratos.apply_score($1, 're_enquiry')", [existing.id]);
      return { status: "re_enquiry", leadId: existing.id, enrolled: false };
    }

    const stageId = (await db.query<{ id: string }>(
      "select id from stratos.pipeline_stages where tenant_id = $1 and not is_won and not is_lost order by position limit 1",
      [t])).rows[0]?.id ?? null;
    const consent = lead.consent ? "granted" : "unknown";
    const evidence = lead.consent
      ? { source: lead.source, text: lead.consent_text, endpoint_id: endpoint.id, ip_hash: ipHash(ctx.ip ?? null), at: new Date().toISOString() }
      : {};
    const ownerId = endpoint.config.owner_id
      ? (await db.query<{ user_id: string }>(
          "select user_id from stratos.tenant_members where tenant_id = $1 and user_id = $2 and active",
          [t, endpoint.config.owner_id])).rows[0]?.user_id ?? null
      : null;

    const leadId = (await db.query<{ id: string }>(
      `insert into stratos.leads (tenant_id, full_name, email, phone, company, job_title, source, source_ref, source_meta,
                                  stage_id, owner_id, consent_status, consent_updated_at, consent_evidence, currency,
                                  custom_fields)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               (select default_currency from stratos.tenants where id = $1), $15)
       returning id`,
      [t, lead.full_name, lead.email, lead.phone, lead.company, lead.job_title, lead.source, lead.source_ref, lead.meta,
       stageId, ownerId, consent, lead.consent ? new Date() : null, evidence, lead.is_test ? { is_test: true } : {}])).rows[0].id;

    if (lead.message) await logEnquiry(db, t, leadId, lead);

    let enrolled = false;
    if (lead.consent && endpoint.config.cadence_key && !lead.is_test) {
      const r = await db.query(
        `insert into stratos.lead_cadence_state (tenant_id, lead_id, cadence_id)
         select $1, $2, c.id from stratos.cadences c where c.tenant_id = $1 and c.key = $3 and c.active
         on conflict (lead_id, cadence_id) do nothing`, [t, leadId, endpoint.config.cadence_key]);
      enrolled = (r.rowCount ?? 0) > 0;
    }
    return { status: "created", leadId, enrolled };
  });
}

/** The enquiry text as an inbound note on the lead's timeline (also resets its inactivity clock). */
async function logEnquiry(db: Db, tenantId: string, leadId: string, lead: InboundLead) {
  await db.query(
    `insert into stratos.interactions (tenant_id, lead_id, channel, direction, provider, body)
     values ($1, $2, 'note', 'inbound', 'manual', $3)`,
    [tenantId, leadId, lead.message ? `Enquiry: ${lead.message}` : `New enquiry via ${lead.source.replace(/_/g, " ")}`]);
}
