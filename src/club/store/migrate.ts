import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { assertNotHosted } from "../db/guard";
import { sampleDataAllowed } from "../enabled";

/**
 * Setting up a throwaway database by itself, for previews.
 *
 * The building comparison: a model apartment that stocks itself. A preview needs a real, shared record book (a Postgres
 * database) or the buttons and the pages each keep their own private notebook (see CLAUDE.md, question CV). A brand new empty
 * database has no tables, and every pull request that adds a table would need someone to set that up by hand. So when
 * CLUB_AUTO_MIGRATE=1, the first request to a preview brings the database up to date from the files in supabase/migrations,
 * once, in order, and remembers which files it has applied.
 *
 * It is never on by default and is refused wherever it could touch something real: on the live production site, anywhere
 * invented data is not allowed, and for any hosted Supabase address. The real club database is set up deliberately.
 */

type Env = Partial<Record<string, string | undefined>>;

/** Where the migration files are, relative to where the server runs (the project root). They are shipped with the app (next.config.ts). */
export const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** One lock for every server that might start at the same time, so each file is applied once. */
const LOCK = "ccs-club-migrations";

/** The list of files already applied, in the database itself. */
const TRACKER = "public.ccs_club_migrations";

/** Whether this server was asked to set its own database up. */
export function autoMigrateRequested(env: Env = process.env): boolean {
  return env.CLUB_AUTO_MIGRATE === "1";
}

/** Refuses, in plain words, anywhere the database should only ever be changed deliberately. */
export function assertMayAutoMigrate(url: string, env: Env = process.env): void {
  if (env.VERCEL_ENV === "production") {
    throw new Error("CLUB_AUTO_MIGRATE is switched on, but this is the live production site. The database is never changed on its own there: apply the migrations deliberately.");
  }
  if (!sampleDataAllowed(env)) {
    throw new Error("CLUB_AUTO_MIGRATE only works where invented data is allowed (previews and development). Turn it off, or apply the migrations deliberately.");
  }
  assertNotHosted(url);
}

/**
 * Applies every migration file that has not been applied yet, in file order, each in its own all-or-nothing step under one
 * lock (so two servers starting together apply each file once). Returns the files it applied. A file that fails is named, and
 * nothing from it is kept; the earlier files stay applied and the next start tries again from the failed one.
 */
export async function applyMigrations(pool: Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied: string[] = [];
  const c = await pool.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      await c.query("begin");
      try {
        await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [LOCK]);
        await c.query(`create table if not exists ${TRACKER} (file text primary key, applied_at timestamptz not null default now())`);
        const done = await c.query(`select 1 from ${TRACKER} where file = $1`, [file]);
        if (done.rowCount === 0) {
          await c.query(sql);
          await c.query(`insert into ${TRACKER} (file) values ($1)`, [file]);
          applied.push(file);
        }
        await c.query("commit");
      } catch (e) {
        await c.query("rollback").catch(() => undefined);
        throw new Error(`Migration ${file} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    c.release();
  }
  return applied;
}

const g = globalThis as unknown as { __ccsMigrated?: Map<string, Promise<void>> };

/**
 * Brings the database at this address up to date, once per running server, when CLUB_AUTO_MIGRATE=1. Without that setting it
 * does nothing at all. If it fails (the database is asleep or down, a file has a mistake), the failure is not remembered, so
 * the next request tries again.
 */
export function ensureMigrated(url: string, env: Env = process.env): Promise<void> {
  if (!autoMigrateRequested(env)) return Promise.resolve();
  try {
    assertMayAutoMigrate(url, env);
  } catch (e) {
    return Promise.reject(e);
  }
  const done = (g.__ccsMigrated ??= new Map<string, Promise<void>>());
  let running = done.get(url);
  if (!running) {
    const attempt = (async () => {
      const pool = new Pool({ connectionString: url, max: 1 });
      pool.on("error", (e) => console.error("Club database connection problem:", e.message));
      try {
        const applied = await applyMigrations(pool);
        if (applied.length > 0) console.log(`Club database set up: applied ${applied.length} migration file${applied.length === 1 ? "" : "s"}.`);
      } finally {
        await pool.end();
      }
    })();
    attempt.catch(() => {
      if (done.get(url) === attempt) done.delete(url);
    });
    done.set(url, attempt);
    running = attempt;
  }
  return running;
}
