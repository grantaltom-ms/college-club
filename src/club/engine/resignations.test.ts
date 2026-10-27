import { describe, expect, it } from "vitest";
import { identitiesForEmail } from "../auth/identities";
import { CLASS_RULES } from "../settings/class-rules";
import { EVENT_RULES } from "../settings/event-rules";
import type { ResignationRules } from "../settings/resignation-rules";
import type { ClubState } from "../types";
import { createClass, scheduleSessions, signUp } from "./classes";
import { createEvent, rsvp } from "./events";
import { createHousehold, endHousehold, grantQualification, removeMember, setQuickbooksId, type BookingLedger } from "./households";
import { fingerprintOf } from "./import";
import { clubLedger } from "./ledger";
import { historyOf, householdOf } from "./queries";
import {
  MAX_RESIGNATION_BYTES,
  MAX_RESIGNATION_ROWS,
  RESIGNATION_COLUMNS,
  RESIGNATION_TEMPLATE,
  planResignations,
  readResignations,
  runResignations,
} from "./resignations";
import { NOW, STORE_KINDS, at, bookAs, fixtureFor, makeStore, memberCtx, staffCtx, type StoreKind } from "./testkit";

const HEADER = RESIGNATION_COLUMNS.join(",");
const row = (id: string, name = "", note = "") => `${id},${name},${note}`;
const file = (...rows: string[]) => [HEADER, ...rows].join("\n");
const rules = (maxHouseholdsPerFile: number, warnPercentOfActive = 25): ResignationRules => ({ placeholder: true, defaults: { maxHouseholdsPerFile, warnPercentOfActive } });

