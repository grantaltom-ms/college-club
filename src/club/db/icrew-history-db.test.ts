import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * The archive of old iCrew bookings as the DATABASE guards it, tested against a real Postgres: it can only be added to, a
 * booking is stored once, an import's counts must match the bookings that came with it, and a booking's day is the Pacific
 * day it starts on whatever time zone the connection uses. Needs CLUB_TEST_DATABASE_URL (a local or throwaway Postgres);
 * skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const NOT_NULL_VIOLATION = "23502";

type Step = [sql: string, params?: unknown[]];
type Failure = { code?: string; message: string };

const hex = () => randomBytes(32).toString("hex");

describe.skipIf(!ADMIN_URL)("the archive of old bookings", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
  });
  afterAll(async () => {
    await db?.drop();
  });

  /** Runs the steps as one change. Returns the error (from a step or from the commit, where the deferred rules are checked), or null. */
  async function change(steps: Step[]): Promise<Failure | null> {
    await q("begin");
    try {
      for (const [sql, params] of steps) await q(sql, params ?? []);
      await q("commit");
      return null;
    } catch (e) {
      await q("rollback").catch(() => undefined);
      return e as Failure;
    }
  }

  const importStep = (id: string, over: Partial<{ added: number; skipped: number; inFile: number; first: string; last: string; fingerprint: string; by: string; name: string }> = {}): Step => [
    `insert into club.history_imports (id, file_name, file_fingerprint, imported_at, imported_by, rows_in_file, rows_added, rows_skipped, first_day, last_day) values ($1,$2,$3,'2026-10-28T20:00:00Z',$4,$5,$6,$7,$8,$9)`,
    [id, over.name ?? "march.csv", over.fingerprint ?? hex(), over.by ?? "Test staff", over.inFile ?? (over.added ?? 1) + (over.skipped ?? 0), over.added ?? 1, over.skipped ?? 0, over.first ?? "2026-03-09", over.last ?? "2026-03-09"],
  ];
  const reservationStep = (id: string, importId: string, over: Partial<{ key: string; source: string; day: string; start: string; end: string; type: string; item: string; by: string; oars: string; rowers: string; out: string }> = {}): Step => [
    `insert into club.legacy_reservations (id, import_id, row_key, source_id, day, starts_at, ends_at, item_type, item_name, oars, booked_by, rowers, out_text) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      importId,
      over.key ?? hex(),
      over.source ?? "123456",
      over.day ?? "2026-03-09",
      over.start ?? "2026-03-09T14:00:00Z",
      over.end ?? "2026-03-09T15:00:00Z",
      over.type ?? "Shell",
      over.item ?? "Cormorant",
      over.oars ?? "",
      over.by ?? "Pat Example",
      over.rowers ?? "",
      over.out ?? "",
    ],
  ];
  const personStep = (reservationId: string, key = "pat example", name = "Pat Example", role = "booker"): Step => [`insert into club.legacy_reservation_people (reservation_id, name_key, name, role) values ($1,$2,$3,$4)`, [reservationId, key, name, role]];
  const uuid = async () => (await q(`select gen_random_uuid() as id`)).rows[0].id as string;

  /** A saved import with one booking and one person. */
  async function stored(over: Parameters<typeof reservationStep>[2] = {}): Promise<{ importId: string; reservationId: string }> {
    const importId = await uuid();
    const reservationId = await uuid();
    expect(await change([importStep(importId, { first: over.day ?? "2026-03-09", last: over.day ?? "2026-03-09" }), reservationStep(reservationId, importId, over), personStep(reservationId)])).toBeNull();
    return { importId, reservationId };
  }

  describe("adding", () => {
    it("takes an import with exactly the bookings it says, and their people", async () => {
      const importId = await uuid();
      const a = await uuid();
      const b = await uuid();
      expect(
        await change([
          importStep(importId, { added: 2, skipped: 3, first: "2026-03-09", last: "2026-03-12" }),
          reservationStep(a, importId, { day: "2026-03-09" }),
          reservationStep(b, importId, { day: "2026-03-12", start: "2026-03-12T14:00:00Z", end: "2026-03-12T15:00:00Z" }),
          personStep(a),
          personStep(a, "sam example", "Sam Example", "rower"),
          personStep(b),
        ]),
      ).toBeNull();
      const { rows } = await q(`select count(*)::int as n from club.legacy_reservation_people where reservation_id in ($1, $2)`, [a, b]);
      expect(rows[0].n).toBe(3);
    });

    it("refuses an import that says it added more bookings than came with it", async () => {
      const importId = await uuid();
      const failure = await change([importStep(importId, { added: 2 }), reservationStep(await uuid(), importId)]);
      expect(failure?.code).toBe(CHECK_VIOLATION);
      expect(failure?.message).toContain("exactly the bookings it says");
    });

    it("refuses an import that came with more bookings than it says", async () => {
      const importId = await uuid();
      const failure = await change([importStep(importId, { added: 1 }), reservationStep(await uuid(), importId), reservationStep(await uuid(), importId)]);
      expect(failure?.code).toBe(CHECK_VIOLATION);
    });

    it("refuses an import that says it covers other days than its bookings do", async () => {
      const importId = await uuid();
      expect((await change([importStep(importId, { first: "2026-03-01", last: "2026-03-09" }), reservationStep(await uuid(), importId)]))?.code).toBe(CHECK_VIOLATION);
      const later = await uuid();
      expect((await change([importStep(later, { first: "2026-03-09", last: "2026-03-30" }), reservationStep(await uuid(), later)]))?.code).toBe(CHECK_VIOLATION);
    });

    it("refuses an import with no bookings at all", async () => {
      expect((await change([importStep(await uuid())]))?.code).toBe(CHECK_VIOLATION);
    });

    it("refuses bookings slipped into an import that was saved earlier", async () => {
      const { importId } = await stored();
      const failure = await change([reservationStep(await uuid(), importId)]);
      expect(failure?.code).toBe(CHECK_VIOLATION);
      expect(failure?.message).toContain("exactly the bookings it says");
      expect((await q(`select count(*)::int as n from club.legacy_reservations where import_id = $1`, [importId])).rows[0].n).toBe(1);
    });

    it("refuses an import whose counts do not add up to the rows in the file", async () => {
      // The bookings match what the import says it added, but added and skipped do not make up the rows in the file.
      const mismatch = await uuid();
      expect((await change([importStep(mismatch, { added: 1, skipped: 1, inFile: 5 }), reservationStep(await uuid(), mismatch)]))?.code).toBe(CHECK_VIOLATION);
      expect((await change([importStep(await uuid(), { added: 2, skipped: 1, inFile: 5 })]))?.code).toBe(CHECK_VIOLATION);
      expect((await change([importStep(await uuid(), { added: 0, inFile: 0 })]))?.code).toBe(CHECK_VIOLATION);
      expect((await change([importStep(await uuid(), { first: "2026-03-10", last: "2026-03-09" })]))?.code).toBe(CHECK_VIOLATION);
    });

    it("stores the same file only once", async () => {
      const fingerprint = hex();
      const first = await uuid();
      expect(await change([importStep(first, { fingerprint }), reservationStep(await uuid(), first)])).toBeNull();
      const second = await uuid();
      expect((await change([importStep(second, { fingerprint }), reservationStep(await uuid(), second)]))?.code).toBe(UNIQUE_VIOLATION);
    });

    it("stores the same booking only once", async () => {
      const key = hex();
      const first = await uuid();
      expect(await change([importStep(first), reservationStep(await uuid(), first, { key })])).toBeNull();
      const second = await uuid();
      expect((await change([importStep(second), reservationStep(await uuid(), second, { key })]))?.code).toBe(UNIQUE_VIOLATION);
    });

    it("refuses a booking that is not tied to an import that exists", async () => {
      expect((await change([reservationStep(await uuid(), await uuid())]))?.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  describe("what a booking must look like", () => {
    const refuse = async (over: NonNullable<Parameters<typeof reservationStep>[2]>, code = CHECK_VIOLATION) => {
      const importId = await uuid();
      const failure = await change([importStep(importId, { first: over.day ?? "2026-03-09", last: over.day ?? "2026-03-09" }), reservationStep(await uuid(), importId, over)]);
      expect(failure?.code, JSON.stringify(over)).toBe(code);
    };

    it("ends after it starts", async () => {
      await refuse({ end: "2026-03-09T14:00:00Z" });
      await refuse({ end: "2026-03-09T13:00:00Z" });
    });

    it("has a numeric source ID of a sensible length", async () => {
      await refuse({ source: "EXAMPLE-1" });
      await refuse({ source: "" });
      await refuse({ source: "1".repeat(13) });
    });

    it("has a key of the right shape", async () => {
      await refuse({ key: "not-a-fingerprint" });
      await refuse({ key: hex().toUpperCase() });
    });

    it("has words of sensible lengths", async () => {
      await refuse({ type: "" });
      await refuse({ type: "x".repeat(61) });
      await refuse({ item: "" });
      await refuse({ item: "x".repeat(121) });
      await refuse({ by: "" });
      await refuse({ by: "x".repeat(121) });
      await refuse({ oars: "x".repeat(121) });
      await refuse({ rowers: "x".repeat(201) });
      await refuse({ out: "x".repeat(21) });
    });

    it("is on the Pacific day it starts on, whatever time zone the connection uses", async () => {
      // 06:30 UTC on Mar 9, 2026 is 11:30 pm on Mar 8 in Pacific daylight time.
      for (const zone of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
        await q(`set time zone '${zone}'`);
        await refuse({ day: "2026-03-09", start: "2026-03-09T06:30:00Z", end: "2026-03-09T07:30:00Z" });
        const importId = await uuid();
        expect(await change([importStep(importId, { first: "2026-03-08", last: "2026-03-08" }), reservationStep(await uuid(), importId, { day: "2026-03-08", start: "2026-03-09T06:30:00Z", end: "2026-03-09T07:30:00Z" })]), zone).toBeNull();
        // And 07:30 UTC is 12:30 am on Mar 9.
        const later = await uuid();
        expect(await change([importStep(later, { first: "2026-03-09", last: "2026-03-09" }), reservationStep(await uuid(), later, { day: "2026-03-09", start: "2026-03-09T07:30:00Z", end: "2026-03-09T08:30:00Z" })]), zone).toBeNull();
      }
      await q(`set time zone 'UTC'`);
    });

    it("follows the Pacific day across the November clock change", async () => {
      // Nov 1, 2026: clocks fall back at 2 am, so 8:30 UTC is 1:30 am (the second time) and 7:30 UTC is 12:30 am PDT.
      const a = await uuid();
      expect(await change([importStep(a, { first: "2026-11-01", last: "2026-11-01" }), reservationStep(await uuid(), a, { day: "2026-11-01", start: "2026-11-01T07:30:00Z", end: "2026-11-01T08:30:00Z" })])).toBeNull();
      await refuse({ day: "2026-10-31", start: "2026-11-01T07:30:00Z", end: "2026-11-01T08:30:00Z" });
    });
  });

  describe("people on a booking", () => {
    it("have a lower-case, trimmed key and a name", async () => {
      const { reservationId } = await stored();
      expect((await change([personStep(reservationId, "Sam Example", "Sam Example", "rower")]))?.code).toBe(CHECK_VIOLATION);
      expect((await change([personStep(reservationId, " sam example", "Sam Example", "rower")]))?.code).toBe(CHECK_VIOLATION);
      expect((await change([personStep(reservationId, "", "Sam Example", "rower")]))?.code).toBe(CHECK_VIOLATION);
      expect((await change([personStep(reservationId, "sam example", "", "rower")]))?.code).toBe(CHECK_VIOLATION);
    });

    it("are either the one who reserved or a rower", async () => {
      const { reservationId } = await stored();
      expect((await change([personStep(reservationId, "sam example", "Sam Example", "guest")]))?.code).toBe(CHECK_VIOLATION);
      expect((await change([personStep(reservationId, "sam example", "Sam Example", "rower")]))).toBeNull();
    });

    it("are on a booking once in each role", async () => {
      const { reservationId } = await stored();
      expect((await change([personStep(reservationId, "pat example", "Pat Example", "booker")]))?.code).toBe(UNIQUE_VIOLATION);
      // Written another way, it is still the same person.
      expect((await change([personStep(reservationId, "pat example", "Pat E.", "booker")]))?.code).toBe(UNIQUE_VIOLATION);
      expect(await change([personStep(reservationId, "pat example", "Pat Example", "rower")])).toBeNull();
    });

    it("belong to a booking that exists", async () => {
      expect((await change([personStep(await uuid())]))?.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });

  describe("only ever added to", () => {
    it("refuses changing or removing an import", async () => {
      const { importId } = await stored();
      for (const sql of [`update club.history_imports set imported_by = 'Someone else' where id = $1`, `delete from club.history_imports where id = $1`]) {
        const failure = await change([[sql, [importId]]]);
        expect(failure?.message, sql).toContain("can only be added to");
      }
    });

    it("refuses changing or removing a booking", async () => {
      const { reservationId } = await stored();
      for (const sql of [`update club.legacy_reservations set item_name = 'Other' where id = $1`, `update club.legacy_reservations set booked_by = 'Someone Else' where id = $1`, `delete from club.legacy_reservations where id = $1`]) {
        const failure = await change([[sql, [reservationId]]]);
        expect(failure?.message, sql).toContain("can only be added to");
      }
    });

    it("refuses changing or removing a person on a booking", async () => {
      const { reservationId } = await stored();
      for (const sql of [`update club.legacy_reservation_people set name = 'Someone Else' where reservation_id = $1`, `update club.legacy_reservation_people set name_key = 'someone else' where reservation_id = $1`, `delete from club.legacy_reservation_people where reservation_id = $1`]) {
        const failure = await change([[sql, [reservationId]]]);
        expect(failure?.message, sql).toContain("can only be added to");
      }
    });

    it("refuses emptying each of the three tables, whichever of them is asked", async () => {
      await stored();
      const triggers = { history_imports: "history_imports_no_truncate", legacy_reservations: "legacy_reservations_no_truncate", legacy_reservation_people: "legacy_people_no_truncate" } as const;
      for (const table of Object.keys(triggers) as (keyof typeof triggers)[]) {
        // The other two tables' guards are switched off inside the change (and put back when it is refused), so only this table's own guard can answer.
        const others = (Object.keys(triggers) as (keyof typeof triggers)[]).filter((t) => t !== table);
        const failure = await change([...others.map((t) => [`alter table club.${t} disable trigger ${triggers[t]}`] as Step), [`truncate club.${table} cascade`]]);
        expect(failure?.message, table).toContain("can only be added to");
      }
      expect((await q(`select count(*)::int as n from club.legacy_reservations`)).rows[0].n).toBeGreaterThan(0);
      expect((await q(`select count(*)::int as n from club.legacy_reservation_people`)).rows[0].n).toBeGreaterThan(0);
      expect((await q(`select count(*)::int as n from club.history_imports`)).rows[0].n).toBeGreaterThan(0);
    });
  });

  it("needs a file name, a fingerprint of the right shape and someone who did it for every import", async () => {
    const attempt = async (over: Parameters<typeof importStep>[1]) => {
      const id = await uuid();
      return (await change([importStep(id, over), reservationStep(await uuid(), id)]))?.code;
    };
    expect(await attempt({ name: "" })).toBe(CHECK_VIOLATION);
    expect(await attempt({ name: "x".repeat(201) })).toBe(CHECK_VIOLATION);
    expect(await attempt({ fingerprint: "abc" })).toBe(CHECK_VIOLATION);
    expect(await attempt({ by: "" })).toBe(CHECK_VIOLATION);
    expect(await attempt({ by: "x".repeat(121) })).toBe(CHECK_VIOLATION);
    const failure = await change([[`insert into club.history_imports (file_name, file_fingerprint, imported_at, rows_in_file, rows_added, rows_skipped, first_day, last_day) values ('a.csv', $1, now(), 1, 1, 0, '2026-03-09', '2026-03-09')`, [hex()]]]);
    expect(failure?.code).toBe(NOT_NULL_VIOLATION);
  });
});
