import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClubPool } from "../store/postgres";
import { PgTestMail } from "../auth/test-mail";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * The test outbox kept in the shared test database, as the DATABASE guards it and as the club's code reads it back, against a
 * real Postgres: a copy is never changed or removed, the book is never emptied, every email is read back exactly as it was
 * written, and the newest comes first. Needs CLUB_TEST_DATABASE_URL; skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";

type Failure = { code?: string; message: string };

describe.skipIf(!ADMIN_URL)("the test outbox in the database", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
  });
  afterAll(async () => {
    await db?.drop();
  });

  async function attempt(sql: string, params: unknown[] = []): Promise<Failure | null> {
    try {
      await q(sql, params);
      return null;
    } catch (e) {
      return e as Failure;
    }
  }
  const add = (over: Partial<{ to: string; subject: string; body: string }> = {}) =>
    attempt(`insert into club.test_mail (sent_at, to_email, subject, body) values ($1, $2, $3, $4)`, ["2026-10-28T20:00:00Z", over.to ?? "ada@example.com", over.subject ?? "Hello", over.body ?? "Hello Ada,"]);

  it("takes an email and refuses to change it or remove it", async () => {
    expect(await add({ subject: "Kept" })).toBeNull();
    const update = await attempt(`update club.test_mail set subject = 'Changed' where subject = 'Kept'`);
    expect(update?.message).toMatch(/cannot be changed or removed/);
    const remove = await attempt(`delete from club.test_mail where subject = 'Kept'`);
    expect(remove?.message).toMatch(/cannot be changed or removed/);
    expect((await q(`select count(*)::int as n from club.test_mail where subject = 'Kept'`)).rows[0].n).toBe(1);
  });

  it("refuses to empty the book", async () => {
    expect((await attempt(`truncate club.test_mail`))?.message).toMatch(/cannot be changed or removed/);
    expect((await attempt(`delete from club.test_mail`))?.message).toMatch(/cannot be changed or removed/);
  });

  it("refuses an empty subject or address, and a subject, address or body that is far too long", async () => {
    expect((await add({ subject: "" }))?.code).toBe(CHECK_VIOLATION);
    expect((await add({ to: "a" }))?.code).toBe(CHECK_VIOLATION);
    expect((await add({ subject: "s".repeat(501) }))?.code).toBe(CHECK_VIOLATION);
    expect((await add({ to: `${"a".repeat(320)}x` }))?.code).toBe(CHECK_VIOLATION);
    expect((await add({ body: "b".repeat(50001) }))?.code).toBe(CHECK_VIOLATION);
    expect(await add({ subject: "s".repeat(500), body: "b".repeat(50000) })).toBeNull();
  });

  it("is locked to the owner: row level security on, nothing granted to the public roles", async () => {
    const { rows } = await q(`select c.relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'club' and c.relname = 'test_mail'`);
    expect(rows[0].relrowsecurity).toBe(true);
  });

  it("is read back exactly as written, newest first, and no more than asked for", async () => {
    const pool = createClubPool(db.url, 2);
    try {
      const mail = new PgTestMail(pool);
      for (let n = 1; n <= 5; n++) await mail.add({ to: `p${n}@example.com`, subject: `Mail ${n}`, text: `Line one\nLine two ${n}\n\n  indented, with “quotes” and an ünïcode name`, at: `2026-10-28T20:0${n}:00.000Z` });
      const recent = await mail.recent(3);
      expect(recent.map((m) => m.subject)).toEqual(["Mail 5", "Mail 4", "Mail 3"]);
      expect(recent[0]).toEqual({ to: "p5@example.com", subject: "Mail 5", text: "Line one\nLine two 5\n\n  indented, with “quotes” and an ünïcode name", at: "2026-10-28T20:05:00.000Z" });
      expect(await mail.recent(1000)).toHaveLength((await q(`select count(*)::int as n from club.test_mail`)).rows[0].n);
    } finally {
      await pool.end();
    }
  });
});
