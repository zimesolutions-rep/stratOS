import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { currentUserId } from "@/lib/auth/current-user";
import { asService, asTenantUser, type Db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { canWrite, isAdminRole, type Membership, type MemberRole, type Tenant } from "@/lib/stratos/types";

/**
 * The tenant a request works in. The cookie only says which tenant the person picked; it is never trusted on its
 * own: stratos.current_tenant_id() returns it only if this user is an active member, so a forged value sees nothing.
 */
export const TENANT_COOKIE = "stratos.tenant";

export type Me = {
  userId: string;
  email: string;
  name: string;
  tenant: Tenant;
  role: MemberRole;
  memberships: Membership[];
  canWrite: boolean;
  isAdmin: boolean;
  db: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
};

async function memberships(userId: string): Promise<Membership[]> {
  return asTenantUser(userId, null, async (db) => (await db.query<Membership>(
    `select m.tenant_id, t.name as tenant_name, t.slug, m.role
       from stratos.tenant_members m join stratos.tenants t on t.id = m.tenant_id
      where m.user_id = $1 and m.active
      order by t.name`, [userId])).rows);
}

async function resolve(userId: string): Promise<Omit<Me, "email" | "name"> | null> {
  const list = await memberships(userId);
  if (!list.length) return null;
  const picked = (await cookies()).get(TENANT_COOKIE)?.value;
  const m = list.find((x) => x.tenant_id === picked) ?? list[0];
  const db: Me["db"] = (fn) => asTenantUser(userId, m.tenant_id, fn);
  const tenant = await db(async (q) => (await q.query<Tenant>(
    `select id, name, slug, industry, compliance_regimes, customer_markets, data_region, default_currency, timezone, retention_days
       from stratos.tenants where id = stratos.current_tenant_id()`)).rows[0]);
  if (!tenant) return null;
  return { userId, tenant, role: m.role, memberships: list, canWrite: canWrite(m.role), isAdmin: isAdminRole(m.role), db };
}

async function userInfo(userId: string) {
  // "user" is Better Auth's table and the app role has no grant on it, so read this one row on the owner connection.
  return asService(async (db) => (await db.query<{ email: string; name: string }>(
    `select email, name from "user" where id = $1`, [userId])).rows[0] ?? { email: "", name: "" });
}

/** For pages: signed-in user and their current tenant. Redirects to /login or /onboarding. */
export const getMe = cache(async (): Promise<Me> => {
  const userId = await currentUserId();
  if (!userId) redirect("/login");
  const [ctx, info] = await Promise.all([resolve(userId), userInfo(userId)]);
  if (!ctx) redirect("/onboarding");
  return { ...ctx, ...info };
});

/** For route handlers and server actions: throws ApiError instead of redirecting. */
export async function requireMember(opts: { write?: boolean; admin?: boolean } = {}): Promise<Me> {
  const userId = await currentUserId();
  if (!userId) throw new ApiError(401, "unauthenticated", "Sign in first");
  const [ctx, info] = await Promise.all([resolve(userId), userInfo(userId)]);
  if (!ctx) throw new ApiError(403, "no_tenant", "Create or join a workspace first");
  if (opts.write && !ctx.canWrite) throw new ApiError(403, "forbidden", "Viewers can't change data");
  if (opts.admin && !ctx.isAdmin) throw new ApiError(403, "forbidden", "Only workspace admins can do that");
  return { ...ctx, ...info };
}
