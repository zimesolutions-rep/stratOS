import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { dateTime } from "@/lib/format";
import { SOURCE_LABEL, type LeadSource } from "@/lib/stratos/types";
import { getMe } from "@/lib/tenant";
import { setEndpointActive } from "../actions";
import { SourceForm } from "./SourceForm";

export const metadata = { title: "Lead sources" };

type Row = { id: string; source: LeadSource; label: string | null; token_prefix: string | null; config: { page_id?: string; cadence_key?: string };
  active: boolean; last_used_at: string | null; created_at: string };

export default async function SourcesPage() {
  const me = await getMe();
  if (!me.isAdmin) redirect("/dashboard");
  const [rows, cadences] = await me.db(async (db) => [
    (await db.query<Row>(
      "select id, source, label, token_prefix, config, active, last_used_at, created_at from stratos.inbound_endpoints order by active desc, created_at desc")).rows,
    (await db.query<{ key: string; name: string }>("select key, name from stratos.cadences where active and key is not null order by name")).rows,
  ] as const);
  const cadenceName = new Map(cadences.map((c) => [c.key, c.name]));

  return (
    <>
      <PageHeader eyebrow="Settings" title="Lead sources"
        description="Leads from these sources land in this workspace with a starting score for their channel. Re-submissions by someone you already have are added to their lead, not duplicated." />
      <div className="grid gap-6">
        <section className="card">
          <h2 className="h2">Connect a source</h2>
          <SourceForm cadences={cadences} />
        </section>
        <section className="card overflow-x-auto">
          <h2 className="h2">Connected</h2>
          {rows.length === 0 ? <p className="text-sm text-ink-3">Nothing connected yet.</p> : (
            <table className="table">
              <thead><tr><th>Source</th><th>Name</th><th>Key</th><th>Cadence</th><th>Last lead</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.active ? "" : "opacity-60"}>
                    <td>{SOURCE_LABEL[r.source]}{r.config.page_id && <div className="font-mono text-xs text-ink-3">page {r.config.page_id}</div>}</td>
                    <td>{r.label ?? "—"}</td>
                    <td className="font-mono text-xs">{r.source === "facebook_lead_ads" ? "signed by Meta" : `${r.token_prefix ?? ""}…`}</td>
                    <td>{r.config.cadence_key ? cadenceName.get(r.config.cadence_key) ?? r.config.cadence_key : "—"}</td>
                    <td className="whitespace-nowrap text-xs">{r.last_used_at ? dateTime(r.last_used_at) : "Never"}</td>
                    <td className="text-right">
                      <form action={setEndpointActive.bind(null, r.id, !r.active)}>
                        <button className="btn-ghost !min-h-8 !px-3 text-xs">{r.active ? "Disconnect" : "Reconnect"}</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
