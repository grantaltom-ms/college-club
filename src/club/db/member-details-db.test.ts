import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HISTORY_KINDS } from "../types";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * Correcting a person's details as the DATABASE guards it, tested against a real Postgres: a name, email or phone cannot
 * change without a matching line in the household's file (written at the same moment, saying what it was and what it is
 * now), and an adult who has left, or whose membership ended, cannot be edited at all. Needs CLUB_TEST_DATABASE_URL (a
 * local or throwaway Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";

type Step = [sql: string, params?: unknown[]];

describe.skipIf(!ADMIN_URL)("correcting a person's details", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  let n = 0;

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
  });
  afterAll(async () => {
    await db?.drop();
  });

  /** Runs the steps as one change. Returns the error (from a step or from the commit, where the deferred rules are checked), or null. */
  async function change(steps: Step[]): Promise<{ code?: string; message: string } | null> {
    await q("begin");
    try {
      for (const [sql, params] of steps) await q(sql, params ?? []);
      await q("commit");
      return null;
    } catch (e) {
      await q("rollback").catch(() => undefined);
      return e as { code?: string; message: string };
    }
  }

  async function household(): Promise<{ hh: string; ada: string; ben: string }> {
    n += 1;
    const hh = (await q(`insert into club.households (display_name, membership_type, joined_on) values ($1, 'Resident', '2020-01-01') returning id`, [`The Test ${n} household`])).rows[0].id;
    const add = async (first: string, role: string) => (await q(`insert into club.members (household_id, first_name, last_name, email, phone, role) values ($1, $2, 'Test', $3, '206-555-0101', $4) returning id`, [hh, first, `${first.toLowerCase()}${n}@example.com`, role])).rows[0].id;
    return { hh, ada: await add("Ada", "primary"), ben: await add("Ben", "additional") };
  }

  const line = (hh: string, member: string, details: Record<string, string>, kind = "member_updated") =>
    [
      `insert into club.household_history (household_id, kind, summary, actor_kind, actor_label, details) values ($1, $2, 'Details changed.', 'staff', 'Test staff', $3)`,
      [hh, kind, JSON.stringify({ memberId: member, ...details })],
    ] as Step;
  const memberRow = async (id: string) => (await q(`select first_name, last_name, email, phone from club.members where id = $1`, [id])).rows[0];

  it("lets the household's file hold a line of the new kind, and the kinds match the app's list", async () => {
    const { rows } = await q(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'household_history_kind_check'`);
    expect([...rows[0].def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...HISTORY_KINDS].sort());
    expect(HISTORY_KINDS).toContain("member_updated");
  });

  it("accepts a change of email, name or phone when a matching line is written in the same change, before or after", async () => {
    const { hh, ada } = await household();
    const was = (await memberRow(ada)).email;
    expect(await change([line(hh, ada, { emailFrom: was, emailTo: "ada.new@example.com" }), [`update club.members set email = 'ada.new@example.com' where id = $1`, [ada]]])).toBeNull();
    expect(await change([[`update club.members set first_name = 'Adaline', last_name = 'Test-Reed', phone = '' where id = $1`, [ada]], line(hh, ada, { firstNameFrom: "Ada", firstNameTo: "Adaline", lastNameFrom: "Test", lastNameTo: "Test-Reed", phoneFrom: "206-555-0101", phoneTo: "" })])).toBeNull();
    expect(await memberRow(ada)).toMatchObject({ first_name: "Adaline", last_name: "Test-Reed", email: "ada.new@example.com", phone: "" });
  });

  it("refuses a change of any of the four details with no line at all, and leaves the person as they were", async () => {
    const { ada } = await household();
    const before = await memberRow(ada);
    for (const set of [`first_name = 'Adaline'`, `last_name = 'Other'`, `email = 'other@example.com'`, `phone = '555'`, `email = 'upper@Example.com'`]) {
      const failed = await change([[`update club.members set ${set} where id = $1`, [ada]]]);
      expect(failed?.code, set).toBe(CHECK_VIOLATION);
      expect(failed?.message, set).toContain("cannot change without a matching line");
    }
    expect(await memberRow(ada)).toEqual(before);
  });

  it("refuses a line that does not say the same thing: another kind, another person, another household, wrong values, or a missing detail", async () => {
    const { hh, ada, ben } = await household();
    const other = await household();
    const was = await memberRow(ada);
    const update: Step = [`update club.members set email = 'new@example.com', phone = '555' where id = $1`, [ada]];
    const right = { emailFrom: was.email, emailTo: "new@example.com", phoneFrom: was.phone, phoneTo: "555" };
    const bad: [string, Step][] = [
      ["another kind of line", line(hh, ada, right, "type_changed")],
      ["a line about another person", line(hh, ben, right)],
      ["a line in another household's file", line(other.hh, ada, right)],
      ["a line with no person", [`insert into club.household_history (household_id, kind, summary, actor_kind, actor_label, details) values ($1, 'member_updated', 'x', 'staff', 'Test staff', $2)`, [hh, JSON.stringify(right)]]],
      ["the wrong new email", line(hh, ada, { ...right, emailTo: "someone.else@example.com" })],
      ["the wrong old email", line(hh, ada, { ...right, emailFrom: "not.what.it.was@example.com" })],
      ["the wrong new phone", line(hh, ada, { ...right, phoneTo: "999" })],
      ["the wrong old phone", line(hh, ada, { ...right, phoneFrom: "000" })],
      ["a line that leaves out the phone", line(hh, ada, { emailFrom: was.email, emailTo: "new@example.com" })],
      ["a line that leaves out the email", line(hh, ada, { phoneFrom: was.phone, phoneTo: "555" })],
    ];
    for (const [what, lineStep] of bad) {
      const failed = await change([lineStep, update]);
      expect(failed?.code, what).toBe(CHECK_VIOLATION);
    }
    expect(await memberRow(ada)).toEqual(was);
    expect(await change([line(hh, ada, right), update])).toBeNull();
  });

  it("checks a name the same way: the line must say what each part of the name was and what it is now", async () => {
    const { hh, ada } = await household();
    const was = await memberRow(ada);
    const update: Step = [`update club.members set first_name = 'Adaline', last_name = 'Reed' where id = $1`, [ada]];
    const right = { firstNameFrom: was.first_name, firstNameTo: "Adaline", lastNameFrom: was.last_name, lastNameTo: "Reed" };
    const bad: [string, Record<string, string>][] = [
      ["the wrong new first name", { ...right, firstNameTo: "Addie" }],
      ["the wrong old first name", { ...right, firstNameFrom: "Nobody" }],
      ["the wrong new last name", { ...right, lastNameTo: "Other" }],
      ["the wrong old last name", { ...right, lastNameFrom: "Nobody" }],
      ["no first name at all", { lastNameFrom: was.last_name, lastNameTo: "Reed" }],
      ["no last name at all", { firstNameFrom: was.first_name, firstNameTo: "Adaline" }],
    ];
    for (const [what, details] of bad) expect((await change([line(hh, ada, details), update]))?.code, what).toBe(CHECK_VIOLATION);
    expect(await memberRow(ada)).toEqual(was);
    expect(await change([line(hh, ada, right), update])).toBeNull();
    expect(await memberRow(ada)).toMatchObject({ first_name: "Adaline", last_name: "Reed" });
  });

  it("needs a line of its own for every change in one step, and accepts the pair when both are written", async () => {
    const { hh, ada } = await household();
    const was = await memberRow(ada);
    const first: Step = [`update club.members set phone = '111' where id = $1`, [ada]];
    const second: Step = [`update club.members set phone = '222' where id = $1`, [ada]];
    const l1 = line(hh, ada, { phoneFrom: was.phone, phoneTo: "111" });
    const l2 = line(hh, ada, { phoneFrom: "111", phoneTo: "222" });
    expect((await change([l1, first, second]))?.code).toBe(CHECK_VIOLATION);
    expect(await change([l1, first, l2, second])).toBeNull();
    expect((await memberRow(ada)).phone).toBe("222");
  });

  it("does not ask for a line when nothing about the person's details changes", async () => {
    const { ada, ben } = await household();
    // The app saves the whole row whenever anything on it changes (a first sign-in fills the login slot, a role changes), so an
    // update that names the details without changing them must pass.
    const loginId = "00000000-0000-4000-8000-0000000000aa";
    expect(await change([[`update club.members set first_name = first_name, last_name = last_name, email = email, phone = phone, login_id = $2 where id = $1`, [ada, loginId]]])).toBeNull();
    expect(await change([[`update club.members set role = 'primary' where id = $1`, [ben]]])).toBeTruthy(); // one primary at a time: an unrelated rule still holds
    expect(await change([[`update club.members set brivo_credential_id = 'brivo-${n}', mailchimp_contact_id = 'mc-${n}' where id = $1`, [ada]]])).toBeNull();
  });

  it("closes the file on someone who has left or whose membership ended, in every one of the four details, even with a line", async () => {
    const left = await household();
    await q(`update club.members set status = 'removed' where id = $1`, [left.ben]);
    const was = await memberRow(left.ben);
    const columns = { first_name: ["firstName", "Benedict"], last_name: ["lastName", "Other"], email: ["email", "ben.later@example.com"], phone: ["phone", "555"] } as const;
    for (const [column, [key, value]] of Object.entries(columns)) {
      const failed = await change([
        line(left.hh, left.ben, { [`${key}From`]: was[column], [`${key}To`]: value }),
        [`update club.members set ${column} = $2 where id = $1`, [left.ben, value]],
      ]);
      expect(failed?.message, column).toContain("cannot be changed");
    }
    expect(await memberRow(left.ben)).toEqual(was);

    const ended = await household();
    await q(`update club.members set status = 'household_ended' where household_id = $1`, [ended.hh]);
    await q(`update club.households set status = 'ended', ended_on = '2026-10-23' where id = $1`, [ended.hh]);
    const wasEnded = await memberRow(ended.ada);
    for (const [column, [key, value]] of Object.entries(columns)) {
      const failedEnded = await change([
        line(ended.hh, ended.ada, { [`${key}From`]: wasEnded[column], [`${key}To`]: value }),
        [`update club.members set ${column} = $2 where id = $1`, [ended.ada, value]],
      ]);
      expect(failedEnded?.message, column).toContain("cannot be changed");
    }
    expect(await memberRow(ended.ada)).toEqual(wasEnded);
  });

  it("still lets an adult who has left be marked as left, and keeps every earlier rule", async () => {
    const { ada, ben } = await household();
    expect(await change([[`update club.members set status = 'removed' where id = $1`, [ben]]])).toBeNull();
    expect((await change([[`update club.members set status = 'active' where id = $1`, [ben]]]))?.message).toContain("cannot be made active again");
    expect((await change([[`update club.members set household_id = (select id from club.households where id <> (select household_id from club.members where id = $1) limit 1) where id = $1`, [ada]]]))?.message).toContain("cannot be moved");
  });
});
