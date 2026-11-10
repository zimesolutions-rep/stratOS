"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { IconClose, IconCollapse, IconDashboard, IconExpand, IconLeads, IconMenu, IconPipeline, IconPlus, IconSettings } from "@/components/Icons";
import { ADMIN_NAV, NAV, type NavItem } from "./nav";
import { LiveClock } from "./LiveClock";
import { ProfileMenu } from "./ProfileMenu";
import { TenantSwitcher, type TenantOption } from "./TenantSwitcher";

const ICONS = { dashboard: IconDashboard, leads: IconLeads, pipeline: IconPipeline, new: IconPlus, settings: IconSettings };
const STORAGE_KEY = "stratos.sidebar.collapsed";

export type ShellUser = {
  name: string; email: string; role: string; canWrite: boolean; isAdmin: boolean;
  tenant: TenantOption; tenants: TenantOption[];
};

/**
 * Same shell as DealGuard and myHR: top context bar (workspace + profile), a collapsible left command bar,
 * and a centered max-w-7xl content wrapper. Step 5 adds the AI tray on the right of this layout.
 */
export function AppShell({ user, signOut, switchTenant, children }: {
  user: ShellUser; signOut: () => Promise<void>; switchTenant: (id: string) => Promise<void>; children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const path = usePathname();

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(STORAGE_KEY) === "1"); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => setMobileOpen(false), [path]);

  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem(STORAGE_KEY, c ? "0" : "1"); } catch { /* storage blocked */ }
    return !c;
  });

  // "Leads" stays lit on a lead's page, but not on /leads/new (the New lead button covers that).
  const isActive = (item: NavItem) => path === item.href
    || (path.startsWith(`${item.href}/`) && !(item.exact && path === `${item.href}/new`));

  const nav = (compact: boolean) => (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {user.canWrite && (
        <Link href="/leads/new" title={compact ? "New lead" : undefined}
          className={`btn ${compact ? "!px-0" : ""}`} aria-current={path === "/leads/new" ? "page" : undefined}>
          <IconPlus /> {!compact && "New lead"}
        </Link>
      )}
      {(user.isAdmin ? [...NAV, ADMIN_NAV] : NAV).map((group) => (
        <div key={group.section}>
          {!compact && <div className="mb-2 px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">{group.section}</div>}
          <ul className="grid gap-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isActive(item);
              return (
                <li key={item.href}>
                  <Link href={item.href} title={compact ? item.label : undefined} aria-current={active ? "page" : undefined}
                    className={`flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition ${compact ? "justify-center" : ""} ${
                      active ? "bg-brand-soft text-brand-strong" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}>
                    <Icon className={`flex-none ${active ? "text-brand" : "text-ink-3"}`} />
                    {!compact && <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className={`sticky top-0 hidden h-screen flex-none flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex ${collapsed ? "w-[76px]" : "w-64"}`}>
        <div className={`flex h-[72px] items-center border-b border-line ${collapsed ? "justify-center" : "px-5"}`}>
          <Link href="/dashboard" aria-label="Home"><Logo compact={collapsed} /></Link>
        </div>
        {nav(collapsed)}
        <button type="button" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="m-3 flex min-h-10 items-center justify-center gap-2 rounded-[10px] text-sm text-ink-3 transition hover:bg-surface-2 hover:text-ink">
          {collapsed ? <IconExpand /> : <><IconCollapse /> Collapse</>}
        </button>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-surface">
            <div className="flex h-[72px] items-center justify-between border-b border-line px-5">
              <Logo />
              <button type="button" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-ink" aria-label="Close menu"><IconClose /></button>
            </div>
            {nav(false)}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
          <div className="flex min-h-[72px] items-center gap-3 px-4 sm:px-6">
            <button type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-ink lg:hidden" aria-label="Open menu"><IconMenu /></button>
            <Link href="/dashboard" className="lg:hidden" aria-label="Home"><Logo compact /></Link>
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3 xl:inline">Workspace</span>
              <TenantSwitcher current={user.tenant} options={user.tenants} switchTenant={switchTenant} />
            </div>
            <div className="hidden flex-1 justify-center md:flex"><LiveClock /></div>
            <div className="ml-auto md:ml-0"><ProfileMenu name={user.name} email={user.email} role={user.role} signOut={signOut} /></div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-ink-3 sm:px-6">
          Built by <a href="https://www.zimesolutions.com" className="font-medium text-brand hover:underline">Zime Solutions</a>
        </footer>
      </div>
    </div>
  );
}