describe("reading a resignations file", () => {
  it("reads each row with its number as a spreadsheet shows it, skipping blank rows", () => {
    const reading = readResignations(file(row("Q1", "The Number1 household", "Moved away"), "", row("Q2")));
    expect(reading).toEqual({
      rows: [
        { row: 2, quickbooksId: "Q1", householdName: "The Number1 household", note: "Moved away" },
        { row: 4, quickbooksId: "Q2", householdName: "", note: "" },
      ],
      problems: [],
      ignoredColumns: [],
      rowCount: 2,
      hasNames: true,
    });
  });

  it("finds columns by name in any order, however they are capitalised or spelled", () => {
    const text = ["reason, QBO ID ,Customer name,Other", "Left town,Q1,The Number1 household,x"].join("\r\n");
    const reading = readResignations(text);
    expect(reading.rows).toEqual([{ row: 2, quickbooksId: "Q1", householdName: "The Number1 household", note: "Left town" }]);
    expect(reading.ignoredColumns).toEqual(["Other"]);
    expect(reading.hasNames).toBe(true);
  });

  it("needs only the QuickBooks ID, and says the IDs then cannot be checked against names", () => {
    const reading = readResignations("QuickBooks ID\nQ1\nQ2\n");
    expect(reading.rows.map((r) => r.quickbooksId)).toEqual(["Q1", "Q2"]);
    expect(reading.hasNames).toBe(false);
    expect(reading.problems).toEqual([]);
  });

  it("reads what a spreadsheet really writes: the invisible marker, quotation marks, any line endings", () => {
    const text = `${String.fromCharCode(0xfeff)}QuickBooks ID,Household name,Note\r\nQ1,"The ""Big"", Number1 household","Moved, to Spain"\rQ2,,\n`;
    const reading = readResignations(text);
    expect(reading.problems).toEqual([]);
    expect(reading.rows).toEqual([
      { row: 2, quickbooksId: "Q1", householdName: 'The "Big", Number1 household', note: "Moved, to Spain" },
      { row: 3, quickbooksId: "Q2", householdName: "", note: "" },
    ]);
  });

  it("squeezes spaces and line breaks out of a name and a note", () => {
    const reading = readResignations('QuickBooks ID,Household name,Note\nQ1,"The  Number1\nhousehold","Moved\n away"\n');
    expect(reading.rows[0]).toMatchObject({ householdName: "The Number1 household", note: "Moved away" });
  });

  it("reports every mistake in the rows at once, each with its row number", () => {
    const reading = readResignations(file(row("", "The Number0 household"), row("EXAMPLE-1"), row("Q1", "n".repeat(121)), row("Q2", "", "t".repeat(201)), row("Q3"), row("Q3"), row("x".repeat(101))));
    expect(reading.problems).toEqual([
      "Row 2: QuickBooks ID is empty. Every row needs the household's QuickBooks ID.",
      'Row 3: "EXAMPLE-1" is one of the template\'s example rows. Delete the example rows before uploading.',
      "Row 4: Household name is longer than 120 characters.",
      "Row 5: Note is longer than 200 characters.",
      "Row 7: QuickBooks ID Q3 is already on row 6. List each household once.",
      "Row 8: QuickBooks ID is longer than 100 characters.",
    ]);
    expect(reading.rows.map((r) => [r.row, r.quickbooksId])).toEqual([[6, "Q3"]]);
    expect(reading.rowCount).toBe(7);
  });

  it("allows a name and a note of exactly the longest length", () => {
    const reading = readResignations(file(row("Q1", "n".repeat(120), "t".repeat(200)), row("y".repeat(100))));
    expect(reading.problems).toEqual([]);
    expect(reading.rows).toHaveLength(2);
  });

  it("refuses the template's example rows, spelled any way", () => {
    expect(readResignations(RESIGNATION_TEMPLATE).problems).toEqual([
      'Row 2: "EXAMPLE-1" is one of the template\'s example rows. Delete the example rows before uploading.',
      'Row 3: "EXAMPLE-2" is one of the template\'s example rows. Delete the example rows before uploading.',
    ]);
    expect(readResignations(file(row("example-2"))).problems).toHaveLength(1);
  });

  it("explains a file that is not a CSV, or is empty, or is unusable, and what to do", () => {
    expect(readResignations("").problems).toEqual(["The file is empty."]);
    expect(readResignations("\n\n,,\n").problems).toEqual(["The file is empty."]);
    expect(readResignations("PK\u0003\u0004stuff").problems).toEqual(["That looks like an Excel file, not a CSV. In Excel choose Save As, then CSV (Comma delimited), and upload that."]);
    expect(readResignations("QuickBooks ID\u0000").problems).toEqual(["That is not a plain CSV text file. In your spreadsheet choose Save As, then CSV (Comma delimited), and upload that."]);
    expect(readResignations('QuickBooks ID\n"Q1').problems).toHaveLength(1);
  });

  it("names the columns it found when there is no QuickBooks ID, and refuses two columns that mean the same", () => {
    const none = readResignations("Name,Note\nThe Number1 household,x\n");
    expect(none.problems).toEqual(['The file has no column for "QuickBooks ID". It has: "Name", "Note". It needs a QuickBooks ID for each household (Household name and Note are optional).']);
    expect(none.ignoredColumns).toEqual(["Name"]);
    expect(none.rows).toEqual([]);
    expect(readResignations("QuickBooks ID,QBO ID\nQ1,Q1\n").problems).toEqual(['Two columns both mean "QuickBooks ID": "QuickBooks ID" and "QBO ID". Keep only one.']);
  });

  it("stops at the size and row limits, exactly", () => {
    const ok = "QuickBooks ID\n" + Array.from({ length: MAX_RESIGNATION_ROWS }, (_, i) => `Q${i}`).join("\n");
    expect(readResignations(ok).problems).toEqual([]);
    expect(readResignations(`${ok}\nQ-one-more`).problems).toEqual([`The file has ${MAX_RESIGNATION_ROWS + 1} rows. It can have up to ${MAX_RESIGNATION_ROWS}.`]);
    expect(readResignations("Q".repeat(MAX_RESIGNATION_BYTES + 1)).problems).toEqual([`The file is too big: it can be up to ${MAX_RESIGNATION_BYTES / 1000} KB, which is far more households than one file can end.`]);
    expect(readResignations("QuickBooks ID\n" + "Q".repeat(MAX_RESIGNATION_BYTES - 14)).problems).toEqual(["Row 2: QuickBooks ID is longer than 100 characters."]);
  });
});

const person = (first: string, last: string) => ({ firstName: first, lastName: last, email: `${first}.${last}@example.com`.toLowerCase() });

/** `n` invented households of two adults each, QuickBooks IDs Q0 to Q(n-1), all active. */
async function clubOf(kind: StoreKind, n: number) {
  const store = await makeStore(kind);
  for (let i = 0; i < n; i++) {
    await createHousehold(store, staffCtx(), {
      displayName: `The Number${i} household`,
      membershipType: "Resident",
      joinedOn: "2020-01-01",
      quickbooksId: `Q${i}`,
      primary: person("Ann", `Number${i}`),
      additional: [person("Bo", `Number${i}`)],
    });
  }
  return store;
}

