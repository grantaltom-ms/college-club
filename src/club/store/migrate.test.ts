import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createScratchDb } from "../db/testdb";
import { applyMigrations, assertMayAutoMigrate, autoMigrateRequested, ensureMigrated, MIGRATIONS_DIR } from "./migrate";
import { createClubPool } from "./postgres";

/**
 * A preview can set its own throwaway database up (CLUB_AUTO_MIGRATE=1). These hold the rules around that: it is off unless
 * asked for, it refuses the live site and any hosted Supabase address, it applies each file once and in order, and a failure
 * is named and tried again.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const PREVIEW = { VERCEL_ENV: "preview", NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1", CLUB_AUTO_MIGRATE: "1" };
const FILES = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

describe("when the database may set itself up", () => {
  it("is off unless it is asked for, exactly with 1", () => {
    for (const value of [undefined, "", "0", "true", "yes", " 1"]) expect(autoMigrateRequested({ CLUB_AUTO_MIGRATE: value }), String(value)).toBe(false);
    expect(autoMigrateRequested({ CLUB_AUTO_MIGRATE: "1" })).toBe(true);
    expect(autoMigrateRequested({})).toBe(false);
  });

  it("is allowed in a preview and while developing, and refused on the live site, anywhere invented data is not allowed, and for hosted Supabase", () => {
    const local = "postgresql://postgres@127.0.0.1:5432/club";
    expect(() => assertMayAutoMigrate(local, PREVIEW)).not.toThrow();
    expect(() => assertMayAutoMigrate(local, { NODE_ENV: "development", CLUB_AUTO_MIGRATE: "1" })).not.toThrow();
    expect(() => assertMayAutoMigrate(local, { ...PREVIEW, VERCEL_ENV: "production" })).toThrow("live production site");
    // Even with the sample-data switch set, the live site is never changed on its own.
    expect(() => assertMayAutoMigrate(local, { VERCEL_ENV: "production", NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1", CLUB_AUTO_MIGRATE: "1" })).toThrow("live production site");
    expect(() => assertMayAutoMigrate(local, { NODE_ENV: "production", CLUB_AUTO_MIGRATE: "1" })).toThrow("only works where invented data is allowed");
    for (const url of ["postgresql://postgres:x@db.hgjcnuwxhemynnvsnmou.supabase.co:5432/postgres", "postgresql://p:x@aws-0-us-west-1.pooler.supabase.com:6543/postgres"]) {
      expect(() => assertMayAutoMigrate(url, PREVIEW), url).toThrow("hosted Supabase");
    }
  });

  it("does nothing at all when it is not asked for, even for an address nobody can reach", async () => {
    await expect(ensureMigrated("postgresql://nobody@127.0.0.1:1/none", {})).resolves.toBeUndefined();
    await expect(ensureMigrated("postgresql://nobody@127.0.0.1:1/none", { CLUB_AUTO_MIGRATE: "0", VERCEL_ENV: "production" })).resolves.toBeUndefined();
  });

  it("refuses, before it connects to anything, on the live site and for a hosted Supabase address", async () => {
    await expect(ensureMigrated("postgresql://nobody@127.0.0.1:1/none", { ...PREVIEW, VERCEL_ENV: "production" })).rejects.toThrow("live production site");
    await expect(ensureMigrated("postgresql://postgres:x@db.hgjcnuwxhemynnvsnmou.supabase.co:5432/postgres", PREVIEW)).rejects.toThrow("hosted Supabase");
  });
});

describe.skipIf(!ADMIN_URL)("setting a database up from the migration files", () => {
  const drops: Array<() => Promise<void>> = [];
  const pools: Pool[] = [];
  const dirs: string[] = [];
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    for (const p of pools) await p.end().catch(() => undefined);
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    for (const drop of drops.reverse()) await drop();
  });

  const pathUrl = (name: string) => {
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${name}`;
    return url.toString();
  };
  const admin = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    const c = new Client({ connectionString: ADMIN_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };
  const create = async (name: string) => {
    await admin((c) => c.query(`create database ${name}`));
    drops.push(() => admin((c) => c.query(`drop database if exists ${name} with (force)`)).then(() => undefined));
    return pathUrl(name);
  };
  /** A brand new, completely empty database: the way a freshly made hosted one starts. */
  const emptyDb = () => create(`club_migrate_${randomBytes(6).toString("hex")}`);
  const poolFor = (url: string) => {
    const p = new Pool({ connectionString: url });
    pools.push(p);
    return p;
  };
  const shape = async (url: string) => {
    const c = new Client({ connectionString: url });
    await c.connect();
    try {
      const tables = await c.query("select table_schema || '.' || table_name as t from information_schema.tables where table_schema in ('club', 'public') and table_name <> 'ccs_club_migrations' order by 1");
      const functions = await c.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'club'");
      return { tables: tables.rows.map((r) => r.t), functions: functions.rows[0].n };
    } finally {
      await c.end();
    }
  };

  it("applies every file, in order, to an empty database and ends with exactly the tables the tests' own database has", async () => {
    const url = await emptyDb();
    const pool = poolFor(url);
    expect(await applyMigrations(pool)).toEqual(FILES);
    expect((await pool.query("select file from public.ccs_club_migrations order by file")).rows.map((r) => r.file)).toEqual(FILES);

    const reference = await createScratchDb(ADMIN_URL!);
    drops.push(() => reference.drop());
    const [mine, theirs] = [await shape(url), await shape(reference.url)];
    expect(mine.tables.length).toBeGreaterThan(30);
    expect(mine).toEqual(theirs);
  }, 60_000);

  it("applies nothing the second time", async () => {
    const pool = poolFor(await emptyDb());
    await applyMigrations(pool);
    expect(await applyMigrations(pool)).toEqual([]);
    expect((await pool.query("select count(*)::int as n from public.ccs_club_migrations")).rows[0].n).toBe(FILES.length);
  }, 60_000);

  it("applies each file once when two servers start together", async () => {
    const url = await emptyDb();
    const [a, b] = [poolFor(url), poolFor(url)];
    const [first, second] = await Promise.all([applyMigrations(a), applyMigrations(b)]);
    expect([...first, ...second].sort()).toEqual(FILES);
    expect((await a.query("select count(*)::int as n from public.ccs_club_migrations")).rows[0].n).toBe(FILES.length);
  }, 60_000);

  it("names a file that fails, keeps nothing from it, keeps the files before it, and carries on from it once it is fixed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "club-migrations-"));
    dirs.push(dir);
    writeFileSync(join(dir, "001-first.sql"), "create table public.first_thing (id int);");
    writeFileSync(join(dir, "002-broken.sql"), "create table public.second_thing (id int); select 1 / 0;");
    writeFileSync(join(dir, "003-third.sql"), "create table public.third_thing (id int);");
    const pool = poolFor(await emptyDb());
    await expect(applyMigrations(pool, dir)).rejects.toThrow(/002-broken\.sql failed.*division by zero/);
    expect((await pool.query("select file from public.ccs_club_migrations order by file")).rows.map((r) => r.file)).toEqual(["001-first.sql"]);
    const exists = async (name: string) => (await pool.query("select to_regclass($1) as t", [`public.${name}`])).rows[0].t !== null;
    expect([await exists("first_thing"), await exists("second_thing"), await exists("third_thing")]).toEqual([true, false, false]);

    writeFileSync(join(dir, "002-broken.sql"), "create table public.second_thing (id int);");
    expect(await applyMigrations(pool, dir)).toEqual(["002-broken.sql", "003-third.sql"]);
    // A file added later is applied on its own.
    writeFileSync(join(dir, "004-later.sql"), "create table public.fourth_thing (id int);");
    expect(await applyMigrations(pool, dir)).toEqual(["004-later.sql"]);
  }, 60_000);

  it("sets a database up once per server when asked, and gives the same answer to the next request", async () => {
    const url = await emptyDb();
    const first = ensureMigrated(url, PREVIEW);
    await first;
    expect(ensureMigrated(url, PREVIEW)).toBe(first);
    const pool = poolFor(url);
    expect((await pool.query("select count(*)::int as n from public.ccs_club_migrations")).rows[0].n).toBe(FILES.length);
  }, 60_000);

  it("does not remember a failure, so the next request tries again", async () => {
    const name = `club_migrate_${randomBytes(6).toString("hex")}`;
    const url = pathUrl(name);
    await expect(ensureMigrated(url, PREVIEW)).rejects.toThrow(/does not exist/);
    await create(name);
    await expect(ensureMigrated(url, PREVIEW)).resolves.toBeUndefined();
    expect((await poolFor(url).query("select count(*)::int as n from club.households")).rows[0].n).toBe(0);
  }, 60_000);

  it("makes the club's own connection pool wait for the set-up, for a query and for a connection with a callback, only when asked", async () => {
    const url = await emptyDb();
    vi.stubEnv("CLUB_AUTO_MIGRATE", "1");
    const waiting = createClubPool(url);
    pools.push(waiting);
    expect((await waiting.query("select count(*)::int as n from club.households")).rows[0].n).toBe(0);
    const viaCallback = await new Promise<number>((resolve, reject) => {
      waiting.connect((err, client, release) => {
        if (err || !client) return reject(err ?? new Error("no client"));
        client.query("select count(*)::int as n from club.members").then(
          (r) => {
            release();
            resolve(r.rows[0].n);
          },
          reject,
        );
      });
    });
    expect(viaCallback).toBe(0);

    // Off by default: the same empty database, an ordinary pool, and no tables.
    vi.stubEnv("CLUB_AUTO_MIGRATE", "");
    const plain = createClubPool(await emptyDb());
    pools.push(plain);
    await expect(plain.query("select count(*)::int as n from club.households")).rejects.toThrow(/does not exist/);
  }, 60_000);
});
