"use client";

import { useTransition } from "react";

export type TenantOption = { id: string; name: string };

/** Workspace chip in the top bar; a select when the person belongs to more than one workspace. */
export function TenantSwitcher({ current, options, switchTenant }: {
  current: TenantOption; options: TenantOption[]; switchTenant: (id: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  if (options.length < 2) {
    return <span className="truncate rounded-full border border-line bg-surface-2 px-3 py-1 text-sm font-semibold text-ink">{current.name}</span>;
  }
  return (
    <select aria-label="Workspace" disabled={pending} value={current.id}
      onChange={(e) => start(() => switchTenant(e.target.value))}
      className="max-w-[16rem] truncate rounded-full border border-line bg-surface-2 px-3 py-1 text-sm font-semibold text-ink">
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
