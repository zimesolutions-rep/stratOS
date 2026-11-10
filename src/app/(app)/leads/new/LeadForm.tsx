"use client";

import { useActionState } from "react";
import { CONSENT_LABEL, CONSENT_STATUSES, LEAD_SOURCES, SOURCE_LABEL, type Stage } from "@/lib/stratos/types";
import { createLeadAction, type LeadFormState } from "../actions";

export function LeadForm({ stages, currency }: { stages: Stage[]; currency: string }) {
  const [state, action, pending] = useActionState<LeadFormState, FormData>(createLeadAction, {});
  const open = stages.filter((s) => !s.is_won && !s.is_lost);
  return (
    <form action={action} className="card max-w-3xl space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="full_name">Name</label><input id="full_name" name="full_name" className="input" maxLength={160} /></div>
        <div><label className="label" htmlFor="company">Company</label><input id="company" name="company" className="input" maxLength={160} /></div>
        <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" /></div>
        <div>
          <label className="label" htmlFor="phone">Phone</label>
          <input id="phone" name="phone" type="tel" className="input" placeholder="+91 98765 43210" />
          <p className="hint">Saved in international format; numbers without a code get your default country code.</p>
        </div>
        <div><label className="label" htmlFor="job_title">Job title</label><input id="job_title" name="job_title" className="input" maxLength={120} /></div>
        <div>
          <label className="label" htmlFor="contract_value">Deal value ({currency})</label>
          <input id="contract_value" name="contract_value" type="number" min="0" step="any" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="source">Source</label>
          <select id="source" name="source" className="input" defaultValue="manual">
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
          <p className="hint">Sets the starting score.</p>
        </div>
        <div>
          <label className="label" htmlFor="stage_id">Stage</label>
          <select id="stage_id" name="stage_id" className="input" defaultValue="">
            <option value="">First stage</option>
            {open.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="consent_status">Consent to contact</label>
          <select id="consent_status" name="consent_status" className="input" defaultValue="unknown">
            {CONSENT_STATUSES.filter((c) => c !== "erasure_requested").map((c) => <option key={c} value={c}>{CONSENT_LABEL[c]}</option>)}
          </select>
          <p className="hint">Record &quot;Granted&quot; only when the person agreed to be contacted.</p>
        </div>
      </div>
      {state.error && <p className="field-error" role="alert">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? "Saving…" : "Add lead"}</button>
    </form>
  );
}
