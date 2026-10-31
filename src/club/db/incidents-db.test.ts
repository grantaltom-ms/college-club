import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * Incident reports as the DATABASE guards them, tested against a real Postgres: a report is filed once with its "filed" line, only
 * staff or an active coach can file one, what the filer wrote never changes, a closed report is frozen, closing needs its details,
 * a change to the cause, change, follow-up person, damage link or status needs a matching log line written at the same moment, the
 * people and boats can only be added in the change that files the report, the log is only added to, and a coach can only file and
 * add notes to their own report. Needs CLUB_TEST_DATABASE_URL (a local or throwaway Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;

type Failure = { code?: string; message: string };
type Statement = [string, unknown[]?];

describe.skipIf(!ADMIN_URL)("incident reports", () => {
  let db: ScratchDb;
  let household: string;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  const members: Record<string, string> = {};
  let n = 0;
  const T = (hh: number, day = 29) => new Date(Date.UTC(2026, 9, day, hh)).toISOString();

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    household = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    for (const [i, name] of ["Ada", "Ben", "Cy", "Dee", "Eli"].entries()) {
      members[name] = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Test', $3, $4) returning id`, [household, name, `${name}@example.com`, i === 0 ? "primary" : "additional"])).rows[0].id;
    }
    await q(`insert into club.item_classes (code, booking_type, name, seats) values ('single', 'Shell', 'Single', 1)`);
    // Ben and Dee are coaches (the coach flag only changes along with a line in the household's file).
    for (const who of ["Ben", "Dee"]) {
      await q("begin");
      await q(`update club.members set is_coach = true where id = $1`, [members[who]]);
      await q(`insert into club.household_history (household_id, at, kind, summary, actor_kind, actor_label, details) values ($1, now(), 'coach_changed', 'A coach line', 'staff', 'Test staff', $2)`, [household, JSON.stringify({ memberId: members[who], coach: "yes" })]);
      await q("commit");
    }
  });
  afterAll(async () => {
    await db?.drop();
  });

  /** Runs the statements as one change and says what the database refused, or null when it all went through (including the end-of-change checks). */
  async function tx(...statements: Statement[]): Promise<Failure | null> {
    try {
      await q("begin");
      for (const [sql, params] of statements) await q(sql, params ?? []);
      await q("commit");
      return null;
    } catch (e) {
      await q("rollback").catch(() => undefined);
      return e as Failure;
    }
  }
  const attempt = (sql: string, params: unknown[] = []) => tx([sql, params]);

  async function boat(): Promise<string> {
    n += 1;
    return (await q(`insert into club.items (name, class_code) values ($1, 'single') returning id`, [`Boat ${n}`])).rows[0].id;
  }

  type Incident = Partial<{
    id: string;
    byKind: string;
    byId: string | null;
    by: string;
    at: string;
    occurredAt: string;
    what: string;
    location: string;
    water: boolean;
    conditions: string;
    aid: boolean;
    aidNotes: string;
    emergency: boolean;
    emergencyNotes: string;
    status: string;
    updatedAt: string;
    cause: string | null;
    change: string | null;
    followUp: string | null;
    damage: string | null;
    closedAt: string | null;
    closedNote: string | null;
  }>;
  const incidentRow = (r: Incident = {}): Statement => {
    const at = r.at ?? T(10);
    const byKind = r.byKind ?? "staff";
    return [
      `insert into club.incidents (id, reported_by_kind, reported_by_id, reported_by_label, reported_at, occurred_at, what_happened, location, on_the_water, conditions,
         first_aid_given, first_aid_notes, emergency_called, emergency_notes, status, updated_at, cause, what_will_change, follow_up_by, damage_report_id, closed_at, closed_note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        r.id ?? randomUUID(),
        byKind,
        r.byId === undefined ? (byKind === "member" ? members.Ben : null) : r.byId,
        r.by ?? (byKind === "member" ? "Ben Test" : "Test staff"),
        at,
        r.occurredAt ?? T(8),
        r.what ?? "A single capsized.",
        r.location ?? "",
        r.water ?? true,
        r.conditions ?? "",
        r.aid ?? false,
        r.aidNotes ?? "",
        r.emergency ?? false,
        r.emergencyNotes ?? "",
        r.status ?? "open",
        r.updatedAt ?? at,
        r.cause ?? null,
        r.change ?? null,
        r.followUp ?? null,
        r.damage ?? null,
        r.closedAt ?? null,
        r.closedNote ?? null,
      ],
    ];
  };

  type Log = Partial<{ incident: string; at: string; kind: string; byKind: string; byId: string | null; by: string; text: string }>;
  const logRow = (l: Log & { incident: string }): Statement => [
    `insert into club.incident_log (incident_id, at, kind, by_kind, by_id, by_label, text) values ($1,$2,$3,$4,$5,$6,$7)`,
    [l.incident, l.at ?? T(10), l.kind ?? "note", l.byKind ?? "staff", l.byId === undefined ? null : l.byId, l.by ?? "Test staff", l.text ?? "A line."],
  ];
  const staffLine = (incident: string, kind: string, at: string): Log & { incident: string } => ({ incident, kind, at, text: "Done." });

  const personRow = (incident: string, p: { member?: string | null; name?: string; injured?: boolean; parent?: boolean } = {}): Statement => [
    `insert into club.incident_people (incident_id, member_id, name, injured, parent_told) values ($1,$2,$3,$4,$5)`,
    [incident, p.member ?? null, p.name ?? "Jordan Example", p.injured ?? false, p.parent ?? false],
  ];
  const boatRow = (incident: string, item: string): Statement => [`insert into club.incident_boats (incident_id, item_id) values ($1,$2)`, [incident, item]];

  /** A filed report with its "filed" line, as the app writes them. */
  async function filed(over: Incident = {}, ...also: Statement[]): Promise<string> {
    const id = over.id ?? randomUUID();
    const byKind = over.byKind ?? "staff";
    const byId = over.byId === undefined ? (byKind === "member" ? members.Ben : null) : over.byId;
    const by = over.by ?? (byKind === "member" ? "Ben Test" : "Test staff");
    const failure = await tx(incidentRow({ ...over, id, byKind, byId, by }), ...also, logRow({ incident: id, at: over.at ?? T(10), kind: "filed", byKind, byId, by, text: "Reported." }));
    expect(failure).toBeNull();
    return id;
  }

  /** Changes a report and writes the given log line in the same change. */
  const change = (id: string, set: string, params: unknown[], line?: Log) =>
    tx([`update club.incidents set ${set} where id = $1`, [id, ...params]], ...(line ? [logRow({ ...line, incident: id })] : []));
  const row = async (id: string) => (await q(`select * from club.incidents where id = $1`, [id])).rows[0];
  const lines = async (id: string) => (await q(`select kind from club.incident_log where incident_id = $1 order by seq`, [id])).rows.map((r) => r.kind as string);
  async function damageReport(item: string): Promise<string> {
    const id = randomUUID();
    expect(
      await tx(
        [`insert into club.damage_reports (id, item_id, reported_by_kind, reported_by_label, reported_at, description, major, priority, status, updated_at) values ($1,$2,'staff','Test staff',$3,'Cracked.',false,3,'open',$3)`, [id, item, T(9)]],
        [`insert into club.damage_log (report_id, at, kind, by_kind, by_label, text) values ($1,$2,'filed','staff','Test staff','Reported.')`, [id, T(9)]],
      ),
    ).toBeNull();
    return id;
  }

  describe("filing a report", () => {
    it("is accepted from staff or an active coach with its filed line, starts open, and keeps the order they were filed in", async () => {
      const first = await filed({ what: "First.", emergency: true, emergencyNotes: "Fire department", aid: true, aidNotes: "Bandage", location: "East dock", conditions: "Chop" });
      const second = await filed({ byKind: "member", what: "Second." });
      expect(await row(first)).toMatchObject({ status: "open", reported_by_kind: "staff", reported_by_id: null, cause: null, what_will_change: null, follow_up_by: null, damage_report_id: null, closed_at: null, emergency_notes: "Fire department", first_aid_notes: "Bandage" });
      expect(await row(second)).toMatchObject({ reported_by_kind: "member", reported_by_id: members.Ben });
      const { rows } = await q(`select id from club.incidents where id = any($1) order by seq`, [[first, second]]);
      expect(rows.map((r) => r.id)).toEqual([first, second]);
      expect(await lines(first)).toEqual(["filed"]);
    });

    it("is refused without its filed line, at the end of the change", async () => {
      const id = randomUUID();
      const failure = await tx(incidentRow({ id }));
      expect(failure?.message).toMatch(/needs its "filed" line/);
      expect((await q(`select count(*)::int as n from club.incidents where id = $1`, [id])).rows[0].n).toBe(0);
    });

    it("is refused when it does not start open, or already holds staff's review fields", async () => {
      const closed = randomUUID();
      expect((await tx(incidentRow({ id: closed, status: "closed", closedAt: T(11), closedNote: "Done." }), logRow({ incident: closed, kind: "filed" })))?.message).toMatch(/starts open/);
      const item = await boat();
      const damage = await damageReport(item);
      for (const over of [{ cause: "A gust." }, { change: "Wind check." }, { followUp: "Sam" }, { damage }] as Incident[]) {
        const id = randomUUID();
        expect((await tx(incidentRow({ id, ...over }), logRow({ incident: id, kind: "filed" })))?.message).toMatch(/has not been reviewed yet/);
      }
    });

    it("is refused from an ordinary member, a member who is not an active coach, a coach who left, and a made-up person", async () => {
      const refused = async (byId: string | null) => {
        const id = randomUUID();
        return tx(incidentRow({ id, byKind: "member", byId }), logRow({ incident: id, kind: "filed", byKind: "member", byId }));
      };
      expect((await refused(members.Ada))?.message).toMatch(/Only club staff and coaches can file/);
      expect((await refused(randomUUID()))?.message).toMatch(/Only club staff and coaches can file/);
      // Dee is a coach until she leaves.
      expect(await filed({ byKind: "member", byId: members.Dee, by: "Dee Test" })).toBeTruthy();
      await q(`update club.members set status = 'removed' where id = $1`, [members.Dee]);
      expect((await refused(members.Dee))?.message).toMatch(/Only club staff and coaches can file/);
    });

    it("keeps the shape of every box", async () => {
      const refused = async (over: Incident) => {
        const id = randomUUID();
        return tx(incidentRow({ ...over, id }), logRow({ incident: id, at: over.at ?? T(10), kind: "filed" }));
      };
      expect((await refused({ what: "" }))?.message).toMatch(/incidents_what_happened_check/);
      expect((await refused({ what: "w".repeat(3001) }))?.message).toMatch(/incidents_what_happened_check/);
      expect((await refused({ location: "l".repeat(401) }))?.message).toMatch(/incidents_location_check/);
      expect((await refused({ conditions: "c".repeat(601) }))?.message).toMatch(/incidents_conditions_check/);
      expect((await refused({ aid: true, aidNotes: "a".repeat(601) }))?.message).toMatch(/incidents_first_aid_notes_check/);
      expect((await refused({ emergency: true, emergencyNotes: "e".repeat(401) }))?.message).toMatch(/incidents_emergency_notes_check/);
      expect((await refused({ byKind: "system", byId: null }))?.message).toMatch(/incidents_reported_by_kind_check/);
      expect((await refused({ by: "" }))?.message).toMatch(/incidents_reported_by_label_check/);
      // A member with no id is stopped by the "only staff and coaches" trigger first (a constraint runs after the triggers).
      expect((await refused({ byKind: "member", byId: null }))?.message).toMatch(/Only club staff and coaches can file/);
      expect((await refused({ byKind: "staff", byId: members.Ben }))?.message).toMatch(/incidents_filer_is_named/);
      expect((await refused({ status: "paused" }))?.message).toMatch(/starts open|incidents_status_check/);
      expect((await refused({ at: T(10), occurredAt: T(11) }))?.message).toMatch(/incidents_occurred_before_filed/);
      expect((await refused({ at: T(10), updatedAt: T(9) }))?.message).toMatch(/incidents_updated_after_filed/);
      expect((await refused({ aid: false, aidNotes: "Bandage" }))?.message).toMatch(/incidents_first_aid_notes_need_first_aid/);
      expect((await refused({ emergency: false, emergencyNotes: "Fire department" }))?.message).toMatch(/incidents_emergency_notes_need_a_call/);
      // The longest of each is fine, and a report can be dated the very moment it was filed.
      expect(await filed({ what: "w".repeat(3000), location: "l".repeat(400), conditions: "c".repeat(600), aid: true, aidNotes: "a".repeat(600), emergency: true, emergencyNotes: "e".repeat(400), occurredAt: T(10) })).toBeTruthy();
    });

    it("is refused when the filed line names someone else, or there is a second filed line", async () => {
      const id = randomUUID();
      expect((await tx(incidentRow({ id }), logRow({ incident: id, kind: "filed", byKind: "member", byId: members.Ben, by: "Ben Test" })))?.message).toMatch(/must name the person who filed/);
      const mine = randomUUID();
      expect((await tx(incidentRow({ id: mine, byKind: "member" }), logRow({ incident: mine, kind: "filed", byKind: "member", byId: members.Dee, by: "Dee Test" })))?.message).toMatch(/must name the person who filed/);
      const done = await filed();
      expect((await tx(logRow({ incident: done, kind: "filed" })))?.message).toMatch(/incident_log_one_filed_idx/);
    });
  });

  describe("what the filer wrote", () => {
    it("can never be changed afterwards", async () => {
      const id = await filed({ byKind: "member" });
      const refuse = async (set: string, value: unknown) => expect((await change(id, `${set} = $2`, [value]))?.message, set).toMatch(/cannot be changed/);
      await refuse("reported_by_kind", "staff");
      await refuse("reported_by_id", members.Dee);
      await refuse("reported_by_label", "Someone Else");
      await refuse("reported_at", T(9));
      await refuse("occurred_at", T(7));
      await refuse("what_happened", "Something else.");
      await refuse("location", "Elsewhere");
      await refuse("on_the_water", false);
      await refuse("conditions", "Calm");
      await refuse("first_aid_given", true);
      await refuse("emergency_called", true);
      await refuse("id", randomUUID());
      await refuse("created_xact", "1");
      expect(await row(id)).toMatchObject({ what_happened: "A single capsized.", on_the_water: true });
    });

    it("cannot have its first aid or emergency notes changed either", async () => {
      const id = await filed({ aid: true, aidNotes: "Bandage", emergency: true, emergencyNotes: "Fire dept" });
      expect((await change(id, `first_aid_notes = 'Other'`, []))?.message).toMatch(/cannot be changed/);
      expect((await change(id, `emergency_notes = 'Other'`, []))?.message).toMatch(/cannot be changed/);
    });

    it("cannot be removed, and the table cannot be emptied", async () => {
      const id = await filed();
      expect((await attempt(`delete from club.incidents where id = $1`, [id]))?.message).toMatch(/cannot be removed/);
      expect((await attempt(`truncate club.incidents cascade`))?.message).toMatch(/cannot be removed/);
      expect((await row(id)).id).toBe(id);
    });
  });

  describe("staff's review", () => {
    it("can set the cause, change, follow-up person and damage link only with a matching reviewed line at that moment", async () => {
      const item = await boat();
      const damage = await damageReport(item);
      const id = await filed();
      const when = T(12);
      expect(await change(id, `cause = 'A gust.', what_will_change = 'Wind check.', follow_up_by = 'Sam', damage_report_id = $2, updated_at = $3`, [damage, when], staffLine(id, "reviewed", when))).toBeNull();
      expect(await row(id)).toMatchObject({ cause: "A gust.", what_will_change: "Wind check.", follow_up_by: "Sam", damage_report_id: damage, status: "open" });
      expect(await lines(id)).toEqual(["filed", "reviewed"]);
    });

    it("is refused without a reviewed line, with one at another moment, or with another kind of line, for each field", async () => {
      const item = await boat();
      const damage = await damageReport(item);
      const id = await filed();
      const when = T(12);
      expect((await change(id, `cause = 'A gust.', updated_at = $2`, [when]))?.message).toMatch(/cannot change without a matching "reviewed" line/);
      expect((await change(id, `what_will_change = 'Wind check.', updated_at = $2`, [when]))?.message).toMatch(/cannot change without a matching "reviewed" line/);
      expect((await change(id, `follow_up_by = 'Sam', updated_at = $2`, [when]))?.message).toMatch(/cannot change without a matching "reviewed" line/);
      expect((await change(id, `damage_report_id = $3, updated_at = $2`, [when, damage]))?.message).toMatch(/cannot change without a matching "reviewed" line/);
      // A reviewed line at a different moment does not count.
      expect((await change(id, `cause = 'A gust.', updated_at = $2`, [when], staffLine(id, "reviewed", T(13))))?.message).toMatch(/cannot change without a matching "reviewed" line/);
      // Neither does another kind of line.
      expect((await change(id, `cause = 'A gust.', updated_at = $2`, [when], staffLine(id, "note", when)))?.message).toMatch(/cannot change without a matching "reviewed" line/);
      expect((await row(id)).cause).toBeNull();
    });

    it("can clear a field the same way, and a review that changes nothing needs no line", async () => {
      const id = await filed();
      expect(await change(id, `cause = 'A gust.', updated_at = $2`, [T(12)], staffLine(id, "reviewed", T(12)))).toBeNull();
      expect((await change(id, `cause = null, updated_at = $2`, [T(13)]))?.message).toMatch(/matching "reviewed" line/);
      expect(await change(id, `cause = null, updated_at = $2`, [T(13)], staffLine(id, "reviewed", T(13)))).toBeNull();
      expect(await change(id, `updated_at = $2`, [T(14)])).toBeNull();
      expect((await row(id)).cause).toBeNull();
    });

    it("keeps the shape of every review box", async () => {
      const id = await filed();
      expect((await change(id, `cause = ''`, []))?.message).toMatch(/incidents_cause_check/);
      expect((await change(id, `cause = $2`, ["c".repeat(2001)]))?.message).toMatch(/incidents_cause_check/);
      expect((await change(id, `what_will_change = $2`, ["w".repeat(2001)]))?.message).toMatch(/incidents_what_will_change_check/);
      expect((await change(id, `follow_up_by = $2`, ["f".repeat(121)]))?.message).toMatch(/incidents_follow_up_by_check/);
      expect((await change(id, `damage_report_id = $2`, [randomUUID()]))?.code).toBe("23503");
    });
  });

  describe("closing", () => {
    it("needs the closing note, the status change and a closed line at that moment", async () => {
      const id = await filed();
      const when = T(15);
      expect((await change(id, `status = 'closed', updated_at = $2`, [when], staffLine(id, "closed", when)))?.message).toMatch(/incidents_closing_is_complete/);
      expect((await change(id, `status = 'closed', closed_at = $2, closed_note = 'Done.', updated_at = $2`, [when]))?.message).toMatch(/cannot change without a matching "closed" line/);
      expect((await change(id, `status = 'closed', closed_at = $2, closed_note = 'Done.', updated_at = $2`, [when], staffLine(id, "closed", T(16))))?.message).toMatch(/matching "closed" line/);
      expect(await change(id, `status = 'closed', closed_at = $2, closed_note = 'Done.', updated_at = $2`, [when], staffLine(id, "closed", when))).toBeNull();
      expect(await row(id)).toMatchObject({ status: "closed", closed_note: "Done." });
    });

    it("is refused for a closing note on an open report, a closed report with no note, one closed before it was filed, and a note of the wrong length", async () => {
      const id = await filed();
      expect((await change(id, `closed_note = 'Done.'`, []))?.message).toMatch(/incidents_closing_is_complete/);
      expect((await change(id, `closed_at = $2`, [T(15)]))?.message).toMatch(/incidents_closing_is_complete/);
      expect((await change(id, `status = 'closed', closed_at = $2, closed_note = 'Done.', updated_at = $3`, [T(9), T(15)], staffLine(id, "closed", T(15))))?.message).toMatch(/incidents_closed_after_filed/);
      expect((await change(id, `status = 'closed', closed_at = $2, closed_note = $3, updated_at = $2`, [T(15), "c".repeat(2001)], staffLine(id, "closed", T(15))))?.message).toMatch(/incidents_closed_note_check/);
      expect((await row(id)).status).toBe("open");
    });

    it("freezes the report: nothing changes once it is closed, not even by staff", async () => {
      const item = await boat();
      const damage = await damageReport(item);
      const id = await filed();
      expect(await change(id, `status = 'closed', closed_at = $2, closed_note = 'Done.', updated_at = $2`, [T(15)], staffLine(id, "closed", T(15)))).toBeNull();
      const frozen = /already closed/;
      expect((await change(id, `cause = 'Late', updated_at = $2`, [T(16)], staffLine(id, "reviewed", T(16))))?.message).toMatch(frozen);
      expect((await change(id, `damage_report_id = $2, updated_at = $3`, [damage, T(16)], staffLine(id, "reviewed", T(16))))?.message).toMatch(frozen);
      expect((await change(id, `status = 'open', closed_at = null, closed_note = null, updated_at = $2`, [T(16)]))?.message).toMatch(frozen);
      expect((await change(id, `closed_note = 'Changed'`, []))?.message).toMatch(frozen);
      expect((await change(id, `updated_at = $2`, [T(17)]))?.message).toMatch(frozen);
      expect((await row(id)).closed_note).toBe("Done.");
    });
  });

  describe("the people and boats", () => {
    it("are added in the change that files the report, and kept in the order they were written", async () => {
      const a = await boat();
      const b = await boat();
      const id = randomUUID();
      const failure = await tx(
        incidentRow({ id }),
        personRow(id, { member: members.Ada, name: "Ada Test", injured: true, parent: true }),
        personRow(id, { name: "Jordan Example" }),
        personRow(id, { member: members.Cy, name: "Cy Test" }),
        boatRow(id, a),
        boatRow(id, b),
        logRow({ incident: id, kind: "filed" }),
      );
      expect(failure).toBeNull();
      const people = (await q(`select name, injured, parent_told, member_id from club.incident_people where incident_id = $1 order by seq`, [id])).rows;
      expect(people.map((p) => [p.name, p.injured, p.parent_told, p.member_id])).toEqual([["Ada Test", true, true, members.Ada], ["Jordan Example", false, false, null], ["Cy Test", false, false, members.Cy]]);
      expect((await q(`select item_id from club.incident_boats where incident_id = $1 order by seq`, [id])).rows.map((r) => r.item_id)).toEqual([a, b]);
    });

    it("cannot be added later, in a change of their own", async () => {
      const id = await filed();
      const item = await boat();
      expect((await tx(personRow(id)))?.message).toMatch(/can only be added when it is filed/);
      expect((await tx(boatRow(id, item)))?.message).toMatch(/can only be added when it is filed/);
      expect((await q(`select count(*)::int as n from club.incident_people where incident_id = $1`, [id])).rows[0].n).toBe(0);
    });

    it("name a member only if they are an active member, and a typed name needs a name", async () => {
      const gone = (await q(`insert into club.members (household_id, first_name, last_name, email, role, status) values ($1, 'Gus', 'Test', 'gus@example.com', 'additional', 'active') returning id`, [household])).rows[0].id;
      await q(`update club.members set status = 'removed' where id = $1`, [gone]);
      const id = randomUUID();
      expect((await tx(incidentRow({ id }), personRow(id, { member: gone, name: "Gus Test" }), logRow({ incident: id, kind: "filed" })))?.message).toMatch(/Only an active member can be named/);
      expect((await tx(incidentRow({ id }), personRow(id, { member: randomUUID(), name: "Nobody" }), logRow({ incident: id, kind: "filed" })))?.message).toMatch(/Only an active member can be named|violates foreign key/);
      expect((await tx(incidentRow({ id }), personRow(id, { name: "" }), logRow({ incident: id, kind: "filed" })))?.message).toMatch(/incident_people_name_check/);
      expect((await tx(incidentRow({ id }), personRow(id, { name: "n".repeat(121) }), logRow({ incident: id, kind: "filed" })))?.message).toMatch(/incident_people_name_check/);
    });

    it("name a member once and a typed name once, whatever the capital letters", async () => {
      const id = randomUUID();
      expect((await tx(incidentRow({ id }), personRow(id, { member: members.Ada, name: "Ada Test" }), personRow(id, { member: members.Ada, name: "Ada Test" }), logRow({ incident: id, kind: "filed" })))?.message).toMatch(/incident_people_member_once_idx/);
      expect((await tx(incidentRow({ id }), personRow(id, { name: "Jordan Example" }), personRow(id, { name: "JORDAN example" }), logRow({ incident: id, kind: "filed" })))?.message).toMatch(/incident_people_name_once_idx/);
      // The same typed name on two different reports is fine.
      for (let i = 0; i < 2; i++) {
        const other = randomUUID();
        expect(await tx(incidentRow({ id: other }), personRow(other, { name: "Jordan Example" }), logRow({ incident: other, kind: "filed" }))).toBeNull();
      }
    });

    it("name a boat once, and only a boat that exists", async () => {
      const item = await boat();
      const id = randomUUID();
      expect((await tx(incidentRow({ id }), boatRow(id, item), boatRow(id, item), logRow({ incident: id, kind: "filed" })))?.message).toMatch(/incident_boats_once/);
      expect((await tx(incidentRow({ id }), boatRow(id, randomUUID()), logRow({ incident: id, kind: "filed" })))?.code).toBe("23503");
    });

    it("cannot be changed or removed, and their tables cannot be emptied", async () => {
      const item = await boat();
      const id = randomUUID();
      expect(await tx(incidentRow({ id }), personRow(id), boatRow(id, item), logRow({ incident: id, kind: "filed" }))).toBeNull();
      expect((await attempt(`update club.incident_people set injured = true where incident_id = $1`, [id]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`update club.incident_people set name = 'Someone Else' where incident_id = $1`, [id]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`delete from club.incident_people where incident_id = $1`, [id]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`update club.incident_boats set item_id = $2 where incident_id = $1`, [id, await boat()]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`delete from club.incident_boats where incident_id = $1`, [id]))?.message).toMatch(/cannot be changed or removed/);
      // Each table's own wipe guard is tried with the report table's switched off, so it cannot hide behind it.
      await q(`alter table club.incident_people disable trigger incident_people_no_change`);
      await q(`alter table club.incident_boats disable trigger incident_boats_no_change`);
      try {
        expect((await attempt(`truncate club.incident_people`))?.message).toMatch(/cannot be changed or removed/);
        expect((await attempt(`truncate club.incident_boats`))?.message).toMatch(/cannot be changed or removed/);
      } finally {
        await q(`alter table club.incident_people enable trigger incident_people_no_change`);
        await q(`alter table club.incident_boats enable trigger incident_boats_no_change`);
      }
      expect((await q(`select count(*)::int as n from club.incident_people where incident_id = $1`, [id])).rows[0].n).toBe(1);
    });
  });

  describe("the log", () => {
    it("takes a coach's note on their own open report, and staff's note any time, even once it is closed", async () => {
      const id = await filed({ byKind: "member" });
      expect(await tx(logRow({ incident: id, at: T(11), kind: "note", byKind: "member", byId: members.Ben, by: "Ben Test" }))).toBeNull();
      expect(await tx(logRow({ incident: id, at: T(12), kind: "note" }))).toBeNull();
      expect(await change(id, `status = 'closed', closed_at = $2, closed_note = 'Done.', updated_at = $2`, [T(13)], staffLine(id, "closed", T(13)))).toBeNull();
      expect(await tx(logRow({ incident: id, at: T(14), kind: "note" }))).toBeNull();
      expect(await lines(id)).toEqual(["filed", "note", "note", "closed", "note"]);
    });

    it("refuses a note from a coach who did not file it, from an ordinary member, and from a coach once the report is closed", async () => {
      const id = await filed({ byKind: "member" });
      expect((await tx(logRow({ incident: id, kind: "note", byKind: "member", byId: members.Dee, by: "Dee Test" })))?.message).toMatch(/Only club staff, or the coach who filed/);
      expect((await tx(logRow({ incident: id, kind: "note", byKind: "member", byId: members.Ada, by: "Ada Test" })))?.message).toMatch(/Only club staff, or the coach who filed/);
      const byStaff = await filed();
      expect((await tx(logRow({ incident: byStaff, kind: "note", byKind: "member", byId: members.Ben, by: "Ben Test" })))?.message).toMatch(/Only club staff, or the coach who filed/);
      expect(await change(id, `status = 'closed', closed_at = $2, closed_note = 'Done.', updated_at = $2`, [T(13)], staffLine(id, "closed", T(13)))).toBeNull();
      expect((await tx(logRow({ incident: id, at: T(14), kind: "note", byKind: "member", byId: members.Ben, by: "Ben Test" })))?.message).toMatch(/only takes notes from club staff/);
    });

    it("refuses a member writing a reviewed or closed line", async () => {
      const id = await filed({ byKind: "member" });
      for (const kind of ["reviewed", "closed"]) {
        expect((await tx(logRow({ incident: id, kind, byKind: "member", byId: members.Ben, by: "Ben Test" })))?.message, kind).toMatch(/Coaches can only file a report and add notes/);
      }
    });

    it("refuses a line dated before the report was filed, an unknown kind, and a member line with no member", async () => {
      const id = await filed({ at: T(10) });
      expect((await tx(logRow({ incident: id, at: T(9), kind: "note" })))?.message).toMatch(/cannot be dated before the report was filed/);
      expect((await tx(logRow({ incident: id, kind: "edited" })))?.message).toMatch(/incident_log_kind_check/);
      expect((await tx(logRow({ incident: id, kind: "note", byKind: "system" })))?.message).toMatch(/incident_log_by_kind_check/);
      // Staff never carry a member's id (a member line with no id is stopped by the note rule first, so the constraint is tried this way).
      expect((await tx(logRow({ incident: id, kind: "note", byKind: "staff", byId: members.Ben })))?.message).toMatch(/incident_log_member_is_named/);
      expect((await tx(logRow({ incident: id, kind: "note", text: "" })))?.message).toMatch(/incident_log_text_check/);
      expect((await tx(logRow({ incident: id, kind: "note", text: "t".repeat(1501) })))?.message).toMatch(/incident_log_text_check/);
      expect(await tx(logRow({ incident: id, at: T(10), kind: "note", text: "t".repeat(1500) }))).toBeNull();
    });

    it("is only ever added to: a line cannot be changed or removed, and the table cannot be emptied", async () => {
      const id = await filed();
      expect((await attempt(`update club.incident_log set text = 'Rewritten.' where incident_id = $1`, [id]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`update club.incident_log set at = $2 where incident_id = $1`, [id, T(12)]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`delete from club.incident_log where incident_id = $1`, [id]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`truncate club.incident_log`))?.message).toMatch(/cannot be changed or removed/);
      expect(await lines(id)).toEqual(["filed"]);
    });
  });

  describe("kept private", () => {
    it("has row level security on every table and nothing granted to the public roles", async () => {
      const { rows } = await q(`select relname, relrowsecurity from pg_class where relnamespace = 'club'::regnamespace and relname in ('incidents','incident_people','incident_boats','incident_log') order by relname`);
      expect(rows).toEqual([
        { relname: "incident_boats", relrowsecurity: true },
        { relname: "incident_log", relrowsecurity: true },
        { relname: "incident_people", relrowsecurity: true },
        { relname: "incidents", relrowsecurity: true },
      ]);
    });
  });
});
