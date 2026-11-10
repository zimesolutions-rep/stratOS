import { attachDatabasePool } from "@vercel/functions";
import { Pool, types, type PoolClient } from "pg";
import { env } from "@/lib/env";

// Keep Postgres values in the shapes the rest of the app (and JSON) expects.
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : Number(v)));
types.setTypeParser(types.builtins.DATE, (v) => v); // 'YYYY-MM-DD', never shifted by time zones
types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => (v === null ? null : new Date(v).toISOString()));

const globalForDb = globalThis as unknown as { stratosPool?: Pool };

/** One pool per server instance. Use Neon's pooled connection string in DATABASE_URL. */
export function pool(): Pool {
  if (!globalForDb.stratosPool) {
    globalForDb.stratosPool = new Pool({ connectionString: env.databaseUrl(), max: 5, idleTimeoutMillis: 10_000 });
    // On Vercel Fluid compute, close idle clients before an instance is suspended (no-op elsewhere).
    attachDatabasePool(globalForDb.stratosPool);
  }
  return globalForDb.stratosPool;
}

export type Db = Pick<PoolClient, "query">;

async function transaction<T>(setup: (c: PoolClient) => Promise<unknown>, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await setup(client);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run queries as a signed-in user inside one tenant. The transaction switches to the stratos_app role and sets
 * app.user_id and app.tenant_id; stratos.current_tenant_id() only honours the tenant if the user is an active
 * member, so every statement is filtered by the RLS policies in db/migrations.
 */
export function asTenantUser<T>(userId: string, tenantId: string | null, fn: (db: Db) => Promise<T>) {
  return transaction(async (c) => {
    await c.query("set local role stratos_app");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)", [userId, tenantId ?? ""]);
  }, fn);
}

/** Trusted server path (owner, no RLS). Only for webhooks, cron workers and auth bootstrap. Always filter by tenant_id. */
export function asService<T>(fn: (db: Db) => Promise<T>) {
  return transaction(async () => {}, fn);
}
