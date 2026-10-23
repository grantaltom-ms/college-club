import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HISTORY_KINDS, SESSION_STATUSES, SIGNUP_STATUSES } from "../types";
import { createScratchDb, recordOutcome, type ScratchDb } from "./testdb";

/**
 * The class rules the DATABASE enforces by itself, tested against a real Postgres: chairs are never over-filled, a room
 * is never used twice (by two classes, or by a class and a member's booking), a name is on a sheet once, and a sign-up
 * only moves forward. Needs CLUB_TEST_DATABASE_URL (a local or throwaway Postgres); skipped without it, and CI always sets it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const EXCLUSION_VIOLATION = "23P01";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

const T = (hh: number, mm = 0, day = 29) => new Date(Date.UTC(2026, 9, day, hh, mm)).toISOString(); // Oct 29, 2026, in UTC

describe.skipIf(!ADMIN_URL)("the class tables", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "other");

  let n = 0;
  let householdId: string;
  const members: string[] = [];
  let classId: string;

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    householdId = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    for (let i = 0; i < 24; i++) {
      members.push((await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Test', $3, $4) returning id`, [householdId, `M${i}`, `m${i}@example.com`, i === 0 ? "primary" : "additional"])).rows[0].id);
    }
    await q(`insert into club.item_classes (code, booking_type, name, seats) values ('gym', 'Gym Space', 'Gym', 1)`);
    classId = (await q(`insert into club.classes (name, default_capacity, default_minutes) values ('Yoga', 3, 60) returning id`)).rows[0].id;
  });
  afterAll(async () => {
    await db?.drop();
  });

  /** A fresh room, so tests never share one. */
  async function freshRoom(): Promise<string> {
    n += 1;
    return (await q(`insert into club.items (name, class_code) values ($1, 'gym') returning id`, [`Room ${n}`])).rows[0].id;
  }
  type SessionFields = Partial<{ room: string | null; start: string; end: string; capacity: number; status: string }>;
  const session = (f: SessionFields = {}, client: Client = db.client) =>
    client.query(
      `insert into club.class_sessions (class_id, room_item_id, starts_at, ends_at, capacity, status, created_by_kind, created_by_label, cancelled_by_kind, cancelled_by_label)
       values ($1, $2, $3, $4, $5, $6, 'staff', 'Test staff', $7, $8) returning id`,
      [classId, f.room === undefined ? null : f.room, f.start ?? T(16), f.end ?? T(17), f.capacity ?? 3, f.status ?? "scheduled", f.status === "cancelled" ? "staff" : null, f.status === "cancelled" ? "Test staff" : null],
    );
  const booking = (item: string, start = T(16), end = T(17), status = "upcoming", client: Client = db.client) =>
    client.query(
      `insert into club.bookings (item_id, booker_id, starts_at, ends_at, status, created_by_kind, created_by_label, cancelled_by_kind, cancelled_by_label)
       values ($1, $2, $3, $4, $5, 'member', 'A Member', $6, $7) returning id`,
      [item, members[0], start, end, status, status === "cancelled" ? "member" : null, status === "cancelled" ? "A Member" : null],
    );
  const join = (sessionId: string, member: string, status = "enrolled", client: Client = db.client) =>
    client.query(`insert into club.class_signups (session_id, member_id, status, created_by_kind, created_by_label) values ($1, $2, $3, 'member', 'A Member') returning id`, [sessionId, member, status]);
  const setStatus = (id: string, status: string) =>
    status === "attended" || status === "no_show"
      ? recordOutcome(db.client, "class_signups", id, status)
      : q(
      `update club.class_signups set status = $2, cancelled_by_kind = case when $2 in ('cancelled','late_cancelled') then 'member' end, cancelled_by_label = case when $2 in ('cancelled','late_cancelled') then 'A Member' end where id = $1`,
      [id, status],
    );
  const statusOf = async (id: string) => (await q(`select status from club.class_signups where id = $1`, [id])).rows[0].status as string;

  describe("a room is never used twice", () => {
    it("refuses two classes in one room at overlapping times, with the database's own exclusion error", async () => {
      const room = await freshRoom();
      await session({ room, start: T(16), end: T(17) });
      for (const [s, e] of [[16, 17], [15, 16.5], [16.5, 17.5], [16.25, 16.75], [15, 18]] as const) {
        expect(await code(session({ room, start: T(Math.floor(s), (s % 1) * 60), end: T(Math.floor(e), (e % 1) * 60) })), `${s}-${e}`).toBe(EXCLUSION_VIOLATION);
      }
      expect((await q(`select count(*)::int as n from club.class_sessions where room_item_id = $1`, [room])).rows[0].n).toBe(1);
    });

    it("allows back to back, another room, a class with no room, and a cancelled class that let go", async () => {
      const room = await freshRoom();
      const first = (await session({ room, start: T(16), end: T(17) })).rows[0].id;
      expect(await code(session({ room, start: T(15), end: T(16) }))).toBeNull();
      expect(await code(session({ room, start: T(17), end: T(18) }))).toBeNull();
      expect(await code(session({ room: await freshRoom(), start: T(16), end: T(17) }))).toBeNull();
      expect(await code(session({ room: null, start: T(16), end: T(17) }))).toBeNull();
      expect(await code(session({ room: null, start: T(16), end: T(17) }))).toBeNull();
      await q(`update club.class_sessions set status = 'cancelled', cancelled_by_kind = 'staff', cancelled_by_label = 'Test staff' where id = $1`, [first]);
      expect(await code(session({ room, start: T(16), end: T(17) }))).toBeNull();
    });

    it("keeps a class and a member's booking out of one room, whichever arrives second", async () => {
      const room = await freshRoom();
      await booking(room, T(16), T(16, 30));
      expect(await code(session({ room, start: T(16), end: T(17) }))).toBe(EXCLUSION_VIOLATION);
      expect(await code(session({ room, start: T(16, 30), end: T(17, 30) }))).toBeNull();

      const other = await freshRoom();
      await session({ room: other, start: T(16), end: T(17) });
      expect(await code(booking(other, T(16, 30), T(17)))).toBe(EXCLUSION_VIOLATION);
      expect(await code(booking(other, T(17), T(17, 30)))).toBeNull();
      expect(await code(booking(other, T(15), T(16)))).toBeNull();
    });

    it("lets go when the booking is cancelled or the class is cancelled", async () => {
      const room = await freshRoom();
      const b = (await booking(room, T(16), T(17))).rows[0].id;
      expect(await code(session({ room }))).toBe(EXCLUSION_VIOLATION);
      await q(`update club.bookings set status = 'cancelled', cancelled_by_kind = 'member', cancelled_by_label = 'A Member' where id = $1`, [b]);
      const s = (await session({ room })).rows[0].id;
      expect(await code(booking(room))).toBe(EXCLUSION_VIOLATION);
      await q(`update club.class_sessions set status = 'cancelled', cancelled_by_kind = 'staff', cancelled_by_label = 'Test staff' where id = $1`, [s]);
      expect(await code(booking(room))).toBeNull();
    });

    it("gives a clean refusal, not a strange error, for times that run backwards", async () => {
      const room = await freshRoom();
      expect(await code(session({ room, start: T(17), end: T(16) }))).toBe(CHECK_VIOLATION);
      expect(await code(booking(room, T(17), T(16)))).toBe(CHECK_VIOLATION);
    });

    it("lets exactly one through when a class and bookings for one room arrive at the same instant", async () => {
      const room = await freshRoom();
      const clients = await Promise.all(Array.from({ length: 12 }, async () => {
        const c = new Client({ connectionString: db.url });
        await c.connect();
        return c;
      }));
      try {
        const attempts = clients.map((c, i) => (i % 2 === 0 ? session({ room, start: T(16), end: T(17) }, c) : booking(room, T(16, 15), T(16, 45), "upcoming", c)));
        const results = await Promise.allSettled(attempts);
        const won = results.filter((r) => r.status === "fulfilled").length;
        // Class-vs-class and booking-vs-booking collisions are refused, and so are class-vs-booking ones: one winner in all.
        expect(won).toBe(1);
        for (const r of results) if (r.status === "rejected") expect((r.reason as { code?: string }).code).toBe(EXCLUSION_VIOLATION);
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    }, 30000);
  });

  describe("chairs are never over-filled", () => {
    it("refuses a chair beyond the class's chairs, but lets the waiting list grow", async () => {
      const s = (await session({ capacity: 2 })).rows[0].id;
      await join(s, members[0]);
      await join(s, members[1]);
      expect(await code(join(s, members[2]))).toBe(CHECK_VIOLATION);
      expect(await code(join(s, members[2], "waitlisted"))).toBeNull();
      expect(await code(join(s, members[3], "waitlisted"))).toBeNull();
    });

    it("hands out exactly the chairs when many arrive at the same instant", async () => {
      const s = (await session({ capacity: 3 })).rows[0].id;
      const clients = await Promise.all(Array.from({ length: 20 }, async () => {
        const c = new Client({ connectionString: db.url });
        await c.connect();
        return c;
      }));
      try {
        const results = await Promise.allSettled(clients.map((c, i) => join(s, members[i], "enrolled", c)));
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
        for (const r of results) if (r.status === "rejected") expect((r.reason as { code?: string }).code).toBe(CHECK_VIOLATION);
        expect((await q(`select count(*)::int as n from club.class_signups where session_id = $1 and status = 'enrolled'`, [s])).rows[0].n).toBe(3);
      } finally {
        await Promise.all(clients.map((c) => c.end()));
      }
    }, 30000);

    it("refuses a waiting person a chair that is not free, and gives it once one is", async () => {
      const s = (await session({ capacity: 1 })).rows[0].id;
      const a = (await join(s, members[0])).rows[0].id;
      const b = (await join(s, members[1], "waitlisted")).rows[0].id;
      expect(await code(setStatus(b, "enrolled"))).toBe(CHECK_VIOLATION);
      await setStatus(a, "cancelled");
      expect(await code(setStatus(b, "enrolled"))).toBeNull();
    });

    it("refuses to lower a class's chairs below the people in them, and allows raising them", async () => {
      const s = (await session({ capacity: 3 })).rows[0].id;
      await join(s, members[0]);
      await join(s, members[1]);
      expect(await code(q(`update club.class_sessions set capacity = 1 where id = $1`, [s]))).toBe(CHECK_VIOLATION);
      expect(await code(q(`update club.class_sessions set capacity = 2 where id = $1`, [s]))).toBeNull();
      expect(await code(q(`update club.class_sessions set capacity = 9 where id = $1`, [s]))).toBeNull();
    });

    it("refuses a place on a class that was cancelled", async () => {
      const s = (await session({ status: "cancelled" })).rows[0].id;
      expect(await code(join(s, members[0]))).toBe(CHECK_VIOLATION);
      expect(await code(join(s, members[0], "waitlisted"))).toBe(CHECK_VIOLATION);
    });
  });

  describe("a name is on a sheet once, and only moves forward", () => {
    it("refuses a second live line for one person on one class, but allows coming back after leaving", async () => {
      const s = (await session()).rows[0].id;
      const first = (await join(s, members[0])).rows[0].id;
      expect(await code(join(s, members[0]))).toBe(UNIQUE_VIOLATION);
      expect(await code(join(s, members[0], "waitlisted"))).toBe(UNIQUE_VIOLATION);
      await setStatus(first, "cancelled");
      expect(await code(join(s, members[0], "waitlisted"))).toBeNull();
      expect(await code(join(s, members[1]))).toBeNull();
    });

    it("lets a chair become attended or a no-show, a waiting place become a chair or leave, and nothing go backwards", async () => {
      const s = (await session({ capacity: 5 })).rows[0].id;
      const chair = (await join(s, members[0])).rows[0].id;
      const waiting = (await join(s, members[1], "waitlisted")).rows[0].id;
      expect(await code(setStatus(chair, "waitlisted"))).toMatch(/./); // a chair never goes back to waiting
      expect(await statusOf(chair)).toBe("enrolled");
      expect(await code(setStatus(waiting, "attended"))).toMatch(/./); // someone waiting never attended
      expect(await statusOf(waiting)).toBe("waitlisted");
      expect(await code(setStatus(waiting, "late_cancelled"))).toMatch(/./); // leaving a waiting list is never late
      expect(await code(setStatus(chair, "attended"))).toBeNull();
      expect(await code(setStatus(chair, "no_show"))).toBeNull(); // a mistake can be corrected, with a line in the record
      expect(await code(setStatus(chair, "attended"))).toBeNull();
      expect(await code(setStatus(chair, "enrolled"))).toMatch(/./); // but never back to a chair
      expect(await code(setStatus(chair, "cancelled"))).toMatch(/./); // or cancelled
      expect(await statusOf(chair)).toBe("attended");

      const left = (await join(s, members[2])).rows[0].id;
      await setStatus(left, "late_cancelled");
      expect(await code(setStatus(left, "enrolled"))).toMatch(/./); // a finished line cannot be revived
      expect(await statusOf(left)).toBe("late_cancelled");
      expect(await code(setStatus(waiting, "cancelled"))).toBeNull();
    });

    it("cannot move a sign-up to another class or another person", async () => {
      const s = (await session({ capacity: 5 })).rows[0].id;
      const other = (await session({ capacity: 5, start: T(20), end: T(21) })).rows[0].id;
      const line = (await join(s, members[0])).rows[0].id;
      await expect(q(`update club.class_signups set session_id = $2 where id = $1`, [line, other])).rejects.toThrow(/cannot be moved/);
      await expect(q(`update club.class_signups set member_id = $2 where id = $1`, [line, members[1]])).rejects.toThrow(/cannot be moved/);
    });

    it("cannot move a session, change its room, or bring a cancelled one back", async () => {
      const room = await freshRoom();
      const s = (await session({ room })).rows[0].id;
      await expect(q(`update club.class_sessions set starts_at = $2, ends_at = $3 where id = $1`, [s, T(18), T(19)])).rejects.toThrow(/cannot be moved/);
      await expect(q(`update club.class_sessions set room_item_id = $2 where id = $1`, [s, await freshRoom()])).rejects.toThrow(/cannot be moved/);
      await q(`update club.class_sessions set status = 'cancelled', cancelled_by_kind = 'staff', cancelled_by_label = 'Test staff' where id = $1`, [s]);
      await expect(q(`update club.class_sessions set status = 'scheduled', cancelled_by_kind = null, cancelled_by_label = null where id = $1`, [s])).rejects.toThrow(/cannot be brought back/);
    });
  });

  describe("ending a membership takes people off future classes, in the same step", () => {
    const NOW = "2026-10-28T20:00:00Z";
    const end = (hh: string) => q(`select club.end_household($1, '2026-10-27', 'staff', null, 'Test staff', $2) as adults`, [hh, NOW]);

    async function busy() {
      const hh = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Busy household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
      const [a, b] = await Promise.all(["A", "B"].map(async (name) => (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Busy', $3, $4) returning id`, [hh, name, `${name}@busy.example`, name === "A" ? "primary" : "additional"])).rows[0].id));
      const future = (await session({ capacity: 1, start: T(16), end: T(17) })).rows[0].id; // tomorrow
      const past = (await session({ capacity: 5, start: T(16, 0, 20), end: T(17, 0, 20) })).rows[0].id;
      const underWay = (await session({ capacity: 5, start: "2026-10-28T19:30:00Z", end: "2026-10-28T20:30:00Z" })).rows[0].id;
      const chair = (await join(future, a)).rows[0].id;
      const waiting = (await join(future, b, "waitlisted")).rows[0].id;
      const pastLine = (await join(past, a)).rows[0].id;
      await setStatus(pastLine, "attended");
      const underWayLine = (await join(underWay, a)).rows[0].id;
      return { hh, a, b, chair, waiting, pastLine, underWayLine };
    }

    it("cancels future sign-ups, chairs and waiting places alike, and writes it to the household's file", async () => {
      const x = await busy();
      await end(x.hh);
      expect(await statusOf(x.chair)).toBe("cancelled");
      expect(await statusOf(x.waiting)).toBe("cancelled");
      const row = (await q(`select cancel_reason, cancelled_by_kind, cancelled_by_label from club.class_signups where id = $1`, [x.chair])).rows[0];
      expect(row).toEqual({ cancel_reason: "The household's membership ended", cancelled_by_kind: "staff", cancelled_by_label: "Test staff" });
      const history = (await q(`select summary, details from club.household_history where household_id = $1 and kind = 'signups_cancelled'`, [x.hh])).rows;
      expect(history).toEqual([{ summary: "2 future class sign-ups cancelled because the membership ended.", details: { count: 2 } }]);
    });

    it("leaves a finished class and one already under way exactly as they were", async () => {
      const x = await busy();
      await end(x.hh);
      expect(await statusOf(x.pastLine)).toBe("attended");
      expect(await statusOf(x.underWayLine)).toBe("enrolled");
    });
  });

  describe("agrees with the app", () => {
    it("on the list of sign-up states, session states and history kinds", async () => {
      const check = async (constraint: string) => {
        const { rows } = await q(`select pg_get_constraintdef(c.oid) as def from pg_constraint c join pg_namespace s on s.oid = c.connamespace where s.nspname = 'club' and c.conname = $1`, [constraint]);
        expect(rows, constraint).toHaveLength(1);
        return rows[0].def as string;
      };
      const values = (def: string) => [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
      expect(values(await check("class_signups_status_check"))).toEqual([...SIGNUP_STATUSES].sort());
      expect(values(await check("class_sessions_status_check"))).toEqual([...SESSION_STATUSES].sort());
      expect(values(await check("household_history_kind_check"))).toEqual([...HISTORY_KINDS].sort());
    });
  });
});
