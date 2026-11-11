import { asService, type Db } from "@/lib/db";
import { CONSENT_LABEL, INDUSTRY_LABEL, MARKET_LABEL, REGIME_LABEL, ROLE_LABEL, SOURCE_LABEL } from "@/lib/stratos/types";

export type AuditRow = {
  id: number; at: string; actor_id: string | null; action: "insert" | "update" | "delete" | "sign_in";
  entity: string; entity_id: string | null; changes: Record<string, unknown>;
};

export type AuditEntry = AuditRow & { actor: string; summary: string; target: string | null; details: string[] };

const ENTITY_LABEL: Record<string, string> = {
  tenants: "workspace settings", tenant_members: "team member", pipeline_stages: "pipeline stage",
  scoring_rules: "scoring rule", cadences: "cadence", cadence_steps: "cadence step", inbound_endpoints: "lead source",
  leads: "lead", interactions: "interaction", tickets: "ticket", lead_cadence_state: "cadence enrolment",
  erasure_requests: "erasure request", session: "session",
};

const FIELD_LABEL: Record<string, string> = {
  full_name: "Name", email: "Email", phone: "Phone", company: "Company", job_title: "Job title", stage_id: "Stage",
  status: "Status", owner_id: "Owner", contract_value: "Deal value", currency: "Currency", consent_status: "Consent",
  contains_phi: "Contains health data", source: "Source", role: "Role", active: "Active", value: "Value", name: "Name",
  probability: "Probability", position: "Position", is_won: "Won stage", is_lost: "Lost stage", channel: "Channel",
  delay_minutes: "Delay (minutes)", cadence_active: "Cadence running", stop_reason: "Stop reason", priority: "Priority",
  assignee_id: "Assignee", retention_days: "Retention (days)", default_currency: "Default currency",
  timezone: "Time zone", compliance_regimes: "Privacy laws", customer_markets: "Customers in", industry: "Industry",
  subject: "Subject", description: "Description", body: "Message", sentiment: "Sentiment", label: "Label",
  display_name: "Display name", reason: "Reason", ip: "IP address", device: "Device",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

/** Latest entries for the current workspace (RLS: owners and admins only), with names filled in for people and records. */
export async function listAudit(db: Db, opts: { entityId?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  const rows = (await db.query<AuditRow>(
    `select id, at, actor_id, action, entity, entity_id, changes from stratos.audit_log
      where ($1::text is null or entity_id = $1 or changes -> 'lead_id' ->> 'to' = $1 or changes ->> 'lead_id' = $1)
      order by at desc, id desc limit $2`, [opts.entityId ?? null, opts.limit ?? 200])).rows;

  const ids = (k: string) => [...new Set(rows.flatMap((r) => {
    const c = r.changes[k] as { from?: unknown; to?: unknown } | string | undefined;
    return typeof c === "string" ? [c] : c && typeof c === "object" ? [c.from, c.to].filter((v): v is string => typeof v === "string") : [];
  }))];
  const leadIds = [...new Set(rows.filter((r) => r.entity === "leads" && r.entity_id).map((r) => r.entity_id!)
    .concat(rows.map((r) => r.changes.lead_id).filter((v): v is string => typeof v === "string")))];
  const userIds = [...new Set(rows.flatMap((r) => [r.actor_id, r.entity === "tenant_members" ? r.entity_id : null])
    .concat(ids("owner_id"), ids("assignee_id")).filter((v): v is string => !!v))];

  const [leads, stages, users] = await Promise.all([
    leadIds.length ? db.query<{ id: string; name: string }>(
      `select id, coalesce(full_name, email, phone, 'Unnamed lead') as name from stratos.leads where id = any($1::uuid[])`,
      [leadIds]).then((r) => r.rows) : [],
    db.query<{ id: string; name: string }>("select id, name from stratos.pipeline_stages").then((r) => r.rows),
    // "user" is Better Auth's table; the app role has no grant on it.
    userIds.length ? asService((s) => s.query<{ id: string; name: string; email: string }>(
      `select id, name, email from "user" where id = any($1)`, [userIds]).then((r) => r.rows)) : [],
  ]);
  const leadName = new Map(leads.map((l) => [l.id, l.name]));
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const userName = new Map(users.map((u) => [u.id, u.name || u.email]));

  const show = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "empty";
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (Array.isArray(v)) {
      const labels: Record<string, string> = field === "customer_markets" ? MARKET_LABEL : field === "compliance_regimes" ? REGIME_LABEL : {};
      return v.map((x) => labels[String(x)] ?? String(x)).join(", ") || "none";
    }
    const s = String(v);
    if (field === "stage_id") return stageName.get(s) ?? "a removed stage";
    if (field === "owner_id" || field === "assignee_id") return userName.get(s) ?? "someone";
    if (field === "consent_status") return CONSENT_LABEL[s as keyof typeof CONSENT_LABEL] ?? cap(s);
    if (field === "source") return SOURCE_LABEL[s as keyof typeof SOURCE_LABEL] ?? cap(s);
    if (field === "role") return ROLE_LABEL[s as keyof typeof ROLE_LABEL] ?? cap(s);
    if (field === "industry") return INDUSTRY_LABEL[s as keyof typeof INDUSTRY_LABEL] ?? cap(s);
    if (field === "status" || field === "stop_reason" || field === "priority" || field === "sentiment") return cap(s);
    return s;
  };

  return rows.map((r) => {
    const actor = r.actor_id ? (userName.get(r.actor_id) ?? "A former member") : "System";
    const what = ENTITY_LABEL[r.entity] ?? r.entity.replace(/_/g, " ");
    const target = r.entity === "leads" && r.entity_id ? (leadName.get(r.entity_id) ?? "an erased lead")
      : r.entity === "tenant_members" && r.entity_id ? (userName.get(r.entity_id) ?? "a member")
      : typeof r.changes.lead_id === "string" ? (leadName.get(r.changes.lead_id) ?? "an erased lead") : null;
    const summary = r.action === "sign_in" ? "Signed in"
      : r.entity === "tenants" && r.action === "insert" ? "Created the workspace"
      : `${r.action === "insert" ? "Added" : r.action === "update" ? "Changed" : "Removed"} ${what}`;
    const details = Object.entries(r.changes).filter(([k]) => !k.endsWith("_id") || k === "stage_id" || k === "owner_id" || k === "assignee_id")
      .map(([k, v]) => {
        const label = FIELD_LABEL[k] ?? cap(k);
        if (r.action !== "update") return `${label}: ${show(k, v)}`;
        const c = v as { changed?: boolean; from?: unknown; to?: unknown };
        return c.changed ? `${label} changed` : `${label}: ${show(k, c.from)} → ${show(k, c.to)}`;
      });
    return { ...r, actor, summary, target, details };
  });
}
