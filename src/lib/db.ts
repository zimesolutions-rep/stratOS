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

/**
 * Every statement is a round trip to Neon, and on a cross-region hop each one costs real time, so the transaction
 * opens and sets its context in ONE simple-protocol message: "begin; select set_config(...)". Values go in as
 * escaped literals because a multi-statement message can't carry bind parameters.
 */
async function transaction<T>(setup: Record<string, string> | null, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    const sets = setup
      ? Object.entries(setup).map(([k, v]) => `set_config(${client.escapeLiteral(k)}, ${client.escapeLiteral(v)}, true)`)
      : [];
    await client.query(sets.length ? `begin; select ${sets.join(", ")}` : "begin");
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
 * Run queries as a signed-in user inside one tenant. The transaction switches to the stratos_app role (setting the
 * "role" GUC locally is SET LOCAL ROLE) and sets app.user_id and app.tenant_id; stratos.current_tenant_id() only
 * honours the tenant if the user is an active member, so every statement is filtered by the RLS policies.
 */
export function asTenantUser<T>(userId: string, tenantId: string | null, fn: (db: Db) => Promise<T>) {
  return transaction({ role: "stratos_app", "app.user_id": userId, "app.tenant_id": tenantId ?? "" }, fn);
}

/** Trusted server path (owner, no RLS). Only for webhooks, cron workers and auth bootstrap. Always filter by tenant_id. */
export function asService<T>(fn: (db: Db) => Promise<T>) {
  return transaction(null, fn);
}
