import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/PageHeader";
import { listAudit } from "@/lib/audit";
import { dateTime } from "@/lib/format";
import { getMe } from "@/lib/tenant";

export const metadata = { title: "Activity log" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const me = await getMe();
  if (!me.isAdmin) redirect("/dashboard");
  const { lead } = await searchParams;
  const leadId = lead && z.uuid().safeParse(lead).success ? lead : undefined;
  const entries = await me.db((db) => listAudit(db, { entityId: leadId }));

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Activity log"
        description={<>Every change in this workspace, who made it and when, including sign-ins and changes made by webhooks and scheduled jobs (shown as System). For personal details such as names, emails and phone numbers, the log records that they changed but not the values.</>}
        actions={leadId ? <Link href="/settings/activity" className="btn-secondary">Show everything</Link> : undefined} />
      <section className="card overflow-x-auto">
        {leadId && <p className="mb-4 text-sm text-ink-2">Showing activity for one lead. <Link href={`/leads/${leadId}`} className="font-medium text-brand hover:underline">Back to the lead</Link></p>}
        {entries.length === 0 ? <p className="text-sm text-ink-3">Nothing recorded yet.</p> : (
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs">{dateTime(e.at)}</td>
                  <td className="whitespace-nowrap">{e.actor}</td>
                  <td>
                    {e.summary}
                    {e.target && <> · {e.entity === "leads" || e.changes.lead_id
                      ? <Link href={`/leads/${e.entity === "leads" ? e.entity_id : e.changes.lead_id}`} className="font-medium text-brand hover:underline">{e.target}</Link>
                      : <span className="font-medium">{e.target}</span>}</>}
                  </td>
                  <td className="text-xs text-ink-2">{e.details.length ? e.details.map((d, i) => <div key={i}>{d}</div>) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {entries.length === 200 && <p className="mt-4 text-xs text-ink-3">Showing the latest 200 entries.</p>}
      </section>
    </>
  );
}
