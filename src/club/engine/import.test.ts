import { describe, expect, it } from "vitest";
import { identitiesForEmail } from "../auth/identities";
import { ClubError } from "../errors";
import type { Actor } from "../types";
import { blockReasonFor } from "./eligibility";
import { createHousehold, endHousehold, removeMember } from "./households";
import { clubLedger } from "./ledger";
import { fingerprintOf, planImport, runImport } from "./import";
import { historyOf, householdOf, membersOf } from "./queries";
import { ROSTER_COLUMNS } from "./roster";
import { NOW, STORE_KINDS, makeStore, memberCtx, staffCtx } from "./testkit";

const TODAY = "2026-10-28";
const HEADER = ROSTER_COLUMNS.join(",");
type R = Partial<Record<"id" | "name" | "type" | "joined" | "first" | "last" | "email" | "phone" | "role", string>>;
const row = (o: R = {}) =>
  [o.id ?? "1001", o.name ?? "The Aldridge household", o.type ?? "Resident", o.joined ?? "2015-06-01", o.first ?? "Una", o.last ?? "Aldridge", o.email ?? "una@example.com", o.phone ?? "", o.role ?? ""].join(",");
const file = (...rows: string[]) => [HEADER, ...rows].join("\n");

/** A roster of `n` invented households, two adults each. */
const bigFile = (n: number) =>
  file(
    ...Array.from({ length: n }, (_, i) => [row({ id: `Q${i}`, name: `The Number${i} household`, first: "Ann", last: `Number${i}`, email: `ann${i}@example.com` }), row({ id: `Q${i}`, name: `The Number${i} household`, first: "Bo", last: `Number${i}`, email: `bo${i}@example.com`, phone: "206-555-0100" })]).flat(),
  );

const GOOD = file(
  row({ id: "1001", first: "Una", email: "una@example.com", phone: "206-555-0101" }),
  row({ id: "1001", first: "Vic", email: "vic@example.com" }),
  row({ id: "1002", name: "The Bowman household", type: "Intermediate", joined: "3/14/2022", first: "Wes", last: "Bowman", email: "wes@example.com" }),
  row({ id: "1003", name: "The Castle household", type: "Non-Resident", joined: "2019-09-30", first: "Xia", last: "Castle", email: "family@example.com" }),
  row({ id: "1003", name: "The Castle household", type: "Non-Resident", joined: "2019-09-30", first: "Yan", last: "Castle", email: "family@example.com" }),
);

