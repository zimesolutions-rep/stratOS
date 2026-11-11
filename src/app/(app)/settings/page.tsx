import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { INDUSTRY_LABEL, REGIME_LABEL, ROLE_LABEL, type MemberRole } from "@/lib/stratos/types";
import { getMe } from "@/lib/tenant";
import { listStages } from "@/lib/leads/repo";

export const metadata = { title: "Settings" };

const RULE_LABEL = (k: string) => k.startsWith("source:") ? `Starting score: ${k.slice(7).replace(/_/g, " ")}` : k.replace(/_/g, " ");

/** Read-only for Step 1: what onboarding seeded. Editing comes with Steps 2 and 4. */
export default async function SettingsPage() {
  const me = await getMe();
  if (!me.isAdmin) redirect("/dashboard");
  // One transaction, one client: queries run one after another (pg refuses overlapping queries on a client).
  const [stages, rules, steps, members] = await me.db(async (db) => [
    await listStages(db),
    (await db.query<{ rule_key: string; value: number }>("select rule_key, value from stratos.scoring_rules order by rule_key")).rows,
    (await db.query<{ cadence: string; position: number; channel: string; delay_minutes: number; body: string | null }>(
      `select c.name as cadence, s.position, s.channel, s.delay_minutes, s.body
         from stratos.cadence_steps s join stratos.cadences c on c.id = s.cadence_id order by c.name, s.position`)).rows,
    (await db.query<{ user_id: string; role: MemberRole; display_name: string | null; active: boolean }>(
      "select user_id, role, display_name, active from stratos.tenant_members order by role, created_at")).rows,
  ] as const);
  const t = me.tenant;
  const delay = (m: number) => m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Settings" description="What your workspace was set up with." actions={<><Link href="/settings/sources" className="btn-secondary">Lead sources</Link><Link href="/settings/scoring" className="btn-secondary">Edit scoring</Link></>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="h2">Workspace</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {([["Name", t.name], ["Address", t.slug], ["Industry", INDUSTRY_LABEL[t.industry]],
               ["Data protection", t.compliance_regimes.map((r) => REGIME_LABEL[r]).join(", ")],
               ["Region", t.data_region.toUpperCase()], ["Currency", t.default_currency],
               ["Retention", t.retention_days ? `${t.retention_days} days after a lead closes` : "Until erasure is requested"]] as const)
              .map(([k, v]) => <div key={k}><dt className="text-xs text-ink-3">{k}</dt><dd className="font-medium text-ink">{v}</dd></div>)}
          </dl>
        </section>
        <section className="card">
          <h2 className="h2">Members</h2>
          <ul className="divide-y divide-line text-sm">
            {members.map((m) => (
              <li key={m.user_id} className="flex justify-between py-2">
                <span className="text-ink">{m.user_id === me.userId ? `${me.name || me.email} (you)` : m.display_name ?? m.user_id}</span>
                <span className="text-ink-3">{ROLE_LABEL[m.role]}{m.active ? "" : " · removed"}</span>
              </li>
            ))}
          </ul>
          <p className="hint">Inviting teammates comes next.</p>
        </section>
        <section className="card">
          <h2 className="h2">Pipeline stages</h2>
          <table className="table">
            <thead><tr><th>Stage</th><th>Floor</th><th>Type</th></tr></thead>
            <tbody>{stages.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.probability}%</td><td>{s.is_won ? "Won" : s.is_lost ? "Lost" : "Open"}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="card">
          <h2 className="h2">Lead scoring</h2>
          <table className="table">
            <thead><tr><th>Rule</th><th>Points</th></tr></thead>
            <tbody>{rules.map((r) => <tr key={r.rule_key}><td className="capitalize">{RULE_LABEL(r.rule_key)}</td><td>{r.value > 0 && !r.rule_key.startsWith("source:") ? "+" : ""}{r.value}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="card lg:col-span-2">
          <h2 className="h2">Starter cadence</h2>
          <table className="table">
            <thead><tr><th>Cadence</th><th>Step</th><th>Channel</th><th>Wait</th><th>Message</th></tr></thead>
            <tbody>{steps.map((s) => (
              <tr key={`${s.cadence}-${s.position}`}><td>{s.cadence}</td><td>{s.position}</td><td className="capitalize">{s.channel.replace("_", " ")}</td><td>{delay(s.delay_minutes)}</td><td className="text-xs">{s.body}</td></tr>
            ))}</tbody>
          </table>
        </section>
      </div>
    </>
  );
}