/**
 * A busy club where the resigning households depend on each other and on a bystander. Quill (Ada, Ben, Cy) and Reed (Dee, Eli)
 * both resign; Zed's household stays. Boats: Ada's double has Eli as crew, Eli's double has Ben as crew. A one-chair class and a
 * two-spot dinner both have Ada first and then Dee, Ben and Zed waiting, so the waiting list runs through three households.
 */
async function busy(kind: StoreKind) {
  const f = await fixtureFor(kind)();
  await setQuickbooksId(f.store, staffCtx(), f.h.Quill, "Q-QUILL");
  await setQuickbooksId(f.store, staffCtx(), f.h.Reed, "Q-REED");
  const zed = await createHousehold(f.store, staffCtx(), { displayName: "The Zed household", membershipType: "Resident", joinedOn: "2020-01-01", quickbooksId: "Q-ZED", primary: person("Zed", "Zed") });
  f.m.Zed = zed.members[0].id;
  f.h.Zed = zed.household.id;
  await grantQualification(f.store, staffCtx(), f.m.Zed, "scull-1");
  await f.store.transaction(async (s, newId) => {
    const id = newId();
    s.items.push({ id, name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
    f.i["Boathouse gym"] = id;
  });

  const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 1, defaultMinutes: 60, roomItemId: f.i["Boathouse gym"] });
  const tomorrow = (await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(1, 9) }))[0];
  for (const who of ["Ada", "Dee", "Ben", "Zed"]) await signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m[who], who), { sessionId: tomorrow.id, memberId: f.m[who] });

  const dinner = await createEvent(f.store, staffCtx(), { title: "Dinner", startsAt: at(3, 18), endsAt: at(3, 21), capacity: 2 });
  await rsvp(f.store, EVENT_RULES, memberCtx(f.m.Ada, "Ada"), { eventId: dinner.id, memberId: f.m.Ada, guests: 1 });
  for (const who of ["Dee", "Ben", "Zed"]) await rsvp(f.store, EVENT_RULES, memberCtx(f.m[who], who), { eventId: dinner.id, memberId: f.m[who], guests: 0 });

  const ids = {
    adaLoon: (await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Eli"])).booking.id,
    eliHeron: (await bookAs(f, "Eli", "Heron", at(2, 7), at(2, 8))).booking.id,
    deeOsprey: (await bookAs(f, "Dee", "Osprey", at(1, 12), at(1, 13))).booking.id,
    eliPelican: (await bookAs(f, "Eli", "Pelican", at(3, 7), at(3, 8), ["Ben"])).booking.id,
    zedKingfisher: (await bookAs(f, "Zed", "Kingfisher", at(1, 7), at(1, 8))).booking.id,
    past: (await bookAs(f, "Ben", "Skimmer", at(-2, 7), at(-2, 8), [], undefined, at(-3, 12))).booking.id,
  };
  return { f, ids, yoga: tomorrow.id, dinner: dinner.id };
}

const QUILL_AND_REED = file(row("Q-QUILL", "The Quill household", "Moved away"), row("Q-REED", "The Reed household"));

const flipped = (before: ClubState, after: ClubState, key: "bookings" | "signups" | "rsvps") => {
  const was = new Map<string, string>(before[key].map((x) => [x.id, x.status]));
  return after[key].filter((x) => was.get(x.id) !== x.status && x.status === "cancelled").map((x) => x.id).sort();
};

/** Everything that says who is in what, without the IDs of history lines (which differ between a bulk run and one-by-one). */
const snapshot = (s: ClubState) => ({
  households: s.households.map((h) => [h.id, h.status, h.endedOn]).sort(),
  members: s.members.map((m) => [m.id, m.status]).sort(),
  bookings: s.bookings.map((b) => [b.id, b.status, [...b.crew].sort()]).sort(),
  signups: s.signups.map((g) => [g.id, g.status]).sort(),
  rsvps: s.rsvps.map((r) => [r.id, r.status, r.guests]).sort(),
  lines: s.history.map((h) => [h.householdId, h.kind]).sort(),
});

