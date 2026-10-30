import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * Private boats as the DATABASE guards them, tested against a real Postgres: a boat is private from the day it is made or
 * never, only a private boat has a list, the list is only added to and ended once (never removed), a person is on a boat's
 * list once at a time, owners are named by staff, an invitation by a member needs that member to be an owner, and nobody can
 * book or sit in a private boat unless they are on its list (and not at all while it has no owner). Needs
 * CLUB_TEST_DATABASE_URL (a local or throwaway Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const RAISED = "P0001";

type Failure = { code?: string; message: string };

describe.skipIf(!ADMIN_URL)("private boats", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  const members: Record<string, string> = {};
  let n = 0;
  const T = (hh: number, day = 29) => new Date(Date.UTC(2026, 9, day, hh)).toISOString();

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    const household = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    for (const [i, name] of ["Ada", "Ben", "Cy", "Dee"].entries()) {
      members[name] = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Test', $3, $4) returning id`, [household, name, `${name}@example.com`, i === 0 ? "primary" : "additional"])).rows[0].id;
    }
    await q(`insert into club.item_classes (code, booking_type, name, seats) values ('single', 'Shell', 'Single', 1), ('double', 'Shell', 'Double', 2)`);
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

  async function boat(isPrivate = true, classCode = "single"): Promise<string> {
    n += 1;
    return (await q(`insert into club.items (name, class_code, is_private) values ($1, $2, $3) returning id`, [`Boat ${n}`, classCode, isPrivate])).rows[0].id;
  }

  type Line = Partial<{ item: string; member: string; kind: string; addedByKind: string; addedById: string | null; addedBy: string; at: string }>;
  const addLine = (f: Line) =>
    attempt(
      `insert into club.item_access (item_id, member_id, kind, added_at, added_by_kind, added_by_id, added_by_label) values ($1,$2,$3,$4,$5,$6,$7)`,
      [f.item, f.member, f.kind ?? "owner", f.at ?? T(10), f.addedByKind ?? "staff", f.addedById === undefined ? null : f.addedById, f.addedBy ?? "Test staff"],
    );
  async function owner(item: string, member: string) {
    expect(await addLine({ item, member, kind: "owner" })).toBeNull();
  }
  async function invite(item: string, member: string, by: string = members.Ada) {
    expect(await addLine({ item, member, kind: "invited", addedByKind: "member", addedById: by, addedBy: "An Owner" })).toBeNull();
  }
  const lineId = async (item: string, member: string) => (await q(`select id from club.item_access where item_id = $1 and member_id = $2 order by seq desc limit 1`, [item, member])).rows[0].id as string;
  const endLine = (id: string, at = T(11)) => attempt(`update club.item_access set ended_at=$2, ended_by_kind='staff', ended_by_label='Test staff', ended_reason='Taken off' where id=$1`, [id, at]);
  const bookIt = (item: string, booker: string, hour = 14) =>
    attempt(`insert into club.bookings (item_id, booker_id, starts_at, ends_at, created_by_kind, created_by_label) values ($1,$2,$3,$4,'member','A Member')`, [item, booker, T(hour), T(hour + 1)]);

  describe("a boat is private from the day it is made, or never", () => {
    it("starts as a club boat unless it is made private", async () => {
      const club = await boat(false);
      const priv = await boat(true);
      const { rows } = await q(`select id, is_private from club.items where id = any($1)`, [[club, priv]]);
      expect(Object.fromEntries(rows.map((r) => [r.id, r.is_private]))).toEqual({ [club]: false, [priv]: true });
      n += 1;
      expect((await q(`insert into club.items (name, class_code) values ($1, 'single') returning is_private`, [`Boat ${n}`])).rows[0].is_private).toBe(false);
    });

    it("cannot turn private, or stop being private, afterwards", async () => {
      const club = await boat(false);
      const priv = await boat(true);
      expect((await attempt(`update club.items set is_private = true where id = $1`, [club]))?.message).toMatch(/cannot turn private/);
      expect((await attempt(`update club.items set is_private = false where id = $1`, [priv]))?.message).toMatch(/cannot turn private/);
      // Other changes to the boat are fine, and a save that names the same value changes nothing.
      expect(await attempt(`update club.items set rule_overrides = '{"maxMinutes": 90}'::jsonb, is_private = true where id = $1`, [priv])).toBeNull();
    });
  });

  describe("a line on a boat's list", () => {
    it("is accepted for a private boat, with who added it and when, and counted in the order added", async () => {
      const item = await boat();
      await owner(item, members.Ada);
      await invite(item, members.Ben);
      const { rows } = await q(`select kind, added_by_kind, added_by_id, added_by_label, ended_at from club.item_access where item_id = $1 order by seq`, [item]);
      expect(rows).toEqual([
        { kind: "owner", added_by_kind: "staff", added_by_id: null, added_by_label: "Test staff", ended_at: null },
        { kind: "invited", added_by_kind: "member", added_by_id: members.Ada, added_by_label: "An Owner", ended_at: null },
      ]);
    });

    it("is refused for an invitation by a member who is not named, before it is even looked at", async () => {
      const item = await boat();
      await owner(item, members.Ada);
      const failure = await addLine({ item, member: members.Ben, kind: "invited", addedByKind: "member", addedById: null });
      expect(failure).not.toBeNull();
      expect((await q(`select count(*)::int as n from club.item_access where item_id = $1`, [item])).rows[0].n).toBe(1);
    });

    it("is refused for a club boat", async () => {
      const club = await boat(false);
      expect((await addLine({ item: club, member: members.Ada }))?.message).toMatch(/Only a private boat has a list/);
      expect((await q(`select count(*)::int as n from club.item_access where item_id = $1`, [club])).rows[0].n).toBe(0);
    });

    it.each([
      ["a kind that is not owner or invited", { kind: "captain" }],
      ["an adder that is neither staff nor a member", { kind: "invited", addedByKind: "system" }],
      ["a member adder with no member named", { kind: "owner", addedByKind: "member", addedById: null }],
      ["a staff adder that names a member", { addedById: "x" }],
      ["an adder with no name", { addedBy: "" }],
      ["an owner added by a member", { kind: "owner", addedByKind: "member", addedById: "x" }],
    ])("refuses %s", async (_what, over) => {
      const item = await boat();
      const failure = await addLine({ item, member: members.Ada, ...over });
      expect(failure?.code).toBe(CHECK_VIOLATION);
    });

    it("puts a person on a boat's list once at a time, but lets them back on after they are taken off", async () => {
      const item = await boat();
      await owner(item, members.Ada);
      expect((await addLine({ item, member: members.Ada, kind: "owner" }))?.code).toBe(UNIQUE_VIOLATION);
      expect((await addLine({ item, member: members.Ada, kind: "invited", addedByKind: "staff" }))?.code).toBe(UNIQUE_VIOLATION);
      await owner(item, members.Ben); // another person, fine
      await owner(await boat(), members.Ada); // another boat, fine
      expect(await endLine(await lineId(item, members.Ada))).toBeNull();
      expect(await addLine({ item, member: members.Ada, kind: "invited", addedByKind: "staff" })).toBeNull();
      expect((await q(`select count(*)::int as n from club.item_access where item_id = $1 and member_id = $2`, [item, members.Ada])).rows[0].n).toBe(2);
    });
  });

  describe("an invitation by a member", () => {
    it("needs that member to be an owner of that boat right now", async () => {
      const item = await boat();
      await owner(item, members.Ada);
      await invite(item, members.Ben, members.Ada);
      const notOwner = await addLine({ item, member: members.Cy, kind: "invited", addedByKind: "member", addedById: members.Dee });
      expect(notOwner?.message).toMatch(/Only an owner of the boat, or club staff, can invite/);
      // Someone who is only invited cannot invite either.
      expect((await addLine({ item, member: members.Cy, kind: "invited", addedByKind: "member", addedById: members.Ben }))?.message).toMatch(/Only an owner/);
      // An owner of a different boat is not an owner of this one.
      const other = await boat();
      await owner(other, members.Dee);
      expect((await addLine({ item, member: members.Cy, kind: "invited", addedByKind: "member", addedById: members.Dee }))?.message).toMatch(/Only an owner/);
      // An owner who has been taken off can no longer invite.
      expect(await endLine(await lineId(item, members.Ada))).toBeNull();
      expect((await addLine({ item, member: members.Cy, kind: "invited", addedByKind: "member", addedById: members.Ada }))?.message).toMatch(/Only an owner/);
    });

    it("is accepted from staff whoever the owners are", async () => {
      const item = await boat();
      expect(await addLine({ item, member: members.Cy, kind: "invited", addedByKind: "staff" })).toBeNull();
    });
  });

  describe("the list is only added to and ended, once", () => {
    it("ends a line with who ended it, when and why, and keeps everything else exactly as it was", async () => {
      const item = await boat();
      await owner(item, members.Ada);
      const id = await lineId(item, members.Ada);
      expect(await endLine(id, T(12))).toBeNull();
      const { rows } = await q(`select kind, added_by_label, ended_at, ended_by_kind, ended_by_label, ended_reason from club.item_access where id = $1`, [id]);
      expect(rows[0]).toMatchObject({ kind: "owner", added_by_label: "Test staff", ended_by_kind: "staff", ended_by_label: "Test staff", ended_reason: "Taken off" });
      expect(new Date(rows[0].ended_at).toISOString()).toBe(T(12));
    });

    it("cannot be ended twice, or changed in any other way", async () => {
      const item = await boat();
      await owner(item, members.Ada);
      const id = await lineId(item, members.Ada);
      for (const change of [
        `kind = 'invited'`,
        `member_id = '${members.Ben}'`,
        `item_id = '${await boat()}'`,
        `added_at = added_at + interval '1 hour'`,
        `added_by_label = 'Someone else'`,
        `added_by_kind = 'member', added_by_id = '${members.Ada}'`,
        `id = '${randomUUID()}'`,
      ]) {
        expect((await attempt(`update club.item_access set ${change} where id = $1`, [id]))?.message, change).toMatch(/cannot be changed/);
      }
      expect(await endLine(id)).toBeNull();
      expect((await endLine(id, T(13)))?.message).toMatch(/cannot be changed/);
      expect((await attempt(`update club.item_access set ended_reason = 'A different reason' where id = $1`, [id]))?.message).toMatch(/cannot be changed/);
    });

    it("cannot be changed in the same step that ends it", async () => {
      const item = await boat();
      await owner(item, members.Ada);
      const id = await lineId(item, members.Ada);
      const ending = `ended_at = $2, ended_by_kind = 'staff', ended_by_label = 'Test staff', ended_reason = 'Taken off'`;
      for (const change of [
        `kind = 'invited'`,
        `member_id = '${members.Ben}'`,
        `item_id = '${await boat()}'`,
        `added_at = added_at + interval '1 hour'`,
        `added_by_label = 'Someone else'`,
        `added_by_kind = 'member', added_by_id = '${members.Ada}'`,
      ]) {
        expect((await attempt(`update club.item_access set ${ending}, ${change} where id = $1`, [id, T(12)]))?.message, change).toMatch(/cannot be changed/);
      }
      expect((await q(`select ended_at from club.item_access where id = $1`, [id])).rows[0].ended_at).toBeNull();
      expect(await endLine(id)).toBeNull();
    });

    it("refuses an end with a missing piece, or before the line began", async () => {
      const item = await boat();
      await owner(item, members.Ada);
      const id = await lineId(item, members.Ada);
      expect((await attempt(`update club.item_access set ended_at = $2 where id = $1`, [id, T(11)]))?.code).toBe(CHECK_VIOLATION);
      expect((await attempt(`update club.item_access set ended_at = $2, ended_by_kind='staff', ended_by_label='x' where id = $1`, [id, T(11)]))?.code).toBe(CHECK_VIOLATION);
      expect((await attempt(`update club.item_access set ended_at = $2, ended_by_kind='member', ended_by_label='x', ended_reason='y' where id = $1`, [id, T(11)]))?.code).toBe(CHECK_VIOLATION);
      expect((await endLine(id, T(9)))?.code).toBe(CHECK_VIOLATION); // the line was added at 10:00
      expect(await endLine(id, T(10))).toBeNull(); // ended the moment it began is allowed
    });

    it("is never removed, and the whole list cannot be emptied", async () => {
      const item = await boat();
      await owner(item, members.Ada);
      expect((await attempt(`delete from club.item_access where item_id = $1`, [item]))?.message).toMatch(/cannot be removed/);
      expect((await attempt(`truncate club.item_access`))?.message).toMatch(/cannot be removed/);
      expect((await q(`select count(*)::int as n from club.item_access where item_id = $1`, [item])).rows[0].n).toBe(1);
    });
  });

  describe("who may book and sit in a private boat", () => {
    it("lets an owner and an invited person book it, and nobody else", async () => {
      const item = await boat();
      await owner(item, members.Ada);
      await invite(item, members.Ben);
      expect(await bookIt(item, members.Ada, 8)).toBeNull();
      expect(await bookIt(item, members.Ben, 10)).toBeNull();
      const stranger = await bookIt(item, members.Cy, 12);
      expect(stranger?.code).toBe(RAISED);
      expect(stranger?.message).toMatch(/Only the owners of a private boat/);
      expect((await q(`select count(*)::int as n from club.bookings where item_id = $1`, [item])).rows[0].n).toBe(2);
    });

    it("refuses someone who has been taken off", async () => {
      const item = await boat();
      await owner(item, members.Ada);
      await invite(item, members.Ben);
      expect(await endLine(await lineId(item, members.Ben))).toBeNull();
      expect((await bookIt(item, members.Ben))?.message).toMatch(/Only the owners of a private boat/);
    });

    it("refuses everyone, an invited person too, while the boat has no owner on its list", async () => {
      const noOwner = await boat();
      await invite(noOwner, members.Ben, members.Ada).catch(() => undefined);
      expect((await bookIt(noOwner, members.Ada))?.message).toMatch(/has no owner right now/);
      const item = await boat();
      await owner(item, members.Ada);
      await invite(item, members.Ben);
      expect(await bookIt(item, members.Ben, 8)).toBeNull();
      expect(await endLine(await lineId(item, members.Ada))).toBeNull();
      expect((await bookIt(item, members.Ben, 10))?.message).toMatch(/has no owner right now/);
      // Staff add an owner, and booking opens again.
      await owner(item, members.Cy);
      expect(await bookIt(item, members.Ben, 10)).toBeNull();
    });

    it("leaves club boats alone", async () => {
      const club = await boat(false);
      expect(await bookIt(club, members.Cy)).toBeNull();
    });

    it("lets only the people on the list sit in the other seats of a private boat", async () => {
      const item = await boat(true, "double");
      await owner(item, members.Ada);
      await invite(item, members.Ben);
      const booking = (await q(`insert into club.bookings (item_id, booker_id, starts_at, ends_at, created_by_kind, created_by_label) values ($1,$2,$3,$4,'member','A Member') returning id`, [item, members.Ada, T(8), T(9)])).rows[0].id;
      const seat = (member: string) => attempt(`insert into club.booking_crew (booking_id, member_id) values ($1, $2)`, [booking, member]);
      expect((await seat(members.Cy))?.message).toMatch(/Only the owners of a private boat, and people an owner has invited, can be in it/);
      expect(await seat(members.Ben)).toBeNull();
    });

    it("refuses someone who has been taken off, even though they were once on the list, in the other seats", async () => {
      const item = await boat(true, "double");
      await owner(item, members.Ada);
      await invite(item, members.Ben);
      expect(await endLine(await lineId(item, members.Ben))).toBeNull();
      const booking = (await q(`insert into club.bookings (item_id, booker_id, starts_at, ends_at, created_by_kind, created_by_label) values ($1,$2,$3,$4,'member','A Member') returning id`, [item, members.Ada, T(8), T(9)])).rows[0].id;
      expect((await attempt(`insert into club.booking_crew (booking_id, member_id) values ($1, $2)`, [booking, members.Ben]))?.message).toMatch(/can be in it/);
    });

    it("lets anyone sit in a club boat", async () => {
      const item = await boat(false, "double");
      const booking = (await q(`insert into club.bookings (item_id, booker_id, starts_at, ends_at, created_by_kind, created_by_label) values ($1,$2,$3,$4,'member','A Member') returning id`, [item, members.Ada, T(8), T(9)])).rows[0].id;
      expect(await attempt(`insert into club.booking_crew (booking_id, member_id) values ($1, $2)`, [booking, members.Cy])).toBeNull();
    });
  });
});
