import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ScoreBar } from "@/components/leads/Badges";
import { money } from "@/lib/format";
import { listLeads, listStages } from "@/lib/leads/repo";
import { getMe } from "@/lib/tenant";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const me = await getMe();
  const [stages, leads] = await me.db(async (db) => [await listStages(db), await listLeads(db, { limit: 500 })] as const);
  const active = leads.filter((l) => l.status === "active" || l.status === "won");
  const cur = me.tenant.default_currency;

  return (
    <>
      <PageHeader eyebrow="Sales" title="Pipeline" description="Weighted value is deal value times conversion probability." />
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.filter((s) => !s.is_lost).map((s) => {
          const items = active.filter((l) => l.stage_id === s.id);
          const value = items.reduce((t, l) => t + (l.contract_value ?? 0), 0);
          const weighted = items.reduce((t, l) => t + (l.contract_value ?? 0) * l.conversion_probability / 100, 0);
          return (
            <section key={s.id} className="flex w-72 flex-none flex-col rounded-[18px] border border-line bg-surface-2">
              <header className="border-b border-line p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-heading text-sm font-bold text-ink">{s.name}</h2>
                  <span className="font-mono text-xs text-ink-3">{items.length}</span>
                </div>
                <div className="mt-1 text-xs text-ink-3">{money(value, cur, true)} · weighted {money(weighted, cur, true)}</div>
              </header>
              <ul className="grid gap-2 p-3">
                {items.length === 0 && <li className="px-1 text-xs text-ink-3">No leads</li>}
                {items.map((l) => (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className="card block !p-3">
                      <div className="truncate text-sm font-semibold text-ink">{l.full_name || l.email || l.phone}</div>
                      <div className="truncate text-xs text-ink-3">{l.company ?? "—"}</div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <ScoreBar value={l.conversion_probability} />
                        <span className="text-xs text-ink-2">{money(l.contract_value, l.currency, true)}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
