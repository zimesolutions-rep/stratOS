import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/PageHeader";
import { ConsentBadge, LeadStatusBadge, ScoreBar, SourceLabel } from "@/components/leads/Badges";
import { dateTime, money } from "@/lib/format";
import { getLead, listStages, scoreHistory } from "@/lib/leads/repo";
import { CONSENT_LABEL, CONSENT_STATUSES, LEAD_STATUSES } from "@/lib/stratos/types";
import { getMe } from "@/lib/tenant";
import { updateLeadAction } from "../actions";

export const metadata = { title: "Lead" };

const RULE_LABEL: Record<string, string> = {
  call_answered: "Picked up a call", call_missed: "Missed a call", inbound_reply: "Replied",
  sentiment_positive: "Positive call", sentiment_neutral: "Neutral call", sentiment_negative: "Negative call",
  inactivity_48h: "No activity for 48 hours",
};

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const me = await getMe();
  const [lead, stages, history] = await me.db(async (db) => [await getLead(db, id), await listStages(db), await scoreHistory(db, id)] as const);
  if (!lead) notFound();
  const update = updateLeadAction.bind(null, lead.id);
  const stage = stages.find((s) => s.id === lead.stage_id);

  return (
    <>
      <PageHeader eyebrow={lead.company ?? "Lead"} title={lead.full_name || lead.email || lead.phone || "Lead"}
        description={<span className="inline-flex flex-wrap items-center gap-3"><LeadStatusBadge status={lead.status} /><ConsentBadge status={lead.consent_status} /><SourceLabel source={lead.source} /></span>} />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section className="card">
            <h2 className="h2">Details</h2>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {([
                ["Email", lead.email], ["Phone", lead.phone], ["Company", lead.company], ["Job title", lead.job_title],
                ["Deal value", money(lead.contract_value, lead.currency)], ["Stage", stage?.name],
                ["Created", dateTime(lead.created_at)], ["Last activity", dateTime(lead.last_activity_at)],
              ] as const).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-ink-3">{k}</dt><dd className="font-medium text-ink">{v || "—"}</dd></div>
              ))}
            </dl>
          </section>

          <section className="card">
            <h2 className="h2">Score history</h2>
            <div className="mb-4 flex items-center gap-3 text-sm text-ink-2">
              <ScoreBar value={lead.conversion_probability} /> <span>started at {Math.round(lead.baseline_probability)}% from the lead source</span>
            </div>
            {history.length === 0 ? <p className="text-sm text-ink-3">No changes yet. Calls, replies and inactivity move the score.</p> : (
              <table className="table">
                <thead><tr><th>When</th><th>Why</th><th>Change</th><th>Score</th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="whitespace-nowrap text-xs">{dateTime(h.created_at)}</td>
                      <td>{RULE_LABEL[h.rule_key] ?? h.rule_key}</td>
                      <td className={h.delta >= 0 ? "text-ok" : "text-bad"}>{h.delta > 0 ? "+" : ""}{h.delta}</td>
                      <td>{Math.round(h.score_after)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        {me.canWrite && (
          <aside className="space-y-6">
            <form key={`${lead.stage_id}-${lead.status}`} action={update} className="card space-y-4">
              <h2 className="h2 !mb-0">Pipeline</h2>
              <div>
                <label className="label" htmlFor="stage_id">Stage</label>
                <select id="stage_id" name="stage_id" className="input" defaultValue={lead.stage_id ?? ""}>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="status">Status</label>
                <select id="status" name="status" className="input" defaultValue={lead.status}>
                  {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
                <p className="hint">Unsubscribed, won, lost and archived stop every follow-up cadence.</p>
              </div>
              <button className="btn-secondary w-full">Save</button>
            </form>

            <form key={lead.consent_status} action={update} className="card space-y-4">
              <h2 className="h2 !mb-0">Consent and data</h2>
              <p className="text-xs text-ink-3">
                {lead.consent_updated_at ? `Last changed ${dateTime(lead.consent_updated_at)}.` : "No consent recorded yet."}
                {" "}Withdrawing consent stops all messages. Requesting erasure also deletes this lead and its history permanently within 30 days.
              </p>
              <select name="consent_status" className="input" defaultValue={lead.consent_status} aria-label="Consent">
                {CONSENT_STATUSES.map((c) => <option key={c} value={c}>{CONSENT_LABEL[c]}</option>)}
              </select>
              <button className="btn-secondary w-full">Update consent</button>
            </form>
          </aside>
        )}
      </div>
    </>
  );
}