describe.each(STORE_KINDS)("importing a roster on the %s store", (kind) => {
  const open = () => makeStore(kind);

  describe("checking a file first", () => {
    it("says what it would add, and changes nothing", async () => {
      const store = await open();
      const before = await store.read();
      const plan = planImport(before, GOOD, TODAY);
      expect(plan.problems).toEqual([]);
      expect(plan.rowCount).toBe(5);
      expect(plan.toAdd.map((h) => [h.quickbooksId, h.displayName, h.membershipType, h.joinedOn, h.adults.length])).toEqual([
        ["1001", "The Aldridge household", "Resident", "2015-06-01", 2],
        ["1002", "The Bowman household", "Intermediate", "2022-03-14", 1],
        ["1003", "The Castle household", "Non-Resident", "2019-09-30", 2],
      ]);
      expect(plan.toAdd[0].adults).toEqual([
        { name: "Una Aldridge", email: "una@example.com", role: "primary" },
        { name: "Vic Aldridge", email: "vic@example.com", role: "additional" },
      ]);
      expect(plan.adultsToAdd).toBe(5);
      expect(plan.alreadyHere).toEqual([]);
      expect(plan.fingerprint).toBe(fingerprintOf(GOOD));
      expect(plan.fingerprint).not.toBe(fingerprintOf(`${GOOD}\n`));
      expect(await store.read()).toEqual(before);
    });

    it("carries a file's problems with it, so nothing can be added", async () => {
      const store = await open();
      const plan = planImport(await store.read(), file(row(), row({ id: "1002", email: "bad" })), TODAY);
      expect(plan.problems).toEqual(['Row 3: "bad" does not look like an email address.']);
    });
  });

  describe("adding the households", () => {
    it("adds every household and adult with their details, QuickBooks ID and a record in the household's file", async () => {
      const store = await open();
      const result = await runImport(store, staffCtx(), GOOD);
      expect(result).toEqual({ added: 3, adults: 5, alreadyHere: 0 });
      const state = await store.read();
      expect(state.households.map((h) => [h.displayName, h.quickbooksId, h.membershipType, h.joinedOn, h.status, h.endedOn])).toEqual([
        ["The Aldridge household", "1001", "Resident", "2015-06-01", "active", null],
        ["The Bowman household", "1002", "Intermediate", "2022-03-14", "active", null],
        ["The Castle household", "1003", "Non-Resident", "2019-09-30", "active", null],
      ]);
      const aldridge = state.households[0];
      expect(membersOf(state, aldridge.id).map((m) => [m.firstName, m.lastName, m.email, m.phone, m.role, m.status])).toEqual([
        ["Una", "Aldridge", "una@example.com", "206-555-0101", "primary", "active"],
        ["Vic", "Aldridge", "vic@example.com", "", "additional", "active"],
      ]);
      for (const m of state.members) {
        expect(blockReasonFor(state, m.id), m.firstName).toBeNull();
        expect([m.brivoCredentialId, m.mailchimpContactId, m.loginId]).toEqual([null, null, null]);
      }
      // The household's file says it was added from a roster file, with the join date, by whom, and the line cannot be missed.
      const lines = historyOf(state, aldridge.id);
      expect(lines.map((l) => l.kind).sort()).toEqual(["joined", "member_added", "member_added"]);
      const joined = lines.find((l) => l.kind === "joined")!;
      expect(joined.summary).toBe("The Aldridge household joined as Resident. Added from a roster file; join date Jun 1, 2015.");
      expect(joined.actor).toMatchObject({ kind: "staff" });
      expect(joined.at).toBe(NOW.toISOString());
      expect(joined.details).toEqual({ joinedOn: "2015-06-01", membershipType: "Resident", quickbooksId: "1001", source: "a roster file" });
    });

    it("lets everyone who was added sign in, partners on a shared address together", async () => {
      const store = await open();
      await runImport(store, staffCtx(), GOOD);
      const state = await store.read();
      expect(identitiesForEmail(state, [], "UNA@example.com").map((i) => i.kind === "member" && i.name)).toEqual(["Una Aldridge"]);
      expect(identitiesForEmail(state, [], "family@example.com").map((i) => i.kind === "member" && i.name)).toEqual(["Xia Castle", "Yan Castle"]);
    });

    it("adds nothing at all if the file has a single problem", async () => {
      const store = await open();
      const before = await store.read();
      await expect(runImport(store, staffCtx(), file(row(), row({ id: "1002", email: "bad" })))).rejects.toMatchObject({ code: "invalid", message: "The file has 1 problem, so nothing was added. Fix the file and check it again." });
      await expect(runImport(store, staffCtx(), file(row({ type: "x" }), row({ id: "1002", email: "bad" })))).rejects.toThrow("The file has 2 problems, so nothing was added.");
      expect(await store.read()).toEqual(before);
    });

    it("says so when there is nothing to add", async () => {
      const store = await open();
      await expect(runImport(store, staffCtx(), HEADER)).rejects.toMatchObject({ code: "conflict", message: "The file has no households to add." });
      expect((await store.read()).households).toHaveLength(0);
    });

    it("is for staff only, and a member cannot import even their own household", async () => {
      const store = await open();
      const { members } = await createHousehold(store, staffCtx(), { displayName: "The Existing household", membershipType: "Resident", joinedOn: "2020-01-01", primary: { firstName: "Em", lastName: "Existing", email: "em@example.com" } });
      const before = await store.read();
      const member: Actor = { kind: "member", memberId: members[0].id, label: "Em Existing" };
      await expect(runImport(store, { actor: member, now: NOW }, GOOD)).rejects.toMatchObject({ code: "forbidden" });
      await expect(runImport(store, memberCtx(members[0].id), GOOD)).rejects.toThrow("Only club staff can import households.");
      expect(await store.read()).toEqual(before);
    });
  });

  describe("a second upload only adds", () => {
    it("adds new households, skips ones already here (by QuickBooks ID) and never changes them", async () => {
      const store = await open();
      await runImport(store, staffCtx(), GOOD);
      const before = await store.read();
      // The same households again, but with different details, and one new household.
      const next = file(
        row({ id: "1001", type: "Non-Resident", joined: "2000-01-01", name: "A Different Name", first: "Una", email: "changed@example.com" }),
        row({ id: "1002", name: "The Bowman household", type: "Intermediate", joined: "3/14/2022", first: "Wes", last: "Bowman", email: "wes@example.com" }),
        row({ id: "1004", name: "The Dunmore household", first: "Zed", last: "Dunmore", email: "zed@example.com" }),
      );
      const plan = planImport(before, next, TODAY);
      expect(plan.toAdd.map((h) => h.quickbooksId)).toEqual(["1004"]);
      expect(plan.alreadyHere).toEqual([
        { quickbooksId: "1001", fileName: "A Different Name", existingName: "The Aldridge household", ended: false, adults: 1 },
        { quickbooksId: "1002", fileName: "The Bowman household", existingName: "The Bowman household", ended: false, adults: 1 },
      ]);
      expect(await runImport(store, staffCtx(), next)).toEqual({ added: 1, adults: 1, alreadyHere: 2 });
      const after = await store.read();
      expect(after.households).toHaveLength(4);
      expect(after.households.slice(0, 3)).toEqual(before.households);
      expect(after.members.slice(0, 5)).toEqual(before.members);
      expect(after.history.filter((h) => before.households.some((x) => x.id === h.householdId))).toEqual(before.history);
    });

    it("says there is nothing to add when every household is already here, and changes nothing", async () => {
      const store = await open();
      await runImport(store, staffCtx(), GOOD);
      const before = await store.read();
      await expect(runImport(store, staffCtx(), GOOD)).rejects.toMatchObject({ code: "conflict", message: "Every household in the file is already here, so there is nothing to add." });
      expect(await store.read()).toEqual(before);
    });

    it("skips a household that was added by hand with the same QuickBooks ID, and one whose membership has ended", async () => {
      const store = await open();
      const { household } = await createHousehold(store, staffCtx(), { displayName: "The Typed-In household", membershipType: "Resident", joinedOn: "2020-01-01", quickbooksId: "1001", primary: { firstName: "Tess", lastName: "Typed", email: "tess@example.com" } });
      await endHousehold(store, clubLedger, staffCtx(), household.id);
      const plan = planImport(await store.read(), GOOD, TODAY);
      expect(plan.alreadyHere).toEqual([{ quickbooksId: "1001", fileName: "The Aldridge household", existingName: "The Typed-In household", ended: true, adults: 2 }]);
      await runImport(store, staffCtx(), GOOD);
      const state = await store.read();
      expect(householdOf(state, household.id)).toMatchObject({ status: "ended", displayName: "The Typed-In household" });
      expect(state.households.map((h) => h.quickbooksId)).toEqual(["1001", "1002", "1003"]);
    });

    it("never removes or ends anyone who is not in the file", async () => {
      const store = await open();
      const { household, members } = await createHousehold(store, staffCtx(), { displayName: "The Old household", membershipType: "Resident", joinedOn: "2010-01-01", quickbooksId: "OLD", primary: { firstName: "Olly", lastName: "Old", email: "olly@example.com" } });
      await runImport(store, staffCtx(), GOOD);
      const state = await store.read();
      expect(householdOf(state, household.id)?.status).toBe("active");
      expect(state.members.find((m) => m.id === members[0].id)?.status).toBe("active");
    });

    it("lets two people press confirm at once: the file is added exactly once", async () => {
      const store = await open();
      const results = await Promise.allSettled([runImport(store, staffCtx(), GOOD), runImport(store, staffCtx(), GOOD), runImport(store, staffCtx(), GOOD)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "conflict", message: "Every household in the file is already here, so there is nothing to add." });
      const state = await store.read();
      expect(state.households).toHaveLength(3);
      expect(state.members).toHaveLength(5);
    });
  });

  describe("confirming exactly what was checked", () => {
    it("adds the file when it is the one that was checked, and refuses when it is not or when the club changed in between", async () => {
      const store = await open();
      const plan = planImport(await store.read(), GOOD, TODAY);
      const expect_ = { fingerprint: plan.fingerprint, households: plan.toAdd.length, adults: plan.adultsToAdd };
      const refusal = "The file, or the club's records, changed since you checked it, so nothing was added. Check the file again.";
      // A different file.
      await expect(runImport(store, staffCtx(), `${GOOD}\n`, expect_)).rejects.toMatchObject({ code: "conflict", message: refusal });
      // The club changed after the check: one of the households is now here.
      await createHousehold(store, staffCtx(), { displayName: "Someone Typed This", membershipType: "Resident", joinedOn: "2020-01-01", quickbooksId: "1002", primary: { firstName: "Tess", lastName: "Typed", email: "tess@example.com" } });
      await expect(runImport(store, staffCtx(), GOOD, expect_)).rejects.toMatchObject({ code: "conflict", message: refusal });
      expect((await store.read()).households).toHaveLength(1);
      // Checking again gives the new picture, and that one goes through.
      const again = planImport(await store.read(), GOOD, TODAY);
      expect(await runImport(store, staffCtx(), GOOD, { fingerprint: again.fingerprint, households: again.toAdd.length, adults: again.adultsToAdd })).toEqual({ added: 2, adults: 4, alreadyHere: 1 });
    });
  });

  describe("things worth a look, that do not stop the import", () => {
    it("points out columns it ignores, an address used in several households or already used here, and a name already here", async () => {
      const store = await open();
      await createHousehold(store, staffCtx(), { displayName: "The Aldridge household", membershipType: "Resident", joinedOn: "2020-01-01", primary: { firstName: "Una", lastName: "Aldridge", email: "una@example.com" } });
      const text = [
        `${HEADER},Balance`,
        `${row({ id: "2001", name: "The Eastman household", first: "Ed", last: "Eastman", email: "shared@example.com" })},$0`,
        `${row({ id: "2002", name: "The Fairfax household", first: "Fay", last: "Fairfax", email: "shared@example.com" })},$0`,
        `${row({ id: "2003", name: "The Aldridge household", first: "Una", last: "Aldridge", email: "una@example.com" })},$0`,
      ].join("\n");
      const plan = planImport(await store.read(), text, TODAY);
      expect(plan.problems).toEqual([]);
      expect(plan.toAdd).toHaveLength(3);
      expect(plan.notices).toEqual([
        'The file has columns this import does not use, and they are ignored: "Balance".',
        'A household called "The Aldridge household" is already here (QuickBooks ID: none). The file\'s "The Aldridge household" (QuickBooks ID 2003) will be added as a separate household. If they are the same, stop here and fix the file.',
        'The address shared@example.com is used in more than one household in the file (The Eastman household, The Fairfax household). That is allowed: whoever signs in with it is asked "Which of you?".',
        "una@example.com (Una Aldridge) is already used by Una Aldridge in The Aldridge household.",
      ]);
      // Notices never stop the import.
      expect(await runImport(store, staffCtx(), text)).toMatchObject({ added: 3 });
    });

    it("does not count someone who has left as still holding an address", async () => {
      const store = await open();
      const { members } = await createHousehold(store, staffCtx(), {
        displayName: "The Aldridge household",
        membershipType: "Resident",
        joinedOn: "2020-01-01",
        primary: { firstName: "Una", lastName: "Aldridge", email: "una@example.com" },
        additional: [{ firstName: "Vic", lastName: "Aldridge", email: "vic@example.com" }],
      });
      const text = file(row({ id: "2001", name: "The Eastman household", first: "Ed", last: "Eastman", email: "vic@example.com" }), row({ id: "2002", name: "The Fairfax household", first: "Fay", last: "Fairfax", email: "una@example.com" }));
      // While Vic is on the household, his address is taken; once he has left, it is free.
      expect(planImport(await store.read(), text, TODAY).notices).toEqual(["vic@example.com (Ed Eastman) is already used by Vic Aldridge in The Aldridge household.", "una@example.com (Fay Fairfax) is already used by Una Aldridge in The Aldridge household."]);
      await removeMember(store, clubLedger, staffCtx(), members[1].id);
      expect(planImport(await store.read(), text, TODAY).notices).toEqual(["una@example.com (Fay Fairfax) is already used by Una Aldridge in The Aldridge household."]);
    });
  });

  describe("a big roster, and using it again and again", () => {
    it("adds three hundred households of two adults each in one go, and a repeat adds nothing", async () => {
      const store = await open();
      const text = bigFile(300);
      const plan = planImport(await store.read(), text, TODAY);
      expect(plan).toMatchObject({ problems: [], adultsToAdd: 600 });
      expect(plan.toAdd).toHaveLength(300);
      expect(await runImport(store, staffCtx(), text)).toEqual({ added: 300, adults: 600, alreadyHere: 0 });
      const state = await store.read();
      expect(state.households).toHaveLength(300);
      expect(state.members).toHaveLength(600);
      expect(state.history.filter((h) => h.kind === "joined")).toHaveLength(300);
      expect(new Set(state.households.map((h) => h.quickbooksId)).size).toBe(300);
      const repeat = planImport(state, text, TODAY);
      expect(repeat.toAdd).toEqual([]);
      expect(repeat.alreadyHere).toHaveLength(300);
    }, 120_000);

    it("adds a few more households each time, ten times over, and every one is there exactly once", async () => {
      const store = await open();
      for (let round = 1; round <= 10; round++) {
        const text = bigFile(round * 3);
        const { added } = await runImport(store, staffCtx(), text);
        expect(added, `round ${round}`).toBe(3);
      }
      const state = await store.read();
      expect(state.households).toHaveLength(30);
      expect(state.members).toHaveLength(60);
    }, 120_000);
  });

  describe("a QuickBooks ID on a household added by hand", () => {
    it("is stored, kept to one household, and refused when empty", async () => {
      const store = await open();
      const { household } = await createHousehold(store, staffCtx(), { displayName: "The Tagged household", membershipType: "Resident", joinedOn: "2020-01-01", quickbooksId: "  QB-7  ", primary: { firstName: "Tag", lastName: "Tagged", email: "tag@example.com" } });
      expect(household.quickbooksId).toBe("QB-7");
      await expect(createHousehold(store, staffCtx(), { displayName: "The Copy household", membershipType: "Resident", joinedOn: "2020-01-01", quickbooksId: "QB-7", primary: { firstName: "Cop", lastName: "Copy", email: "cop@example.com" } })).rejects.toMatchObject({
        code: "conflict",
        message: "QuickBooks ID QB-7 already belongs to The Tagged household.",
      });
      await expect(createHousehold(store, staffCtx(), { displayName: "The Blank household", membershipType: "Resident", joinedOn: "2020-01-01", quickbooksId: "  ", primary: { firstName: "Bla", lastName: "Blank", email: "bla@example.com" } })).rejects.toThrow(ClubError);
      expect((await store.read()).households).toHaveLength(1);
    });

    it("is left empty when none is given, as before", async () => {
      const store = await open();
      const { household } = await createHousehold(store, staffCtx(), { displayName: "The Plain household", membershipType: "Resident", joinedOn: "2020-01-01", primary: { firstName: "Pla", lastName: "Plain", email: "pla@example.com" } });
      expect(household.quickbooksId).toBeNull();
      const lines = historyOf(await store.read(), household.id);
      expect(lines.find((l) => l.kind === "joined")).toMatchObject({ summary: "The Plain household joined as Resident.", details: { joinedOn: "2020-01-01", membershipType: "Resident" } });
    });
  });
});
