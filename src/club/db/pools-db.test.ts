import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * Pools as the DATABASE guards them, tested against a real Postgres: only a dock, club room or gym space can have more than
 * one place, the number of places is fixed when the pool is made, a pool is never private, and no booking may leave more people
 * in a pool than it has places at any moment (counted, not numbered). Nobody holds two places of one pool at once. A single
 * item keeps the overlap rule it has had since step 2. Needs CLUB_TEST_DATABASE_URL (a local or throwaway Postgres); skipped
 * without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";
const EXCLUSION_VIOLATION = "23P01";
const RAISED = "P0001";

type Failure = { code?: string; message: string };

describe.skipIf(!ADMIN_URL)("pools", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  const members: string[] = [];
  let n = 0;
  const T = (hh: number, mm = 0, day = 29) => new Date(Date.UTC(2026, 9, day, hh, mm)).toISOString();

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    const household = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    for (let i = 0; i < 6; i++) {
      members.push((await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Test', $3, $4) returning id`, [household, `Person${i}`, `p${i}@example.com`, i === 0 ? "primary" : "additional"])).rows[0].id);
    }
    await q(`insert into club.item_classes (code, booking_type, name, seats) values
      ('t-dock', 'Dock Space', 'Dock', 1), ('t-gym', 'Gym Space', 'Gym', 1), ('t-room', 'Room Space', 'Room', 1),
      ('t-boat', 'Shell', 'Single', 1), ('t-kayak', 'Kayak', 'Kayak', 1), ('t-board', 'Paddle Board', 'Board', 1), ('t-work', 'Work Space', 'Work', 1)`);
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

  async function item(classCode: string, places?: number, isPrivate = false): Promise<string> {
    n += 1;
    if (places === undefined) return (await q(`insert into club.items (name, class_code, is_private) values ($1, $2, $3) returning id`, [`Item ${n}`, classCode, isPrivate])).rows[0].id;
    return (await q(`insert into club.items (name, class_code, places, is_private) values ($1, $2, $3, $4) returning id`, [`Item ${n}`, classCode, places, isPrivate])).rows[0].id;
  }
  const pool = (places: number, classCode = "t-dock") => item(classCode, places);
  const book = (itemId: string, who: number, from: [number, number], to: [number, number], status = "upcoming") =>
    attempt(`insert into club.bookings (item_id, booker_id, starts_at, ends_at, status, created_by_kind, created_by_label, cancelled_by_kind, cancelled_by_label) values ($1,$2,$3,$4,$5,'member','A Member', $6, $7)`, [
      itemId,
      members[who],
      T(...from),
      T(...to),
      status,
      status === "cancelled" ? "member" : null,
      status === "cancelled" ? "A Member" : null,
    ]);
  const count = async (itemId: string) => (await q(`select count(*)::int as n from club.bookings where item_id = $1`, [itemId])).rows[0].n as number;

  describe("the number of places on an item", () => {
    it("is one unless the pool says more, and is kept as it was written", async () => {
      expect((await q(`select places from club.items where id = $1`, [await item("t-boat")])).rows[0].places).toBe(1);
      expect((await q(`select places from club.items where id = $1`, [await pool(60)])).rows[0].places).toBe(60);
      expect((await q(`select places from club.items where id = $1`, [await pool(500)])).rows[0].places).toBe(500);
    });

    it("must be from 1 to 500", async () => {
      for (const bad of [0, -1, 501]) {
        n += 1;
        const failure = await attempt(`insert into club.items (name, class_code, places) values ($1, 't-dock', $2)`, [`Item ${n}`, bad]);
        expect(failure?.code).toBe(CHECK_VIOLATION);
      }
    });

    it("can be more than one only for a dock, a club room or a gym", async () => {
      for (const code of ["t-dock", "t-gym", "t-room"]) expect(await attempt(`insert into club.items (name, class_code, places) values ($1, $2, 4)`, [`Pool ${code}`, code])).toBeNull();
      for (const code of ["t-boat", "t-kayak", "t-board", "t-work"]) {
        const failure = await attempt(`insert into club.items (name, class_code, places) values ($1, $2, 4)`, [`Bad ${code}`, code]);
        expect(failure?.message).toMatch(/Only a dock, club room or gym space/);
      }
      // One place is fine for anything.
      for (const code of ["t-boat", "t-kayak", "t-board", "t-work"]) expect(await attempt(`insert into club.items (name, class_code, places) values ($1, $2, 1)`, [`One ${code}`, code])).toBeNull();
    });

    it("cannot change once the pool is made, but a save that names the same number changes nothing", async () => {
      const id = await pool(8);
      expect((await attempt(`update club.items set places = 9 where id = $1`, [id]))?.message).toMatch(/cannot be changed/);
      expect((await attempt(`update club.items set places = 1 where id = $1`, [id]))?.message).toMatch(/cannot be changed/);
      expect(await attempt(`update club.items set places = 8, rule_overrides = '{"maxMinutes": 90}'::jsonb where id = $1`, [id])).toBeNull();
      expect((await q(`select places from club.items where id = $1`, [id])).rows[0].places).toBe(8);
    });

    it("cannot move a boat's class so that it is a pool, or a pool's class to a boat", async () => {
      const id = await pool(8);
      expect((await attempt(`update club.items set class_code = 't-boat' where id = $1`, [id]))?.message).toMatch(/Only a dock, club room or gym space/);
      expect(await attempt(`update club.items set class_code = 't-gym' where id = $1`, [id])).toBeNull();
    });

    it("is never a private pool", async () => {
      n += 1;
      const failure = await attempt(`insert into club.items (name, class_code, places, is_private) values ($1, 't-dock', 4, true)`, [`Item ${n}`]);
      expect(failure?.code).toBe(CHECK_VIOLATION);
      expect(failure?.message).toMatch(/items_pool_is_not_private/);
      // A private boat with one place is still fine.
      expect(await attempt(`insert into club.items (name, class_code, is_private) values ($1, 't-boat', true)`, [`Boat ${n}`])).toBeNull();
    });
  });

  describe("how many people a pool holds at once", () => {
    it("takes as many overlapping bookings as it has places and refuses the next", async () => {
      const id = await pool(3);
      expect(await book(id, 0, [9, 0], [10, 0])).toBeNull();
      expect(await book(id, 1, [9, 0], [10, 0])).toBeNull();
      expect(await book(id, 2, [9, 0], [10, 0])).toBeNull();
      const failure = await book(id, 3, [9, 0], [10, 0]);
      expect(failure?.code).toBe(EXCLUSION_VIOLATION);
      expect(failure?.message).toMatch(/full/);
      expect(await count(id)).toBe(3);
    });

    it("counts the busiest moment, so a booking that meets a full stretch anywhere inside it is refused", async () => {
      const id = await pool(2);
      expect(await book(id, 0, [9, 0], [10, 0])).toBeNull();
      expect(await book(id, 1, [9, 30], [10, 30])).toBeNull();
      // 9:30 to 10:00 holds both places.
      expect((await book(id, 2, [8, 0], [9, 45]))?.code).toBe(EXCLUSION_VIOLATION);
      expect((await book(id, 2, [9, 45], [11, 0]))?.code).toBe(EXCLUSION_VIOLATION);
      expect((await book(id, 2, [9, 15], [9, 45]))?.code).toBe(EXCLUSION_VIOLATION);
      // Before and after the full stretch, and exactly touching it, are fine.
      expect(await book(id, 2, [8, 0], [9, 30])).toBeNull();
      expect(await book(id, 3, [10, 0], [10, 30])).toBeNull();
      expect(await count(id)).toBe(4);
    });

    it("fits a long booking beside two shorter ones that follow each other, which a numbered place could not", async () => {
      const id = await pool(2);
      expect(await book(id, 0, [9, 0], [10, 0])).toBeNull();
      expect(await book(id, 1, [10, 0], [11, 0])).toBeNull();
      expect(await book(id, 2, [9, 0], [11, 0])).toBeNull();
      expect((await book(id, 3, [9, 30], [10, 30]))?.code).toBe(EXCLUSION_VIOLATION);
    });

    it("lets the place go the moment a booking is cancelled, and never counts a cancelled booking", async () => {
      const id = await pool(2);
      expect(await book(id, 0, [9, 0], [10, 0])).toBeNull();
      expect(await book(id, 1, [9, 0], [10, 0])).toBeNull();
      expect((await book(id, 2, [9, 0], [10, 0]))?.code).toBe(EXCLUSION_VIOLATION);
      expect(await attempt(`update club.bookings set status = 'cancelled', cancelled_by_kind = 'member', cancelled_by_label = 'A Member' where item_id = $1 and booker_id = $2`, [id, members[0]])).toBeNull();
      expect(await book(id, 2, [9, 0], [10, 0])).toBeNull();
      // A booking made already cancelled holds nothing.
      expect(await book(id, 3, [9, 0], [10, 0], "cancelled")).toBeNull();
    });

    it("lines up two requests for the last place one at a time, so exactly one of them gets it", async () => {
      const id = await pool(2);
      expect(await book(id, 0, [9, 0], [10, 0])).toBeNull();
      const other = new Client({ connectionString: db.url });
      await other.connect();
      const insert = (client: Client, who: number) =>
        client.query(`insert into club.bookings (item_id, booker_id, starts_at, ends_at, created_by_kind, created_by_label) values ($1,$2,$3,$4,'member','A Member')`, [id, members[who], T(9), T(10)]);
      try {
        // The first request takes the last place but has not finished; the second asks for it meanwhile and has to wait its turn.
        await q("begin");
        await insert(db.client, 1);
        await other.query("begin");
        const second = insert(other, 2).then(
          () => null,
          (e: Failure) => e,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        await q("commit");
        const failure = await second;
        expect(failure?.code).toBe(EXCLUSION_VIOLATION);
        expect(failure?.message).toMatch(/full/);
        await other.query("rollback");
      } finally {
        await other.end();
      }
      expect(await count(id)).toBe(2);
    });

    it("counts a pool of one place the old way, and never mixes pools: another pool or boat is not affected", async () => {
      const full = await pool(1, "t-gym");
      const other = await pool(1, "t-room");
      expect(await book(full, 0, [9, 0], [10, 0])).toBeNull();
      expect((await book(full, 1, [9, 30], [10, 30]))?.code).toBe(EXCLUSION_VIOLATION);
      expect(await book(other, 1, [9, 30], [10, 30])).toBeNull();
      const two = await pool(2, "t-gym");
      expect(await book(two, 2, [9, 0], [10, 0])).toBeNull();
      expect(await book(two, 3, [9, 0], [10, 0])).toBeNull();
    });
  });

  describe("one place for one person", () => {
    it("refuses a second place in the same pool at an overlapping time, but allows one after it, in another pool, or after a cancel", async () => {
      const id = await pool(5);
      const other = await pool(5, "t-gym");
      expect(await book(id, 0, [9, 0], [10, 0])).toBeNull();
      const failure = await book(id, 0, [9, 30], [10, 30]);
      expect(failure?.code).toBe(EXCLUSION_VIOLATION);
      expect(failure?.message).toMatch(/bookings_one_place_each/);
      expect(await book(id, 0, [10, 0], [11, 0])).toBeNull();
      expect(await book(other, 0, [9, 30], [10, 30])).toBeNull();
      expect(await book(id, 1, [9, 30], [10, 30])).toBeNull();
    });
  });

  describe("a single item keeps its old rule", () => {
    it("two bookings of one boat can never overlap, and the database sets the single-place flag from the item, not from the app", async () => {
      const id = await item("t-boat");
      expect(await book(id, 0, [9, 0], [10, 0])).toBeNull();
      expect((await book(id, 1, [9, 30], [10, 30]))?.code).toBe(EXCLUSION_VIOLATION);
      // The app naming a flag of its own changes nothing: the database overrides it.
      const lie = await attempt(`insert into club.bookings (item_id, booker_id, starts_at, ends_at, single_place, created_by_kind, created_by_label) values ($1,$2,$3,$4,false,'member','A Member')`, [id, members[2], T(9, 30), T(10, 30)]);
      expect(lie?.code).toBe(EXCLUSION_VIOLATION);
      expect((await q(`select bool_and(single_place) as all_single from club.bookings where item_id = $1`, [id])).rows[0].all_single).toBe(true);
      expect(await book(id, 1, [10, 0], [11, 0])).toBeNull();
    });

    it("marks the bookings of a pool as not single, and the flag cannot be flipped afterwards", async () => {
      const id = await pool(2);
      expect(await book(id, 0, [9, 0], [10, 0])).toBeNull();
      expect((await q(`select single_place from club.bookings where item_id = $1`, [id])).rows[0].single_place).toBe(false);
      expect((await attempt(`update club.bookings set single_place = true where item_id = $1`, [id]))?.message).toMatch(/cannot be moved or handed over/);
      const boat = await item("t-boat");
      expect(await book(boat, 0, [9, 0], [10, 0])).toBeNull();
      expect((await attempt(`update club.bookings set single_place = false where item_id = $1`, [boat]))?.message).toMatch(/cannot be moved or handed over/);
    });

    it("still refuses a booking to be moved, handed over or changed after it has an outcome", async () => {
      const id = await pool(2);
      expect(await book(id, 0, [9, 0], [10, 0])).toBeNull();
      expect((await attempt(`update club.bookings set booker_id = $2 where item_id = $1`, [id, members[1]]))?.code).toBe(RAISED);
      expect((await attempt(`update club.bookings set starts_at = $2 where item_id = $1`, [id, T(8)]))?.code).toBe(RAISED);
    });
  });
});
