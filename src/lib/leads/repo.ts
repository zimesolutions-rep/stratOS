import type { Db } from "@/lib/db";
import type { Lead, ScoreEvent, Stage } from "@/lib/stratos/types";
import type { LeadDetails, LeadInput, LeadUpdate } from "./schema";

const LEAD_COLS = `id, full_name, email, phone, company, job_title, source, stage_id, status, owner_id, contract_value, currency,
  conversion_probability, baseline_probability, last_activity_at, consent_status, consent_updated_at, contains_phi, created_at`;

/** Every query here runs under asTenantUser, so RLS already limits it to the current tenant. */
export async function listStages(db: Db): Promise<Stage[]> {
  return (await db.query<Stage>(
    "select id, key, name, position, probability, is_won, is_lost from stratos.pipeline_stages order by position")).rows;
}

export async function listLeads(db: Db, opts: { q?: string; stageId?: string; limit?: number } = {}): Promise<Lead[]> {
  const q = opts.q?.trim() ? `%${opts.q.trim().toLowerCase()}%` : null;
  return (await db.query<Lead>(
    `select ${LEAD_COLS} from stratos.leads
      where ($1::text is null or lower(coalesce(full_name, '') || ' ' || coalesce(company, '') || ' ' || coalesce(email, '')) like $1)
        and ($2::uuid is null or stage_id = $2)
      order by conversion_probability desc, last_activity_at desc
      limit $3`, [q, opts.stageId ?? null, opts.limit ?? 200])).rows;
}

export async function getLead(db: Db, id: string): Promise<Lead | null> {
  return (await db.query<Lead>(`select ${LEAD_COLS} from stratos.leads where id = $1`, [id])).rows[0] ?? null;
}

export async function scoreHistory(db: Db, leadId: string): Promise<ScoreEvent[]> {
  return (await db.query<ScoreEvent>(
    `select id, rule_key, delta, score_before, score_after, created_at from stratos.score_events
      where lead_id = $1 order by created_at desc limit 50`, [leadId])).rows;
}

/** tenant_id, created_by and the baseline score are set by triggers from the session, never from input. */
export async function createLead(db: Db, input: LeadInput, ownerId: string): Promise<string> {
  const stageId = input.stage_id ?? (await db.query<{ id: string }>(
    "select id from stratos.pipeline_stages where not is_won and not is_lost order by position limit 1")).rows[0]?.id ?? null;
  const evidence = input.consent_status === "granted"
    ? { source: "manual_entry", recorded_by: ownerId, at: new Date().toISOString() } : {};
  const { rows } = await db.query<{ id: string }>(
    `insert into stratos.leads (full_name, email, phone, company, job_title, source, stage_id, owner_id, contract_value,
                                consent_status, consent_evidence, currency)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             coalesce((select default_currency from stratos.tenants where id = stratos.current_tenant_id()), 'INR'))
     returning id`,
    [input.full_name, input.email, input.phone, input.company, input.job_title, input.source, stageId, ownerId,
     input.contract_value, input.consent_status, evidence],
  );
  return rows[0].id;
}

/** Only these columns; the database refuses any other (column grants) and stops cadences on status/consent changes. */
export async function updateLead(db: Db, id: string, patch: LeadUpdate): Promise<void> {
  await db.query(
    `update stratos.leads set
        stage_id = coalesce($2, stage_id),
        status = coalesce($3::stratos.lead_status, status),
        consent_status = coalesce($4::stratos.consent_status, consent_status)
      where id = $1`,
    [id, patch.stage_id ?? null, patch.status ?? null, patch.consent_status ?? null]);
}

/** Contact details from the edit form. Phone and email are already normalised by the schema. */
export async function updateLeadDetails(db: Db, id: string, d: LeadDetails): Promise<boolean> {
  const { rowCount } = await db.query(
    `update stratos.leads set full_name = $2, email = $3, phone = $4, company = $5, job_title = $6, contract_value = $7
      where id = $1 and consent_status <> 'erasure_requested'`,
    [id, d.full_name, d.email, d.phone, d.company, d.job_title, d.contract_value]);
  return (rowCount ?? 0) > 0;
}

export async function pipelineSummary(db: Db) {
  return (await db.query<{ stage_id: string | null; leads: number; value: number; weighted: number }>(
    `select stage_id, count(*)::int as leads, coalesce(sum(contract_value), 0) as value,
            coalesce(sum(contract_value * conversion_probability / 100), 0) as weighted
       from stratos.leads where status = 'active' group by stage_id`)).rows;
}
