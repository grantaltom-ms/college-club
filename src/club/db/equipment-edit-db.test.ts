import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * Fixing and retiring equipment as the DATABASE guards it, tested against a real Postgres, with every rule broken on purpose:
 * an item's name, kind, skill level, places or retirement cannot change without a matching line in its file written in the very
 * same change; the file is only added to; a retired item is not booked, not reserved for a practice, and only renamed; an item
 * never turns into another kind of thing or into a boat with fewer seats than an upcoming booking has people; a pool is resized
 * but never to or from a single place and never below the most people booked at one moment. Needs CLUB_TEST_DATABASE_URL (a
 * local or throwaway Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const NEEDS_A_LINE = /cannot change without a matching line in its file/;
const RETIRE_NEEDS_A_LINE = /cannot be retired or brought back without a matching line/;

type Failure = { code?: string; message: string };
type Step = [string, unknown[]?];

describe.skipIf(!ADMIN_URL)("equipment edit", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  const members: string[] = [];
  let n = 0;
  let day = 0;
  /** A moment in October 2026; every test takes its own day so bookings never meet. */
  const T = (hh: number, d: number) => new Date(Date.UTC(2026, 9, d, hh)).toISOString();
  const nextDay = () => 1 + ++day;

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    const household = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    for (let i = 0; i < 6; i++) {
      members.push((await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Test', $3, $4) returning id`, [household, `Person${i}`, `p${i}@example.com`, i === 0 ? "primary" : "additional"])).rows[0].id);
    }
    await q(`insert into club.item_classes (code, booking_type, name, seats) values
      ('t-single', 'Shell', 'Single', 1), ('t-double', 'Shell', 'Double', 2), ('t-quad', 'Shell', 'Quad', 4),
      ('t-kayak', 'Kayak', 'Kayak', 1), ('t-dock', 'Dock Space', 'Dock', 1), ('t-gym', 'Gym Space', 'Gym', 1)`);
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

  /** Several statements as one change. The rules that are checked at the end of a change fire at the commit. */
  async function change(steps: Step[]): Promise<Failure | null> {
    await q("begin");
    try {
      for (const [sql, params] of steps) await q(sql, params ?? []);
      await q("commit");
      return null;
    } catch (e) {
      await q("rollback");
      return e as Failure;
    }
  }

  async function item(classCode: string, places?: number): Promise<string> {
    n += 1;
    if (places === undefined) return (await q(`insert into club.items (name, class_code) values ($1, $2) returning id`, [`Item ${n}`, classCode])).rows[0].id;
    return (await q(`insert into club.items (name, class_code, places) values ($1, $2, $3) returning id`, [`Item ${n}`, classCode, places])).rows[0].id;
  }
  const nameOf = async (id: string) => (await q(`select name from club.items where id = $1`, [id])).rows[0].name as string;
  const row = async (id: string) => (await q(`select * from club.items where id = $1`, [id])).rows[0];

  /** A line in the item's file, written now, in the change it is part of. */
  const line = (itemId: string, kind: string, details: Record<string, unknown> = {}, text = "A line."): Step => [
    `insert into club.item_log (item_id, at, kind, by_label, text, details) values ($1, now(), $2, 'Test staff', $3, $4)`,
    [itemId, kind, text, JSON.stringify(details)],
  ];
  const rename = (id: string, to: string): Step => [`update club.items set name = $2 where id = $1`, [id, to]];
  const retire = (id: string): Step => [`update club.items set retired_at = now(), retired_by_label = 'Test staff', retired_reason = 'Sold' where id = $1`, [id]];
  const retiredLine = (id: string): Step => line(id, "retired", { reason: "Sold" });
  const restore = (id: string): Step => [`update club.items set retired_at = null, retired_by_label = null, retired_reason = null where id = $1`, [id]];

  /** A retired item. */
  async function retired(classCode = "t-single"): Promise<string> {
    const id = await item(classCode);
    expect(await change([retire(id), retiredLine(id)])).toBeNull();
    return id;
  }

  async function bookingOn(itemId: string, who: number, hour: number, d: number, o: { hours?: number; status?: string } = {}): Promise<string> {
    const status = o.status ?? "upcoming";
    return (
      await q(
        `insert into club.bookings (item_id, booker_id, starts_at, ends_at, status, created_by_kind, created_by_label, cancelled_by_kind, cancelled_by_label)
         values ($1,$2,$3,$4,$5,'member','A Member',$6,$7) returning id`,
        [itemId, members[who], T(hour, d), T(hour + (o.hours ?? 1), d), status, status === "cancelled" ? "member" : null, status === "cancelled" ? "A Member" : null],
      )
    ).rows[0].id;
  }

  describe("a retired item's marks", () => {
    it("are all set or all empty: a retirement needs who, when and why", async () => {
      const id = await item("t-single");
      for (const set of [
        `retired_at = now()`,
        `retired_by_label = 'Test staff'`,
        `retired_reason = 'Sold'`,
        `retired_at = now(), retired_by_label = 'Test staff'`,
        `retired_at = now(), retired_reason = 'Sold'`,
        `retired_by_label = 'Test staff', retired_reason = 'Sold'`,
      ]) {
        const failure = await attempt(`update club.items set ${set} where id = $1`, [id]);
        expect(failure?.code).toBe(CHECK_VIOLATION);
        expect(failure?.message).toMatch(/items_retirement_is_complete/);
      }
      expect((await row(id)).retired_at).toBeNull();
    });

    it("need a reason that is not blank and not over 200 characters", async () => {
      const id = await item("t-single");
      for (const reason of ["   ", "", "x".repeat(201)]) {
        const failure = await attempt(`update club.items set retired_at = now(), retired_by_label = 'Test staff', retired_reason = $2 where id = $1`, [id, reason]);
        expect(failure?.code).toBe(CHECK_VIOLATION);
        // The reason's own rule refused it, not one of the other rules that also guard a retirement.
        expect(failure?.message).toMatch(/items_retired_reason_check/);
      }
      expect(await change([retire(id), retiredLine(id)])).toBeNull();
      expect((await row(id)).retired_reason).toBe("Sold");
    });
  });

  describe("an item's file", () => {
    it("takes a changed, retired or restored line and nothing else", async () => {
      const id = await item("t-single");
      for (const kind of ["changed", "restored"]) expect(await attempt(`insert into club.item_log (item_id, at, kind, by_label, text) values ($1, now(), $2, 'Test staff', 'A line.')`, [id, kind])).toBeNull();
      expect(await attempt(`insert into club.item_log (item_id, at, kind, by_label, text, details) values ($1, now(), 'retired', 'Test staff', 'A line.', '{"reason": "Sold"}')`, [id])).toBeNull();
      for (const kind of ["deleted", "note", "CHANGED", ""]) {
        expect((await attempt(`insert into club.item_log (item_id, at, kind, by_label, text) values ($1, now(), $2, 'Test staff', 'A line.')`, [id, kind]))?.code).toBe(CHECK_VIOLATION);
      }
    });

    it("keeps the reason on a retired line, 1 to 200 characters", async () => {
      const id = await item("t-single");
      const retiredWith = (details: unknown) => attempt(`insert into club.item_log (item_id, at, kind, by_label, text, details) values ($1, now(), 'retired', 'Test staff', 'A line.', $2)`, [id, JSON.stringify(details)]);
      expect((await retiredWith({}))?.message).toMatch(/item_log_retired_has_a_reason/);
      expect((await retiredWith({ reason: "   " }))?.message).toMatch(/item_log_retired_has_a_reason/);
      expect((await retiredWith({ reason: "x".repeat(201) }))?.message).toMatch(/item_log_retired_has_a_reason/);
      expect(await retiredWith({ reason: "x".repeat(200) })).toBeNull();
    });

    it("has text of 1 to 1500 characters, a name for who did it, details that are an object, and an item that exists", async () => {
      const id = await item("t-single");
      const put = (text: string, by = "Test staff", details = "{}") => attempt(`insert into club.item_log (item_id, at, kind, by_label, text, details) values ($1, now(), 'changed', $3, $2, $4)`, [id, text, by, details]);
      expect((await put(""))?.code).toBe(CHECK_VIOLATION);
      expect((await put("x".repeat(1501)))?.code).toBe(CHECK_VIOLATION);
      expect(await put("x".repeat(1500))).toBeNull();
      expect((await put("A line.", ""))?.code).toBe(CHECK_VIOLATION);
      expect((await put("A line.", "x".repeat(121)))?.code).toBe(CHECK_VIOLATION);
      expect((await put("A line.", "Test staff", "[]"))?.code).toBe(CHECK_VIOLATION);
      const failure = await attempt(`insert into club.item_log (item_id, at, kind, by_label, text) values ('00000000-0000-4000-8000-0000000fffff', now(), 'changed', 'Test staff', 'A line.')`);
      expect(failure?.code).toBe(FOREIGN_KEY_VIOLATION);
    });

    it("is only added to: a line cannot be changed or removed, and the file cannot be emptied", async () => {
      const id = await item("t-single");
      await q(`insert into club.item_log (item_id, at, kind, by_label, text) values ($1, now(), 'changed', 'Test staff', 'Original.')`, [id]);
      expect((await attempt(`update club.item_log set text = 'Rewritten.' where item_id = $1`, [id]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`update club.item_log set item_id = item_id where item_id = $1`, [id]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`delete from club.item_log where item_id = $1`, [id]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`truncate club.item_log`))?.message).toMatch(/cannot be changed or removed/);
      expect((await q(`select text from club.item_log where item_id = $1`, [id])).rows.map((r) => r.text)).toEqual(["Original."]);
    });
  });

  describe("a change to an item", () => {
    it("needs a line in its file, written in the same change", async () => {
      const id = await item("t-single");
      const before = await nameOf(id);
      expect((await attempt(`update club.items set name = 'Renamed' where id = $1`, [id]))?.message).toMatch(NEEDS_A_LINE);
      expect(await nameOf(id)).toBe(before);
      // The same change with the line: fine, and the line may come after the item it explains.
      expect(await change([rename(id, "Renamed"), line(id, "changed", { nameFrom: before, nameTo: "Renamed" })])).toBeNull();
      expect(await nameOf(id)).toBe("Renamed");
      expect(await change([line(id, "changed", { nameFrom: "Renamed", nameTo: "Renamed again" }), rename(id, "Renamed again")])).toBeNull();
    });

    it("is not explained by a line from an earlier change", async () => {
      const id = await item("t-single");
      const before = await nameOf(id);
      expect(await change([line(id, "changed", { nameFrom: before, nameTo: "Later" })])).toBeNull();
      expect((await change([rename(id, "Later")]))?.message).toMatch(NEEDS_A_LINE);
      expect(await nameOf(id)).toBe(before);
    });

    it("must be explained by a line about this item, of kind changed, with the real old and new value", async () => {
      const id = await item("t-single");
      const other = await item("t-single");
      const before = await nameOf(id);
      expect((await change([rename(id, "New"), line(id, "changed", { nameFrom: "Wrong", nameTo: "New" })]))?.message).toMatch(NEEDS_A_LINE);
      expect((await change([rename(id, "New"), line(id, "changed", { nameFrom: before, nameTo: "Wrong" })]))?.message).toMatch(NEEDS_A_LINE);
      expect((await change([rename(id, "New"), line(id, "changed", { nameFrom: before })]))?.message).toMatch(NEEDS_A_LINE);
      expect((await change([rename(id, "New"), line(other, "changed", { nameFrom: before, nameTo: "New" })]))?.message).toMatch(NEEDS_A_LINE);
      expect((await change([rename(id, "New"), line(id, "restored", { nameFrom: before, nameTo: "New" })]))?.message).toMatch(NEEDS_A_LINE);
      expect(await nameOf(id)).toBe(before);
    });

    it("names every thing that changed: a line about the name does not cover a new size", async () => {
      const id = await item("t-single");
      const before = await nameOf(id);
      const both: Step[] = [[`update club.items set name = 'Both', class_code = 't-double' where id = $1`, [id]]];
      expect((await change([...both, line(id, "changed", { nameFrom: before, nameTo: "Both" })]))?.message).toMatch(NEEDS_A_LINE);
      expect((await change([...both, line(id, "changed", { classFrom: "t-single", classTo: "t-double" })]))?.message).toMatch(NEEDS_A_LINE);
      expect(await change([...both, line(id, "changed", { nameFrom: before, nameTo: "Both", classFrom: "t-single", classTo: "t-double" })])).toBeNull();
      expect((await row(id)).class_code).toBe("t-double");
    });

    it("needs the old and new size, skill level and places to be the real ones", async () => {
      const id = await item("t-single");
      const size: Step = [`update club.items set class_code = 't-double' where id = $1`, [id]];
      expect((await change([size, line(id, "changed", { classFrom: "t-quad", classTo: "t-double" })]))?.message).toMatch(NEEDS_A_LINE);
      expect((await change([size, line(id, "changed", { classFrom: "t-single", classTo: "t-quad" })]))?.message).toMatch(NEEDS_A_LINE);
      expect(await change([size, line(id, "changed", { classFrom: "t-single", classTo: "t-double" })])).toBeNull();

      const skill: Step = [`update club.items set qualification_mode = 'none' where id = $1`, [id]];
      expect((await change([skill, line(id, "changed", { skillFrom: "none", skillTo: "none" })]))?.message).toMatch(NEEDS_A_LINE);
      expect((await change([skill, line(id, "changed", { skillFrom: "class", skillTo: "scull-1" })]))?.message).toMatch(NEEDS_A_LINE);
      expect(await change([skill, line(id, "changed", { skillFrom: "class", skillTo: "none" })])).toBeNull();
      const code: Step = [`update club.items set qualification_mode = 'code', required_qualification = 'scull-1' where id = $1`, [id]];
      expect((await change([code, line(id, "changed", { skillFrom: "none", skillTo: "code" })]))?.message).toMatch(NEEDS_A_LINE);
      expect(await change([code, line(id, "changed", { skillFrom: "none", skillTo: "scull-1" })])).toBeNull();
      expect(await change([[`update club.items set qualification_mode = 'class', required_qualification = null where id = $1`, [id]], line(id, "changed", { skillFrom: "scull-1", skillTo: "class" })])).toBeNull();

      const pool = await item("t-dock", 8);
      const places: Step = [`update club.items set places = 9 where id = $1`, [pool]];
      expect((await change([places, line(pool, "changed", { placesFrom: 8, placesTo: 10 })]))?.message).toMatch(NEEDS_A_LINE);
      expect((await change([places, line(pool, "changed", { placesFrom: 7, placesTo: 9 })]))?.message).toMatch(NEEDS_A_LINE);
      expect(await change([places, line(pool, "changed", { placesFrom: 8, placesTo: 9 })])).toBeNull();
    });

    it("lets a save that changes nothing through, and the rules JSON be edited, without a line", async () => {
      const id = await item("t-single");
      expect(await attempt(`update club.items set name = name, class_code = class_code, places = places where id = $1`, [id])).toBeNull();
      expect(await attempt(`update club.items set rule_overrides = '{"maxMinutes": 90}'::jsonb where id = $1`, [id])).toBeNull();
    });
  });

  describe("retiring an item", () => {
    it("needs a retired line in its file, and bringing it back a restored one", async () => {
      const id = await item("t-single");
      expect((await change([retire(id)]))?.message).toMatch(RETIRE_NEEDS_A_LINE);
      expect((await change([retire(id), line(id, "changed", { nameFrom: "a", nameTo: "b" })]))?.message).toMatch(RETIRE_NEEDS_A_LINE);
      expect((await change([retire(id), line(id, "restored")]))?.message).toMatch(RETIRE_NEEDS_A_LINE);
      expect((await row(id)).retired_at).toBeNull();
      expect(await change([retire(id), retiredLine(id)])).toBeNull();
      expect((await row(id)).retired_at).not.toBeNull();

      expect((await change([restore(id)]))?.message).toMatch(RETIRE_NEEDS_A_LINE);
      expect((await change([restore(id), retiredLine(id)]))?.message).toMatch(RETIRE_NEEDS_A_LINE);
      expect((await row(id)).retired_at).not.toBeNull();
      expect(await change([restore(id), line(id, "restored")])).toBeNull();
      expect((await row(id)).retired_at).toBeNull();
    });

    it("cannot use a retired line from an earlier change", async () => {
      const id = await item("t-single");
      expect(await change([retiredLine(id)])).toBeNull();
      expect((await change([retire(id)]))?.message).toMatch(RETIRE_NEEDS_A_LINE);
    });

    it("is never rewritten: the time, who and why of a retirement stay as they were", async () => {
      const id = await retired();
      for (const set of [`retired_reason = 'Something else'`, `retired_by_label = 'Someone else'`, `retired_at = now() + interval '1 day'`]) {
        expect((await attempt(`update club.items set ${set} where id = $1`, [id]))?.message).toMatch(/A retirement cannot be changed/);
      }
      expect((await row(id)).retired_reason).toBe("Sold");
    });

    it("leaves a retired item able to be renamed, and nothing else", async () => {
      const id = await retired("t-double");
      const before = await nameOf(id);
      expect(await change([rename(id, "Renamed"), line(id, "changed", { nameFrom: before, nameTo: "Renamed" })])).toBeNull();
      const refusal = /A retired item can only be renamed/;
      expect((await change([[`update club.items set class_code = 't-single' where id = $1`, [id]], line(id, "changed", { classFrom: "t-double", classTo: "t-single" })]))?.message).toMatch(refusal);
      expect((await change([[`update club.items set qualification_mode = 'none' where id = $1`, [id]], line(id, "changed", { skillFrom: "class", skillTo: "none" })]))?.message).toMatch(refusal);
      expect((await row(id)).class_code).toBe("t-double");
      // Brought back, it can be changed again.
      expect(await change([restore(id), line(id, "restored")])).toBeNull();
      expect(await change([[`update club.items set class_code = 't-single' where id = $1`, [id]], line(id, "changed", { classFrom: "t-double", classTo: "t-single" })])).toBeNull();
    });

    it("keeps a retired pool's size as it was", async () => {
      const pool = await item("t-dock", 8);
      expect(await change([retire(pool), retiredLine(pool)])).toBeNull();
      expect((await change([[`update club.items set places = 9 where id = $1`, [pool]], line(pool, "changed", { placesFrom: 8, placesTo: 9 })]))?.message).toMatch(/A retired item can only be renamed/);
      expect((await row(pool)).places).toBe(8);
    });

    it("leaves the bookings already made exactly as they were", async () => {
      const id = await item("t-single");
      const d = nextDay();
      const booking = await bookingOn(id, 0, 8, d);
      expect(await change([retire(id), retiredLine(id)])).toBeNull();
      expect((await q(`select status from club.bookings where id = $1`, [booking])).rows[0].status).toBe("upcoming");
    });
  });

  describe("a retired item", () => {
    it("cannot be booked, but an item that is not retired can, and one brought back can again", async () => {
      const id = await item("t-single");
      const d = nextDay();
      await bookingOn(id, 0, 8, d);
      expect(await change([retire(id), retiredLine(id)])).toBeNull();
      const failure = await attempt(
        `insert into club.bookings (item_id, booker_id, starts_at, ends_at, status, created_by_kind, created_by_label) values ($1,$2,$3,$4,'upcoming','member','A Member')`,
        [id, members[1], T(10, d), T(11, d)],
      );
      expect(failure?.message).toMatch(/A retired item cannot be booked/);
      expect(await change([restore(id), line(id, "restored")])).toBeNull();
      await bookingOn(id, 1, 10, d);
    });

    it("cannot be reserved for a practice", async () => {
      const id = await retired("t-single");
      const live = await item("t-single");
      const d = nextDay();
      const practice = (
        await q(
          `insert into club.practices (name, starts_at, ends_at, status, created_at, created_by_kind, created_by_label, status_changed_at)
           values ('Morning session',$1,$2,'scheduled',$3,'staff','Test staff',$3) returning id`,
          [T(7, d), T(9, d), T(1, d)],
        )
      ).rows[0].id;
      const reserve = (boat: string) =>
        attempt(`insert into club.practice_boats (practice_id, item_id, added_at, added_by_kind, added_by_label) values ($1,$2,$3,'staff','Test staff')`, [practice, boat, T(1, d)]);
      expect((await reserve(id))?.message).toMatch(/A retired boat cannot be reserved for a practice/);
      expect(await reserve(live)).toBeNull();
    });
  });

  describe("the kind of thing an item is", () => {
    const toSize = (id: string, from: string, to: string): Step[] => [
      [`update club.items set class_code = $2 where id = $1`, [id, to]],
      line(id, "changed", { classFrom: from, classTo: to }),
    ];

    it("never changes: a shell stays a shell, a kayak a kayak, a dock a dock", async () => {
      const refusal = /cannot change what kind of thing it is/;
      expect((await change(toSize(await item("t-single"), "t-single", "t-kayak")))?.message).toMatch(refusal);
      expect((await change(toSize(await item("t-kayak"), "t-kayak", "t-single")))?.message).toMatch(refusal);
      expect((await change(toSize(await item("t-dock", 8), "t-dock", "t-gym")))?.message).toMatch(refusal);
      expect((await change(toSize(await item("t-dock"), "t-dock", "t-double")))?.message).toMatch(refusal);
    });

    it("can become another size of the same kind, with its line", async () => {
      const id = await item("t-single");
      expect(await change(toSize(id, "t-single", "t-quad"))).toBeNull();
      expect(await change(toSize(id, "t-quad", "t-double"))).toBeNull();
      expect((await row(id)).class_code).toBe("t-double");
    });

    it("cannot become a boat with fewer seats than an upcoming booking has people", async () => {
      const id = await item("t-double");
      const d = nextDay();
      const booking = await bookingOn(id, 0, 8, d);
      await q(`insert into club.booking_crew (booking_id, member_id) values ($1, $2)`, [booking, members[1]]);
      const failure = await change(toSize(id, "t-double", "t-single"));
      expect(failure?.code).toBe(CHECK_VIOLATION);
      expect(failure?.message).toMatch(/more people in it than the new size has seats/);
      expect((await row(id)).class_code).toBe("t-double");
      // A quad holds them, and a booking with nobody else in the boat fits a single.
      expect(await change(toSize(id, "t-double", "t-quad"))).toBeNull();
    });

    it("does not count a crew member who was taken off, or a booking that was cancelled or is over", async () => {
      const taken = await item("t-double");
      const d = nextDay();
      const booking = await bookingOn(taken, 0, 8, d);
      await q(`insert into club.booking_crew (booking_id, member_id, removed_at, removed_reason) values ($1, $2, now(), 'Left the club')`, [booking, members[1]]);
      expect(await change(toSize(taken, "t-double", "t-single"))).toBeNull();

      const cancelled = await item("t-double");
      const second = await bookingOn(cancelled, 0, 8, nextDay(), { status: "cancelled" });
      await q(`insert into club.booking_crew (booking_id, member_id) values ($1, $2)`, [second, members[1]]);
      expect(await change(toSize(cancelled, "t-double", "t-single"))).toBeNull();
    });
  });

  describe("the places in a pool", () => {
    const resize = (id: string, from: number, to: number): Step[] => [
      [`update club.items set places = $2 where id = $1`, [id, to]],
      line(id, "changed", { placesFrom: from, placesTo: to }),
    ];

    it("can be changed, with its line, between 2 and 500", async () => {
      const id = await item("t-dock", 8);
      expect(await change(resize(id, 8, 60))).toBeNull();
      expect(await change(resize(id, 60, 500))).toBeNull();
      expect((await change(resize(id, 500, 501)))?.code).toBe(CHECK_VIOLATION);
      expect(await change(resize(id, 500, 2))).toBeNull();
      expect((await row(id)).places).toBe(2);
    });

    it("never becomes a single place, and a single place never becomes a pool", async () => {
      const pool = await item("t-dock", 8);
      expect((await change(resize(pool, 8, 1)))?.message).toMatch(/cannot become a pool, or stop being one/);
      const single = await item("t-dock");
      expect((await change(resize(single, 1, 4)))?.message).toMatch(/cannot become a pool, or stop being one/);
      const boat = await item("t-single");
      expect((await change(resize(boat, 1, 4)))?.message).toMatch(/cannot become a pool, or stop being one/);
      expect((await row(pool)).places).toBe(8);
    });

    it("never goes below the most people booked at one moment, and says how many", async () => {
      const pool = await item("t-dock", 4);
      const d = nextDay();
      for (let who = 0; who < 4; who++) await bookingOn(pool, who, 8, d);
      const failure = await change(resize(pool, 4, 3));
      expect(failure?.code).toBe(CHECK_VIOLATION);
      expect(failure?.message).toMatch(/has 4 people in it at once, so it cannot have fewer than 4 places/);
      expect((await row(pool)).places).toBe(4);
      // Exactly the busiest moment is fine, and so is more.
      expect(await change(resize(pool, 4, 5))).toBeNull();
      expect(await change(resize(pool, 5, 4))).toBeNull();
    });

    it("counts the busiest moment, not the total: bookings one after another fit in two places", async () => {
      const pool = await item("t-dock", 4);
      const d = nextDay();
      for (let who = 0; who < 4; who++) await bookingOn(pool, who, 8 + who, d);
      expect(await change(resize(pool, 4, 2))).toBeNull();
      // Two overlapping bookings need two places at once: exactly two is fine.
      const overlapping = await item("t-dock", 4);
      const e = nextDay();
      await bookingOn(overlapping, 0, 8, e, { hours: 2 });
      await bookingOn(overlapping, 1, 9, e, { hours: 2 });
      expect(await change(resize(overlapping, 4, 2))).toBeNull();
      expect((await row(overlapping)).places).toBe(2);
    });

    it("does not count a cancelled booking", async () => {
      const pool = await item("t-dock", 4);
      const d = nextDay();
      for (let who = 0; who < 3; who++) await bookingOn(pool, who, 8, d);
      await bookingOn(pool, 3, 8, d, { status: "cancelled" });
      expect(await change(resize(pool, 4, 3))).toBeNull();
      expect((await change(resize(pool, 3, 2)))?.message).toMatch(/cannot have fewer than 3 places/);
    });
  });
});
