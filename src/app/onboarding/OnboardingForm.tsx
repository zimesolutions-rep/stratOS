"use client";

import { useActionState, useState } from "react";
import { INDUSTRIES, INDUSTRY_LABEL, REGIMES, REGIME_LABEL } from "@/lib/stratos/types";
import { createWorkspace, type OnboardingState } from "./actions";

const INDUSTRY_HINT: Record<(typeof INDUSTRIES)[number], string> = {
  digital_marketing_agency: "Enquiry, discovery call, audit, negotiation, retainer",
  it_consulting_saas: "Qualified, demo, POC, proposal, closed",
  recruitment_staffing: "Requirement, intake, shortlist, interviews, offer, placement",
  tech_support: "Enquiry, assessment, quote, AMC signed",
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

export function OnboardingForm() {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createWorkspace, {});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="label">Workspace name</label>
          <input id="name" name="name" className="input" required maxLength={80} value={name} placeholder="Acme Digital"
            onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }} />
        </div>
        <div>
          <label htmlFor="slug" className="label">Workspace address</label>
          <input id="slug" name="slug" className="input font-mono" required value={slug} pattern="[a-z0-9][a-z0-9\-]{1,46}[a-z0-9]"
            onChange={(e) => { setSlug(slugify(e.target.value)); setSlugEdited(true); }} />
          <p className="hint">Lowercase letters, digits and hyphens.</p>
        </div>
      </div>

      <fieldset>
        <legend className="label">Industry</legend>
        <p className="hint !mt-0 mb-3">Sets up your pipeline stages, a starter follow-up cadence and lead scoring. You can change them later.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {INDUSTRIES.map((i, n) => (
            <label key={i} className="flex cursor-pointer gap-3 rounded-[14px] border border-line p-4 transition has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="radio" name="industry" value={i} required defaultChecked={n === 0} className="mt-1" />
              <span>
                <span className="block text-sm font-bold text-ink">{INDUSTRY_LABEL[i]}</span>
                <span className="block text-xs text-ink-3">{INDUSTRY_HINT[i]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="label">Data protection laws that apply</legend>
          <div className="space-y-2">
            {REGIMES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" name="regimes" value={r} defaultChecked={r === "dpdp"} /> {REGIME_LABEL[r]}
              </label>
            ))}
          </div>
          <p className="hint">HIPAA turns on strict masking of health details before any AI processing.</p>
        </fieldset>
        <div>
          <label htmlFor="region" className="label">Where your customers are</label>
          <select id="region" name="region" className="input" defaultValue="in">
            <option value="in">India</option>
            <option value="eu">European Union</option>
            <option value="us">United States</option>
          </select>
        </div>
      </div>

      {state.error && <p className="field-error" role="alert">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? "Setting up…" : "Create workspace"}</button>
    </form>
  );
}
