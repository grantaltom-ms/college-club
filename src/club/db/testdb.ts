import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { assertNotHosted, looksLikeHostedSupabase } from "./guard";

/**
 * Scratch databases for the tests, made from the migration files in supabase/migrations and dropped afterwards.
 * They refuse anything that looks like the live Supabase project.
 */

const MIGRATIONS = join(__dirname, "../../../supabase/migrations");

export { looksLikeHostedSupabase };

const migrationSql = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(join(MIGRATIONS, f), "utf8"));
const pathUrl = (adminUrl: string, name: string) => {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
};
async function asAdmin<T>(adminUrl: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export interface ScratchDb {
  /** Address of the scratch database, for tests that need a second connection. */
  url: string;
  client: Client;
  drop(): Promise<void>;
}

/** A fresh database with every migration applied, and one open connection to it. */
export async function createScratchDb(adminUrl: string): Promise<ScratchDb> {
  if (looksLikeHostedSupabase(adminUrl)) {
    throw new Error("Refusing to run: the test database address looks like a hosted Supabase project. Use a local or throwaway Postgres.");
  }
  const name = `club_test_${randomBytes(6).toString("hex")}`;
  await asAdmin(adminUrl, (c) => c.query(`create database ${name}`));
  const url = pathUrl(adminUrl, name);
  const client = new Client({ connectionString: url });
  await client.connect();
  for (const sql of migrationSql()) await client.query(sql);
  return {
    url,
    client,
    async drop() {
      await client.end();
      await asAdmin(adminUrl, (c) => c.query(`drop database if exists ${name} with (force)`));
    },
  };
}

/* ---------- Many quick databases: clone a template that already has the migrations ---------- */

let template: Promise<string> | undefined;

async function templateName(adminUrl: string): Promise<string> {
  assertNotHosted(adminUrl);
  return (template ??= (async () => {
    const name = `club_tpl_${randomBytes(6).toString("hex")}`;
    await asAdmin(adminUrl, (c) => c.query(`create database ${name}`));
    const c = new Client({ connectionString: pathUrl(adminUrl, name) });
    await c.connect();
    try {
      for (const sql of migrationSql()) await c.query(sql);
    } finally {
      await c.end();
    }
    return name;
  })());
}

/** A new empty-but-migrated database in a few tens of milliseconds. No connection is left open. */
export async function cloneScratchDb(adminUrl: string): Promise<{ url: string; drop(): Promise<void> }> {
  const tpl = await templateName(adminUrl);
  const name = `club_test_${randomBytes(6).toString("hex")}`;
  await asAdmin(adminUrl, (c) => c.query(`create database ${name} template ${tpl}`));
  return {
    url: pathUrl(adminUrl, name),
    drop: () => asAdmin(adminUrl, (c) => c.query(`drop database if exists ${name} with (force)`)).then(() => undefined),
  };
}

/** Call once when a test file is done. */
export async function dropTemplate(adminUrl: string): Promise<void> {
  if (!template) return;
  const name = await template;
  template = undefined;
  await asAdmin(adminUrl, (c) => c.query(`drop database if exists ${name} with (force)`));
}


/* ---------- Recording an attendance outcome the way the app does: the status change and its line in the check-in record ---------- */

const OUTCOME_TABLES = {
  bookings: { kind: "booking", fk: "booking_id", member: "booker_id" },
  class_signups: { kind: "class", fk: "signup_id", member: "member_id" },
  event_rsvps: { kind: "event", fk: "rsvp_id", member: "member_id" },
} as const;

const outcomeOfStatus = (status: string) => (status === "completed" || status === "attended" ? "attended" : status === "no_show" ? "no_show" : null);

/**
 * Sets a booking, sign-up or RSVP to completed / attended / no_show together with the line the database now requires in the
 * check-in record, in one transaction. A refused change rolls back and throws the database's own error.
 */
export async function recordOutcome(
  client: Pick<Client, "query">,
  table: keyof typeof OUTCOME_TABLES,
  id: string,
  status: string,
  options: { at?: string; via?: "staff" | "automatic" } = {},
): Promise<void> {
  const shape = OUTCOME_TABLES[table];
  const at = options.at ?? new Date().toISOString();
  const via = options.via ?? "staff";
  await client.query("begin");
  try {
    const { rows } = await client.query(`select status, ${shape.member} as member_id from club.${table} where id = $1`, [id]);
    const previous = outcomeOfStatus(rows[0].status);
    await client.query(`update club.${table} set status = $2, status_changed_at = $3 where id = $1`, [id, status, at]);
    await client.query(
      `insert into club.attendance_log (kind, ${shape.fk}, member_id, at, outcome, previous_outcome, by_kind, by_label, via) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [shape.kind, id, rows[0].member_id, at, outcomeOfStatus(status), previous, via === "automatic" ? "system" : "staff", via === "automatic" ? "Automatic no-show" : "Test staff", via],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}
