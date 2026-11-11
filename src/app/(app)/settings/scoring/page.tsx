import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { SOURCE_LABEL, type LeadSource } from "@/lib/stratos/types";
import { getMe } from "@/lib/tenant";
import { ScoringForm, type RuleRow } from "./ScoringForm";

export const metadata = { title: "Lead scoring" };

const EVENTS: Record<string, [string, string]> = {
  call_answered: ["Picks up a call", "TeleCMI call with the lead on the line"],
  call_missed: ["Misses an outbound call", "Rings out or is rejected"],
  inbound_reply: ["Replies", "WhatsApp, SMS, chat or email from the lead"],
  re_enquiry: ["Enquires again", "Submits a form when already a lead"],
  sentiment_positive: ["Positive call", "From the AI call analysis"],
  sentiment_neutral: ["Neutral call", "From the AI call analysis"],
  sentiment_negative: ["Negative call", "From the AI call analysis; also stops cadences"],
  inactivity_48h: ["Idle for 48 hours", "Applied at most once every 48 hours"],
};

export default async function ScoringPage() {
  const me = await getMe();
  if (!me.isAdmin) redirect("/dashboard");
  const rules = await me.db(async (db) => (await db.query<{ rule_key: string; value: number }>(
    "select rule_key, value from stratos.scoring_rules order by rule_key")).rows);
  const baselines: RuleRow[] = rules.filter((r) => r.rule_key.startsWith("source:")).map((r) => {
    const s = r.rule_key.slice(7) as LeadSource;
    return { ...r, label: SOURCE_LABEL[s] ?? s, hint: "" };
  });
  const deltas: RuleRow[] = rules.filter((r) => !r.rule_key.startsWith("source:")).map((r) => ({
    ...r, label: EVENTS[r.rule_key]?.[0] ?? r.rule_key.replace(/_/g, " "), hint: EVENTS[r.rule_key]?.[1] ?? "",
  }));
  return (
    <>
      <PageHeader eyebrow="Settings" title="Lead scoring"
        description="Every lead gets a conversion probability from its channel, then moves with what happens next. Each change is logged on the lead." />
      <ScoringForm baselines={baselines} deltas={deltas} />
    </>
  );
}
