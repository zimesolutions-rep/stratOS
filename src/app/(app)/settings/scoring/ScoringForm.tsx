"use client";

import { useActionState } from "react";
import { saveScoring, type ScoringState } from "../actions";

export type RuleRow = { rule_key: string; value: number; label: string; hint: string };

export function ScoringForm({ baselines, deltas }: { baselines: RuleRow[]; deltas: RuleRow[] }) {
  const [state, action, pending] = useActionState<ScoringState, FormData>(saveScoring, {});
  const row = (r: RuleRow, min: number) => (
    <tr key={r.rule_key}>
      <td><div className="font-medium text-ink">{r.label}</div><div className="text-xs text-ink-3">{r.hint}</div></td>
      <td className="w-32">
        <input name={`rule:${r.rule_key}`} type="number" min={min} max={100} step="0.5" defaultValue={r.value} required
          className="input !py-1.5 text-right font-mono" aria-label={r.label} />
      </td>
    </tr>
  );
  return (
    <form action={action} className="grid gap-6 lg:grid-cols-2">
      <section className="card">
        <h2 className="h2">Starting score by channel</h2>
        <table className="table"><thead><tr><th>Channel</th><th className="text-right">Score %</th></tr></thead>
          <tbody>{baselines.map((r) => row(r, 0))}</tbody></table>
      </section>
      <section className="card">
        <h2 className="h2">What moves the score</h2>
        <table className="table"><thead><tr><th>Event</th><th className="text-right">Points</th></tr></thead>
          <tbody>{deltas.map((r) => row(r, -100))}</tbody></table>
        <p className="hint">Scores stay between 0 and 100 and never fall below the minimum of the lead&apos;s stage.</p>
      </section>
      <div className="flex items-center gap-3 lg:col-span-2">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save scoring"}</button>
        {state.saved && <span className="text-sm text-ok">Saved. New events use these numbers; existing scores stay as they are.</span>}
        {state.error && <span className="field-error !mt-0" role="alert">{state.error}</span>}
      </div>
    </form>
  );
}
