import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/**
 * A scratch database for the tests: made fresh, filled by running every migration file in order, and
 * dropped afterwards. It refuses anything that looks like the live Supabase project.
 */

const MIGRATIONS = join(__dirname, "../../../supabase/migrations");

/** The live project, or any hosted Supabase address. Tests must never connect to these. */
export function looksLikeHostedSupabase(url: string): boolean {
  return /supabase\.(co|com|net|in)|hgjcnuwxhemynnvsnmou|pooler\.supabase/i.test(url);
}

export interface ScratchDb {
  /** Address of the scratch database, for tests that need a second connection. */
  url: string;
  client: Client;
  drop(): Promise<void>;
}

export async function createScratchDb(adminUrl: string): Promise<ScratchDb> {
  if (looksLikeHostedSupabase(adminUrl)) {
    throw new Error("Refusing to run: the test database address looks like a hosted Supabase project. Use a local or throwaway Postgres.");
  }
  const name = `club_test_${randomBytes(6).toString("hex")}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await client.query(readFileSync(join(MIGRATIONS, file), "utf8"));
  }

  return {
    url: url.toString(),
    client,
    async drop() {
      await client.end();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${name} with (force)`);
      await cleanup.end();
    },
  };
}
