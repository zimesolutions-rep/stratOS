"use client";

import { useActionState, useState } from "react";
import { INDUSTRIES, INDUSTRY_LABEL, MARKET_LABEL, MARKET_REGIMES, MARKETS, REGIMES, REGIME_LABEL, type Market, type Regime } from "@/lib/stratos/types";
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
  const [markets, setMarkets] = useState<Market[]>(["in"]);
  const [regimes, setRegimes] = useState<Regime[]>(["dpdp"]);

  // Ticking a market ticks its privacy laws; unticking removes the ones no other ticked market needs.
  const toggleMarket = (m: Market, on: boolean) => {
    const next = on ? [...markets, m] : markets.filter((x) => x !== m);
    setMarkets(next);
    if (on) setRegimes((r) => [...new Set([...r, ...MARKET_REGIMES[m]])]);
    else {
      const stillNeeded = new Set(next.flatMap((x) => MARKET_REGIMES[x]));
      setRegimes((r) => r.filter((x) => !MARKET_REGIMES[m].includes(x) || stillNeeded.has(x)));
    }
  };
  const toggleRegime = (r: Regime, on: boolean) => setRegimes((cur) => on ? [...cur, r] : cur.filter((x) => x !== r));

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

      <fieldset>
        <legend className="label">Where your customers are</legend>
        <p className="hint !mt-0 mb-3">Pick every market you sell to or hold personal data from. We suggest the privacy laws for each.</p>
        <div className="flex flex-wrap gap-2">
          {MARKETS.map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3.5 py-2 text-sm text-ink-2 transition has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand-strong">
              <input type="checkbox" name="markets" value={m} checked={markets.includes(m)} onChange={(e) => toggleMarket(m, e.target.checked)} />
              {MARKET_LABEL[m]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Privacy laws that apply</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {REGIMES.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" name="regimes" value={r} checked={regimes.includes(r)} onChange={(e) => toggleRegime(r, e.target.checked)} /> {REGIME_LABEL[r]}
            </label>
          ))}
        </div>
        <p className="hint">Tick HIPAA if you handle US patients&apos; health details: it turns on strict masking before any AI processing. Every workspace gets consent tracking, erasure on request and PII masking whatever you tick.</p>
      </fieldset>

      {state.error && <p className="field-error" role="alert">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? "Setting up…" : "Create workspace"}</button>
    </form>
  );
}
