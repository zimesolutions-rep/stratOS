"use client";

import { useActionState, useState } from "react";
import { createEndpoint, type SourceFormState } from "../actions";

const SOURCE_OPTIONS = [
  { value: "website_form", label: "Website form" },
  { value: "google_ads_lead_form", label: "Google Ads lead form" },
  { value: "facebook_lead_ads", label: "Facebook and Instagram Lead Ads" },
] as const;

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-ghost !min-h-8 !px-3 text-xs"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => {})}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code className="block min-w-0 flex-1 truncate rounded-[10px] border border-line bg-surface px-3 py-2 font-mono text-xs text-ink">{value}</code>
        <Copy text={value} />
      </div>
    </div>
  );
}

export function SourceForm({ cadences }: { cadences: { key: string; name: string }[] }) {
  const [state, action, pending] = useActionState<SourceFormState, FormData>(createEndpoint, {});
  const [source, setSource] = useState<string>("website_form");
  const c = state.created;

  return (
    <div className="space-y-4">
      {c && (
        <div className="space-y-3 rounded-[14px] border border-ok/30 bg-ok-soft p-4">
          <p className="text-sm font-semibold text-ok">Connected. Copy these now: the key is not shown again.</p>
          {c.source === "website_form" && <>
            <Field label="Form endpoint (POST JSON or form data)" value={c.url} />
            <p className="text-xs text-ink-2">Fields: name, email, phone, company, job_title, message, consent (true when the visitor ticked a consent box), and any utm_ fields. Add an empty hidden field named <code>website</code> to catch bots.</p>
          </>}
          {c.source === "google_ads_lead_form" && <>
            <Field label="Webhook URL" value={c.url} />
            {c.token && <Field label="Key" value={c.token} />}
            <p className="text-xs text-ink-2">In Google Ads, open the lead form asset, then Lead delivery &gt; Webhook integration, and paste both. Use &quot;Send test data&quot; to check it.</p>
          </>}
          {c.source === "facebook_lead_ads" && <>
            <Field label="Callback URL (already set on the app)" value={c.url} />
            <p className="text-xs text-ink-2">Leads from this page now arrive automatically. The page must be shared with the developer Business account and subscribed to the app&apos;s leadgen webhook.</p>
          </>}
        </div>
      )}
      <form action={action} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="source">Source</label>
          <select id="source" name="source" className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="label">Name</label>
          <input id="label" name="label" className="input" maxLength={80} placeholder="Contact page, Diwali campaign…" />
        </div>
        {source === "facebook_lead_ads" && (
          <div>
            <label className="label" htmlFor="page_id">Facebook page id</label>
            <input id="page_id" name="page_id" className="input font-mono" inputMode="numeric" required />
            <p className="hint">Instagram lead ads arrive through the linked Facebook page.</p>
          </div>
        )}
        <div>
          <label className="label" htmlFor="cadence_key">Start a follow-up cadence</label>
          <select id="cadence_key" name="cadence_key" className="input" defaultValue="">
            <option value="">No, a rep follows up by hand</option>
            {cadences.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}
          </select>
          <p className="hint">Only for people who asked to be contacted. Messages start once the cadence engine is switched on.</p>
        </div>
        {state.error && <p className="field-error sm:col-span-2" role="alert">{state.error}</p>}
        <div className="sm:col-span-2"><button className="btn" disabled={pending}>{pending ? "Connecting…" : "Connect source"}</button></div>
      </form>
    </div>
  );
}
