// Makes a fresh, migrated database for the browser tests that run against Postgres.
// Uses CLUB_TEST_DATABASE_URL (a local or throwaway Postgres) and refuses anything that looks like Supabase.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const NAME = "club_e2e";
const admin = process.env.CLUB_TEST_DATABASE_URL;
if (!admin) {
  console.error("Set CLUB_TEST_DATABASE_URL to a local or throwaway Postgres.");
  process.exit(1);
}
if (/supabase\.(co|com|net|in)|hgjcnuwxhemynnvsnmou|pooler\.supabase/i.test(admin)) {
  console.error("Refusing: that address looks like a hosted Supabase project.");
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const target = new URL(admin);
target.pathname = `/${NAME}`;

const root = new pg.Client({ connectionString: admin });
await root.connect();
await root.query(`drop database if exists ${NAME} with (force)`);
await root.query(`create database ${NAME}`);
await root.end();

const db = new pg.Client({ connectionString: target.toString() });
await db.connect();
for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await db.query(readFileSync(join(dir, file), "utf8"));
await db.end();
console.log(`Prepared database ${NAME} for the browser tests.`);
