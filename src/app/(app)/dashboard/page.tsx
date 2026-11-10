import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ScoreBar } from "@/components/leads/Badges";
import { money } from "@/lib/format";
import { listLeads } from "@/lib/leads/repo";
import { INDUSTRY_LABEL } from "@/lib/stratos/types";
import { getMe } from "@/lib/tenant";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const me = await getMe();
  const leads = await me.db((db) => listLeads(db, { limit: 500 }));
  const active = leads.filter((l) => l.status === "active");
  const cur = me.tenant.default_currency;
  const pipeline = active.reduce((t, l) => t + (l.contract_value ?? 0), 0);
  const weighted = active.reduce((t, l) => t + (l.contract_value ?? 0) * l.conversion_probability / 100, 0);
  const hot = active.filter((l) => l.conversion_probability >= 60).length;
  const stale = active.filter((l) => Date.now() - Date.parse(l.last_activity_at) > 48 * 3600_000).length;

  const metrics = [
    { label: "Active leads", value: String(active.length) },
    { label: "Pipeline value", value: money(pipeline, cur, true) },
    { label: "Weighted pipeline", value: money(weighted, cur, true) },
    { label: "Hot (60%+)", value: String(hot) },
    { label: "Idle over 48 hours", value: String(stale) },
  ];

  return (
    <>
      {welcome && (
        <div className="mb-6 rounded-[18px] bg-brand-soft p-4 text-sm text-brand-strong">
          Your {INDUSTRY_LABEL[me.tenant.industry].toLowerCase()} workspace is ready, with pipeline stages, a starter cadence and lead scoring set up.
        </div>
      )}
      <PageHeader eyebrow={me.tenant.name} title="Dashboard" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map((m) => (
          <div key={m.label} className="card">
            <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">{m.label}</div>
            <div className="mt-2 font-heading text-2xl font-extrabold text-ink">{m.value}</div>
          </div>
        ))}
      </div>
      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="h2 !mb-0">Most likely to convert</h2>
          <Link href="/leads" className="text-sm font-medium text-brand hover:underline">All leads</Link>
        </div>
        {active.length === 0 ? <p className="text-sm text-ink-3">No active leads yet.</p> : (
          <ul className="divide-y divide-line">
            {active.slice(0, 8).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-4 py-3">
                <Link href={`/leads/${l.id}`} className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink hover:text-brand">{l.full_name || l.email || l.phone}</div>
                  <div className="truncate text-xs text-ink-3">{l.company ?? "—"}</div>
                </Link>
                <ScoreBar value={l.conversion_probability} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
