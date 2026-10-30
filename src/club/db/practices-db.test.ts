import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * Practices and lineups as the DATABASE guards them, tested against a real Postgres: a member is marked as a coach only with a
 * line in the household's file, a practice is run by an active coach or by staff and never changes except to be cancelled once, a
 * boat is reserved by one practice at a time (and not a private boat or a space), nobody can book a boat a practice has reserved,
 * a boat line and a seat line are only added and ended (never removed), a boat cannot come off a practice with people still
 * seated in it, a seat belongs to a boat on the practice, and a person is in one seat of a practice and one person in a seat.
 * Needs CLUB_TEST_DATABASE_URL (a local or throwaway Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const EXCLUSION_VIOLATION = "23P01";

type Failure = { code?: string; message: string };

describe.skipIf(!ADMIN_URL)("practices and lineups", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  const members: Record<string, string> = {};
  let household = "";
  let days = 0;
  /** A fresh run of days far from every other test, so tests never touch each other's boats or practices. */
  const nextDay = () => (days += 1);
  const T = (hh: number, day: number, mm = 0) => new Date(Date.UTC(2027, 0, day, hh, mm)).toISOString();

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    household = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    for (const [i, name] of ["Ada", "Ben", "Cy", "Dee", "Eli"].entries()) {
      members[name] = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Test', $3, $4) returning id`, [household, name, `${name}@example.com`, i === 0 ? "primary" : "additional"])).rows[0].id;
    }
    await q(`insert into club.item_classes (code, booking_type, name, seats) values ('single','Shell','Single',1), ('double','Shell','Double',2), ('quad','Shell','Quad',4), ('kayak','Kayak','Kayak',1), ('dock','Dock Space','Dock',1)`);
    // Ben is a coach.
    expect(await markCoach(members.Ben, true)).toBeNull();
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

  /** Runs statements as one change, so the checks the database leaves to the end of a change run at commit. */
  async function tx(fn: () => Promise<void>): Promise<Failure | null> {
    await q("begin");
    try {
      await fn();
      await q("commit");
      return null;
    } catch (e) {
      await q("rollback").catch(() => undefined);
      return e as Failure;
    }
  }

  async function coachLine(memberId: string, coach: string, kind = "coach_changed", forMember = memberId): Promise<void> {
    await q(`insert into club.household_history (household_id, at, kind, summary, actor_kind, actor_label, details) values ($1, now(), $2, 'A coach line', 'staff', 'Test staff', $3)`, [
      household,
      kind,
      JSON.stringify({ memberId: forMember, coach }),
    ]);
  }
  const markCoach = (memberId: string, coach: boolean) =>
    tx(async () => {
      await q(`update club.members set is_coach = $2 where id = $1`, [memberId, coach]);
      await coachLine(memberId, coach ? "yes" : "no");
    });

  let boats = 0;
  async function boat(classCode = "single", extra: { isPrivate?: boolean; places?: number } = {}): Promise<string> {
    boats += 1;
    return (await q(`insert into club.items (name, class_code, is_private, places) values ($1, $2, $3, $4) returning id`, [`Boat ${boats}`, classCode, extra.isPrivate ?? false, extra.places ?? 1])).rows[0].id;
  }

  type PracticeOptions = Partial<{ name: string; start: string; end: string; coach: string | null; by: "staff" | "member"; byId: string | null; status: string }>;
  const insertPractice = async (o: PracticeOptions & { day: number }) => {
    const by = o.by ?? "staff";
    const byId = o.byId === undefined ? (by === "member" ? o.coach ?? null : null) : o.byId;
    return attempt(
      `insert into club.practices (name, starts_at, ends_at, status, coach_id, created_at, created_by_kind, created_by_id, created_by_label, status_changed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'Test staff',$6)`,
      [o.name ?? "Morning session", o.start ?? T(7, o.day), o.end ?? T(9, o.day), o.status ?? "scheduled", o.coach === undefined ? null : o.coach, T(1, o.day), by, byId],
    );
  };
  async function practice(o: PracticeOptions & { day: number }): Promise<string> {
    expect(await insertPractice(o)).toBeNull();
    return (await q(`select id from club.practices order by seq desc limit 1`)).rows[0].id;
  }
  const addBoat = (practiceId: string, item: string, extra: { endedAt?: string } = {}) =>
    attempt(
      `insert into club.practice_boats (practice_id, item_id, added_at, added_by_kind, added_by_label, ended_at, ended_by_kind, ended_by_label) values ($1,$2,$3,'staff','Test staff',$4,$5,$6)`,
      [practiceId, item, T(1, 1), extra.endedAt ?? null, extra.endedAt ? "staff" : null, extra.endedAt ? "Test staff" : null],
    );
  const endBoat = (practiceId: string, item: string) =>
    attempt(`update club.practice_boats set ended_at=$3, ended_by_kind='staff', ended_by_label='Test staff' where practice_id=$1 and item_id=$2 and ended_at is null`, [practiceId, item, T(2, 1)]);
  type SeatOptions = Partial<{ side: string | null; by: "staff" | "member"; byId: string | null }>;
  const seat = (practiceId: string, item: string, n: number, member: string, o: SeatOptions = {}) =>
    attempt(
      `insert into club.practice_seats (practice_id, item_id, seat, side, member_id, added_at, added_by_kind, added_by_id, added_by_label) values ($1,$2,$3,$4,$5,$6,$7,$8,'Test staff')`,
      [practiceId, item, n, o.side === undefined ? null : o.side, member, T(2, 1), o.by ?? "staff", o.byId === undefined ? null : o.byId],
    );
  const endSeat = (practiceId: string, item: string, n: number) =>
    attempt(`update club.practice_seats set ended_at=$4, ended_by_kind='staff', ended_by_label='Test staff', ended_reason='Taken out' where practice_id=$1 and item_id=$2 and seat=$3 and ended_at is null`, [practiceId, item, n, T(3, 1)]);
  const book = (item: string, booker: string, start: string, end: string) =>
    attempt(`insert into club.bookings (item_id, booker_id, starts_at, ends_at, created_by_kind, created_by_label) values ($1,$2,$3,$4,'member','A Member')`, [item, booker, start, end]);
  const cancel = (practiceId: string) =>
    attempt(`update club.practices set status='cancelled', status_changed_at=$2, cancelled_by_kind='staff', cancelled_by_label='Test staff' where id=$1`, [practiceId, T(4, 1)]);

  describe("coaches", () => {
    it("start as not a coach", async () => {
      expect((await q(`select is_coach from club.members where id = $1`, [members.Ada])).rows[0].is_coach).toBe(false);
      expect((await q(`select is_coach from club.members where id = $1`, [members.Ben])).rows[0].is_coach).toBe(true);
    });

    it("cannot be marked without a matching line in the household's file", async () => {
      const failure = await tx(async () => {
        await q(`update club.members set is_coach = true where id = $1`, [members.Cy]);
      });
      expect(failure?.code).toBe(CHECK_VIOLATION);
      expect(failure?.message).toMatch(/without a matching line/);
      expect((await q(`select is_coach from club.members where id = $1`, [members.Cy])).rows[0].is_coach).toBe(false);
    });

    it("is accepted with a line saying so, written in the same change, before or after", async () => {
      expect(await tx(async () => {
        await coachLine(members.Cy, "yes");
        await q(`update club.members set is_coach = true where id = $1`, [members.Cy]);
      })).toBeNull();
      expect((await q(`select is_coach from club.members where id = $1`, [members.Cy])).rows[0].is_coach).toBe(true);
      expect(await tx(async () => {
        await q(`update club.members set is_coach = false where id = $1`, [members.Cy]);
        await coachLine(members.Cy, "no");
      })).toBeNull();
      expect((await q(`select is_coach from club.members where id = $1`, [members.Cy])).rows[0].is_coach).toBe(false);
    });

    it("needs a line about this member and the right way round", async () => {
      const wrongPerson = await tx(async () => {
        await q(`update club.members set is_coach = true where id = $1`, [members.Dee]);
        await coachLine(members.Dee, "yes", "coach_changed", members.Eli);
      });
      expect(wrongPerson?.code).toBe(CHECK_VIOLATION);
      const wrongWay = await tx(async () => {
        await q(`update club.members set is_coach = true where id = $1`, [members.Dee]);
        await coachLine(members.Dee, "no");
      });
      expect(wrongWay?.code).toBe(CHECK_VIOLATION);
      const wrongKind = await tx(async () => {
        await q(`update club.members set is_coach = true where id = $1`, [members.Dee]);
        await coachLine(members.Dee, "yes", "member_updated");
      });
      expect(wrongKind?.code).toBe(CHECK_VIOLATION);
      expect((await q(`select is_coach from club.members where id = $1`, [members.Dee])).rows[0].is_coach).toBe(false);
    });

    it("cannot be unmarked without a line either", async () => {
      const failure = await tx(async () => {
        await q(`update club.members set is_coach = false where id = $1`, [members.Ben]);
      });
      expect(failure?.code).toBe(CHECK_VIOLATION);
      expect((await q(`select is_coach from club.members where id = $1`, [members.Ben])).rows[0].is_coach).toBe(true);
    });

    it("cannot newly be a member who has left", async () => {
      const other = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('Other', 'Resident', '2020-01-01') returning id`)).rows[0].id;
      const a = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, 'Pat', 'Test', 'pat@example.com', 'primary') returning id`, [other])).rows[0].id;
      const b = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, 'Quinn', 'Test', 'quinn@example.com', 'additional') returning id`, [other])).rows[0].id;
      await q(`update club.members set status = 'removed' where id = $1`, [b]);
      const failure = await tx(async () => {
        await q(`update club.members set is_coach = true where id = $1`, [b]);
        await q(`insert into club.household_history (household_id, at, kind, summary, actor_kind, actor_label, details) values ($1, now(), 'coach_changed', 'x', 'staff', 'Test staff', $2)`, [other, JSON.stringify({ memberId: b, coach: "yes" })]);
      });
      expect(failure?.message).toMatch(/Only an active member can be marked as a coach/);
      void a;
    });

    it("accepts the new kind of line in a household's file", async () => {
      expect((await q(`select count(*)::int as n from club.household_history where kind = 'coach_changed'`)).rows[0].n).toBeGreaterThan(0);
    });
  });

  describe("a practice", () => {
    it("is accepted when staff run it, with or without a coach", async () => {
      const day = nextDay();
      expect(await insertPractice({ day })).toBeNull();
      expect(await insertPractice({ day, coach: members.Ben })).toBeNull();
    });

    it("must end after it starts", async () => {
      const day = nextDay();
      expect((await insertPractice({ day, start: T(9, day), end: T(9, day) }))?.code).toBe(CHECK_VIOLATION);
      expect((await insertPractice({ day, start: T(10, day), end: T(9, day) }))?.code).toBe(CHECK_VIOLATION);
    });

    it("starts out scheduled", async () => {
      const day = nextDay();
      const failure = await insertPractice({ day, status: "cancelled" });
      expect(failure).not.toBeNull();
    });

    it("is run by an active coach, never by an ordinary member, one who left, or a made-up person", async () => {
      const day = nextDay();
      expect((await insertPractice({ day, coach: members.Ada }))?.message).toMatch(/run by an active coach, or by staff/);
      expect((await insertPractice({ day, coach: members.Cy }))?.message).toMatch(/run by an active coach, or by staff/);
      expect(await insertPractice({ day, coach: "00000000-0000-4000-8000-0000000fffff" })).not.toBeNull();
    });

    it("set up by a member must be run by that same member", async () => {
      const day = nextDay();
      expect(await insertPractice({ day, by: "member", coach: members.Ben, byId: members.Ben })).toBeNull();
      expect((await insertPractice({ day, by: "member", coach: members.Ben, byId: members.Ada }))?.code).toBe(CHECK_VIOLATION);
      expect((await insertPractice({ day, by: "member", coach: null, byId: members.Ben }))?.code).toBe(CHECK_VIOLATION);
      expect((await insertPractice({ day, by: "member", coach: members.Ben, byId: null }))?.code).toBe(CHECK_VIOLATION);
    });

    it("keeps its name, notes, times, coach and maker for good", async () => {
      const day = nextDay();
      const id = await practice({ day, coach: members.Ben });
      for (const [set, value] of [
        ["name", "Another"],
        ["notes", "Something"],
        ["starts_at", T(6, day)],
        ["ends_at", T(10, day)],
        ["coach_id", null],
        ["created_by_label", "Someone else"],
        ["created_at", T(2, day)],
      ] as const) {
        const failure = await attempt(`update club.practices set ${set} = $2 where id = $1`, [id, value]);
        expect(failure?.message, set).toMatch(/cannot change/);
      }
      expect((await q(`select name from club.practices where id = $1`, [id])).rows[0].name).toBe("Morning session");
    });

    it("can be cancelled once, with who did it and when, and then cannot change or come back", async () => {
      const day = nextDay();
      const id = await practice({ day });
      expect(await cancel(id)).toBeNull();
      expect((await q(`select status, cancelled_by_label from club.practices where id = $1`, [id])).rows[0]).toEqual({ status: "cancelled", cancelled_by_label: "Test staff" });
      expect((await attempt(`update club.practices set status='scheduled' where id = $1`, [id]))).not.toBeNull();
      expect((await attempt(`update club.practices set cancel_reason='A new reason' where id = $1`, [id]))?.message).toMatch(/can be cancelled once/);
      expect((await attempt(`update club.practices set cancelled_by_label='Someone' where id = $1`, [id]))).not.toBeNull();
    });

    it("needs its cancellation filled in completely, and a reason only when cancelled", async () => {
      const day = nextDay();
      const id = await practice({ day });
      expect((await attempt(`update club.practices set status='cancelled' where id = $1`, [id]))?.code).toBe(CHECK_VIOLATION);
      expect((await attempt(`update club.practices set status='cancelled', status_changed_at=$2, cancelled_by_kind='member', cancelled_by_label='A Coach' where id = $1`, [id, T(4, 1)]))?.code).toBe(CHECK_VIOLATION);
      // A reason on a practice that is not cancelled, and a cancelled practice with nobody named as having cancelled it.
      expect(
        (await attempt(`insert into club.practices (name, starts_at, ends_at, status, created_at, created_by_kind, created_by_label, status_changed_at, cancel_reason) values ('X',$1,$2,'scheduled',$3,'staff','Test staff',$3,'Wind')`, [T(7, day), T(9, day), T(1, day)]))?.code,
      ).toBe(CHECK_VIOLATION);
      // A scheduled practice cannot be given a cancellation reason on its own either.
      expect((await attempt(`update club.practices set cancel_reason='Wind' where id = $1`, [id]))?.message).toMatch(/can be cancelled once/);
    });

    it("cannot be removed", async () => {
      const day = nextDay();
      const id = await practice({ day });
      expect((await attempt(`delete from club.practices where id = $1`, [id]))?.message).toMatch(/cannot be removed/);
      expect((await attempt(`truncate club.practices cascade`))?.message).toMatch(/cannot be removed/);
    });
  });

  describe("the boats a practice reserves", () => {
    it("accepts a club boat, a kayak and a paddle-board-like single, each once", async () => {
      const day = nextDay();
      const id = await practice({ day });
      const single = await boat("single");
      const kayak = await boat("kayak");
      expect(await addBoat(id, single)).toBeNull();
      expect(await addBoat(id, kayak)).toBeNull();
      expect((await addBoat(id, single))?.code).toBe(UNIQUE_VIOLATION);
    });

    it("refuses a private boat, a pool and a space that is not on the water", async () => {
      const day = nextDay();
      const id = await practice({ day });
      expect((await addBoat(id, await boat("single", { isPrivate: true })))?.message).toMatch(/Only a club boat/);
      expect((await addBoat(id, await boat("dock", { places: 4 })))?.message).toMatch(/Only a club boat/);
      expect((await addBoat(id, await boat("dock")))?.message).toMatch(/Only a club boat/);
    });

    it("is reserved by one practice at a time: overlapping is refused, back to back is fine", async () => {
      const day = nextDay();
      const item = await boat("quad");
      const first = await practice({ day, name: "First" });
      expect(await addBoat(first, item)).toBeNull();
      const overlapping = await practice({ day, name: "Overlap", start: T(8, day), end: T(10, day) });
      expect((await addBoat(overlapping, item))?.code).toBe(EXCLUSION_VIOLATION);
      const before = await practice({ day, name: "Before", start: T(5, day), end: T(7, day) });
      const after = await practice({ day, name: "After", start: T(9, day), end: T(11, day) });
      expect(await addBoat(before, item)).toBeNull();
      expect(await addBoat(after, item)).toBeNull();
    });

    it("is free again once the other practice is cancelled or lets the boat go", async () => {
      const day = nextDay();
      const item = await boat("quad");
      const first = await practice({ day, name: "First" });
      await addBoat(first, item);
      const second = await practice({ day, name: "Second", start: T(8, day), end: T(10, day) });
      expect((await addBoat(second, item))?.code).toBe(EXCLUSION_VIOLATION);
      expect(await endBoat(first, item)).toBeNull();
      expect(await addBoat(second, item)).toBeNull();
      const third = await practice({ day, name: "Third", start: T(9, day, 30), end: T(10, day, 30) });
      expect((await addBoat(third, item))?.code).toBe(EXCLUSION_VIOLATION);
      expect(await cancel(second)).toBeNull();
      expect(await addBoat(third, item)).toBeNull();
    });

    it("cannot be reserved by a practice that has been cancelled", async () => {
      const day = nextDay();
      const id = await practice({ day });
      await cancel(id);
      expect((await addBoat(id, await boat("single")))?.message).toMatch(/cancelled practice cannot reserve a boat/);
    });

    it("can be recorded as already ended, without blocking anything", async () => {
      const day = nextDay();
      const item = await boat("single");
      const first = await practice({ day });
      expect(await addBoat(first, item, { endedAt: T(3, 1) })).toBeNull();
      const second = await practice({ day, name: "Second" });
      expect(await addBoat(second, item)).toBeNull();
    });

    it("is only ever ended, once, and never changed or removed", async () => {
      const day = nextDay();
      const id = await practice({ day });
      const item = await boat("single");
      await addBoat(id, item);
      expect((await attempt(`update club.practice_boats set added_by_label='Someone' where practice_id=$1 and item_id=$2`, [id, item]))?.message).toMatch(/can only be ended, once/);
      expect((await attempt(`update club.practice_boats set item_id=$3 where practice_id=$1 and item_id=$2`, [id, item, await boat("single")]))?.message).toMatch(/can only be ended, once/);
      expect(await endBoat(id, item)).toBeNull();
      expect((await attempt(`update club.practice_boats set ended_at=$3 where practice_id=$1 and item_id=$2`, [id, item, T(5, 1)]))?.message).toMatch(/can only be ended, once/);
      expect((await attempt(`delete from club.practice_boats where practice_id=$1`, [id]))?.message).toMatch(/cannot be removed/);
      expect((await attempt(`truncate club.practice_boats`))?.message).toMatch(/cannot be removed/);
    });

    it("needs its ending filled in completely", async () => {
      const day = nextDay();
      const id = await practice({ day });
      const item = await boat("single");
      await addBoat(id, item);
      expect((await attempt(`update club.practice_boats set ended_at=$3 where practice_id=$1 and item_id=$2`, [id, item, T(5, 1)]))?.code).toBe(CHECK_VIOLATION);
    });

    it("cannot come off a practice while someone is still seated in it", async () => {
      const day = nextDay();
      const id = await practice({ day, coach: members.Ben });
      const item = await boat("double");
      await addBoat(id, item);
      expect(await seat(id, item, 1, members.Ada)).toBeNull();
      const failure = await tx(async () => {
        await q(`update club.practice_boats set ended_at=$3, ended_by_kind='staff', ended_by_label='Test staff' where practice_id=$1 and item_id=$2`, [id, item, T(5, 1)]);
      });
      expect(failure?.code).toBe(CHECK_VIOLATION);
      expect(failure?.message).toMatch(/still seated/);
      // Ending the seats in the same change is fine.
      expect(await tx(async () => {
        await q(`update club.practice_boats set ended_at=$3, ended_by_kind='staff', ended_by_label='Test staff' where practice_id=$1 and item_id=$2`, [id, item, T(5, 1)]);
        await q(`update club.practice_seats set ended_at=$3, ended_by_kind='staff', ended_by_label='Test staff', ended_reason='Boat came off' where practice_id=$1 and item_id=$2`, [id, item, T(5, 1)]);
      })).toBeNull();
    });
  });

  describe("bookings and reservations", () => {
    it("a booking on a reserved boat during the practice is refused", async () => {
      const day = nextDay();
      const id = await practice({ day });
      const item = await boat("single");
      await addBoat(id, item);
      expect((await book(item, members.Ada, T(8, day), T(9, day)))?.code).toBe(EXCLUSION_VIOLATION);
      expect((await book(item, members.Ada, T(6, day, 30), T(7, day, 30)))?.code).toBe(EXCLUSION_VIOLATION);
      expect((await book(item, members.Ada, T(8, day), T(9, day)))?.message).toMatch(/reserved for a practice/);
    });

    it("back to back with the practice, a different boat, and a different day are fine", async () => {
      const day = nextDay();
      const id = await practice({ day });
      const item = await boat("single");
      const other = await boat("single");
      await addBoat(id, item);
      expect(await book(item, members.Ada, T(9, day), T(10, day))).toBeNull();
      expect(await book(item, members.Ben, T(6, day), T(7, day))).toBeNull();
      expect(await book(other, members.Cy, T(8, day), T(9, day))).toBeNull();
      expect(await book(item, members.Dee, T(8, day + 1), T(9, day + 1))).toBeNull();
    });

    it("a cancelled practice, or a boat that came off, lets the boat be booked", async () => {
      const day = nextDay();
      const a = await practice({ day });
      const item = await boat("single");
      await addBoat(a, item);
      expect(await endBoat(a, item)).toBeNull();
      expect(await book(item, members.Ada, T(8, day), T(9, day))).toBeNull();
      const day2 = nextDay();
      const b = await practice({ day: day2 });
      const item2 = await boat("single");
      await addBoat(b, item2);
      expect(await cancel(b)).toBeNull();
      expect(await book(item2, members.Ada, T(8, day2), T(9, day2))).toBeNull();
    });

    it("a practice can reserve a boat that already has a booking: the database leaves the flagging to the app", async () => {
      const day = nextDay();
      const item = await boat("single");
      expect(await book(item, members.Ada, T(8, day), T(9, day))).toBeNull();
      const id = await practice({ day });
      expect(await addBoat(id, item)).toBeNull();
    });

    it("two practices asking for the same boat at overlapping times together get it once", async () => {
      const day = nextDay();
      const item = await boat("single");
      const a = await practice({ day, name: "A" });
      const b = await practice({ day, name: "B", start: T(8, day), end: T(10, day) });
      const second = new Client({ connectionString: db.url });
      await second.connect();
      try {
        const other = await second.query(`insert into club.practice_boats (practice_id, item_id, added_at, added_by_kind, added_by_label) values ($1,$2,$3,'staff','Test staff')`, [b, item, T(1, 1)]).then(
          () => null,
          (e: Failure) => e,
        );
        const mine = await addBoat(a, item);
        void other;
        void mine;
      } finally {
        await second.end();
      }
      // Run again, this time truly together on two connections.
      const day2 = nextDay();
      const item2 = await boat("single");
      const c = await practice({ day: day2, name: "C" });
      const d = await practice({ day: day2, name: "D", start: T(8, day2), end: T(10, day2) });
      const conn = new Client({ connectionString: db.url });
      await conn.connect();
      try {
        const insert = (client: { query: typeof q }, practiceId: string) =>
          client
            .query(`insert into club.practice_boats (practice_id, item_id, added_at, added_by_kind, added_by_label) values ($1,$2,$3,'staff','Test staff')`, [practiceId, item2, T(1, 1)])
            .then(() => "in", (e: Failure) => e.code ?? "failed");
        const results = await Promise.all([insert({ query: q }, c), insert(conn, d)]);
        expect(results.filter((r) => r === "in")).toHaveLength(1);
        expect(results.filter((r) => r === EXCLUSION_VIOLATION)).toHaveLength(1);
        expect((await q(`select count(*)::int as n from club.practice_boats where item_id=$1 and ended_at is null`, [item2])).rows[0].n).toBe(1);
      } finally {
        await conn.end();
      }
    });
  });

  describe("a seat in a lineup", () => {
    async function ready(classCode = "quad", coach: string | null = members.Ben) {
      const day = nextDay();
      const id = await practice({ day, coach });
      const item = await boat(classCode);
      expect(await addBoat(id, item)).toBeNull();
      return { id, item };
    }

    it("is accepted with a side, or none, and counted in the order seated", async () => {
      const { id, item } = await ready();
      expect(await seat(id, item, 1, members.Ada, { side: "port" })).toBeNull();
      expect(await seat(id, item, 2, members.Cy, { side: "starboard" })).toBeNull();
      expect(await seat(id, item, 3, members.Dee)).toBeNull();
      const { rows } = await q(`select seat, side, member_id from club.practice_seats where practice_id=$1 order by seq`, [id]);
      expect(rows).toEqual([
        { seat: 1, side: "port", member_id: members.Ada },
        { seat: 2, side: "starboard", member_id: members.Cy },
        { seat: 3, side: null, member_id: members.Dee },
      ]);
    });

    it("must be a real seat of that boat and a real side", async () => {
      const { id, item } = await ready("double");
      expect((await seat(id, item, 3, members.Ada))?.message).toMatch(/only 2 seats/);
      expect((await seat(id, item, 0, members.Ada))?.code).toBe(CHECK_VIOLATION);
      expect((await seat(id, item, 1, members.Ada, { side: "left" }))?.code).toBe(CHECK_VIOLATION);
      expect(await seat(id, item, 2, members.Ada)).toBeNull();
    });

    it("must be in a boat that is on the practice, not another, not one that came off", async () => {
      const { id, item } = await ready("double");
      const stranger = await boat("double");
      expect((await seat(id, stranger, 1, members.Ada))?.code).toBe(CHECK_VIOLATION);
      expect((await seat(id, stranger, 1, members.Ada))?.message).toMatch(/on the practice/);
      expect(await endBoat(id, item)).toBeNull();
      expect((await seat(id, item, 1, members.Ada))?.message).toMatch(/on the practice/);
    });

    it("must be for an active member of an active household", async () => {
      const { id, item } = await ready();
      const gone = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, 'Fay', 'Test', 'fay@example.com', 'additional') returning id`, [household])).rows[0].id;
      await q(`update club.members set status = 'removed' where id = $1`, [gone]);
      expect((await seat(id, item, 1, gone))?.code).toBe(CHECK_VIOLATION);
      expect((await seat(id, item, 1, gone))?.message).toMatch(/Only an active member/);
    });

    it("holds one person per seat and one seat per person, until the line is ended", async () => {
      const { id, item } = await ready();
      expect(await seat(id, item, 1, members.Ada)).toBeNull();
      expect((await seat(id, item, 1, members.Cy))?.code).toBe(UNIQUE_VIOLATION);
      expect((await seat(id, item, 2, members.Ada))?.code).toBe(UNIQUE_VIOLATION);
      expect(await endSeat(id, item, 1)).toBeNull();
      expect(await seat(id, item, 1, members.Cy)).toBeNull();
      expect(await seat(id, item, 2, members.Ada)).toBeNull();
      expect((await q(`select count(*)::int as n from club.practice_seats where practice_id = $1`, [id])).rows[0].n).toBe(3);
    });

    it("lets the same person sit in two different practices", async () => {
      const a = await ready();
      const b = await ready();
      expect(await seat(a.id, a.item, 1, members.Dee)).toBeNull();
      expect(await seat(b.id, b.item, 1, members.Dee)).toBeNull();
    });

    it("cannot be added to a cancelled practice", async () => {
      const { id, item } = await ready();
      expect(await cancel(id)).toBeNull();
      expect((await seat(id, item, 1, members.Ada))?.message).toMatch(/cancelled practice has no lineup/);
    });

    it("is only ended, once, and never changed or removed", async () => {
      const { id, item } = await ready();
      await seat(id, item, 1, members.Ada, { side: "port" });
      expect((await attempt(`update club.practice_seats set side='starboard' where practice_id=$1`, [id]))?.message).toMatch(/can only be ended, once/);
      expect((await attempt(`update club.practice_seats set member_id=$2 where practice_id=$1`, [id, members.Cy]))?.message).toMatch(/can only be ended, once/);
      expect((await attempt(`update club.practice_seats set seat=2 where practice_id=$1`, [id]))?.message).toMatch(/can only be ended, once/);
      expect(await endSeat(id, item, 1)).toBeNull();
      expect((await attempt(`update club.practice_seats set ended_reason='Another' where practice_id=$1`, [id]))?.message).toMatch(/can only be ended, once/);
      expect((await attempt(`delete from club.practice_seats where practice_id=$1`, [id]))?.message).toMatch(/cannot be removed/);
      expect((await attempt(`truncate club.practice_seats`))?.message).toMatch(/cannot be removed/);
    });

    it("needs its ending filled in completely, including why", async () => {
      const { id, item } = await ready();
      await seat(id, item, 1, members.Ada);
      expect((await attempt(`update club.practice_seats set ended_at=$2 where practice_id=$1`, [id, T(5, 1)]))?.code).toBe(CHECK_VIOLATION);
      expect((await attempt(`update club.practice_seats set ended_at=$2, ended_by_kind='staff', ended_by_label='Test staff' where practice_id=$1`, [id, T(5, 1)]))?.code).toBe(CHECK_VIOLATION);
    });

    it("is seated by staff, or by the active coach who runs the practice, and nobody else", async () => {
      const { id, item } = await ready("quad", members.Ben);
      expect(await seat(id, item, 1, members.Ada, { by: "member", byId: members.Ben })).toBeNull();
      expect((await seat(id, item, 2, members.Cy, { by: "member", byId: members.Dee }))?.message).toMatch(/Only the coach who runs a practice/);
      expect((await seat(id, item, 2, members.Cy, { by: "member", byId: members.Ada }))?.message).toMatch(/Only the coach who runs a practice/);
      expect((await seat(id, item, 2, members.Cy, { by: "member", byId: null }))?.message).toMatch(/Only the coach who runs a practice/);
      const staffRun = await ready("quad", null);
      expect((await seat(staffRun.id, staffRun.item, 1, members.Ada, { by: "member", byId: members.Ben }))?.message).toMatch(/Only the coach who runs a practice/);
    });

    it("cannot be added by a coach who is no longer a coach", async () => {
      expect(await markCoach(members.Cy, true)).toBeNull();
      const { id, item } = await ready("quad", members.Cy);
      expect(await seat(id, item, 1, members.Ada, { by: "member", byId: members.Cy })).toBeNull();
      expect(await markCoach(members.Cy, false)).toBeNull();
      expect((await seat(id, item, 2, members.Dee, { by: "member", byId: members.Cy }))?.message).toMatch(/Only the coach who runs a practice/);
      expect(await seat(id, item, 2, members.Dee)).toBeNull();
    });
  });
});
