import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * The public tour request cards as the DATABASE guards them, tested against a real Postgres: a request is never removed, the
 * only change it can ever have is being marked followed up (once, by someone, at some time), and its fields have the right
 * shape. Needs CLUB_TEST_DATABASE_URL (a local or throwaway Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";

type Failure = { code?: string; message: string };

describe.skipIf(!ADMIN_URL)("the tour request cards", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
  });
  afterAll(async () => {
    await db?.drop();
  });

  /** Runs one statement and returns what the database said, or null when it went through. */
  async function attempt(sql: string, params: unknown[] = []): Promise<Failure | null> {
    try {
      await q(sql, params);
      return null;
    } catch (e) {
      return e as Failure;
    }
  }

  const insert = (over: Partial<{ id: string; at: string; name: string; email: string; phone: string; note: string }> = {}) => {
    const id = over.id ?? randomUUID();
    return { id, run: () => attempt(`insert into club.tour_requests (id, created_at, name, email, phone, note) values ($1,$2,$3,$4,$5,$6)`, [id, over.at ?? "2026-10-28T20:00:00Z", over.name ?? "Ada Quill", over.email ?? "ada@example.com", over.phone ?? "", over.note ?? ""]) };
  };
  async function saved(over: Parameters<typeof insert>[0] = {}): Promise<string> {
    const row = insert(over);
    expect(await row.run()).toBeNull();
    return row.id;
  }

  describe("a new card", () => {
    it("is accepted with a name and an email, new and not followed up", async () => {
      const id = await saved();
      const { rows } = await q(`select status, followed_up_at, followed_up_by, phone, note from club.tour_requests where id = $1`, [id]);
      expect(rows[0]).toEqual({ status: "new", followed_up_at: null, followed_up_by: null, phone: "", note: "" });
    });

    it("keeps cards in the order they arrived", async () => {
      const a = await saved({ name: "First" });
      const b = await saved({ name: "Second" });
      const { rows } = await q(`select id from club.tour_requests where id = any($1) order by seq`, [[a, b]]);
      expect(rows.map((r) => r.id)).toEqual([a, b]);
    });

    it.each([
      ["an empty name", { name: "" }],
      ["a name with spaces around it", { name: " Ada" }],
      ["a name over 120 characters", { name: "x".repeat(121) }],
      ["an email with capital letters", { email: "Ada@Example.com" }],
      ["an email with spaces around it", { email: " ada@example.com" }],
      ["an email that is too short", { email: "a@" }],
      ["an email over 254 characters", { email: `${"x".repeat(250)}@e.co` }],
      ["a phone number over 40 characters", { phone: "1".repeat(41) }],
      ["a phone number with spaces around it", { phone: " 206 " }],
      ["a note over 500 characters", { note: "n".repeat(501) }],
    ])("refuses %s", async (_what, over) => {
      expect((await insert(over).run())?.code).toBe(CHECK_VIOLATION);
    });

    it("accepts the longest allowed name, phone and note", async () => {
      expect(await insert({ name: "x".repeat(120), phone: "1".repeat(40), note: "n".repeat(500) }).run()).toBeNull();
    });

    it("refuses a card with no arrival time", async () => {
      expect((await attempt(`insert into club.tour_requests (id, created_at, name, email) values ($1, null, 'A', 'a@b.co')`, [randomUUID()]))?.code).toBe(NOT_NULL_VIOLATION);
    });

    it("refuses an unknown status, and a new card that already says it was followed up", async () => {
      const base = `insert into club.tour_requests (id, created_at, name, email, status, followed_up_at, followed_up_by) values ($1,'2026-10-28T20:00:00Z','A','a@b.co',$2,$3,$4)`;
      expect((await attempt(base, [randomUUID(), "done", null, null]))?.code).toBe(CHECK_VIOLATION);
      expect((await attempt(base, [randomUUID(), "new", "2026-10-28T21:00:00Z", null]))?.code).toBe(CHECK_VIOLATION);
      expect((await attempt(base, [randomUUID(), "new", null, "Alex Staffer"]))?.code).toBe(CHECK_VIOLATION);
    });

    it("refuses a followed-up card that does not say who and when", async () => {
      const base = `insert into club.tour_requests (id, created_at, name, email, status, followed_up_at, followed_up_by) values ($1,'2026-10-28T20:00:00Z','A','a@b.co','followed_up',$2,$3)`;
      expect((await attempt(base, [randomUUID(), null, "Alex Staffer"]))?.code).toBe(CHECK_VIOLATION);
      expect((await attempt(base, [randomUUID(), "2026-10-28T21:00:00Z", null]))?.code).toBe(CHECK_VIOLATION);
      expect((await attempt(base, [randomUUID(), "2026-10-28T21:00:00Z", ""]))?.code).toBe(CHECK_VIOLATION);
      expect(await attempt(base, [randomUUID(), "2026-10-28T21:00:00Z", "Alex Staffer"])).toBeNull();
    });
  });

  describe("marking a card followed up", () => {
    const markSql = `update club.tour_requests set status = 'followed_up', followed_up_at = '2026-10-28T21:00:00Z', followed_up_by = 'Alex Staffer' where id = $1`;

    it("works once, and keeps who and when", async () => {
      const id = await saved();
      expect(await attempt(markSql, [id])).toBeNull();
      const { rows } = await q(`select status, followed_up_by, followed_up_at from club.tour_requests where id = $1`, [id]);
      expect(rows[0]).toMatchObject({ status: "followed_up", followed_up_by: "Alex Staffer" });
      expect(new Date(rows[0].followed_up_at).toISOString()).toBe("2026-10-28T21:00:00.000Z");
    });

    it("cannot be done a second time, not even to put the same thing again", async () => {
      const id = await saved();
      await attempt(markSql, [id]);
      expect((await attempt(markSql, [id]))?.message).toMatch(/can only be marked followed up, once/);
      expect((await attempt(`update club.tour_requests set followed_up_by = 'Someone Else' where id = $1`, [id]))?.message).toMatch(/can only be marked followed up, once/);
    });

    it("cannot be undone", async () => {
      const id = await saved();
      await attempt(markSql, [id]);
      expect((await attempt(`update club.tour_requests set status = 'new', followed_up_at = null, followed_up_by = null where id = $1`, [id]))?.message).toMatch(/cannot be changed/);
    });

    it.each([
      ["the name", "name = 'Someone Else'"],
      ["the email", "email = 'other@example.com'"],
      ["the phone number", "phone = '555'"],
      ["the note", "note = 'edited'"],
      ["the arrival time", "created_at = '2020-01-01T00:00:00Z'"],
      ["the id", `id = '${randomUUID()}'`],
    ])("cannot change %s, alone", async (_what, change) => {
      const id = await saved({ note: "original" });
      expect((await attempt(`update club.tour_requests set ${change} where id = $1`, [id]))?.message).toMatch(/cannot be changed/);
    });

    it.each([
      ["the name", "name = 'Someone Else'"],
      ["the email", "email = 'other@example.com'"],
      ["the phone number", "phone = '555'"],
      ["the note", "note = 'edited'"],
      ["the arrival time", "created_at = '2020-01-01T00:00:00Z'"],
      ["the id", `id = '${randomUUID()}'`],
    ])("cannot change %s while marking it followed up", async (_what, change) => {
      const id = await saved({ note: "original" });
      const failure = await attempt(`update club.tour_requests set status = 'followed_up', followed_up_at = '2026-10-28T21:00:00Z', followed_up_by = 'Alex Staffer', ${change} where id = $1`, [id]);
      expect(failure?.message).toMatch(/cannot be changed/);
      expect((await q(`select status from club.tour_requests where id = $1`, [id])).rows[0].status).toBe("new");
    });

    it("cannot be a change of status without saying who and when", async () => {
      const id = await saved();
      expect((await attempt(`update club.tour_requests set status = 'followed_up' where id = $1`, [id]))?.code).toBe(CHECK_VIOLATION);
    });
  });

  describe("removing", () => {
    it("is refused for a card, whatever its state", async () => {
      const fresh = await saved();
      const done = await saved();
      await attempt(`update club.tour_requests set status = 'followed_up', followed_up_at = '2026-10-28T21:00:00Z', followed_up_by = 'A' where id = $1`, [done]);
      for (const id of [fresh, done]) {
        expect((await attempt(`delete from club.tour_requests where id = $1`, [id]))?.message).toMatch(/cannot be removed/);
      }
      expect((await q(`select count(*)::int as n from club.tour_requests where id = any($1)`, [[fresh, done]])).rows[0].n).toBe(2);
    });

    it("is refused for the whole list at once, by delete or by emptying it", async () => {
      await saved();
      expect((await attempt(`delete from club.tour_requests`))?.message).toMatch(/cannot be removed/);
      expect((await attempt(`truncate club.tour_requests`))?.message).toMatch(/cannot be removed/);
      expect((await q(`select count(*)::int as n from club.tour_requests`)).rows[0].n).toBeGreaterThan(0);
    });
  });
});
