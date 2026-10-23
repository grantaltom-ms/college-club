import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVENT_STATUSES, HISTORY_KINDS, RSVP_STATUSES, RSVP_VIA } from "../types";
import { createScratchDb, recordOutcome, type ScratchDb } from "./testdb";

/**
 * The event rules the DATABASE enforces by itself, tested against a real Postgres: places are never over-filled (a member
 * and each guest take one place), a name is on an event's list once, an RSVP only moves forward, and a cancelled event stays
 * cancelled. Needs CLUB_TEST_DATABASE_URL (a local or throwaway Postgres); skipped without it, and CI always sets it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

const T = (hh: number, mm = 0, day = 29) => new Date(Date.UTC(2026, 9, day, hh, mm)).toISOString(); // Oct 29, 2026, in UTC

describe.skipIf(!ADMIN_URL)("the event tables", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "other");

  const members: string[] = [];

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    const household = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    for (let i = 0; i < 24; i++) {
      members.push((await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Test', $3, $4) returning id`, [household, `M${i}`, `m${i}@example.com`, i === 0 ? "primary" : "additional"])).rows[0].id);
    }
  });
  afterAll(async () => {
    await db?.drop();
  });

  type EventFields = Partial<{ capacity: number | null; start: string; end: string; status: string; replyBy: string | null }>;
  const event = (f: EventFields = {}, client: Client = db.client) =>
    client.query(
      `insert into club.events (title, starts_at, ends_at, capacity, reply_by, status, created_by_kind, created_by_label, cancelled_by_kind, cancelled_by_label)
       values ('Dinner', $1, $2, $3, $4, $5, 'staff', 'Test staff', $6, $7) returning id`,
      [f.start ?? T(16), f.end ?? T(19), f.capacity === undefined ? 10 : f.capacity, f.replyBy ?? null, f.status ?? "scheduled", f.status === "cancelled" ? "staff" : null, f.status === "cancelled" ? "Test staff" : null],
    );
  const join = (eventId: string, member: string, guests = 0, status = "going", client: Client = db.client) =>
    client.query(`insert into club.event_rsvps (event_id, member_id, guests, status, created_by_kind, created_by_label) values ($1, $2, $3, $4, 'member', 'A Member') returning id`, [eventId, member, guests, status]);
  const setStatus = (id: string, status: string) =>
    status === "attended" || status === "no_show"
      ? recordOutcome(db.client, "event_rsvps", id, status)
      : q(
      `update club.event_rsvps set status = $2, cancelled_by_kind = case when $2 in ('cancelled','late_cancelled') then 'member' end, cancelled_by_label = case when $2 in ('cancelled','late_cancelled') then 'A Member' end where id = $1`,
      [id, status],
    );
  const statusOf = async (id: string) => (await q(`select status from club.event_rsvps where id = $1`, [id])).rows[0].status as string;
  const clients = async (n: number) =>
    Promise.all(
      Array.from({ length: n }, async () => {
        const c = new Client({ connectionString: db.url });
        await c.connect();
        return c;
      }),
    );

  describe("places are never over-filled", () => {
    it("counts the member and each guest, refuses what does not fit, and lets the waiting list grow", async () => {
      const e = (await event({ capacity: 5 })).rows[0].id;
      await join(e, members[0], 2); // 3 places
      await join(e, members[1], 1); // 5 places
      expect(await code(join(e, members[2]))).toBe(CHECK_VIOLATION);
      expect(await code(join(e, members[2], 0, "waitlisted"))).toBeNull();
      expect(await code(join(e, members[3], 4, "waitlisted"))).toBeNull();
    });

    it("refuses a group that is one place too big, and takes it when it just fits", async () => {
      const e = (await event({ capacity: 4 })).rows[0].id;
      await join(e, members[0]); // 1 of 4
      expect(await code(join(e, members[1], 3))).toBe(CHECK_VIOLATION); // needs 4, 3 left
      expect(await code(join(e, members[1], 2))).toBeNull(); // needs 3
    });

    it("has no limit at all when none is set", async () => {
      const e = (await event({ capacity: null })).rows[0].id;
      for (let i = 0; i < 10; i++) expect(await code(join(e, members[i], 20))).toBeNull();
    });

    it("hands out exactly the places when many arrive at the same instant", async () => {
      const e = (await event({ capacity: 6 })).rows[0].id;
      const open = await clients(20);
      try {
        const results = await Promise.allSettled(open.map((c, i) => join(e, members[i], 1, "going", c))); // each needs 2 places
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
        for (const r of results) if (r.status === "rejected") expect((r.reason as { code?: string }).code).toBe(CHECK_VIOLATION);
        expect((await q(`select sum(1 + guests)::int as n from club.event_rsvps where event_id = $1 and status = 'going'`, [e])).rows[0].n).toBe(6);
      } finally {
        await Promise.all(open.map((c) => c.end()));
      }
    }, 30000);

    it("gives a waiting group places only when its whole group fits", async () => {
      const e = (await event({ capacity: 3 })).rows[0].id;
      const a = (await join(e, members[0])).rows[0].id; // 1 of 3
      await join(e, members[1], 0); // 2 of 3
      const b = (await join(e, members[2], 2, "waitlisted")).rows[0].id; // needs 3
      expect(await code(setStatus(b, "going"))).toBe(CHECK_VIOLATION);
      await setStatus(a, "cancelled");
      expect(await code(setStatus(b, "going"))).toBe(CHECK_VIOLATION); // 2 free, needs 3
      const rest = (await q(`select id from club.event_rsvps where event_id = $1 and member_id = $2`, [e, members[1]])).rows[0].id;
      await setStatus(rest, "cancelled");
      expect(await code(setStatus(b, "going"))).toBeNull();
    });

    it("refuses more guests than fit, and lets guests be removed", async () => {
      const e = (await event({ capacity: 4 })).rows[0].id;
      const a = (await join(e, members[0], 1)).rows[0].id; // 2 of 4
      await join(e, members[1], 0); // 3 of 4
      expect(await code(q(`update club.event_rsvps set guests = 3 where id = $1`, [a]))).toBe(CHECK_VIOLATION); // 4 places for Ada: 5 of 4
      expect(await code(q(`update club.event_rsvps set guests = 2 where id = $1`, [a]))).toBeNull(); // 4 of 4
      expect(await code(q(`update club.event_rsvps set guests = 0 where id = $1`, [a]))).toBeNull();
    });

    it("refuses to lower an event's limit below the people going, and allows raising or removing it", async () => {
      const e = (await event({ capacity: 10 })).rows[0].id;
      await join(e, members[0], 2);
      await join(e, members[1], 1); // 5 going
      expect(await code(q(`update club.events set capacity = 4 where id = $1`, [e]))).toBe(CHECK_VIOLATION);
      expect(await code(q(`update club.events set capacity = 5 where id = $1`, [e]))).toBeNull();
      expect(await code(q(`update club.events set capacity = 50 where id = $1`, [e]))).toBeNull();
      expect(await code(q(`update club.events set capacity = null where id = $1`, [e]))).toBeNull();
    });

    it("refuses a place on an event that was cancelled", async () => {
      const e = (await event({ status: "cancelled" })).rows[0].id;
      expect(await code(join(e, members[0]))).toBe(CHECK_VIOLATION);
      expect(await code(join(e, members[0], 0, "waitlisted"))).toBe(CHECK_VIOLATION);
    });
  });

  describe("a name is on a list once, and only moves forward", () => {
    it("refuses a second live line for one person on one event, but allows coming back after cancelling", async () => {
      const e = (await event()).rows[0].id;
      const first = (await join(e, members[0])).rows[0].id;
      expect(await code(join(e, members[0]))).toBe(UNIQUE_VIOLATION);
      expect(await code(join(e, members[0], 0, "waitlisted"))).toBe(UNIQUE_VIOLATION);
      await setStatus(first, "cancelled");
      expect(await code(join(e, members[0], 0, "waitlisted"))).toBeNull();
      expect(await code(join(e, members[1]))).toBeNull();
    });

    it("lets places become attended or a no-show, a waiting place become places or leave, and nothing go backwards", async () => {
      const e = (await event({ capacity: 20 })).rows[0].id;
      const places = (await join(e, members[0])).rows[0].id;
      const waiting = (await join(e, members[1], 0, "waitlisted")).rows[0].id;
      expect(await code(setStatus(places, "waitlisted"))).toMatch(/./);
      expect(await statusOf(places)).toBe("going");
      expect(await code(setStatus(waiting, "attended"))).toMatch(/./);
      expect(await code(setStatus(waiting, "late_cancelled"))).toMatch(/./); // leaving a waiting list is never late
      expect(await statusOf(waiting)).toBe("waitlisted");
      expect(await code(setStatus(places, "attended"))).toBeNull();
      expect(await code(setStatus(places, "no_show"))).toBeNull(); // a mistake can be corrected, with a line in the record
      expect(await code(setStatus(places, "attended"))).toBeNull();
      expect(await code(setStatus(places, "going"))).toMatch(/./); // but never back to going
      expect(await code(setStatus(places, "cancelled"))).toMatch(/./); // or cancelled
      expect(await statusOf(places)).toBe("attended");

      const left = (await join(e, members[2])).rows[0].id;
      await setStatus(left, "late_cancelled");
      expect(await code(setStatus(left, "going"))).toMatch(/./); // a finished line cannot be revived
      expect(await statusOf(left)).toBe("late_cancelled");
      expect(await code(setStatus(waiting, "cancelled"))).toBeNull();
    });

    it("cannot move an RSVP to another event or person, and a finished RSVP's guests cannot change", async () => {
      const e = (await event({ capacity: 20 })).rows[0].id;
      const other = (await event({ capacity: 20, start: T(20), end: T(22) })).rows[0].id;
      const line = (await join(e, members[0])).rows[0].id;
      await expect(q(`update club.event_rsvps set event_id = $2 where id = $1`, [line, other])).rejects.toThrow(/cannot be moved/);
      await expect(q(`update club.event_rsvps set member_id = $2 where id = $1`, [line, members[1]])).rejects.toThrow(/cannot be moved/);
      await setStatus(line, "attended");
      await expect(q(`update club.event_rsvps set guests = 3 where id = $1`, [line])).rejects.toThrow(/cannot change/);
    });

    it("lets only someone waiting have a hold on the waiting list, and the hold must be cleared when they move on", async () => {
      const e = (await event({ capacity: 5 })).rows[0].id;
      const hold = T(17);
      const waiting = (await q(`insert into club.event_rsvps (event_id, member_id, guests, status, hold_until, created_by_kind, created_by_label) values ($1, $2, 0, 'waitlisted', $3, 'member', 'A Member') returning id`, [e, members[0], hold])).rows[0].id;
      // Someone with places has no hold, from the start...
      expect(await code(q(`insert into club.event_rsvps (event_id, member_id, guests, status, hold_until, created_by_kind, created_by_label) values ($1, $2, 0, 'going', $3, 'member', 'A Member')`, [e, members[1], hold]))).toBe(CHECK_VIOLATION);
      // ...and a waiting place that moves up keeps no hold behind.
      expect(await code(q(`update club.event_rsvps set status = 'going' where id = $1`, [waiting]))).toBe(CHECK_VIOLATION);
      expect(await code(q(`update club.event_rsvps set status = 'going', hold_until = null where id = $1`, [waiting]))).toBeNull();
      expect((await q(`select hold_until from club.event_rsvps where id = $1`, [waiting])).rows[0].hold_until).toBeNull();
    });

    it("cannot bring a cancelled event back", async () => {
      const e = (await event()).rows[0].id;
      await q(`update club.events set status = 'cancelled', cancelled_by_kind = 'staff', cancelled_by_label = 'Test staff' where id = $1`, [e]);
      await expect(q(`update club.events set status = 'scheduled', cancelled_by_kind = null, cancelled_by_label = null where id = $1`, [e])).rejects.toThrow(/cannot be brought back/);
    });
  });

  describe("an event's own facts make sense", () => {
    it("must end after it starts, take its reply-by before the start, and record who cancelled it", async () => {
      expect(await code(event({ start: T(19), end: T(16) }))).toBe(CHECK_VIOLATION);
      expect(await code(event({ replyBy: T(17) }))).toBe(CHECK_VIOLATION); // after the 16:00 start
      expect(await code(event({ replyBy: T(12) }))).toBeNull();
      expect(await code(q(`insert into club.events (title, starts_at, ends_at, status, created_by_kind, created_by_label) values ('X', $1, $2, 'cancelled', 'staff', 'Test staff')`, [T(16), T(19)]))).toBe(CHECK_VIOLATION);
      expect(await code(event({ capacity: 0 }))).toBe(CHECK_VIOLATION);
      expect(await code(q(`insert into club.events (title, starts_at, ends_at, price_cents, created_by_kind, created_by_label) values ('X', $1, $2, -1, 'staff', 'Test staff')`, [T(16), T(19)]))).toBe(CHECK_VIOLATION);
    });
  });

  describe("ending a membership cancels future RSVPs, in the same step", () => {
    const NOW = "2026-10-28T20:00:00Z";
    const end = (hh: string) => q(`select club.end_household($1, '2026-10-27', 'staff', null, 'Test staff', $2) as adults`, [hh, NOW]);

    async function busy() {
      const hh = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Busy household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
      const [a, b] = await Promise.all(["A", "B"].map(async (name) => (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Busy', $3, $4) returning id`, [hh, name, `${name}@busy.example`, name === "A" ? "primary" : "additional"])).rows[0].id));
      const future = (await event({ capacity: 2, start: T(16), end: T(19) })).rows[0].id; // tomorrow
      const past = (await event({ capacity: 5, start: T(16, 0, 20), end: T(19, 0, 20) })).rows[0].id;
      const underWay = (await event({ capacity: 5, start: "2026-10-28T19:30:00Z", end: "2026-10-28T22:30:00Z" })).rows[0].id;
      const places = (await join(future, a, 1)).rows[0].id;
      const waiting = (await join(future, b, 0, "waitlisted")).rows[0].id;
      const pastLine = (await join(past, a)).rows[0].id;
      await setStatus(pastLine, "attended");
      const underWayLine = (await join(underWay, a)).rows[0].id;
      return { hh, places, waiting, pastLine, underWayLine };
    }

    it("cancels future RSVPs, places and waiting alike, and writes it to the household's file", async () => {
      const x = await busy();
      await end(x.hh);
      expect(await statusOf(x.places)).toBe("cancelled");
      expect(await statusOf(x.waiting)).toBe("cancelled");
      const row = (await q(`select cancel_reason, cancelled_by_kind, cancelled_by_label from club.event_rsvps where id = $1`, [x.places])).rows[0];
      expect(row).toEqual({ cancel_reason: "The household's membership ended", cancelled_by_kind: "staff", cancelled_by_label: "Test staff" });
      const history = (await q(`select summary, details from club.household_history where household_id = $1 and kind = 'rsvps_cancelled'`, [x.hh])).rows;
      expect(history).toEqual([{ summary: "2 future event RSVPs cancelled because the membership ended.", details: { count: 2 } }]);
    });

    it("leaves a finished event and one already under way exactly as they were", async () => {
      const x = await busy();
      await end(x.hh);
      expect(await statusOf(x.pastLine)).toBe("attended");
      expect(await statusOf(x.underWayLine)).toBe("going");
    });
  });

  describe("agrees with the app", () => {
    it("on the list of RSVP states, event states, ways to RSVP and history kinds", async () => {
      const check = async (constraint: string) => {
        const { rows } = await q(`select pg_get_constraintdef(c.oid) as def from pg_constraint c join pg_namespace s on s.oid = c.connamespace where s.nspname = 'club' and c.conname = $1`, [constraint]);
        expect(rows, constraint).toHaveLength(1);
        return rows[0].def as string;
      };
      const values = (def: string) => [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
      expect(values(await check("event_rsvps_status_check"))).toEqual([...RSVP_STATUSES].sort());
      expect(values(await check("events_status_check"))).toEqual([...EVENT_STATUSES].sort());
      expect(values(await check("event_rsvps_via_check"))).toEqual([...RSVP_VIA].sort());
      expect(values(await check("household_history_kind_check"))).toEqual([...HISTORY_KINDS].sort());
    });
  });
});
