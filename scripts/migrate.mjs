// Applies db/migrations/*.sql in filename order, once each, recording them in public._migrations.
//   npm run db:migrate          migrations only
//   npm run db:migrate -- --seed  also runs db/seed.sql if you add one (idempotent)
// Uses DATABASE_URL_UNPOOLED when set (recommended on Neon for DDL), else DATABASE_URL.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

for (const f of [".env.local", ".env"]) {
  try { process.loadEnvFile(f); } catch { /* optional */ }
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (or DATABASE_URL_UNPOOLED) first.");
  process.exit(1);
}

const dir = path.join(process.cwd(), "db", "migrations");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await client.query("select name from public._migrations")).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) { console.log(`= ${file} (already applied)`); continue; }
    const sql = await readFile(path.join(dir, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public._migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`+ ${file}`);
    } catch (err) {
      await client.query("rollback");
      console.error(`! ${file} failed: ${err.message}`);
      process.exit(1);
    }
  }
  if (process.argv.includes("--seed")) {
    await client.query(await readFile(path.join(process.cwd(), "db", "seed.sql"), "utf8"));
    console.log("+ seed.sql");
  }
  console.log("Database is up to date.");
} finally {
  await client.end();
}