describe.each(STORE_KINDS)("ending memberships from a file on the %s store", (kind) => {
  describe("checking a file first", () => {
    it("says which households it would end and what that cancels, and changes nothing", async () => {
      const store = await clubOf(kind, 6);
      const before = await store.read();
      const text = file(row("Q1", "The Number1 household", "Moved away"), row("Q3"));
      const plan = planResignations(before, text, NOW);
      expect(plan.problems).toEqual([]);
      expect(plan.endsOn).toBe("2026-10-28");
      expect(plan.rowCount).toBe(2);
      expect(plan.toEnd.map((h) => [h.row, h.quickbooksId, h.displayName, h.adults, h.note])).toEqual([
        [2, "Q1", "The Number1 household", ["Ann Number1", "Bo Number1"], "Moved away"],
        [3, "Q3", "The Number3 household", ["Ann Number3", "Bo Number3"], ""],
      ]);
      expect(plan.adultsToBlock).toBe(4);
      expect(plan.preview.total).toBe(0);
      expect(plan.alreadyEnded).toEqual([]);
      expect(plan.fingerprint).toBe(fingerprintOf(text));
      expect(plan.fingerprint).not.toBe(fingerprintOf(`${text}\n`));
      expect(planResignations(before, text, NOW)).toEqual(plan);
      expect(await store.read()).toEqual(before);
    });

    it("lists every household whose ID is not in the club, and says what to do", async () => {
      const store = await clubOf(kind, 2);
      const plan = planResignations(await store.read(), file(row("Q99"), row("Q0"), row("007")), NOW);
      const hint = "Check the ID in QuickBooks (a spreadsheet can drop a leading zero). A household with no QuickBooks ID cannot be named in a file; end it in the household desk.";
      expect(plan.problems).toEqual([`Row 2: no household in the club has QuickBooks ID Q99. ${hint}`, `Row 4: no household in the club has QuickBooks ID 007. ${hint}`]);
    });

    it("never ends a household whose name is not the one on file, and ignores spacing and capitals when it is", async () => {
      const store = await clubOf(kind, 2);
      const state = await store.read();
      expect(planResignations(state, file(row("Q1", "The Wrong household")), NOW).problems).toEqual([
        'Row 2: QuickBooks ID Q1 is "The Number1 household" in the club, but the file calls it "The Wrong household". Fix the ID or the name, so the wrong household is never ended.',
      ]);
      const same = planResignations(state, file(row("Q1", "  the NUMBER1    household ")), NOW);
      expect(same.problems).toEqual([]);
      expect(same.toEnd.map((h) => h.quickbooksId)).toEqual(["Q1"]);
    });

    it("lists the mistakes in the order of the rows, the file reader's and the read-back's together, with a problem about the whole file last", async () => {
      const store = await clubOf(kind, 4);
      const plan = planResignations(await store.read(), file(row("Q99"), row("Q0"), row("Q1", "The Wrong household"), row("Q2"), row("Q2")), NOW, rules(1));
      expect(plan.problems.map((p) => (p.startsWith("Row") ? p.slice(0, 6) : "whole file"))).toEqual(["Row 2:", "Row 4:", "Row 6:", "whole file"]);
      expect(plan.problems[1]).toContain("The Wrong household");
      expect(plan.problems[2]).toBe("Row 6: QuickBooks ID Q2 is already on row 5. List each household once.");
      expect(plan.problems[3]).toBe("The file would end 2 households, and one file can end at most 1. If that is right, split it into files of 1 or fewer and upload them one after another.");
    });

    it("names only the adults who are still members, and counts only them as blocked", async () => {
      const store = await clubOf(kind, 3);
      const state = await store.read();
      await removeMember(store, clubLedger, staffCtx(), state.members.find((m) => m.firstName === "Bo" && m.lastName === "Number1")!.id);
      const plan = planResignations(await store.read(), file(row("Q1"), row("Q2")), NOW);
      expect(plan.toEnd.map((h) => h.adults)).toEqual([["Ann Number1"], ["Ann Number2", "Bo Number2"]]);
      expect(plan.adultsToBlock).toBe(3);
      expect(await runResignations(store, clubLedger, staffCtx(), file(row("Q1"), row("Q2")))).toMatchObject({ ended: 2, adults: 3 });
    });

    it("counts only active households when it works out what share of the club a file would end", async () => {
      const store = await clubOf(kind, 10);
      for (const id of ["Q8", "Q9"]) await endHousehold(store, clubLedger, staffCtx(), (await store.read()).households.find((h) => h.quickbooksId === id)!.id);
      // Two of the eight still active is a quarter; two of all ten would only be a fifth.
      const notices = planResignations(await store.read(), file(row("Q0"), row("Q1")), NOW).notices.filter((x) => x.startsWith("This would end"));
      expect(notices).toEqual(["This would end 2 of the club's 8 active households (25%). If you meant to upload the whole roster, stop here and check the file."]);
    });

    it("skips a household that has already ended, and says when", async () => {
      const store = await clubOf(kind, 3);
      await endHousehold(store, clubLedger, staffCtx(), (await store.read()).households.find((h) => h.quickbooksId === "Q2")!.id);
      const plan = planResignations(await store.read(), file(row("Q2", "The Number2 household"), row("Q1")), NOW);
      expect(plan.problems).toEqual([]);
      expect(plan.toEnd.map((h) => h.quickbooksId)).toEqual(["Q1"]);
      expect(plan.alreadyEnded).toEqual([{ quickbooksId: "Q2", displayName: "The Number2 household", endedOn: "2026-10-28" }]);
    });

    it("stops a file that would end more households than one file may, exactly one over", async () => {
      const store = await clubOf(kind, 6);
      const state = await store.read();
      expect(planResignations(state, file(row("Q0"), row("Q1")), NOW, rules(2)).problems).toEqual([]);
      expect(planResignations(state, file(row("Q0"), row("Q1"), row("Q2")), NOW, rules(2)).problems).toEqual([
        "The file would end 3 households, and one file can end at most 2. If that is right, split it into files of 2 or fewer and upload them one after another.",
      ]);
      expect(planResignations(state, file(row("Q0")), NOW, rules(1)).problems).toEqual([]);
    });

    it("does not count households that are skipped against that limit", async () => {
      const store = await clubOf(kind, 4);
      for (const id of ["Q2", "Q3"]) await endHousehold(store, clubLedger, staffCtx(), (await store.read()).households.find((h) => h.quickbooksId === id)!.id);
      expect(planResignations(await store.read(), file(row("Q0"), row("Q1"), row("Q2"), row("Q3")), NOW, rules(2)).problems).toEqual([]);
    });

    it("warns when a file would end a quarter of the club or more, and not below that", async () => {
      const store = await clubOf(kind, 8);
      const state = await store.read();
      const warning = (n: number) => planResignations(state, file(...Array.from({ length: n }, (_, i) => row(`Q${i}`))), NOW).notices.filter((x) => x.startsWith("This would end"));
      expect(warning(1)).toEqual([]);
      expect(warning(2)).toEqual(["This would end 2 of the club's 8 active households (25%). If you meant to upload the whole roster, stop here and check the file."]);
      expect(warning(3)).toHaveLength(1);
      expect(planResignations(state, file(row("Q0"), row("Q1")), NOW, rules(50, 26)).notices.filter((x) => x.startsWith("This would end"))).toEqual([]);
    });

    it("notes the ignored columns, a missing name column, and that dues stop from next month", async () => {
      const store = await clubOf(kind, 10);
      const state = await store.read();
      const full = planResignations(state, "QuickBooks ID,Household name,Joined,Balance\nQ1,The Number1 household,2020-01-01,5\n", NOW);
      expect(full.notices).toEqual([
        'The file has columns this tool does not use, and they are ignored: "Joined", "Balance".',
        "The file's dates are not used: these households end today, Oct 28, 2026. Dues are billed for each month in which a household was a member on the 1st, so no dues are billed from November 2026 on. Months already started are billed as usual when they are closed, along with any bar, snack bar, visitor and event charges not yet billed.",
      ]);
      const bare = planResignations(state, "QuickBooks ID\nQ1\n", NOW);
      expect(bare.notices[0]).toBe("The file has no Household name column, so the QuickBooks IDs cannot be double-checked against names. Adding one is the best protection against ending the wrong household.");
      // With nothing to end there is nothing to say about dues.
      expect(planResignations(state, "QuickBooks ID,Household name\n", NOW).notices).toEqual([]);
    });

    it("names the month after the ending, across a year end", async () => {
      const store = await clubOf(kind, 1);
      const december = new Date("2026-12-31T20:00:00Z");
      const plan = planResignations(await store.read(), file(row("Q0")), december);
      expect(plan.notices.some((n) => n.includes("no dues are billed from January 2027 on"))).toBe(true);
      expect(plan.endsOn).toBe("2026-12-31");
    });
  });

  describe("ending the households", () => {
    it("ends exactly what was previewed, including a waiting list that runs through three households", async () => {
      const { f, ids, yoga, dinner } = await busy(kind);
      const before = await f.store.read();
      const plan = planResignations(before, QUILL_AND_REED, NOW);
      expect(plan.problems).toEqual([]);
      expect(plan.toEnd.map((h) => h.displayName)).toEqual(["The Quill household", "The Reed household"]);
      expect(plan.adultsToBlock).toBe(5);

      // Worked out together: a boat booked by one resigning household with crew from the other is cancelled once, not also a seat given up.
      expect(plan.preview.bookings.map((l) => l.id).sort()).toEqual([ids.adaLoon, ids.eliHeron, ids.deeOsprey, ids.eliPelican].sort());
      expect(plan.preview.crewSeats).toEqual([]);
      expect(plan.preview.signUps).toHaveLength(3);
      expect(plan.preview.rsvps).toHaveLength(3);
      expect(plan.preview.total).toBe(10);

      const result = await runResignations(f.store, clubLedger, staffCtx(), QUILL_AND_REED, { fingerprint: plan.fingerprint, households: plan.toEnd.length, adults: plan.adultsToBlock });
      expect(result).toEqual({ ended: 2, adults: 5, cancelledBookings: 4, cancelledSignUps: 3, cancelledRsvps: 3, alreadyEnded: 0 });
      const after = await f.store.read();

      expect(plan.preview.bookings.map((l) => l.id).sort()).toEqual(flipped(before, after, "bookings"));
      expect(plan.preview.signUps.map((l) => l.id).sort()).toEqual(flipped(before, after, "signups"));
      expect(plan.preview.rsvps.map((l) => l.id).sort()).toEqual(flipped(before, after, "rsvps"));

      for (const h of ["Quill", "Reed"]) expect(householdOf(after, f.h[h])).toMatchObject({ status: "ended", endedOn: "2026-10-28" });
      for (const name of ["Ada", "Ben", "Cy", "Dee", "Eli"]) expect(after.members.find((m) => m.id === f.m[name])!.status).toBe("household_ended");
      // The bystander is untouched, and the waiting lists moved up to them.
      expect(householdOf(after, f.h.Zed)!.status).toBe("active");
      expect(after.members.find((m) => m.id === f.m.Zed)!.status).toBe("active");
      expect(after.bookings.find((b) => b.id === ids.zedKingfisher)!.status).toBe("upcoming");
      expect(after.signups.find((g) => g.sessionId === yoga && g.memberId === f.m.Zed)!.status).toBe("enrolled");
      expect(after.rsvps.find((r) => r.eventId === dinner && r.memberId === f.m.Zed)!.status).toBe("going");
      // A past outing stays as history.
      expect(after.bookings.find((b) => b.id === ids.past)!.status).toBe(before.bookings.find((b) => b.id === ids.past)!.status);
    });

    it("writes each household's file: where it came from, the note, and what was cancelled", async () => {
      const { f } = await busy(kind);
      await runResignations(f.store, clubLedger, staffCtx(), QUILL_AND_REED);
      const after = await f.store.read();
      const quill = historyOf(after, f.h.Quill).find((e) => e.kind === "membership_ended")!;
      expect(quill.summary).toBe("Membership ended on Oct 28, 2026, from a resignations file. 3 adults can no longer book. Note: Moved away");
      expect(quill.details).toMatchObject({ endedOn: "2026-10-28", adults: 3, source: "a resignations file", note: "Moved away" });
      expect(quill.actor).toEqual({ kind: "staff", label: "Test staff" });
      const reed = historyOf(after, f.h.Reed).find((e) => e.kind === "membership_ended")!;
      expect(reed.summary).toBe("Membership ended on Oct 28, 2026, from a resignations file. 2 adults can no longer book.");
      expect(reed.details).not.toHaveProperty("note");
      expect(historyOf(after, f.h.Quill).map((e) => e.kind)).toEqual(expect.arrayContaining(["bookings_cancelled", "signups_cancelled", "rsvps_cancelled"]));
      // The household the file did not name has no such line.
      expect(historyOf(after, f.h.Zed).map((e) => e.kind)).not.toContain("membership_ended");
    });

    it("leaves exactly the records that ending the same households one at a time leaves", async () => {
      const bulk = await busy(kind);
      const single = await busy(kind);
      await runResignations(bulk.f.store, clubLedger, staffCtx(), QUILL_AND_REED);
      await endHousehold(single.f.store, clubLedger, staffCtx(), single.f.h.Quill);
      await endHousehold(single.f.store, clubLedger, staffCtx(), single.f.h.Reed);
      expect(snapshot(await bulk.f.store.read())).toEqual(snapshot(await single.f.store.read()));
    });

    it("signs the adults out: their addresses open nothing any more", async () => {
      const store = await clubOf(kind, 3);
      expect(identitiesForEmail(await store.read(), [], "ann.number1@example.com")).toHaveLength(1);
      await runResignations(store, clubLedger, staffCtx(), file(row("Q1")));
      const state = await store.read();
      expect(identitiesForEmail(state, [], "ann.number1@example.com")).toEqual([]);
      expect(identitiesForEmail(state, [], "bo.number1@example.com")).toEqual([]);
      expect(identitiesForEmail(state, [], "ann.number2@example.com")).toHaveLength(1);
    });

    it("is for staff only, and a member's attempt changes nothing", async () => {
      const { f } = await busy(kind);
      const before = await f.store.read();
      await expect(runResignations(f.store, clubLedger, memberCtx(f.m.Ada, "Ada"), QUILL_AND_REED)).rejects.toMatchObject({ code: "forbidden", message: "Only club staff can end memberships." });
      expect(await f.store.read()).toEqual(before);
    });

    it("ends nothing from a file with a problem, even if the other rows are fine", async () => {
      const store = await clubOf(kind, 3);
      const before = await store.read();
      const text = file(row("Q0"), row("Q99"), row("Q1", "The Wrong household"));
      await expect(runResignations(store, clubLedger, staffCtx(), text)).rejects.toMatchObject({
        code: "invalid",
        message: "The file has 2 problems, so nothing was ended. Fix the file and check it again.",
      });
      expect(await store.read()).toEqual(before);
      await expect(runResignations(store, clubLedger, staffCtx(), file(row("Q99")))).rejects.toThrow("The file has 1 problem, so nothing was ended.");
    });

    it("says so when there is nothing to end", async () => {
      const store = await clubOf(kind, 2);
      await expect(runResignations(store, clubLedger, staffCtx(), `${HEADER}\n`)).rejects.toMatchObject({ code: "conflict", message: "The file has no households to end." });
      await runResignations(store, clubLedger, staffCtx(), file(row("Q0")));
      await expect(runResignations(store, clubLedger, staffCtx(), file(row("Q0")))).rejects.toMatchObject({ code: "conflict", message: "Every household in the file has already ended, so there is nothing to do." });
    });

    it("ends the households once however many people press confirm at once", async () => {
      const store = await clubOf(kind, 3);
      const text = file(row("Q0"), row("Q1"));
      const results = await Promise.allSettled([runResignations(store, clubLedger, staffCtx(), text), runResignations(store, clubLedger, staffCtx(), text), runResignations(store, clubLedger, staffCtx(), text)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "conflict", message: "Every household in the file has already ended, so there is nothing to do." });
      const state = await store.read();
      expect(state.households.filter((h) => h.status === "ended").map((h) => h.quickbooksId).sort()).toEqual(["Q0", "Q1"]);
      expect(state.history.filter((h) => h.kind === "membership_ended")).toHaveLength(2);
    });

    it("ends none of them when one of them fails part-way", async () => {
      const { f } = await busy(kind);
      const before = await f.store.read();
      let calls = 0;
      const breaking: BookingLedger = {
        ...clubLedger,
        cancelFutureBookings: async (input) => {
          if (++calls === 2) throw new Error("The ledger broke on the second household.");
          return clubLedger.cancelFutureBookings(input);
        },
      };
      await expect(runResignations(f.store, breaking, staffCtx(), QUILL_AND_REED)).rejects.toThrow("The ledger broke on the second household.");
      expect(calls).toBe(2);
      expect(await f.store.read()).toEqual(before);
      // And the same file then works.
      expect((await runResignations(f.store, clubLedger, staffCtx(), QUILL_AND_REED)).ended).toBe(2);
    });
  });

  describe("confirming exactly what was checked", () => {
    const refusal = "The file, or the club's records, changed since you checked it, so nothing was ended. Check the file again.";

    it("ends them when it is the file that was checked, and refuses a different file, or a club that changed in between", async () => {
      const store = await clubOf(kind, 4);
      const text = file(row("Q0"), row("Q1"));
      const plan = planResignations(await store.read(), text, NOW);
      const expectNow = { fingerprint: plan.fingerprint, households: plan.toEnd.length, adults: plan.adultsToBlock };
      const before = await store.read();

      // Another file with the same number of households.
      await expect(runResignations(store, clubLedger, staffCtx(), file(row("Q0"), row("Q2")), expectNow)).rejects.toMatchObject({ code: "conflict", message: refusal });
      // The same file, but the numbers staff saw were different.
      await expect(runResignations(store, clubLedger, staffCtx(), text, { ...expectNow, households: 3 })).rejects.toMatchObject({ message: refusal });
      await expect(runResignations(store, clubLedger, staffCtx(), text, { ...expectNow, adults: 3 })).rejects.toMatchObject({ message: refusal });
      await expect(runResignations(store, clubLedger, staffCtx(), `${text}\n`, expectNow)).rejects.toMatchObject({ message: refusal });
      expect(await store.read()).toEqual(before);

      // Someone removed an adult between checking and confirming: the counts no longer match.
      const state = await store.read();
      await removeMember(store, clubLedger, staffCtx(), state.members.find((m) => m.firstName === "Bo" && m.lastName === "Number1")!.id);
      await expect(runResignations(store, clubLedger, staffCtx(), text, expectNow)).rejects.toMatchObject({ message: refusal });
      expect((await store.read()).households.filter((h) => h.status === "ended")).toHaveLength(0);

      // Checked again, it goes through.
      const again = planResignations(await store.read(), text, NOW);
      const done = await runResignations(store, clubLedger, staffCtx(), text, { fingerprint: again.fingerprint, households: again.toEnd.length, adults: again.adultsToBlock });
      expect(done).toMatchObject({ ended: 2, adults: 3 });
    });

    it("refuses when one of the households was ended by hand after the check", async () => {
      const store = await clubOf(kind, 3);
      const text = file(row("Q0"), row("Q1"));
      const plan = planResignations(await store.read(), text, NOW);
      await endHousehold(store, clubLedger, staffCtx(), (await store.read()).households.find((h) => h.quickbooksId === "Q0")!.id);
      await expect(runResignations(store, clubLedger, staffCtx(), text, { fingerprint: plan.fingerprint, households: plan.toEnd.length, adults: plan.adultsToBlock })).rejects.toMatchObject({ message: refusal });
      expect(householdOf(await store.read(), (await store.read()).households.find((h) => h.quickbooksId === "Q1")!.id)!.status).toBe("active");
    });
  });

  describe("a big wave, and using it again and again", () => {
    it("ends forty households of two adults each in one go, and a repeat ends nothing", async () => {
      const store = await clubOf(kind, 45);
      const text = file(...Array.from({ length: 40 }, (_, i) => row(`Q${i}`, `The Number${i} household`)));
      const plan = planResignations(await store.read(), text, NOW);
      expect(plan).toMatchObject({ problems: [], adultsToBlock: 80 });
      expect(await runResignations(store, clubLedger, staffCtx(), text, { fingerprint: plan.fingerprint, households: 40, adults: 80 })).toMatchObject({ ended: 40, adults: 80 });
      const state = await store.read();
      expect(state.households.filter((h) => h.status === "ended")).toHaveLength(40);
      expect(state.households.filter((h) => h.status === "active")).toHaveLength(5);
      expect(state.members.filter((m) => m.status === "household_ended")).toHaveLength(80);
      expect(state.history.filter((h) => h.kind === "membership_ended")).toHaveLength(40);
      const repeat = planResignations(state, text, NOW);
      expect(repeat.toEnd).toEqual([]);
      expect(repeat.alreadyEnded).toHaveLength(40);
    }, 180_000);

    it("ends a few more each time, ten times over, and every one ends exactly once", async () => {
      const store = await clubOf(kind, 40);
      for (let round = 0; round < 10; round++) {
        const text = file(...Array.from({ length: 4 }, (_, i) => row(`Q${round * 4 + i}`)));
        expect(await runResignations(store, clubLedger, staffCtx(), text), `round ${round}`).toMatchObject({ ended: 4, adults: 8 });
      }
      const state = await store.read();
      expect(state.households.filter((h) => h.status === "ended")).toHaveLength(40);
      expect(state.history.filter((h) => h.kind === "membership_ended")).toHaveLength(40);
    }, 180_000);
  });
});
