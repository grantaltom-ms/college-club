import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * Sign-in links and signed-in browsers as the DATABASE guards them, tested against a real Postgres: only fingerprints of the
 * right shape, links that live a short time and are used once, sessions that name exactly one member or one staff email, and
 * rows that are never changed except to be used or signed out, and never removed. Needs CLUB_TEST_DATABASE_URL (a local or
 * throwaway Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

const T = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 29, hh, mm)).toISOString();
const hex = (n: number) => n.toString(16).padStart(64, "0");

describe.skipIf(!ADMIN_URL)("sign-in links and sessions", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "other");
  let n = 0;
  let member: string;

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    const hh = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    member = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, 'Ada', 'Test', 'ada@example.com', 'primary') returning id`, [hh])).rows[0].id;
  });
  afterAll(async () => {
    await db?.drop();
  });

  const token = (o: Record<string, unknown> = {}) => ({ token_hash: hex(++n), email: "ada@example.com", created_at: T(12), expires_at: T(12, 15), used_at: null as string | null, ...o });
  const insertToken = (t: ReturnType<typeof token>) => q(`insert into club.login_tokens (token_hash, email, created_at, expires_at, used_at) values ($1,$2,$3,$4,$5) returning id`, [t.token_hash, t.email, t.created_at, t.expires_at, t.used_at]);
  const session = (o: Record<string, unknown> = {}) => ({ token_hash: hex(++n + 10000), subject_kind: "member", member_id: member as string | null, staff_email: null as string | null, created_at: T(12), expires_at: T(13), revoked_at: null as string | null, ...o });
  const insertSession = (s: ReturnType<typeof session>) =>
    q(`insert into club.sessions (token_hash, subject_kind, member_id, staff_email, created_at, expires_at, revoked_at) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [s.token_hash, s.subject_kind, s.member_id, s.staff_email, s.created_at, s.expires_at, s.revoked_at]);

  describe("sign-in links", () => {
    it("hold a fingerprint, never the secret, and a lower-case address", async () => {
      expect(await code(insertToken(token()))).toBeNull();
      for (const bad of ["secret", "A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64)]) expect(await code(insertToken(token({ token_hash: bad }))), bad).toBe(CHECK_VIOLATION);
      expect(await code(insertToken(token({ email: "Ada@Example.com" })))).toBe(CHECK_VIOLATION);
      expect(await code(insertToken(token({ email: "a@" })))).toBe(CHECK_VIOLATION);
    });

    it("are unique", async () => {
      const t = token();
      await insertToken(t);
      expect(await code(insertToken({ ...t }))).toBe(UNIQUE_VIOLATION);
    });

    it("are short-lived: they expire after they were made, and within a day", async () => {
      expect(await code(insertToken(token({ expires_at: T(12) })))).toBe(CHECK_VIOLATION);
      expect(await code(insertToken(token({ expires_at: T(11) })))).toBe(CHECK_VIOLATION);
      expect(await code(insertToken(token({ expires_at: new Date(Date.UTC(2026, 9, 30, 12)).toISOString() })))).toBeNull(); // exactly a day
      expect(await code(insertToken(token({ expires_at: new Date(Date.UTC(2026, 9, 30, 12, 1)).toISOString() })))).toBe(CHECK_VIOLATION);
    });

    it("can be used once, while alive, and then never again", async () => {
      const id = (await insertToken(token())).rows[0].id;
      expect(await code(q(`update club.login_tokens set used_at = $2 where id = $1`, [id, T(11)]))).toBe(CHECK_VIOLATION); // before it was made
      expect(await code(q(`update club.login_tokens set used_at = $2 where id = $1`, [id, T(12, 16)]))).toBe(CHECK_VIOLATION); // after it ran out
      expect(await code(q(`update club.login_tokens set used_at = $2 where id = $1`, [id, T(12, 5)]))).toBeNull();
      await expect(q(`update club.login_tokens set used_at = $2 where id = $1`, [id, T(12, 6)])).rejects.toThrow("can only be used once");
      await expect(q(`update club.login_tokens set used_at = null where id = $1`, [id])).rejects.toThrow("can only be used once");
    });

    it("can change in no way except being used, and are never removed", async () => {
      const id = (await insertToken(token())).rows[0].id;
      for (const set of [`email = 'other@example.com'`, `expires_at = '2026-10-29T13:00:00Z'`, `created_at = '2026-10-29T11:00:00Z'`, `token_hash = '${hex(99999)}'`]) {
        await expect(q(`update club.login_tokens set ${set} where id = $1`, [id]), set).rejects.toThrow("cannot be changed, only used");
      }
      await expect(q(`delete from club.login_tokens where id = $1`, [id])).rejects.toThrow("never removed");
      await expect(q(`truncate club.login_tokens`)).rejects.toThrow("never removed");
    });
  });

  describe("sessions", () => {
    it("hold a fingerprint, and name exactly one member or one staff email", async () => {
      expect(await code(insertSession(session()))).toBeNull();
      expect(await code(insertSession(session({ subject_kind: "staff", member_id: null, staff_email: "alex@example.org" })))).toBeNull();
      expect(await code(insertSession(session({ token_hash: "secret" })))).toBe(CHECK_VIOLATION);
      // A member session with no member, or with a staff email too; a staff session with no email, or with a member too.
      expect(await code(insertSession(session({ member_id: null })))).toBe(CHECK_VIOLATION);
      expect(await code(insertSession(session({ staff_email: "alex@example.org" })))).toBe(CHECK_VIOLATION);
      expect(await code(insertSession(session({ subject_kind: "staff", member_id: null, staff_email: null })))).toBe(CHECK_VIOLATION);
      expect(await code(insertSession(session({ subject_kind: "staff", staff_email: "alex@example.org" })))).toBe(CHECK_VIOLATION);
      expect(await code(insertSession(session({ subject_kind: "guest" })))).toBe(CHECK_VIOLATION);
      expect(await code(insertSession(session({ subject_kind: "staff", member_id: null, staff_email: "Alex@Example.org" })))).toBe(CHECK_VIOLATION);
    });

    it("must belong to a real member, and are unique", async () => {
      expect(await code(insertSession(session({ member_id: "00000000-0000-4000-8000-0000000000ff" })))).toBe(FOREIGN_KEY_VIOLATION);
      const s = session();
      await insertSession(s);
      expect(await code(insertSession({ ...s }))).toBe(UNIQUE_VIOLATION);
    });

    it("have a ceiling on how long someone stays signed in: 90 days", async () => {
      expect(await code(insertSession(session({ expires_at: T(12) })))).toBe(CHECK_VIOLATION);
      expect(await code(insertSession(session({ expires_at: new Date(Date.UTC(2027, 0, 27, 12)).toISOString() })))).toBeNull(); // Jan 27 is exactly 90 days after Oct 29
      expect(await code(insertSession(session({ expires_at: new Date(Date.UTC(2027, 0, 27, 12, 1)).toISOString() })))).toBe(CHECK_VIOLATION);
    });

    it("can be signed out once, and a signed-out browser stays signed out", async () => {
      const id = (await insertSession(session())).rows[0].id;
      expect(await code(q(`update club.sessions set revoked_at = $2 where id = $1`, [id, T(11)]))).toBe(CHECK_VIOLATION); // before it was made
      expect(await code(q(`update club.sessions set revoked_at = $2 where id = $1`, [id, T(12, 30)]))).toBeNull();
      await expect(q(`update club.sessions set revoked_at = null where id = $1`, [id])).rejects.toThrow("stays signed out");
      await expect(q(`update club.sessions set revoked_at = $2 where id = $1`, [id, T(12, 45)])).rejects.toThrow("stays signed out");
    });

    it("can change in no way except being signed out, and are never removed", async () => {
      const id = (await insertSession(session())).rows[0].id;
      const hh = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Handover household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
      const someoneElse = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, 'Cy', 'Handover', 'cy@example.com', 'primary') returning id`, [hh])).rows[0].id;
      for (const set of [`member_id = '${someoneElse}'`, `expires_at = '2027-01-01T00:00:00Z'`, `staff_email = 'x@example.org'`, `subject_kind = 'staff'`, `created_at = '2026-10-29T11:00:00Z'`, `token_hash = '${hex(88888)}'`]) {
        await expect(q(`update club.sessions set ${set} where id = $1`, [id]), set).rejects.toThrow("cannot be changed, only signed out");
      }
      await expect(q(`delete from club.sessions where id = $1`, [id])).rejects.toThrow("never removed");
      await expect(q(`truncate club.sessions`)).rejects.toThrow("never removed");
    });

    it("keep a member's record from being removed from under them", async () => {
      const hh = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Other household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
      const other = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, 'Bo', 'Other', 'bo@example.com', 'primary') returning id`, [hh])).rows[0].id;
      await insertSession(session({ member_id: other }));
      await expect(q(`delete from club.members where id = $1`, [other])).rejects.toThrow();
    });
  });
});
