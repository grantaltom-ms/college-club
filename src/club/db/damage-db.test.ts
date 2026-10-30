import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * Damage reports as the DATABASE guards them, tested against a real Postgres: a report is filed once with its "filed" line, what
 * the filer wrote never changes, the status only moves forward and a closed report is frozen, closing needs its details, every
 * change to the status, priority or assignee needs a matching log line written at the same moment, the log is only added to, a
 * member can only file and add notes to their own report, and a member cannot file on a private boat that is not theirs. Needs
 * CLUB_TEST_DATABASE_URL (a local or throwaway Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;

type Failure = { code?: string; message: string };
type Statement = [string, unknown[]?];

describe.skipIf(!ADMIN_URL)("damage reports", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);
  const members: Record<string, string> = {};
  let n = 0;
  const T = (hh: number, day = 29) => new Date(Date.UTC(2026, 9, day, hh)).toISOString();

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
    const household = (await q(`insert into club.households (display_name, membership_type, joined_on) values ('The Test household', 'Resident', '2020-01-01') returning id`)).rows[0].id;
    for (const [i, name] of ["Ada", "Ben", "Cy"].entries()) {
      members[name] = (await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Test', $3, $4) returning id`, [household, name, `${name}@example.com`, i === 0 ? "primary" : "additional"])).rows[0].id;
    }
    await q(`insert into club.item_classes (code, booking_type, name, seats) values ('single', 'Shell', 'Single', 1)`);
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

  async function boat(isPrivate = false): Promise<string> {
    n += 1;
    return (await q(`insert into club.items (name, class_code, is_private) values ($1, 'single', $2) returning id`, [`Boat ${n}`, isPrivate])).rows[0].id;
  }

  type Report = Partial<{ id: string; item: string; byKind: string; byId: string | null; by: string; at: string; description: string; location: string; how: string; major: boolean; priority: number; status: string; updatedAt: string }>;
  const reportRow = (r: Report & { item: string }): Statement => {
    const at = r.at ?? T(10);
    return [
      `insert into club.damage_reports (id, item_id, reported_by_kind, reported_by_id, reported_by_label, reported_at, description, location, how_it_happened, major, priority, status, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [r.id ?? randomUUID(), r.item, r.byKind ?? "member", r.byId === undefined ? members.Ada : r.byId, r.by ?? "Ada Test", at, r.description ?? "The seat sticks.", r.location ?? "", r.how ?? "", r.major ?? false, r.priority ?? 3, r.status ?? "open", r.updatedAt ?? at],
    ];
  };

  type Log = Partial<{ report: string; at: string; kind: string; byKind: string; byId: string | null; by: string; text: string }>;
  const logRow = (l: Log & { report: string }): Statement => [
    `insert into club.damage_log (report_id, at, kind, by_kind, by_id, by_label, text) values ($1,$2,$3,$4,$5,$6,$7)`,
    [l.report, l.at ?? T(10), l.kind ?? "note", l.byKind ?? "staff", l.byId === undefined ? null : l.byId, l.by ?? "Test staff", l.text ?? "A line."],
  ];
  const staffLine = (report: string, kind: string, at: string, text = "Done."): Log & { report: string } => ({ report, kind, at, text });

  /** A filed report (by Ada unless told otherwise) with its "filed" line, as the app writes them. */
  async function filed(item: string, over: Report = {}): Promise<string> {
    const id = over.id ?? randomUUID();
    const byKind = over.byKind ?? "member";
    const byId = over.byId === undefined ? (byKind === "member" ? members.Ada : null) : over.byId;
    const failure = await tx(reportRow({ ...over, id, item, byKind, byId, by: over.by ?? (byKind === "member" ? "Ada Test" : "Test staff") }), logRow({ report: id, at: over.at ?? T(10), kind: "filed", byKind, byId, by: over.by ?? (byKind === "member" ? "Ada Test" : "Test staff"), text: "Reported." }));
    expect(failure).toBeNull();
    return id;
  }

  /** Changes a report and writes the given log line in the same change. */
  const change = (id: string, set: string, params: unknown[], line?: Log) =>
    tx([`update club.damage_reports set ${set} where id = $1`, [id, ...params]], ...(line ? [logRow({ ...line, report: id })] : []));
  // Dates are read as plain text so the tests do not depend on the time zone of the machine they run on.
  const row = async (id: string) => (await q(`select *, repaired_on::text as repaired_on_text from club.damage_reports where id = $1`, [id])).rows[0];
  const lines = async (id: string) => (await q(`select kind from club.damage_log where report_id = $1 order by seq`, [id])).rows.map((r) => r.kind as string);

  describe("filing a report", () => {
    it("is accepted with its filed line, starts open, and keeps the order they were filed in", async () => {
      const item = await boat();
      const first = await filed(item, { description: "First.", major: true, priority: 1, location: "Bow", how: "The dock." });
      const second = await filed(item, { byKind: "staff", description: "Second." });
      expect(await row(first)).toMatchObject({ item_id: item, status: "open", major: true, priority: 1, location: "Bow", how_it_happened: "The dock.", assigned_to: null, closed_at: null, reported_by_kind: "member", reported_by_id: members.Ada });
      expect(await row(second)).toMatchObject({ reported_by_kind: "staff", reported_by_id: null });
      const { rows } = await q(`select id from club.damage_reports where item_id = $1 order by seq`, [item]);
      expect(rows.map((r) => r.id)).toEqual([first, second]);
      expect(await lines(first)).toEqual(["filed"]);
    });

    it("is refused without its filed line, at the end of the change", async () => {
      const item = await boat();
      const failure = await tx(reportRow({ item }));
      expect(failure?.message).toMatch(/needs its "filed" line/);
      expect((await q(`select count(*)::int as n from club.damage_reports where item_id = $1`, [item])).rows[0].n).toBe(0);
    });

    it("is refused for a report that does not start open", async () => {
      const item = await boat();
      const id = randomUUID();
      const failure = await tx(reportRow({ id, item, status: "in_progress" }), logRow({ report: id, kind: "filed", byKind: "member", byId: members.Ada, by: "Ada Test" }));
      expect(failure?.message).toMatch(/starts open/);
    });

    it("is refused for a boat that does not exist", async () => {
      const id = randomUUID();
      const failure = await tx(reportRow({ id, item: randomUUID() }), logRow({ report: id, kind: "filed", byKind: "member", byId: members.Ada, by: "Ada Test" }));
      expect(failure?.code).toBe("23503");
    });

    it("keeps the shape of every box", async () => {
      const item = await boat();
      const refused = async (over: Report) => {
        const id = randomUUID();
        const byKind = over.byKind ?? "member";
        return tx(reportRow({ ...over, id, item }), logRow({ report: id, at: over.at ?? T(10), kind: "filed", byKind, byId: over.byId === undefined ? (byKind === "member" ? members.Ada : null) : over.byId, by: "Ada Test" }));
      };
      expect((await refused({ description: "" }))?.message).toMatch(/damage_reports_description_check/);
      expect((await refused({ description: "d".repeat(1001) }))?.message).toMatch(/damage_reports_description_check/);
      expect((await refused({ location: "l".repeat(301) }))?.message).toMatch(/damage_reports_location_check/);
      expect((await refused({ how: "h".repeat(1001) }))?.message).toMatch(/damage_reports_how_it_happened_check/);
      expect((await refused({ priority: 0 }))?.message).toMatch(/damage_reports_priority_check/);
      expect((await refused({ priority: 5 }))?.message).toMatch(/damage_reports_priority_check/);
      // A status that is not one of the four is refused before the column's own check is reached: a report must start open.
      expect((await refused({ status: "closed" }))?.message).toMatch(/starts open|damage_reports_status_check/);
      expect((await refused({ byKind: "system", byId: null }))?.message).toMatch(/damage_reports_reported_by_kind_check/);
      expect((await refused({ by: "" }))?.message).toMatch(/damage_reports_reported_by_label_check/);
      expect((await refused({ byKind: "member", byId: null }))?.message).toMatch(/damage_reports_filer_is_named/);
      expect((await refused({ byKind: "staff", byId: members.Ada }))?.message).toMatch(/damage_reports_filer_is_named/);
      expect((await refused({ at: T(10), updatedAt: T(9) }))?.message).toMatch(/damage_reports_updated_after_filed/);
      // The longest of each is fine.
      expect(await filed(item, { description: "d".repeat(1000), location: "l".repeat(300), how: "h".repeat(1000) })).toBeTruthy();
    });

    it("lets a member report on a private boat only when they are on its list, and staff always", async () => {
      const item = await boat(true);
      await q(`insert into club.item_access (item_id, member_id, kind, added_at, added_by_kind, added_by_label) values ($1, $2, 'owner', $3, 'staff', 'Test staff')`, [item, members.Ada, T(8)]);
      const id = randomUUID();
      const notOnList = await tx(reportRow({ id, item, byId: members.Ben, by: "Ben Test" }), logRow({ report: id, kind: "filed", byKind: "member", byId: members.Ben, by: "Ben Test" }));
      expect(notOnList?.message).toMatch(/Only the people on a private boat's list can report damage on it/);
      expect(await filed(item, { byId: members.Ada })).toBeTruthy();
      expect(await filed(item, { byKind: "staff" })).toBeTruthy();
      // Taken off the list, a member can no longer report on it.
      await q(`update club.item_access set ended_at = $2, ended_by_kind = 'staff', ended_by_label = 'Test staff', ended_reason = 'Taken off' where item_id = $1 and member_id = $3`, [item, T(12), members.Ada]);
      const id2 = randomUUID();
      const after = await tx(reportRow({ id: id2, item, byId: members.Ada }), logRow({ report: id2, kind: "filed", byKind: "member", byId: members.Ada, by: "Ada Test" }));
      expect(after?.message).toMatch(/Only the people on a private boat's list/);
    });
  });

  describe("what the filer wrote", () => {
    it("can never be changed afterwards", async () => {
      const item = await boat();
      const other = await boat();
      const id = await filed(item);
      const refuse = async (set: string, value: unknown) => expect((await change(id, `${set} = $2`, [value]))?.message, set).toMatch(/cannot be changed/);
      await refuse("item_id", other);
      await refuse("reported_by_kind", "staff");
      await refuse("reported_by_id", members.Ben);
      await refuse("reported_by_label", "Someone Else");
      await refuse("reported_at", T(9));
      await refuse("description", "Something else.");
      await refuse("location", "Elsewhere");
      await refuse("how_it_happened", "A different story.");
      await refuse("major", true);
      expect(await row(id)).toMatchObject({ item_id: item, description: "The seat sticks.", major: false });
    });

    it("cannot be removed, and the table cannot be emptied", async () => {
      const id = await filed(await boat());
      expect((await attempt(`delete from club.damage_reports where id = $1`, [id]))?.message).toMatch(/cannot be removed/);
      // Emptying the table also reaches the log through the link between them; either table's own guard may be the one that speaks.
      expect((await attempt(`truncate club.damage_reports cascade`))?.message).toMatch(/cannot be (removed|changed or removed)/);
      expect(await row(id)).toBeTruthy();
    });
  });

  describe("triage: status, priority and who is fixing it", () => {
    it("moves forward only: open, then being fixed, then repaired or dismissed", async () => {
      const item = await boat();
      const id = await filed(item);
      expect(await change(id, `status = 'in_progress', updated_at = $2`, [T(11)], staffLine(id, "started", T(11)))).toBeNull();
      expect((await change(id, `status = 'open', updated_at = $2`, [T(12)], staffLine(id, "started", T(12))))?.message).toMatch(/only move forward/);
      expect(await change(id, `status = 'repaired', updated_at = $2, closed_at = $2, repaired_on = '2026-10-29', repaired_by = 'Sam'`, [T(13)], staffLine(id, "repaired", T(13)))).toBeNull();
      expect(await row(id)).toMatchObject({ status: "repaired", repaired_by: "Sam" });
      expect(await lines(id)).toEqual(["filed", "started", "repaired"]);
      // Straight from open to dismissed is fine, and so is straight from open to repaired.
      const other = await filed(item);
      expect(await change(other, `status = 'dismissed', updated_at = $2, closed_at = $2, dismissed_reason = 'Duplicate'`, [T(11)], staffLine(other, "dismissed", T(11)))).toBeNull();
      const third = await filed(item);
      expect(await change(third, `status = 'repaired', updated_at = $2, closed_at = $2, repaired_on = '2026-10-29', repaired_by = 'Sam'`, [T(11)], staffLine(third, "repaired", T(11)))).toBeNull();
    });

    it("freezes a report once it is repaired or dismissed: nothing about it changes again", async () => {
      const item = await boat();
      const repaired = await filed(item);
      await change(repaired, `status = 'repaired', updated_at = $2, closed_at = $2, repaired_on = '2026-10-29', repaired_by = 'Sam'`, [T(11)], staffLine(repaired, "repaired", T(11)));
      const dismissed = await filed(item);
      await change(dismissed, `status = 'dismissed', updated_at = $2, closed_at = $2, dismissed_reason = 'Duplicate'`, [T(11)], staffLine(dismissed, "dismissed", T(11)));
      for (const id of [repaired, dismissed]) {
        expect((await change(id, `priority = 1, updated_at = $2`, [T(12)], staffLine(id, "priority_changed", T(12))))?.message, id).toMatch(/already (repaired|dismissed) cannot change/);
        expect((await change(id, `assigned_to = 'Pat', updated_at = $2`, [T(12)], staffLine(id, "assigned", T(12))))?.message, id).toMatch(/cannot change/);
        expect((await change(id, `status = 'open', updated_at = $2`, [T(12)]))?.message, id).toMatch(/cannot change/);
        expect((await change(id, `repair_notes = 'Late notes.'`, []))?.message, id).toMatch(/cannot change/);
      }
    });

    it("needs a matching line in the log, written at the same moment, for every change of status, priority or assignee", async () => {
      const item = await boat();
      const id = await filed(item);
      // Status.
      expect((await change(id, `status = 'in_progress', updated_at = $2`, [T(11)]))?.message).toMatch(/status cannot change without a matching "started" line/);
      expect((await change(id, `status = 'in_progress', updated_at = $2`, [T(11)], staffLine(id, "note", T(11))))?.message).toMatch(/matching "started" line/);
      expect((await change(id, `status = 'in_progress', updated_at = $2`, [T(11)], staffLine(id, "started", T(12))))?.message).toMatch(/matching "started" line/);
      // Priority.
      expect((await change(id, `priority = 1, updated_at = $2`, [T(11)]))?.message).toMatch(/priority cannot change without a matching "priority_changed" line/);
      expect((await change(id, `priority = 1, updated_at = $2`, [T(11)], staffLine(id, "assigned", T(11))))?.message).toMatch(/priority_changed/);
      expect((await change(id, `priority = 1, updated_at = $2`, [T(11)], staffLine(id, "priority_changed", T(12))))?.message).toMatch(/matching "priority_changed" line/);
      expect(await change(id, `priority = 1, updated_at = $2`, [T(11)], staffLine(id, "priority_changed", T(11)))).toBeNull();
      // Assignee.
      expect((await change(id, `assigned_to = 'Sam', updated_at = $2`, [T(12)]))?.message).toMatch(/assigned to cannot change without a matching "assigned" line/);
      expect((await change(id, `assigned_to = 'Sam', updated_at = $2`, [T(12)], staffLine(id, "priority_changed", T(12))))?.message).toMatch(/matching "assigned" line/);
      expect((await change(id, `assigned_to = 'Sam', updated_at = $2`, [T(12)], staffLine(id, "assigned", T(13))))?.message).toMatch(/matching "assigned" line/);
      expect(await change(id, `assigned_to = 'Sam', updated_at = $2`, [T(12)], staffLine(id, "assigned", T(12)))).toBeNull();
      // Closing needs the closing line, and the right one.
      expect((await change(id, `status = 'repaired', updated_at = $2, closed_at = $2, repaired_on = '2026-10-29', repaired_by = 'Sam'`, [T(13)], staffLine(id, "dismissed", T(13))))?.message).toMatch(/matching "repaired" line/);
      expect((await change(id, `status = 'dismissed', updated_at = $2, closed_at = $2, dismissed_reason = 'x'`, [T(13)], staffLine(id, "repaired", T(13))))?.message).toMatch(/matching "dismissed" line/);
      expect(await row(id)).toMatchObject({ status: "open", priority: 1, assigned_to: "Sam" });
    });

    it("allows several changes in one step when each has its line", async () => {
      const id = await filed(await boat());
      const failure = await tx(
        [`update club.damage_reports set priority = 2, assigned_to = 'Pat', updated_at = $2 where id = $1`, [id, T(11)]],
        logRow(staffLine(id, "priority_changed", T(11))),
        logRow(staffLine(id, "assigned", T(11))),
      );
      expect(failure).toBeNull();
    });

    it("keeps priority between 1 and 4 and the names within their length", async () => {
      const id = await filed(await boat());
      expect((await change(id, `priority = 5, updated_at = $2`, [T(11)], staffLine(id, "priority_changed", T(11))))?.message).toMatch(/damage_reports_priority_check/);
      expect((await change(id, `assigned_to = $2, updated_at = $3`, ["a".repeat(121), T(11)], staffLine(id, "assigned", T(11))))?.message).toMatch(/damage_reports_assigned_to_check/);
      expect((await change(id, `assigned_to = '', updated_at = $2`, [T(11)], staffLine(id, "assigned", T(11))))?.message).toMatch(/damage_reports_assigned_to_check/);
      expect((await change(id, `updated_at = $2`, [T(9)]))?.message).toMatch(/damage_reports_updated_after_filed/);
    });
  });

  describe("closing a report", () => {
    const repaired = (id: string, extra = "") => change(id, `status = 'repaired', updated_at = $2, closed_at = $2, repaired_on = '2026-10-29', repaired_by = 'Sam'${extra}`, [T(11)], staffLine(id, "repaired", T(11)));

    it("records a repair with when, who, the time, the cost and the notes", async () => {
      const id = await filed(await boat());
      expect(await repaired(id, `, repair_minutes = 90, cost_cents = 1850, repair_notes = 'Replaced two wheels.'`)).toBeNull();
      expect(await row(id)).toMatchObject({ status: "repaired", repaired_on_text: "2026-10-29", repaired_by: "Sam", repair_minutes: 90, cost_cents: 1850, repair_notes: "Replaced two wheels.", closed_at: new Date(T(11)) });
      const zero = await filed(await boat());
      expect(await repaired(zero, `, repair_minutes = 0, cost_cents = 0`)).toBeNull();
    });

    it("needs when and who for a repair, and the reason for a dismissal, and a closing moment for both", async () => {
      const id = await filed(await boat());
      const close = (set: string, kind: string) => change(id, `${set}, updated_at = $2`, [T(11)], staffLine(id, kind, T(11)));
      expect((await close(`status = 'repaired', closed_at = '${T(11)}', repaired_by = 'Sam'`, "repaired"))?.message).toMatch(/damage_reports_repair_is_complete/);
      expect((await close(`status = 'repaired', closed_at = '${T(11)}', repaired_on = '2026-10-29'`, "repaired"))?.message).toMatch(/damage_reports_repair_is_complete/);
      expect((await close(`status = 'repaired', repaired_on = '2026-10-29', repaired_by = 'Sam'`, "repaired"))?.message).toMatch(/damage_reports_closing_is_complete/);
      expect((await close(`status = 'dismissed', closed_at = '${T(11)}'`, "dismissed"))?.message).toMatch(/damage_reports_dismissal_is_complete/);
      expect((await close(`status = 'dismissed', dismissed_reason = 'Duplicate'`, "dismissed"))?.message).toMatch(/damage_reports_closing_is_complete/);
      expect((await close(`status = 'dismissed', closed_at = '${T(11)}', dismissed_reason = ''`, "dismissed"))?.message).toMatch(/damage_reports_dismissed_reason_check/);
      expect((await close(`status = 'repaired', closed_at = '${T(11)}', repaired_on = '2026-10-29', repaired_by = 'Sam', dismissed_reason = 'x'`, "repaired"))?.message).toMatch(/damage_reports_dismissal_is_complete/);
      expect((await close(`status = 'dismissed', closed_at = '${T(11)}', dismissed_reason = 'x', repair_notes = 'y'`, "dismissed"))?.message).toMatch(/damage_reports_repair_only_when_repaired/);
      expect(await row(id)).toMatchObject({ status: "open" });
    });

    it("refuses repair details on a report that is not repaired", async () => {
      const id = await filed(await boat());
      for (const set of [`repaired_on = '2026-10-29'`, `repaired_by = 'Sam'`, `repair_minutes = 5`, `cost_cents = 5`, `repair_notes = 'x'`]) {
        expect((await change(id, `${set}, updated_at = $2`, [T(11)]))?.message, set).toMatch(/damage_reports_repair_only_when_repaired/);
      }
    });

    it("keeps the time, cost, notes and names within their limits, and the closing moment after the filing", async () => {
      const id = await filed(await boat());
      expect((await repaired(id, `, repair_minutes = -1`))?.message).toMatch(/damage_reports_repair_minutes_check/);
      expect((await repaired(id, `, repair_minutes = 60001`))?.message).toMatch(/damage_reports_repair_minutes_check/);
      expect((await repaired(id, `, cost_cents = -1`))?.message).toMatch(/damage_reports_cost_cents_check/);
      expect((await repaired(id, `, cost_cents = 10000001`))?.message).toMatch(/damage_reports_cost_cents_check/);
      expect((await repaired(id, `, repair_notes = ''`))?.message).toMatch(/damage_reports_repair_notes_check/);
      expect((await repaired(id, `, repair_notes = '${"n".repeat(2001)}'`))?.message).toMatch(/damage_reports_repair_notes_check/);
      expect((await change(id, `status = 'repaired', updated_at = $2, closed_at = $3, repaired_on = '2026-10-29', repaired_by = 'Sam'`, [T(11), T(9)], staffLine(id, "repaired", T(11))))?.message).toMatch(/damage_reports_closed_after_filed/);
      expect((await change(id, `status = 'repaired', updated_at = $2, closed_at = $2, repaired_on = '2026-10-29', repaired_by = $3`, [T(11), "s".repeat(121)], staffLine(id, "repaired", T(11))))?.message).toMatch(/damage_reports_repaired_by_check/);
      expect((await change(id, `status = 'dismissed', updated_at = $2, closed_at = $2, dismissed_reason = $3`, [T(11), "r".repeat(201)], staffLine(id, "dismissed", T(11))))?.message).toMatch(/damage_reports_dismissed_reason_check/);
      expect(await row(id)).toMatchObject({ status: "open" });
    });
  });

  describe("the log", () => {
    it("takes a line for each kind of step, in order, with who wrote it", async () => {
      const id = await filed(await boat());
      const kinds = ["note", "assigned", "priority_changed", "started", "taken_out_of_service", "returned_to_service", "repaired", "dismissed"];
      for (const kind of kinds) expect(await tx(logRow({ report: id, kind, at: T(11) })), kind).toBeNull();
      expect(await lines(id)).toEqual(["filed", ...kinds]);
    });

    it("is only added to: a line cannot be changed or removed, and the table cannot be emptied", async () => {
      const id = await filed(await boat());
      expect((await attempt(`update club.damage_log set text = 'Rewritten.' where report_id = $1`, [id]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`update club.damage_log set at = $2 where report_id = $1`, [id, T(9)]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`delete from club.damage_log where report_id = $1`, [id]))?.message).toMatch(/cannot be changed or removed/);
      expect((await attempt(`truncate club.damage_log`))?.message).toMatch(/cannot be changed or removed/);
      expect(await lines(id)).toEqual(["filed"]);
    });

    it("keeps the shape of every column", async () => {
      const id = await filed(await boat());
      expect((await tx(logRow({ report: id, kind: "gossip" })))?.message).toMatch(/damage_log_kind_check/);
      expect((await tx(logRow({ report: id, byKind: "system" })))?.message).toMatch(/damage_log_by_kind_check/);
      expect((await tx(logRow({ report: id, text: "" })))?.message).toMatch(/damage_log_text_check/);
      expect((await tx(logRow({ report: id, text: "t".repeat(1501) })))?.message).toMatch(/damage_log_text_check/);
      expect((await tx(logRow({ report: id, by: "" })))?.message).toMatch(/damage_log_by_label_check/);
      expect(await tx(logRow({ report: id, byKind: "member", byId: null }))).not.toBeNull();
      expect((await tx(logRow({ report: id, byKind: "staff", byId: members.Ada })))?.message).toMatch(/damage_log_member_is_named/);
      expect((await tx(logRow({ report: randomUUID() })))?.code).toBe("23503");
      expect(await tx(logRow({ report: id, text: "t".repeat(1500) }))).toBeNull();
    });

    it("has one filed line for a report, naming the person who filed it, and no line dated before the report", async () => {
      const id = await filed(await boat());
      expect((await tx(logRow({ report: id, kind: "filed", byKind: "member", byId: members.Ada, by: "Ada Test" })))?.message).toMatch(/damage_log_one_filed_idx/);
      const other = await boat();
      const second = randomUUID();
      const wrong = await tx(reportRow({ id: second, item: other }), logRow({ report: second, kind: "filed", byKind: "member", byId: members.Ben, by: "Ben Test" }));
      expect(wrong?.message).toMatch(/must name the person who filed the report/);
      const staffFiled = randomUUID();
      const asStaff = await tx(reportRow({ id: staffFiled, item: other }), logRow({ report: staffFiled, kind: "filed", byKind: "staff", by: "Test staff" }));
      expect(asStaff?.message).toMatch(/must name the person who filed the report/);
      expect((await tx(logRow({ report: id, kind: "note", at: T(9) })))?.message).toMatch(/cannot be dated before the report was filed/);
    });

    it("lets a member write only a filed line or a note, never a step that is staff's", async () => {
      const id = await filed(await boat());
      for (const kind of ["assigned", "priority_changed", "started", "taken_out_of_service", "returned_to_service", "repaired", "dismissed"]) {
        expect((await tx(logRow({ report: id, kind, byKind: "member", byId: members.Ada, by: "Ada Test" })))?.message, kind).toMatch(/Members can only file a report and add notes to their own/);
      }
      expect(await tx(logRow({ report: id, kind: "note", byKind: "member", byId: members.Ada, by: "Ada Test", text: "More." }))).toBeNull();
    });

    it("lets a member add a note only to their own report and only while it is open, and staff any time", async () => {
      const item = await boat();
      const id = await filed(item);
      const staffReport = await filed(item, { byKind: "staff" });
      const note = (report: string, byKind: string, byId: string | null) => tx(logRow({ report, kind: "note", byKind, byId, by: byKind === "member" ? "A Member" : "Test staff", at: T(12) }));
      expect((await note(id, "member", members.Ben))?.message).toMatch(/Only club staff, or the person who filed the report, can add a note/);
      expect((await note(staffReport, "member", members.Ada))?.message).toMatch(/Only club staff, or the person who filed the report, can add a note/);
      expect(await note(id, "member", members.Ada)).toBeNull();
      expect(await note(id, "staff", null)).toBeNull();
      await change(id, `status = 'in_progress', updated_at = $2`, [T(13)], staffLine(id, "started", T(13)));
      expect(await note(id, "member", members.Ada)).toBeNull();
      await change(id, `status = 'dismissed', updated_at = $2, closed_at = $2, dismissed_reason = 'Duplicate'`, [T(14)], staffLine(id, "dismissed", T(14)));
      expect((await tx(logRow({ report: id, kind: "note", byKind: "member", byId: members.Ada, by: "A Member", at: T(15) })))?.message).toMatch(/closed damage report only takes notes from club staff/);
      expect(await tx(logRow({ report: id, kind: "note", at: T(15) }))).toBeNull();
    });
  });

  describe("locked to the owner", () => {
    it("has row level security on both tables and no policy", async () => {
      const { rows } = await q(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'club' and c.relname in ('damage_reports', 'damage_log') order by 1`);
      expect(rows).toEqual([
        { relname: "damage_log", relrowsecurity: true },
        { relname: "damage_reports", relrowsecurity: true },
      ]);
      expect((await q(`select count(*)::int as n from pg_policies where schemaname = 'club' and tablename in ('damage_reports', 'damage_log')`)).rows[0].n).toBe(0);
    });
  });
});
