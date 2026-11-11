"use client";

import { useActionState, useEffect, useState } from "react";
import { updateLeadDetailsAction, type LeadFormState } from "../actions";

type Editable = {
  full_name: string | null; email: string | null; phone: string | null; company: string | null;
  job_title: string | null; contract_value: number | null;
};

/** The Details card. Shows the lead's details; people who can write get an Edit button that turns it into a form. */
export function LeadDetails({ id, lead, rows, currency, canEdit }: {
  id: string; lead: Editable; rows: [string, string | null | undefined][]; currency: string; canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<LeadFormState, FormData>(updateLeadDetailsAction.bind(null, id), {});
  useEffect(() => { if (state.saved) setEditing(false); }, [state.saved]);

  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="h2 !mb-0">Details</h2>
        {canEdit && !editing && <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>Edit</button>}
      </div>

      {!editing ? (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}><dt className="text-xs text-ink-3">{k}</dt><dd className="font-medium text-ink">{v || "—"}</dd></div>
          ))}
        </dl>
      ) : (
        <form action={action} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="full_name" label="Name" value={lead.full_name} max={160} />
            <Field id="company" label="Company" value={lead.company} max={160} />
            <Field id="email" label="Email" type="email" value={lead.email} />
            <Field id="phone" label="Phone" type="tel" value={lead.phone} hint="Numbers without a code get your default country code." />
            <Field id="job_title" label="Job title" value={lead.job_title} max={120} />
            <div>
              <label className="label" htmlFor="contract_value">Deal value ({currency})</label>
              <input id="contract_value" name="contract_value" type="number" min="0" step="any" className="input"
                defaultValue={lead.contract_value ?? ""} />
            </div>
          </div>
          {state.error && <p className="field-error" role="alert">{state.error}</p>}
          <div className="flex gap-2">
            <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}

function Field({ id, label, value, type = "text", max, hint }: {
  id: string; label: string; value: string | null; type?: string; max?: number; hint?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} name={id} type={type} className="input" maxLength={max} defaultValue={value ?? ""} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
