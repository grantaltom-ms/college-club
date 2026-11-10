import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * Coaches-only boats (the 4x and the 8x) as the DATABASE guards them, tested against a real Postgres (Grant, Nov 10, 2026). The app
 * refuses these bookings first and explains why; this is the second line of defence underneath it. A booking a member makes on a
 * club boat whose class is coaches-only must have an active coach as its booker; staff bookings are never refused for it; a private
 * boat of either size is left to its own list; other classes are untouched. Needs CLUB_TEST_DATABASE_URL (a local or throwaway
 * Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";

type Failure = { code?: string; message: string };

describe.skipIf(!ADMIN_URL)("coaches-only boats in the database", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  const members: Record<string, string> = {};
  const boats: Record<string, string> = {};
  let household = "";
  let ended = "";
  let hour = 0;
  /** A fresh hour for every booking, so no two bookings in these tests ever overlap. */
  const slot = () => {
    hour += 1;
    const start = new Date(Date.UTC(2027, 1, 1) + hour * 3_600_000);
    return [start.toISOString(), new Date(start.getTime() + 3_600_000).toISOString()];
  };

  async function attempt(sql: string, params: unknown[] = []): Promise<Failure | null> {
    try {
      await q(sql, params);
      return null;
    } catch (e) {
      return e as Failure;
    }
  }

  /** Marks a member as a coach the way the app does: the flag and the matching line in the household's file, in one change. */
  async function markCoach(memberId: string, householdId: string, coach: boolean): Promise<void> {
    await q("begin");
    await q(`update club.members set is_coach = $2 where id = $1`, [memberId, coach]);
    await q(`insert into club.household_history (household_id, at, kind, summary, actor_kind, actor_label, details) values ($1, now(), 'coach_changed', 'A coach line', 'staff', 'Test staff', $2)`, [
      householdId,
      JSON.stringify({ memberId, coach: coach ? "yes" : "no" }),
    ]);
    await q("commit");
  }

  const book = (boat: string, booker: string, by: "member" | "staff" = "member") => {
    const [start, end] = slot();
    return attempt(`insert into club.bookings (item_id, booker_id, starts_at, ends_at, created_by_kind, created_by_label) values ($1,$2,$3,$4,$5,'Someone')`, [boats[boat], members[booker], start, end, by]);
  };

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    household = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    for (const [i, name] of ["Ada", "Ben", "Cy"].entries()) {
      members[name] = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Test', $3, $4) returning id`, [household, name, `${name}@example.com`, i === 0 ? "primary" : "additional"])).rows[0].id;
    }
    ended = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Gone household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    members.Dee = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, 'Dee', 'Gone', 'dee@example.com', 'primary') returning id`, [ended])).rows[0].id;
    await q(`insert into club.item_classes (code, booking_type, name, seats, coaches_only) values ('double', 'Shell', 'Double', 2, false), ('quad', 'Shell', 'Quad', 4, true), ('eight', 'Shell', 'Eight', 8, true)`);
    for (const [name, cls, priv] of [["Loon", "double", false], ["Albatross", "quad", false], ["Gull", "eight", false], ["Tern", "quad", true], ["Gannet", "eight", true]] as const) {
      boats[name] = (await q(`insert into club.items (name, class_code, is_private) values ($1, $2, $3) returning id`, [name, cls, priv])).rows[0].id;
    }
    // Ben is a coach; Dee is a coach whose household then ends.
    await markCoach(members.Ben, household, true);
    await markCoach(members.Dee, ended, true);
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("gives every class the flag, off unless it is set", async () => {
    const { rows } = await q(`select column_default, is_nullable from information_schema.columns where table_schema = 'club' and table_name = 'item_classes' and column_name = 'coaches_only'`);
    expect(rows).toEqual([{ column_default: "false", is_nullable: "NO" }]);
  });

  it("refuses a booking a member who is not a coach makes on a 4x or an 8x, as a check failure in words", async () => {
    for (const boat of ["Albatross", "Gull"]) {
      const failure = await book(boat, "Ada");
      expect(failure?.code).toBe(CHECK_VIOLATION);
      expect(failure?.message).toBe("This boat can only be booked by coaches and club staff.");
    }
    expect((await q(`select count(*)::int as n from club.bookings where booker_id = $1`, [members.Ada])).rows[0].n).toBe(0);
  });

  it("lets an active coach book a 4x and an 8x", async () => {
    expect(await book("Albatross", "Ben")).toBeNull();
    expect(await book("Gull", "Ben")).toBeNull();
  });

  it("lets staff book a 4x or an 8x for a member who is not a coach", async () => {
    expect(await book("Albatross", "Cy", "staff")).toBeNull();
    expect(await book("Gull", "Cy", "staff")).toBeNull();
  });

  it("leaves other classes alone: a member who is not a coach books a double", async () => {
    expect(await book("Loon", "Ada")).toBeNull();
  });

  it("leaves a private 4x or 8x to its own list, whatever the size", async () => {
    // Ada is not a coach. Whether she may book a private boat is the private-boat rule's business (its own list), not this one's;
    // the private-boat guard needs her on the list, so put her there first.
    for (const boat of ["Tern", "Gannet"]) {
      await q(`insert into club.item_access (item_id, member_id, kind, added_at, added_by_kind, added_by_label) values ($1, $2, 'owner', now(), 'staff', 'Test staff')`, [boats[boat], members.Ada]);
      expect(await book(boat, "Ada")).toBeNull();
    }
  });

  it("refuses a coach who has been unmarked, and keeps the bookings they already made", async () => {
    const before = (await q(`select count(*)::int as n from club.bookings where booker_id = $1`, [members.Ben])).rows[0].n;
    await markCoach(members.Ben, household, false);
    expect((await book("Albatross", "Ben"))?.code).toBe(CHECK_VIOLATION);
    expect((await q(`select count(*)::int as n from club.bookings where booker_id = $1 and status = 'upcoming'`, [members.Ben])).rows[0].n).toBe(before);
    await markCoach(members.Ben, household, true);
    expect(await book("Albatross", "Ben")).toBeNull();
  });

  it("refuses a coach whose household has ended", async () => {
    expect(await book("Gull", "Dee")).toBeNull();
    // The database's own way to end a household (it also cancels Dee's future bookings, as the app does).
    await q(`select club.end_household($1, '2027-01-15', 'staff', null, 'Test staff', '2027-01-15T12:00:00Z')`, [ended]);
    expect((await book("Gull", "Dee"))?.code).toBe(CHECK_VIOLATION);
  });
});
