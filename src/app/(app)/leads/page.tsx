import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ConsentBadge, LeadStatusBadge, ScoreBar, SourceLabel } from "@/components/leads/Badges";
import { IconPlus, IconSearch } from "@/components/Icons";
import { dateTime, money } from "@/lib/format";
import { listLeads, listStages } from "@/lib/leads/repo";
import { getMe } from "@/lib/tenant";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const me = await getMe();
  const [leads, stages] = await me.db(async (db) => [await listLeads(db, { q }), await listStages(db)] as const);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeader eyebrow="Sales" title="Leads" description="Sorted by conversion probability, highest first."
        actions={me.canWrite && <Link href="/leads/new" className="btn"><IconPlus /> New lead</Link>} />
      <form className="mb-4 flex max-w-md items-center gap-2" role="search">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input name="q" defaultValue={q} className="input !pl-10" placeholder="Search name, company or email" aria-label="Search leads" />
        </div>
        <button className="btn-secondary">Search</button>
      </form>
      <div className="card overflow-x-auto !p-0">
        {leads.length === 0 ? (
          <p className="p-6 text-sm text-ink-3">
            {q ? "No leads match that search." : "No leads yet. Add one by hand, or connect a lead source in Step 2."}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Lead</th><th>Stage</th><th>Score</th><th>Value</th><th>Source</th><th>Consent</th><th>Last activity</th></tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link href={`/leads/${l.id}`} className="font-semibold text-ink hover:text-brand">{l.full_name || l.email || l.phone}</Link>
                    <div className="text-xs text-ink-3">{l.company ?? "—"}</div>
                  </td>
                  <td>{l.status === "active" ? (l.stage_id ? stageName.get(l.stage_id) : "—") : <LeadStatusBadge status={l.status} />}</td>
                  <td><ScoreBar value={l.conversion_probability} /></td>
                  <td className="whitespace-nowrap">{money(l.contract_value, l.currency, true)}</td>
                  <td><SourceLabel source={l.source} /></td>
                  <td><ConsentBadge status={l.consent_status} /></td>
                  <td className="whitespace-nowrap text-xs">{dateTime(l.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
