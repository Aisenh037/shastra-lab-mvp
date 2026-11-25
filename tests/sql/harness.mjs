// Shared setup for database tests: a throwaway in-process Postgres (PGlite)
// with minimal stand-ins for Supabase's auth and storage schemas, then every
// migration in supabase/migrations applied in order.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS = join(here, "../../supabase/migrations");

const PRELUDE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated' $$;
CREATE TABLE storage.buckets (id text primary key, name text, public boolean);
CREATE TABLE storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name, '/') $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
`;

/** Migrations that need extensions PGlite doesn't have (pg_cron, pg_net, Vault). */
const SKIP = (f) => f.includes("worker_schedule");

export function migrationFiles() {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

/** Fresh database. `before(file, db)` runs before each migration (to plant legacy data). */
export async function freshDb({ before } = {}) {
  const db = new PGlite();
  await db.exec(PRELUDE);
  for (const f of migrationFiles()) {
    if (SKIP(f)) continue;
    if (before) await before(f, db);
    try {
      await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${e.message}`);
    }
  }
  const q = async (sql) => (await db.query(sql)).rows;
  /** Run following queries as this user (auth.uid()); pass "" for no user. */
  const as = (id) => q(`select set_config('request.jwt.claim.sub','${id}',false)`);
  const user = async (email, meta = {}) =>
    (await q(`insert into auth.users(email, raw_user_meta_data) values ('${email}', '${JSON.stringify(meta)}') returning id`))[0].id;
  return { db, q, as, user };
}

let failures = 0;
export function check(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " " + JSON.stringify(detail)}`);
  if (!cond) failures++;
}
export async function throws(fn) {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}
export function done() {
  process.exit(failures ? 1 : 0);
}
