import type { Db } from "@/lib/db";

/** Score rules the database knows. Starting scores (`source:<channel>`) are applied by trigger on insert. */
export type ScoreRule =
  | "call_answered" | "call_missed" | "inbound_reply" | "re_enquiry"
  | "sentiment_positive" | "sentiment_neutral" | "sentiment_negative" | "inactivity_48h";

/**
 * Applies one rule to a lead through stratos.apply_score(): clamps to 0..100, never below the stage floor, logs a
 * score_event. Returns the new score, or null when the tenant has no such rule. On a signed-in connection the lead
 * must belong to the current tenant.
 */
export async function applyRule(db: Db, leadId: string, rule: ScoreRule, interactionId?: string): Promise<number | null> {
  const { rows } = await db.query<{ score: number | null }>(
    "select stratos.apply_score($1, $2, $3) as score", [leadId, rule, interactionId ?? null]);
  return rows[0]?.score ?? null;
}

/** Service path, cron only: -inactivity_48h for every active lead quiet for 48 hours, once per 48 hours. */
export async function decayInactiveLeads(db: Db, limit = 500): Promise<number> {
  const { rows } = await db.query<{ n: number }>("select stratos.decay_inactive_leads($1) as n", [limit]);
  return rows[0]?.n ?? 0;
}
