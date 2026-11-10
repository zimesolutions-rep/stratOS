"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function ProfileMenu({ name, email, role, signOut }: { name: string; email: string; role: string; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className="flex min-h-11 items-center gap-3 rounded-full border border-line bg-surface py-1 pl-1 pr-4 transition hover:border-brand">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-chrome text-xs font-bold text-white">{initials || "?"}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[12rem] truncate text-sm font-bold text-ink">{name}</span>
          <span className="block text-xs text-ink-3">{role}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-[18px] border border-line bg-surface p-2 shadow-[0_16px_40px_rgba(15,23,42,0.16)]">
          <div className="border-b border-line px-3 pb-3 pt-2">
            <div className="truncate font-bold text-ink">{name}</div>
            <div className="truncate text-xs text-ink-3">{email}</div>
            <div className="mt-2 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-strong">{role}</div>
          </div>
          <Link href="/onboarding?new=1" role="menuitem" className="mt-1 block rounded-[10px] px-3 py-2 text-sm text-ink-2 hover:bg-surface-2">
            Create another workspace
          </Link>
          <form action={signOut} className="px-1 pb-1 pt-2">
            <button className="btn-secondary w-full" role="menuitem">Sign out</button>
          </form>
        </div>
      )}
    </div>
  );
}
