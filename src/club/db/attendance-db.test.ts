import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, recordOutcome, type ScratchDb } from "./testdb";

/**
 * The check-in record as the DATABASE guards it, tested against a real Postgres: lines are only ever added, every line is
 * about exactly one record, who and how agree, and no booking, class chair or RSVP can change its outcome without a matching
 * line written at the same moment. Needs CLUB_TEST_DATABASE_URL (a local or throwaway Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";

const T = (hh: number, mm = 0, day = 29) => new Date(Date.UTC(2026, 9, day, hh, mm)).toISOString(); // Oct 29, 2026, in UTC

describe.skipIf(!ADMIN_URL)("the check-in record", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "other");

  let n = 0;
  let member: string;
  let item: string;
  let sessionId: string;
  let eventId: string;

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    const hh = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    member = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, 'Ada', 'Test', 'ada@example.com', 'primary') returning id`, [hh])).rows[0].id;
    await q(`insert into club.item_classes (code, booking_type, name, seats) values ('single', 'Shell', 'Single', 1)`);
    item = (await q(`insert into club.items (name, class_code) values ('Heron', 'single') returning id`)).rows[0].id;
    const cls = (await q(`insert into club.classes (name, default_capacity, default_minutes) values ('Yoga', 30, 60) returning id`)).rows[0].id;
    sessionId = (await q(`insert into club.class_sessions (class_id, starts_at, ends_at, capacity, created_by_kind, created_by_label) values ($1, $2, $3, 30, 'staff', 'Test staff') returning id`, [cls, T(9), T(10)])).rows[0].id;
    eventId = (await q(`insert into club.events (title, starts_at, ends_at, capacity, created_by_kind, created_by_label) values ('Dinner', $1, $2, 30, 'staff', 'Test staff') returning id`, [T(18), T(21)])).rows[0].id;
  });
  afterAll(async () => {
    await db?.drop();
  });

  /** One fresh record of each kind, so tests never share one. */
  async function fresh() {
    n += 1;
    const slot = (n % 40) * 5; // different minute each time: bookings of one boat cannot overlap
    const start = new Date(Date.UTC(2026, 10, 1 + Math.floor(n / 40), 6, slot)).toISOString();
    const end = new Date(Date.parse(start) + 60000).toISOString();
    const other = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ((select household_id from club.members where id = $1), $2, 'Test', $3, 'additional') returning id`, [member, `P${n}`, `p${n}@example.com`])).rows[0].id;
    return {
      booking: (await q(`insert into club.bookings (item_id, booker_id, starts_at, ends_at, created_by_kind, created_by_label) values ($1, $2, $3, $4, 'member', 'A Member') returning id`, [item, member, start, end])).rows[0].id as string,
      signup: (await q(`insert into club.class_signups (session_id, member_id, status, created_by_kind, created_by_label) values ($1, $2, 'enrolled', 'member', 'A Member') returning id`, [sessionId, other])).rows[0].id as string,
      rsvp: (await q(`insert into club.event_rsvps (event_id, member_id, guests, status, created_by_kind, created_by_label) values ($1, $2, 0, 'going', 'member', 'A Member') returning id`, [eventId, other])).rows[0].id as string,
      other: other as string,
    };
  }

  const line = (overrides: Record<string, unknown> = {}) => ({
    kind: "booking",
    booking_id: null as string | null,
    signup_id: null as string | null,
    rsvp_id: null as string | null,
    member_id: member,
    at: T(12),
    outcome: "attended",
    previous_outcome: null as string | null,
    by_kind: "staff",
    by_id: null as string | null,
    by_label: "Test staff",
    via: "staff",
    note: null as string | null,
    ...overrides,
  });
  const insertLine = (l: ReturnType<typeof line>) =>
    q(
      `insert into club.attendance_log (kind, booking_id, signup_id, rsvp_id, member_id, at, outcome, previous_outcome, by_kind, by_id, by_label, via, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [l.kind, l.booking_id, l.signup_id, l.rsvp_id, l.member_id, l.at, l.outcome, l.previous_outcome, l.by_kind, l.by_id, l.by_label, l.via, l.note],
    );

  describe("what a line is", () => {
    it("is about exactly one record, and the record must be the kind it says", async () => {
      const r = await fresh();
      expect(await code(insertLine(line({ booking_id: r.booking })))).toBeNull();
      expect(await code(insertLine(line({ kind: "class", signup_id: r.signup })))).toBeNull();
      expect(await code(insertLine(line({ kind: "event", rsvp_id: r.rsvp })))).toBeNull();
      // Nothing, two things, or the wrong kind of thing.
      expect(await code(insertLine(line()))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ booking_id: r.booking, signup_id: r.signup })))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ kind: "class", booking_id: r.booking })))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ kind: "booking", rsvp_id: r.rsvp })))).toBe(CHECK_VIOLATION);
    });

    it("must agree on who did it and how: the system for automatic, staff for the front desk, a member for the iPad and the phone", async () => {
      const r = await fresh();
      const b = { booking_id: r.booking };
      const own = { by_kind: "member", by_id: member, by_label: "Ada Test" };
      expect(await code(insertLine(line({ ...b, via: "automatic", by_kind: "system", by_label: "Automatic no-show", outcome: "no_show" })))).toBeNull();
      expect(await code(insertLine(line({ ...b, via: "ipad", ...own })))).toBeNull();
      expect(await code(insertLine(line({ ...b, via: "phone", ...own })))).toBeNull();
      expect(await code(insertLine(line({ ...b, via: "automatic", by_kind: "staff" })))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ ...b, via: "staff", by_kind: "system" })))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ ...b, via: "staff", by_kind: "member" })))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ ...b, via: "ipad", by_kind: "staff" })))).toBe(CHECK_VIOLATION);
      // A phone or iPad line that is otherwise a perfect member tap, but signed by someone who is not a member.
      expect(await code(insertLine(line({ ...b, via: "phone", by_kind: "staff", by_id: member })))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ ...b, via: "ipad", by_kind: "system", by_id: member, by_label: "Automatic no-show" })))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ ...b, via: "tablet", ...own })))).toBe(CHECK_VIOLATION);
    });

    it("lets only staff write a confirmation, a line that says nothing changed", async () => {
      const r = await fresh();
      const b = { booking_id: r.booking, outcome: "no_show", previous_outcome: "no_show" };
      expect(await code(insertLine(line(b)))).toBeNull();
      expect(await code(insertLine(line({ ...b, via: "automatic", by_kind: "system" })))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ ...b, via: "ipad", by_kind: "member", by_id: member })))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ ...b, via: "phone", by_kind: "member", by_id: member })))).toBe(CHECK_VIOLATION);
    });

    it("only knows two outcomes, and keeps notes short", async () => {
      const r = await fresh();
      expect(await code(insertLine(line({ booking_id: r.booking, outcome: "completed" })))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ booking_id: r.booking, note: "x".repeat(301) })))).toBe(CHECK_VIOLATION);
      expect(await code(insertLine(line({ booking_id: r.booking, note: "x".repeat(300) })))).toBeNull();
    });
  });

  describe("a member checking themselves in", () => {
    const tapLine = (overrides: Record<string, unknown> = {}) => line({ via: "phone", by_kind: "member", by_id: member, by_label: "Ada Test", ...overrides });

    for (const via of ["phone", "ipad"]) {
      it(`on the ${via === "ipad" ? "iPad" : "phone"} is only ever "I came": about themselves, the first line, for an outing or a class chair`, async () => {
        const r = await fresh();
        expect(await code(insertLine(tapLine({ via, booking_id: r.booking })))).toBeNull();
        // Not a no-show, and not a correction of something already recorded.
        expect(await code(insertLine(tapLine({ via, booking_id: r.booking, outcome: "no_show" })))).toBe(CHECK_VIOLATION);
        expect(await code(insertLine(tapLine({ via, booking_id: r.booking, previous_outcome: "no_show" })))).toBe(CHECK_VIOLATION);
        expect(await code(insertLine(tapLine({ via, booking_id: r.booking, previous_outcome: "attended" })))).toBe(CHECK_VIOLATION);
        // About themselves: the line's person is the one who tapped.
        expect(await code(insertLine(tapLine({ via, booking_id: r.booking, by_id: r.other })))).toBe(CHECK_VIOLATION);
        expect(await code(insertLine(tapLine({ via, booking_id: r.booking, by_id: null })))).toBe(CHECK_VIOLATION);
        // Events are ticked off by staff.
        expect(await code(insertLine(tapLine({ via, kind: "event", rsvp_id: r.rsvp, member_id: r.other, by_id: r.other })))).toBe(CHECK_VIOLATION);
        expect(await code(insertLine(tapLine({ via, kind: "class", signup_id: r.signup, member_id: r.other, by_id: r.other })))).toBeNull();
      });
    }

    it("must be for an outing the person is on: the booker, or crew still aboard", async () => {
      const r = await fresh();
      const tapByOther = () => insertLine(tapLine({ booking_id: r.booking, member_id: r.other, by_id: r.other, by_label: "Crew Test" }));
      expect(await code(tapByOther())).toBe(CHECK_VIOLATION); // not on the booking at all
      await q(`insert into club.booking_crew (booking_id, member_id) values ($1, $2)`, [r.booking, r.other]);
      expect(await code(tapByOther())).toBeNull();

      const gone = await fresh();
      await q(`insert into club.booking_crew (booking_id, member_id, removed_at, removed_reason) values ($1, $2, $3, 'Left the club')`, [gone.booking, gone.other, T(11)]);
      expect(await code(insertLine(tapLine({ booking_id: gone.booking, member_id: gone.other, by_id: gone.other })))).toBe(CHECK_VIOLATION); // left the boat
    });

    it("must be for a class chair the person holds", async () => {
      const r = await fresh();
      expect(await code(insertLine(tapLine({ kind: "class", signup_id: r.signup })))).toBe(CHECK_VIOLATION); // someone else's chair
      expect(await code(insertLine(tapLine({ kind: "class", signup_id: r.signup, member_id: r.other, by_id: r.other })))).toBeNull();
    });

    it("leaves staff free to record anything, as before", async () => {
      const r = await fresh();
      expect(await code(insertLine(line({ booking_id: r.booking, outcome: "no_show", previous_outcome: "attended" })))).toBeNull();
      expect(await code(insertLine(line({ kind: "event", rsvp_id: r.rsvp, member_id: r.other })))).toBeNull();
    });
  });

  describe("only ever added to", () => {
    it("refuses to change, remove or empty the record, and a record with lines cannot be deleted from under them", async () => {
      const r = await fresh();
      const id = (await insertLine(line({ booking_id: r.booking }))).rows[0].id;
      await expect(q(`update club.attendance_log set outcome = 'no_show' where id = $1`, [id])).rejects.toThrow("can only be added to");
      await expect(q(`update club.attendance_log set note = 'edited' where id = $1`, [id])).rejects.toThrow("can only be added to");
      await expect(q(`delete from club.attendance_log where id = $1`, [id])).rejects.toThrow("can only be added to");
      await expect(q(`truncate club.attendance_log`)).rejects.toThrow("can only be added to");
      await expect(q(`delete from club.bookings where id = $1`, [r.booking])).rejects.toThrow(/foreign key/);
      expect((await q(`select count(*)::int as n from club.attendance_log where id = $1`, [id])).rows[0].n).toBe(1);
    });
  });

  describe("no outcome without a line", () => {
    const tables = [
      ["bookings", "booking", "completed"],
      ["class_signups", "signup", "attended"],
      ["event_rsvps", "rsvp", "attended"],
    ] as const;

    for (const [table, key, attended] of tables) {
      it(`refuses to record ${table === "bookings" ? "a booking" : table === "class_signups" ? "a class chair" : "an RSVP"} as ${attended} or a no-show with no line written beside it`, async () => {
        const r = await fresh();
        const id = r[key];
        expect(await code(q(`update club.${table} set status = $2, status_changed_at = $3 where id = $1`, [id, attended, T(12)]))).toBe(CHECK_VIOLATION);
        expect(await code(q(`update club.${table} set status = 'no_show', status_changed_at = $2 where id = $1`, [id, T(12)]))).toBe(CHECK_VIOLATION);
        expect((await q(`select status from club.${table} where id = $1`, [id])).rows[0].status).toBe(table === "bookings" ? "upcoming" : table === "class_signups" ? "enrolled" : "going");
        // With its line, in the same change, it goes through.
        await recordOutcome(db.client, table, id, attended === "completed" ? "completed" : "attended");
      });

      it(`refuses a line that says the wrong thing, was written at another moment, or leaves out what it was before (${table})`, async () => {
        const r = await fresh();
        const id = r[key];
        const kind = key === "booking" ? "booking" : key === "signup" ? "class" : "event";
        const fk = { [`${key}_id`]: id };
        const change = async (lineFields: Record<string, unknown>, status = attended) => {
          await q("begin");
          try {
            await q(`update club.${table} set status = $2, status_changed_at = $3 where id = $1`, [id, status, T(12)]);
            if (lineFields) await insertLine(line({ kind, ...fk, ...lineFields }));
            await q("commit");
          } catch (e) {
            await q("rollback");
            throw e;
          }
        };
        // The line says no-show but the record says attended.
        expect(await code(change({ outcome: "no_show", at: T(12) }))).toBe(CHECK_VIOLATION);
        // The line was written at a different moment than the change.
        expect(await code(change({ outcome: "attended", at: T(13) }))).toBe(CHECK_VIOLATION);
        // The line claims there was already an outcome.
        expect(await code(change({ outcome: "attended", previous_outcome: "no_show", at: T(12) }))).toBe(CHECK_VIOLATION);
        // The right line.
        expect(await code(change({ outcome: "attended", at: T(12) }))).toBeNull();
      });
    }

    it("makes a correction need its own new line, even when the old line says the same thing", async () => {
      const r = await fresh();
      await recordOutcome(db.client, "bookings", r.booking, "completed", { at: T(12) });
      await recordOutcome(db.client, "bookings", r.booking, "no_show", { at: T(13) });
      // Back to completed at 14:00 with no new line: the two old lines do not count.
      expect(await code(q(`update club.bookings set status = 'completed', status_changed_at = $2 where id = $1`, [r.booking, T(14)]))).toBe(CHECK_VIOLATION);
      // Even at the very moment of the first line, because the line must also say what it was before.
      expect(await code(q(`update club.bookings set status = 'completed', status_changed_at = $2 where id = $1`, [r.booking, T(12)]))).toBe(CHECK_VIOLATION);
      await recordOutcome(db.client, "bookings", r.booking, "completed", { at: T(14) });
      expect((await q(`select outcome, previous_outcome from club.attendance_log where booking_id = $1 order by seq`, [r.booking])).rows).toEqual([
        { outcome: "attended", previous_outcome: null },
        { outcome: "no_show", previous_outcome: "attended" },
        { outcome: "attended", previous_outcome: "no_show" },
      ]);
    });

    it("lets an outcome move between attended and no-show but never anywhere else", async () => {
      const r = await fresh();
      await recordOutcome(db.client, "class_signups", r.signup, "attended");
      await recordOutcome(db.client, "class_signups", r.signup, "no_show");
      for (const status of ["enrolled", "waitlisted", "cancelled", "late_cancelled"]) {
        expect(await code(q(`update club.class_signups set status = $2, cancelled_by_kind = 'staff', cancelled_by_label = 'x' where id = $1`, [r.signup, status])), status).not.toBeNull();
      }
      await recordOutcome(db.client, "event_rsvps", r.rsvp, "no_show");
      await recordOutcome(db.client, "event_rsvps", r.rsvp, "attended");
      for (const status of ["going", "waitlisted", "cancelled", "late_cancelled"]) {
        expect(await code(q(`update club.event_rsvps set status = $2, cancelled_by_kind = 'staff', cancelled_by_label = 'x' where id = $1`, [r.rsvp, status])), status).not.toBeNull();
      }
    });

    it("lets a cancelled booking stay cancelled and does not ask for a line when someone cancels", async () => {
      const r = await fresh();
      expect(await code(q(`update club.bookings set status = 'cancelled', cancelled_by_kind = 'member', cancelled_by_label = 'Ada' where id = $1`, [r.booking]))).toBeNull();
      await expect(recordOutcome(db.client, "bookings", r.booking, "completed")).rejects.toThrow("already cancelled cannot change again");
    });
  });
});
