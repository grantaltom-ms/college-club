import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOOKING_STATUSES, BOOKING_TYPES, HISTORY_KINDS } from "../types";
import raw from "../settings/booking-rules.json";
import { SAMPLE_ITEMS } from "../sample/equipment";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * The booking rules the DATABASE enforces by itself, tested against a real Postgres. The headline: two members
 * can never hold the same item at overlapping times, however many requests arrive at the same instant.
 * Needs CLUB_TEST_DATABASE_URL (a local or throwaway Postgres); skipped without it, and CI always sets it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const EXCLUSION_VIOLATION = "23P01";

const T = (hh: number, mm = 0, day = 29) => new Date(Date.UTC(2026, 9, day, hh, mm)).toISOString(); // Oct 29, 2026, in UTC

describe.skipIf(!ADMIN_URL)("the booking tables", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);

  let n = 0;
  let householdId: string;
  const members: string[] = [];
  const items: Record<string, string> = {};

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    // A household of three adults, an ended one is made per test, and a few items.
    householdId = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    for (const [i, name] of ["Ada", "Ben", "Cy"].entries()) {
      members.push((await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Test', $3, $4) returning id`, [householdId, name, `${name}@example.com`, i === 0 ? "primary" : "additional"])).rows[0].id);
    }
    await q(`insert into club.item_classes (code, booking_type, name, seats) values ('single', 'Shell', 'Single', 1), ('double', 'Shell', 'Double', 2)`);
    for (const name of ["Heron", "Osprey", "Kingfisher", "Loon"]) {
      items[name] = (await q(`insert into club.items (name, class_code) values ($1, $2) returning id`, [name, name === "Loon" ? "double" : "single"])).rows[0].id;
    }
  });
  afterAll(async () => {
    await db?.drop();
  });

  type Fields = Partial<{ item: string; booker: string; start: string; end: string; status: string }>;
  async function book(f: Fields = {}, client: Client = db.client) {
    n += 1;
    return client.query(
      `insert into club.bookings (item_id, booker_id, starts_at, ends_at, status, created_by_kind, created_by_label)
       values ($1, $2, $3, $4, $5, 'member', 'A Member') returning id`,
      [f.item ?? items.Heron, f.booker ?? members[0], f.start ?? T(14), f.end ?? T(15), f.status ?? "upcoming"],
    );
  }
  /** A fresh item, so tests never share a boat. */
  async function freshItem(): Promise<string> {
    n += 1;
    return (await q(`insert into club.items (name, class_code) values ($1, 'single') returning id`, [`Boat ${n}`])).rows[0].id;
  }
  const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "other");

  describe("no double booking", () => {
    it("refuses any overlap on one item, with the database's own exclusion error", async () => {
      const item = await freshItem();
      await book({ item, start: T(14), end: T(15) });
      for (const [s, e] of [[14, 15], [13, 14.5], [14.5, 15.5], [14.25, 14.75], [13, 16]] as const) {
        const result = await code(book({ item, booker: members[1], start: T(Math.floor(s), (s % 1) * 60), end: T(Math.floor(e), (e % 1) * 60) }));
        expect(result, `${s}-${e}`).toBe(EXCLUSION_VIOLATION);
      }
      expect((await q(`select count(*)::int as n from club.bookings where item_id = $1`, [item])).rows[0].n).toBe(1);
    });

    it("allows back to back, other items, and the same time on a different day", async () => {
      const item = await freshItem();
      await book({ item, start: T(14), end: T(15) });
      expect(await code(book({ item, start: T(13), end: T(14) }))).toBeNull(); // ends as the other starts
      expect(await code(book({ item, start: T(15), end: T(16) }))).toBeNull(); // starts as the other ends
      expect(await code(book({ item: await freshItem(), start: T(14), end: T(15) }))).toBeNull(); // another boat
      expect(await code(book({ item, start: T(14, 0, 30), end: T(15, 0, 30) }))).toBeNull(); // another day
    });

    it("lets a cancelled or late-cancelled booking go, so the slot is free again", async () => {
      const item = await freshItem();
      const first = (await book({ item })).rows[0].id;
      expect(await code(book({ item, booker: members[1] }))).toBe(EXCLUSION_VIOLATION);
      await q(`update club.bookings set status = 'cancelled', cancelled_by_kind = 'member', cancelled_by_label = 'Ada' where id = $1`, [first]);
      const second = (await book({ item, booker: members[1] })).rows[0].id;
      expect(await code(book({ item, booker: members[2] }))).toBe(EXCLUSION_VIOLATION);
      await q(`update club.bookings set status = 'late_cancelled', cancelled_by_kind = 'member', cancelled_by_label = 'Ben' where id = $1`, [second]);
      expect(await code(book({ item, booker: members[2] }))).toBeNull();
    });

    it("keeps completed and no-show outings holding their slot", async () => {
      const item = await freshItem();
      const a = (await book({ item, start: T(10), end: T(11) })).rows[0].id;
      const b = (await book({ item, start: T(11), end: T(12) })).rows[0].id;
      await q(`update club.bookings set status = 'completed' where id = $1`, [a]);
      await q(`update club.bookings set status = 'no_show' where id = $1`, [b]);
      expect(await code(book({ item, booker: members[1], start: T(10, 30), end: T(11, 30) }))).toBe(EXCLUSION_VIOLATION);
      expect(await code(book({ item, booker: members[1], start: T(11), end: T(11, 30) }))).toBe(EXCLUSION_VIOLATION);
    });

    it("gives exactly one booking when twenty members grab the same boat and slot at the same instant", async () => {
      const item = await freshItem();
      const clients = await Promise.all(Array.from({ length: 20 }, async () => {
        const c = new Client({ connectionString: db.url });
        await c.connect();
        return c;
      }));
      try {
        // Everyone is connected and ready; then all twenty requests go in together.
        const outcomes = await Promise.allSettled(clients.map((c, i) => book({ item, booker: members[i % 3], start: T(7), end: T(8) }, c)));
        const won = outcomes.filter((o) => o.status === "fulfilled");
        const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
        expect(won).toHaveLength(1);
        expect(lost).toHaveLength(19);
        for (const l of lost) expect((l.reason as { code?: string }).code).toBe(EXCLUSION_VIOLATION);
        expect((await q(`select count(*)::int as n from club.bookings where item_id = $1`, [item])).rows[0].n).toBe(1);
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    }, 30_000);

    it("stays correct under a storm: a hundred overlapping attempts across three boats leave no overlap behind", async () => {
      const storm = [await freshItem(), await freshItem(), await freshItem()];
      const clients = await Promise.all(Array.from({ length: 10 }, async () => {
        const c = new Client({ connectionString: db.url });
        await c.connect();
        return c;
      }));
      try {
        // Deterministic pseudo-random times on a 4-hour stretch, in half hour steps and 30 to 120 minutes long.
        let seed = 12345;
        const next = (max: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % max);
        const attempt = (i: number) => {
          const startSlot = next(8);
          const length = 1 + next(4);
          return { item: storm[next(3)], booker: members[i % 3], start: T(8 + Math.floor(startSlot / 2), (startSlot % 2) * 30), end: T(8 + Math.floor((startSlot + length) / 2), ((startSlot + length) % 2) * 30) };
        };
        const plan = Array.from({ length: 100 }, (_, i) => attempt(i));
        // Ten connections each work through ten attempts, all ten at once, so the attempts really do collide.
        const lanes = clients.map(async (c, lane) => {
          const results: PromiseSettledResult<unknown>[] = [];
          for (const a of plan.filter((_, i) => i % clients.length === lane)) results.push(...(await Promise.allSettled([book(a, c)])));
          return results;
        });
        const outcomes = (await Promise.all(lanes)).flat();
        const failures = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
        for (const f of failures) expect((f.reason as { code?: string }).code).toBe(EXCLUSION_VIOLATION); // only ever the overlap rule
        expect(outcomes.some((o) => o.status === "fulfilled")).toBe(true);
        expect(failures.length).toBeGreaterThan(10);
        const { rows } = await q(
          `select count(*)::int as n from club.bookings a join club.bookings b on a.item_id = b.item_id and a.id < b.id
            where a.item_id = any ($1) and a.status = 'upcoming' and b.status = 'upcoming' and a.starts_at < b.ends_at and b.starts_at < a.ends_at`,
          [storm],
        );
        expect(rows[0].n).toBe(0);
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    }, 30_000);
  });

  describe("what a booking is", () => {
    it("ends after it starts, and has one of the five states", async () => {
      expect(await code(book({ start: T(15), end: T(15) }))).toBe("23514");
      expect(await code(book({ start: T(16), end: T(15) }))).toBe("23514");
      expect(await code(book({ item: await freshItem(), status: "maybe" }))).toBe("23514");
      for (const status of BOOKING_STATUSES) {
        if (status === "cancelled" || status === "late_cancelled") continue; // those need a cancel record, below
        expect(await code(book({ item: await freshItem(), status })), status).toBeNull();
      }
    });

    it("records who cancelled whenever, and only when, it is cancelled", async () => {
      const item = await freshItem();
      expect(await code(book({ item, status: "cancelled" }))).toBe("23514"); // cancelled with no cancel record
      const id = (await book({ item })).rows[0].id;
      await expect(q(`update club.bookings set cancelled_by_kind = 'member', cancelled_by_label = 'Ada' where id = $1`, [id])).rejects.toThrow(/bookings_cancel_matches_status/);
      await q(`update club.bookings set status = 'cancelled', cancelled_by_kind = 'staff', cancelled_by_label = 'Test staff', cancel_reason = 'Boat repair' where id = $1`, [id]);
      expect((await q(`select cancel_reason, status from club.bookings where id = $1`, [id])).rows[0]).toEqual({ cancel_reason: "Boat repair", status: "cancelled" });
    });

    it("keeps a staff override complete: a reason, who, and which rules, all together or not at all", async () => {
      const insert = (reason: string | null, by: string | null, waived: string[] | null) =>
        q(
          `insert into club.bookings (item_id, booker_id, starts_at, ends_at, created_by_kind, created_by_label, override_reason, override_by_label, override_waived)
           values ($1, $2, $3, $4, 'staff', 'Test staff', $5, $6, $7)`,
          [items.Osprey, members[0], T(20), T(21), reason, by, waived],
        );
      await expect(insert("Lesson", null, ["outside_hours"])).rejects.toThrow(/bookings_override_is_complete/);
      await expect(insert(null, "Test staff", null)).rejects.toThrow(/bookings_override_is_complete/);
      await expect(insert("   ", "Test staff", ["outside_hours"])).rejects.toThrow(/override_reason/);
      await insert("Learn-to-row lesson", "Test staff", ["not_qualified", "outside_hours"]);
      const saved = (await q(`select override_reason, override_by_label, override_waived from club.bookings where item_id = $1 and starts_at = $2`, [items.Osprey, T(20)])).rows[0];
      expect(saved).toEqual({ override_reason: "Learn-to-row lesson", override_by_label: "Test staff", override_waived: ["not_qualified", "outside_hours"] });
    });

    it("cannot be moved or handed to someone else, and a finished one is final", async () => {
      const item = await freshItem();
      const id = (await book({ item })).rows[0].id;
      await expect(q(`update club.bookings set starts_at = $2, ends_at = $3 where id = $1`, [id, T(16), T(17)])).rejects.toThrow("cannot be moved or handed over");
      await expect(q(`update club.bookings set booker_id = $2 where id = $1`, [id, members[1]])).rejects.toThrow("cannot be moved or handed over");
      await expect(q(`update club.bookings set item_id = $2 where id = $1`, [id, items.Osprey])).rejects.toThrow("cannot be moved or handed over");
      await q(`update club.bookings set status = 'completed' where id = $1`, [id]);
      await expect(q(`update club.bookings set status = 'upcoming' where id = $1`, [id])).rejects.toThrow("already completed cannot change again");
      await expect(q(`update club.bookings set status = 'no_show' where id = $1`, [id])).rejects.toThrow("already completed cannot change again");
    });

    it("is never lost by deleting the boat or the member", async () => {
      const item = await freshItem();
      await book({ item });
      await expect(q(`delete from club.items where id = $1`, [item])).rejects.toThrow(/foreign key/);
      await expect(q(`delete from club.members where id = $1`, [members[0]])).rejects.toThrow(/foreign key/);
    });
  });

  describe("crew", () => {
    it("lists the other people in a multi-seat boat, never the booker, never twice, and keeps a record of who left", async () => {
      const id = (await book({ item: items.Loon, start: T(18), end: T(19) })).rows[0].id;
      await q(`insert into club.booking_crew (booking_id, member_id) values ($1, $2)`, [id, members[1]]);
      await expect(q(`insert into club.booking_crew (booking_id, member_id) values ($1, $2)`, [id, members[1]])).rejects.toThrow(/duplicate key/);
      await expect(q(`insert into club.booking_crew (booking_id, member_id) values ($1, $2)`, [id, members[0]])).rejects.toThrow("already in the boat");
      await expect(q(`update club.booking_crew set removed_at = now() where booking_id = $1`, [id])).rejects.toThrow(/booking_crew_removal_is_complete/);
      await q(`update club.booking_crew set removed_at = now(), removed_reason = 'Left the club' where booking_id = $1`, [id]);
      expect((await q(`select removed_reason from club.booking_crew where booking_id = $1`, [id])).rows[0].removed_reason).toBe("Left the club");
    });
  });

  describe("out of service", () => {
    const out = (item: string, from: string, until: string | null, reason = "Repair", kind = "staff") =>
      q(`insert into club.out_of_service (item_id, from_at, until_at, reason, created_by_kind, created_by_label) values ($1, $2, $3, $4, $5, 'Test staff')`, [item, from, until, reason, kind]);

    it("records a period, open ended or not, with a reason, and does not touch bookings already made", async () => {
      const item = await freshItem();
      const id = (await book({ item, start: T(10), end: T(11) })).rows[0].id;
      await out(item, T(9), null, "Hull crack");
      await out(await freshItem(), T(9), T(23));
      expect((await q(`select status from club.bookings where id = $1`, [id])).rows[0].status).toBe("upcoming");
    });

    it("needs a real reason and a return that is not before the start", async () => {
      const item = await freshItem();
      await expect(out(item, T(9), T(8))).rejects.toThrow(/out_of_service_ends_after_start/);
      // Ending it the same moment it began is an empty period: allowed, so an immediate "never mind" can be recorded.
      await out(item, T(9), T(9));
      await expect(out(item, T(9), null, "   ")).rejects.toThrow(/reason/);
      await expect(out(item, T(9), null, "Repair", "member")).rejects.toThrow(/created_by_kind/);
    });
  });

  describe("rules as data", () => {
    it("holds the shipped rules file, its classes and the sample items, so staff can edit them as rows later", async () => {
      await q(`insert into club.booking_rule_defaults (placeholder, rules) values ($1, $2)`, [raw.placeholder, JSON.stringify(raw.defaults)]);
      await expect(q(`insert into club.booking_rule_defaults (placeholder, rules) values (true, '{}')`)).rejects.toThrow(/duplicate key|pkey/); // only one row
      for (const c of raw.classes) {
        await q(`insert into club.item_classes (code, booking_type, name, seats, required_qualification, rules) values ($1, $2, $3, $4, $5, $6)`, [c.code, c.type, c.name, c.seats, c.requiredQualification, JSON.stringify(c.rules)]);
      }
      for (const i of SAMPLE_ITEMS) {
        await q(`insert into club.items (name, class_code, rule_overrides) values ($1, $2, $3)`, [`Sample ${i.name}`, i.classCode, JSON.stringify(i.ruleOverrides ?? {})]);
      }
      const stored = (await q(`select rules from club.booking_rule_defaults`)).rows[0].rules;
      expect(stored).toEqual(raw.defaults);
      expect((await q(`select count(*)::int as n from club.items where name like 'Sample %'`)).rows[0].n).toBe(SAMPLE_ITEMS.length);
      expect((await q(`select rule_overrides from club.items where name = 'Sample Tern'`)).rows[0].rule_overrides).toEqual({ maxMinutes: 90 });
    });

    it("refuses rules that are not an object, a class with a bad type, and a qualification that does not exist", async () => {
      await expect(q(`insert into club.item_classes (code, booking_type, name, seats, rules) values ('x1', 'Shell', 'X', 1, '[]')`)).rejects.toThrow(/rules/);
      await expect(q(`insert into club.item_classes (code, booking_type, name, seats) values ('x2', 'Canoe', 'X', 1)`)).rejects.toThrow(/booking_type/);
      await expect(q(`insert into club.item_classes (code, booking_type, name, seats, required_qualification) values ('x3', 'Shell', 'X', 1, 'scull-9')`)).rejects.toThrow(/foreign key/);
      await expect(q(`insert into club.item_classes (code, booking_type, name, seats) values ('x4', 'Shell', 'X', 0)`)).rejects.toThrow(/seats/);
    });

    it("lets one item drop or change its class's qualification, consistently", async () => {
      await q(`insert into club.items (name, class_code, qualification_mode) values ('Open single', 'single', 'none')`);
      await q(`insert into club.items (name, class_code, qualification_mode, required_qualification) values ('Strict single', 'single', 'code', 'scull-3')`);
      await expect(q(`insert into club.items (name, class_code, qualification_mode) values ('Bad 1', 'single', 'code')`)).rejects.toThrow(/items_qualification_matches_mode/);
      await expect(q(`insert into club.items (name, class_code, qualification_mode, required_qualification) values ('Bad 2', 'single', 'class', 'scull-1')`)).rejects.toThrow(/items_qualification_matches_mode/);
    });

    it("agrees with the app on the list of booking types, booking states and history kinds", async () => {
      // Read each list by the constraint's own name: a table can have several constraints that mention the same column.
      const check = async (constraint: string) => {
        const { rows } = await q(`select pg_get_constraintdef(c.oid) as def from pg_constraint c join pg_namespace s on s.oid = c.connamespace where s.nspname = 'club' and c.conname = $1`, [constraint]);
        expect(rows, constraint).toHaveLength(1);
        return rows[0].def as string;
      };
      const values = (def: string) => [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
      expect(values(await check("item_classes_booking_type_check"))).toEqual([...BOOKING_TYPES].sort());
      expect(values(await check("bookings_status_check"))).toEqual([...BOOKING_STATUSES].sort());
      expect(values(await check("household_history_kind_check"))).toEqual([...HISTORY_KINDS].sort());
    });
  });

  describe("ending a membership cancels future bookings, in the same step", () => {
    /** A household with two adults and a mix of bookings, as of `now`. */
    async function busy() {
      const hh = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Busy household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
      const [a, b] = await Promise.all(["A", "B"].map(async (name) => (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Busy', $3, $4) returning id`, [hh, name, `${name}@busy.example`, name === "A" ? "primary" : "additional"])).rows[0].id));
      const item = await freshItem();
      const other = await freshItem();
      const make = async (booker: string, it: string, start: string, end: string, status = "upcoming") => (await book({ item: it, booker, start, end, status })).rows[0].id as string;
      const ids = {
        future1: await make(a, item, T(10, 0, 30), T(11, 0, 30)),
        future2: await make(b, item, T(12, 0, 30), T(13, 0, 30)),
        started: await make(a, other, T(9, 0, 27), T(11, 0, 27)), // already under way at "now"
        past: await make(b, other, T(9, 0, 20), T(10, 0, 20), "completed"),
        someoneElses: await make(members[0], other, T(10, 0, 30), T(11, 0, 30)),
      };
      await q(`insert into club.booking_crew (booking_id, member_id) values ($1, $2)`, [ids.someoneElses, b]);
      return { hh, a, b, ids };
    }
    const NOW = T(10, 0, 27);
    const end = (hh: string, now = NOW) => q(`select club.end_household($1, '2026-10-27', 'staff', null, 'Test staff', $2) as adults`, [hh, now]);
    const status = async (id: string) => (await q(`select status, cancel_reason, cancelled_by_kind from club.bookings where id = $1`, [id])).rows[0];

    it("cancels each adult's future bookings, not late, and says why", async () => {
      const { hh, ids } = await busy();
      expect((await end(hh)).rows[0].adults).toBe(2);
      for (const id of [ids.future1, ids.future2]) expect(await status(id)).toEqual({ status: "cancelled", cancel_reason: "The household's membership ended", cancelled_by_kind: "staff" });
    });

    it("leaves a booking under way, a finished one and other households' bookings exactly as they were", async () => {
      const { hh, ids } = await busy();
      await end(hh);
      expect((await status(ids.started)).status).toBe("upcoming");
      expect((await status(ids.past)).status).toBe("completed");
      expect((await status(ids.someoneElses)).status).toBe("upcoming");
    });

    it("takes the adults off other people's boats and keeps those bookings", async () => {
      const { hh, b, ids } = await busy();
      await end(hh);
      const crew = (await q(`select removed_reason, removed_at is not null as removed from club.booking_crew where booking_id = $1 and member_id = $2`, [ids.someoneElses, b])).rows[0];
      expect(crew).toEqual({ removed_reason: "The household's membership ended", removed: true });
    });

    it("writes the cancellation to the household's file, with the count", async () => {
      const { hh } = await busy();
      await end(hh);
      const kinds = (await q(`select kind, summary, details from club.household_history where household_id = $1 order by kind`, [hh])).rows;
      expect(kinds.map((k) => k.kind)).toEqual(["bookings_cancelled", "membership_ended"]);
      expect(kinds[0]).toMatchObject({ summary: "2 future bookings cancelled because the membership ended.", details: { count: 2 } });
    });

    it("frees the slots, so others can book them at once", async () => {
      const { hh, ids } = await busy();
      const { rows } = await q(`select item_id, starts_at, ends_at from club.bookings where id = $1`, [ids.future1]);
      expect(await code(book({ item: rows[0].item_id, booker: members[1], start: rows[0].starts_at.toISOString(), end: rows[0].ends_at.toISOString() }))).toBe(EXCLUSION_VIOLATION);
      await end(hh);
      expect(await code(book({ item: rows[0].item_id, booker: members[1], start: rows[0].starts_at.toISOString(), end: rows[0].ends_at.toISOString() }))).toBeNull();
    });

    it("is all or nothing: a refused ending cancels nothing", async () => {
      const { hh, ids } = await busy();
      await expect(q(`select club.end_household($1, '2019-01-01', 'staff', null, 'Test staff', $2)`, [hh, NOW])).rejects.toThrow("cannot end before it began");
      expect((await status(ids.future1)).status).toBe("upcoming");
      expect((await q(`select status from club.households where id = $1`, [hh])).rows[0].status).toBe("active");
    });

    it("ends with no bookings at all, and writes no cancellation line", async () => {
      const hh = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Quiet household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
      await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, 'Q', 'Quiet', 'q@quiet.example', 'primary')`, [hh]);
      expect((await end(hh)).rows[0].adults).toBe(1);
      expect((await q(`select kind from club.household_history where household_id = $1`, [hh])).rows.map((r) => r.kind)).toEqual(["membership_ended"]);
    });
  });
});
