import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { listStages } from "@/lib/leads/repo";
import { getMe } from "@/lib/tenant";
import { LeadForm } from "./LeadForm";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const me = await getMe();
  if (!me.canWrite) redirect("/leads");
  const stages = await me.db(listStages);
  return (
    <>
      <PageHeader eyebrow="Leads" title="New lead" description="Give at least a name, an email or a phone number." />
      <LeadForm stages={stages} currency={me.tenant.default_currency} />
    </>
  );
}
