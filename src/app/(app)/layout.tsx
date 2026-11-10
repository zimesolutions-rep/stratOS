import { AppShell } from "@/components/shell/AppShell";
import { switchTenant } from "@/app/actions";
import { signOut } from "@/app/login/actions";
import { displayName } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/stratos/types";
import { getMe } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const user = {
    name: displayName({ full_name: me.name, email: me.email }),
    email: me.email,
    role: ROLE_LABEL[me.role],
    canWrite: me.canWrite,
    isAdmin: me.isAdmin,
    tenant: { id: me.tenant.id, name: me.tenant.name },
    tenants: me.memberships.map((m) => ({ id: m.tenant_id, name: m.tenant_name })),
  };
  return <AppShell user={user} signOut={signOut} switchTenant={switchTenant}>{children}</AppShell>;
}
