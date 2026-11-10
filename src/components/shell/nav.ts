export type NavIcon = "dashboard" | "leads" | "pipeline" | "new" | "settings";
export type NavItem = { href: string; label: string; icon: NavIcon; exact?: boolean };

export const NAV: { section: string; items: NavItem[] }[] = [
  { section: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }] },
  {
    section: "Sales",
    items: [
      { href: "/leads", label: "Leads", icon: "leads", exact: true },
      { href: "/pipeline", label: "Pipeline", icon: "pipeline" },
    ],
  },
];

/** Shown to workspace owners and admins only. */
export const ADMIN_NAV: { section: string; items: NavItem[] } = {
  section: "Workspace",
  items: [{ href: "/settings", label: "Settings", icon: "settings" }],
};
