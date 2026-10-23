import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { middayPacific } from "../time";
import type { Actor } from "../types";
import { bookingLedger as NO_BOOKINGS_YET } from "./bookings";
import {
  addMember,
  changeMembershipType,
  createHousehold,
  endHousehold,
  grantQualification,
  householdFieldsProblem,
  memberFieldsProblem,
  planMemberDetails,
  removeMember,
  updateMemberDetails,
  type BookingLedger,
  type Ctx,
} from "./households";
import { blockReasonFor, meetsQualification } from "./eligibility";
import { historyOf, membersOf, qualificationsOf } from "./queries";
import { STORE_KINDS, makeStore } from "./testkit";

describe.each(STORE_KINDS)("on the %s store", (kind) => {
  const staff: Actor = { kind: "staff", label: "Test staff" };
  const at = (day: string) => middayPacific(day);
  const ctx = (day = "2026-10-22", actor: Actor = staff): Ctx => ({ actor, now: at(day) });

  const ada = { firstName: "Ada", lastName: "Quill", email: "ada@example.com", phone: "206-555-0101" };
  const ben = { firstName: "Ben", lastName: "Quill", email: "ben@example.com" };
  const cy = { firstName: "Cy", lastName: "Quill", email: "cy@example.com" };

  async function setup(extra = [ben]) {
    const store = await makeStore(kind);
    const { household, members } = await createHousehold(store, ctx("2020-01-15"), {
      displayName: "The Quill household",
      membershipType: "Resident",
      joinedOn: "2020-01-15",
      primary: ada,
      additional: extra,
    });
    return { store, household, members };
  }

  /** A pretend booking calendar that holds a few future bookings and cancels them on request. */
  function fakeLedger(booked: Record<string, string[]>) {
    const calls: { memberIds: string[]; reason: string }[] = [];
    const ledger: BookingLedger = {
      async cancelFutureBookings({ memberIds, reason }) {
        calls.push({ memberIds, reason });
        return memberIds.flatMap((id) => booked[id] ?? []);
      },
    };
    return { ledger, calls };
  }

  describe("a household joins", () => {
    it("creates the household and each adult with permanent IDs, empty link slots and a joined line in its file", async () => {
      const { store, household, members } = await setup();
      expect(household).toMatchObject({ status: "active", endedOn: null, quickbooksId: null, notes: "", joinedOn: "2020-01-15" });
      expect(members.map((m) => m.role)).toEqual(["primary", "additional"]);
      for (const m of members) {
        expect(m).toMatchObject({ status: "active", householdId: household.id, brivoCredentialId: null, mailchimpContactId: null, loginId: null });
      }
      expect(new Set([household.id, ...members.map((m) => m.id)]).size).toBe(3);
      const history = historyOf(await store.read(), household.id);
      expect(history.map((e) => e.kind).sort()).toEqual(["joined", "member_added", "member_added"]);
      expect(history.find((e) => e.kind === "joined")?.actor).toEqual(staff);
    });

    it("allows two adults to share one email address", async () => {
      const { members } = await setup([{ ...ben, email: ada.email }]);
      expect(members[0].email).toBe(members[1].email);
    });

    it("refuses bad input in plain words", async () => {
      const store = await makeStore(kind);
      const base = { displayName: "The X household", membershipType: "Resident" as const, joinedOn: "2026-01-01", primary: ada };
      await expect(createHousehold(store, ctx(), { ...base, displayName: "  " })).rejects.toThrow("The household name is required.");
      await expect(createHousehold(store, ctx(), { ...base, primary: { ...ada, email: "nope" } })).rejects.toThrow('"nope" does not look like an email address.');
      await expect(createHousehold(store, ctx(), { ...base, joinedOn: "Jan 1" })).rejects.toThrow("The join date must look like 2026-10-22.");
      await expect(createHousehold(store, ctx(), { ...base, membershipType: "Gold" as never })).rejects.toThrow("Choose Resident, Intermediate or Non-Resident.");
      await expect(createHousehold(store, ctx(), { ...base, joinedOn: "2026-02-31" })).rejects.toThrow("That join date is not a real date.");
      await expect(createHousehold(store, ctx(), { ...base, additional: [{ ...ben, firstName: " " }] })).rejects.toThrow("First name is required.");
      // Nothing half-made is left behind after a refusal.
      expect((await store.read()).households).toHaveLength(0);
    });

    it("explains the same mistakes without changing anything, for a form to show before it saves", () => {
      const base = { displayName: "The X household", membershipType: "Resident" as const, joinedOn: "2026-01-01", primary: ada };
      expect(householdFieldsProblem(base)).toBeNull();
      expect(householdFieldsProblem({ ...base, displayName: "" })).toBe("The household name is required.");
      expect(householdFieldsProblem({ ...base, joinedOn: "2026-13-01" })).toBe("That join date is not a real date.");
      expect(householdFieldsProblem({ ...base, joinedOn: "Jan 1" })).toBe("The join date must look like 2026-10-22.");
      expect(householdFieldsProblem({ ...base, primary: { ...ada, email: "nope" } })).toBe('"nope" does not look like an email address.');
      expect(householdFieldsProblem({ ...base, additional: [{ ...ben, lastName: "x".repeat(81) }] })).toBe("Last name must be 80 characters or fewer.");
      expect(memberFieldsProblem(ben)).toBeNull();
      expect(memberFieldsProblem({ ...ben, email: "" })).toBe("Email is required.");
    });

    it("is staff only", async () => {
      const { store, members } = await setup();
      const member: Actor = { kind: "member", memberId: members[0].id, label: "Ada Quill" };
      await expect(createHousehold(store, ctx("2026-10-22", member), { displayName: "The Y household", membershipType: "Resident", joinedOn: "2026-10-22", primary: cy })).rejects.toMatchObject({ code: "forbidden" });
    });
  });

  describe("changes to a household are written to its file", () => {
    it("records a member added, with who and when", async () => {
      const { store, household } = await setup();
      const added = await addMember(store, ctx("2026-03-02"), household.id, cy);
      expect(added.role).toBe("additional");
      const entry = historyOf(await store.read(), household.id)[0];
      expect(entry).toMatchObject({ kind: "member_added", actor: staff });
      expect(entry.at).toBe(at("2026-03-02").toISOString());
      expect(entry.summary).toContain("Cy Quill");
    });

    it("records a type change and refuses a pointless one", async () => {
      const { store, household } = await setup();
      await changeMembershipType(store, ctx("2026-04-01"), household.id, "Non-Resident");
      const state = await store.read();
      expect(state.households[0].membershipType).toBe("Non-Resident");
      expect(historyOf(state, household.id)[0]).toMatchObject({ kind: "type_changed", details: { from: "Resident", to: "Non-Resident" } });
      await expect(changeMembershipType(store, ctx(), household.id, "Non-Resident")).rejects.toThrow("already Non-Resident");
    });

    it("removing an adult blocks them, keeps the rest of the household, and cancels their future bookings", async () => {
      const { store, household, members } = await setup([ben, cy]);
      const { ledger, calls } = fakeLedger({ [members[1].id]: ["booking-1", "booking-2"] });
      await removeMember(store, ledger, ctx("2026-05-05"), members[1].id);
      const state = await store.read();
      expect(membersOf(state, household.id).map((m) => [m.firstName, m.status])).toEqual([["Ada", "active"], ["Cy", "active"], ["Ben", "removed"]]);
      expect(blockReasonFor(state, members[1].id)).toContain("no longer listed");
      expect(blockReasonFor(state, members[0].id)).toBeNull();
      expect(calls).toEqual([{ memberIds: [members[1].id], reason: "Ben Quill was removed from the household" }]);
      expect(historyOf(state, household.id).map((e) => e.kind)).toEqual(expect.arrayContaining(["member_removed", "bookings_cancelled"]));
    });

    it("will not remove the primary until someone else is named, or the last adult at all", async () => {
      const { store, household, members } = await setup();
      await expect(removeMember(store, NO_BOOKINGS_YET, ctx(), members[0].id)).rejects.toThrow("Choose who becomes primary first.");
      await removeMember(store, NO_BOOKINGS_YET, ctx(), members[0].id, { newPrimaryId: members[1].id });
      const state = await store.read();
      expect(membersOf(state, household.id).find((m) => m.status === "active")).toMatchObject({ firstName: "Ben", role: "primary" });
      expect(historyOf(state, household.id).map((e) => e.kind)).toContain("primary_changed");
      await expect(removeMember(store, NO_BOOKINGS_YET, ctx(), members[1].id)).rejects.toThrow("last adult in the household");
    });
  });

  describe("correcting a person's details", () => {
    const fix = (store: Awaited<ReturnType<typeof setup>>["store"], memberId: string, change: Partial<typeof ada>, day = "2026-10-23") => {
      const m = store.read().then((s) => s.members.find((x) => x.id === memberId)!);
      return m.then((cur) => updateMemberDetails(store, ctx(day), memberId, { firstName: cur.firstName, lastName: cur.lastName, email: cur.email, phone: cur.phone, ...change }));
    };

    it("changes name, email and phone together, and writes one line saying what each was and what it is now", async () => {
      const { store, household, members } = await setup();
      const result = await fix(store, members[0].id, { firstName: "Adaline", lastName: "Quill-Reed", email: "adaline@example.com", phone: "206-555-0199" });
      expect(result.changed).toEqual(["firstName", "lastName", "email", "phone"]);
      expect(result.signInChanged).toBe(true);
      const state = await store.read();
      expect(state.members.find((m) => m.id === members[0].id)).toMatchObject({ firstName: "Adaline", lastName: "Quill-Reed", email: "adaline@example.com", phone: "206-555-0199" });
      const lines = historyOf(state, household.id).filter((e) => e.kind === "member_updated");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ actor: staff, at: at("2026-10-23").toISOString() });
      expect(lines[0].summary).toBe(
        "Details changed for Ada Quill: name from Ada Quill to Adaline Quill-Reed; email from ada@example.com to adaline@example.com; phone from 206-555-0101 to 206-555-0199.",
      );
      expect(lines[0].details).toEqual({
        memberId: members[0].id,
        firstNameFrom: "Ada",
        firstNameTo: "Adaline",
        lastNameFrom: "Quill",
        lastNameTo: "Quill-Reed",
        emailFrom: "ada@example.com",
        emailTo: "adaline@example.com",
        phoneFrom: "206-555-0101",
        phoneTo: "206-555-0199",
      });
    });

    it("touches nothing else about the person: role, status, outside IDs, sign-in slot, qualifications and everyone else", async () => {
      const { store, members } = await setup([ben, cy]);
      await grantQualification(store, ctx(), members[1].id, "scull-2");
      const before = await store.read();
      await fix(store, members[1].id, { phone: "206-555-0123" });
      const after = await store.read();
      const was = before.members.find((m) => m.id === members[1].id)!;
      expect(after.members.find((m) => m.id === members[1].id)).toEqual({ ...was, phone: "206-555-0123" });
      for (const other of [members[0].id, members[2].id]) expect(after.members.find((m) => m.id === other)).toEqual(before.members.find((m) => m.id === other));
      expect(after.memberQualifications).toEqual(before.memberQualifications);
      expect(after.households).toEqual(before.households);
    });

    it("says a phone change is not a sign-in change, and neither is a change of capital letters or spaces in the email", async () => {
      const { store, household, members } = await setup();
      expect((await fix(store, members[0].id, { phone: "" })).signInChanged).toBe(false);
      const shout = await fix(store, members[0].id, { email: "ADA@Example.com" });
      expect(shout).toMatchObject({ changed: ["email"], signInChanged: false });
      expect((await store.read()).members[0].email).toBe("ADA@Example.com");
      const lines = historyOf(await store.read(), household.id).filter((e) => e.kind === "member_updated");
      expect(lines.map((l) => l.summary)).toEqual([
        "Details changed for Ada Quill: email from ada@example.com to ADA@Example.com.",
        "Details changed for Ada Quill: phone from 206-555-0101 to no number.",
      ]);
    });

    it("lets two partners keep one shared address, and changing one partner's email leaves the other's alone", async () => {
      const { store, members } = await setup([{ ...ben, email: "ada@example.com" }]);
      await fix(store, members[1].id, { email: "ben.new@example.com" });
      const state = await store.read();
      expect(state.members.map((m) => m.email)).toEqual(["ada@example.com", "ben.new@example.com"]);
    });

    it("refuses a change that changes nothing, and writes no line for it", async () => {
      const { store, household, members } = await setup();
      const lines = async () => historyOf(await store.read(), household.id).length;
      const before = await lines();
      await expect(fix(store, members[0].id, {})).rejects.toMatchObject({ code: "unchanged", message: "Nothing was changed: those are already Ada Quill's details." });
      await expect(fix(store, members[0].id, { firstName: "  Ada  " })).rejects.toMatchObject({ code: "unchanged" });
      expect(await lines()).toBe(before);
    });

    it("is staff only, including a member trying to change their own details", async () => {
      const { store, household, members } = await setup();
      const asAda: Actor = { kind: "member", memberId: members[0].id, label: "Ada Quill" };
      for (const target of [members[0].id, members[1].id]) {
        await expect(updateMemberDetails(store, ctx("2026-10-23", asAda), target, { ...ada, phone: "206-555-0000" })).rejects.toMatchObject({ code: "forbidden" });
      }
      await expect(updateMemberDetails(store, ctx("2026-10-23", { kind: "member", memberId: members[0].id, label: "Ada Quill" }), members[0].id, { ...ada, email: "new@example.com" })).rejects.toThrow("Only club staff");
      const state = await store.read();
      expect(state.members[0]).toMatchObject({ email: "ada@example.com", phone: "206-555-0101" });
      expect(historyOf(state, household.id).some((e) => e.kind === "member_updated")).toBe(false);
    });

    it("refuses missing, mistyped and unusable details in plain words, and changes nothing", async () => {
      const { store, household, members } = await setup();
      const before = await store.read();
      const cases: [Partial<typeof ada>, string][] = [
        [{ firstName: "   " }, "First name is required."],
        [{ lastName: "" }, "Last name is required."],
        [{ email: "" }, "Email is required."],
        [{ email: "ada.example.com" }, `"ada.example.com" does not look like an email address.`],
        [{ firstName: "A".repeat(81) }, "First name must be 80 characters or fewer."],
        [{ email: `${"a".repeat(195)}@e.com` }, "Email must be 200 characters or fewer."],
      ];
      for (const [change, words] of cases) await expect(fix(store, members[0].id, change), words).rejects.toMatchObject({ code: "invalid", message: words });
      expect(await store.read()).toEqual(before);
      expect(historyOf(await store.read(), household.id)).toEqual(historyOf(before, household.id));
    });

    it("refuses an address sign-in could never use, so a typo cannot lock someone out", async () => {
      const { store, members } = await setup();
      for (const email of ["ada..quill@example.com", "ada quill@example.com", "ada<quill>@example.com", "ada,quill@example.com", ".ada@example.com", "ada@example"]) {
        await expect(fix(store, members[0].id, { email }), email).rejects.toMatchObject({ code: "invalid" });
        expect(memberFieldsProblem({ ...ada, email }), email).toContain("does not look like an email address");
        await expect(addMember(store, ctx(), (await store.read()).households[0].id, { ...cy, email }), email).rejects.toMatchObject({ code: "invalid" });
      }
      expect((await store.read()).members[0].email).toBe("ada@example.com");
    });

    it("refuses someone who has left, someone whose household ended, and someone who does not exist", async () => {
      const { store, household, members } = await setup([ben, cy]);
      await removeMember(store, NO_BOOKINGS_YET, ctx(), members[1].id);
      await expect(fix(store, members[1].id, { phone: "206-555-0000" })).rejects.toMatchObject({ code: "conflict", message: "Ben Quill is no longer on this household's membership, so their details cannot be changed." });
      await endHousehold(store, NO_BOOKINGS_YET, ctx("2026-10-24"), household.id);
      await expect(fix(store, members[0].id, { phone: "206-555-0000" })).rejects.toMatchObject({ code: "conflict", message: "That household's membership ended on Oct 24, 2026. Nothing in it can be changed." });
      await expect(updateMemberDetails(store, ctx(), "00000000-0000-4000-8000-0000000000ff", ada)).rejects.toMatchObject({ code: "not_found" });
      expect(historyOf(await store.read(), household.id).some((e) => e.kind === "member_updated")).toBe(false);
    });

    it("planning changes nothing, and says what saving would do", async () => {
      const { store, household, members } = await setup();
      const before = await store.read();
      const plan = planMemberDetails(before, ctx(), members[0].id, { ...ada, email: "new@example.com" });
      expect(plan).toMatchObject({ changed: ["email"], signInChanged: true, before: { email: "ada@example.com" }, after: { email: "new@example.com" } });
      expect(() => planMemberDetails(before, ctx("2026-10-23", { kind: "member", memberId: members[0].id, label: "Ada" }), members[0].id, ada)).toThrow("Only club staff");
      expect(await store.read()).toEqual(before);
      expect(historyOf(await store.read(), household.id)).toEqual(historyOf(before, household.id));
    });

    it("keeps the line inside the file's length limit even when every detail is as long as it can be", async () => {
      const { store, household, members } = await setup();
      const long = (c: string, n: number) => c.repeat(n);
      await fix(store, members[0].id, { firstName: long("F", 80), lastName: long("L", 80), email: `${long("e", 100)}@${long("d", 90)}.com`, phone: long("9", 40) });
      await fix(store, members[0].id, { firstName: long("G", 80), lastName: long("M", 80), email: `${long("f", 100)}@${long("c", 90)}.com`, phone: long("8", 40) });
      const lines = historyOf(await store.read(), household.id).filter((e) => e.kind === "member_updated");
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(line.summary.length).toBeLessThanOrEqual(500);
      // The full values are kept in the details even where the sentence shortens them.
      expect(lines[0].details).toMatchObject({ emailTo: `${long("f", 100)}@${long("c", 90)}.com`, phoneTo: long("8", 40) });
      expect(lines[0].summary).toContain("…");
    });

    it("lines up simultaneous corrections to the same person: each is written, in order, and none is lost", async () => {
      const { store, household, members } = await setup();
      const phones = Array.from({ length: 12 }, (_, i) => `206-555-01${String(i).padStart(2, "0")}`);
      const outcomes = await Promise.allSettled(phones.map((p) => updateMemberDetails(store, ctx(), members[0].id, { ...ada, phone: p })));
      const state = await store.read();
      const lines = historyOf(state, household.id).filter((e) => e.kind === "member_updated");
      // One of the twelve may already be the stored number when its turn comes (refused, nothing written); every other one is written.
      const done = outcomes.filter((o) => o.status === "fulfilled").length;
      expect(lines).toHaveLength(done);
      expect(done).toBeGreaterThanOrEqual(11);
      for (const o of outcomes) if (o.status === "rejected") expect(o.reason).toMatchObject({ code: "unchanged" });
      expect(phones).toContain(state.members[0].phone);
      // The chain of "from" and "to" is unbroken: each line starts where the one before it ended.
      const chain = [...lines].reverse();
      for (let i = 1; i < chain.length; i++) expect(chain[i].details.phoneFrom).toBe(chain[i - 1].details.phoneTo);
    });
  });

  describe("qualifications", () => {
    it("staff grant one and it records the level, who granted it and when", async () => {
      const { store, household, members } = await setup();
      await grantQualification(store, ctx("2026-06-01"), members[0].id, "scull-2");
      const state = await store.read();
      expect(qualificationsOf(state, members[0].id)).toEqual([
        { qualification: expect.objectContaining({ code: "scull-2", rank: 2 }), grantedAt: at("2026-06-01").toISOString(), grantedBy: "Test staff" },
      ]);
      expect(historyOf(state, household.id)[0].kind).toBe("qualification_granted");
    });

    it("a member cannot grant one to themselves or anyone else", async () => {
      const { store, members } = await setup();
      const self: Actor = { kind: "member", memberId: members[0].id, label: "Ada Quill" };
      await expect(grantQualification(store, ctx("2026-06-01", self), members[0].id, "scull-3")).rejects.toMatchObject({ code: "forbidden", message: "Only club staff can grant a qualification." });
      await expect(grantQualification(store, ctx("2026-06-01", self), members[1].id, "scull-1")).rejects.toBeInstanceOf(ClubError);
      expect((await store.read()).memberQualifications).toHaveLength(0);
    });

    it("refuses an unknown code, a repeat, and a member who has left", async () => {
      const { store, members } = await setup();
      await expect(grantQualification(store, ctx(), members[0].id, "scull-9")).rejects.toThrow("does not exist");
      await grantQualification(store, ctx(), members[0].id, "scull-1");
      await expect(grantQualification(store, ctx(), members[0].id, "scull-1")).rejects.toThrow("already holds");
      await removeMember(store, NO_BOOKINGS_YET, ctx(), members[1].id);
      await expect(grantQualification(store, ctx(), members[1].id, "scull-1")).rejects.toThrow("not an active member");
    });

    it("a higher level on the same track counts for a lower requirement, other tracks do not", async () => {
      const { store, members } = await setup();
      await grantQualification(store, ctx(), members[0].id, "scull-3");
      await grantQualification(store, ctx(), members[1].id, "sweep");
      const state = await store.read();
      expect(meetsQualification(state, members[0].id, "scull-1")).toBe(true);
      expect(meetsQualification(state, members[0].id, "scull-3")).toBe(true);
      expect(meetsQualification(state, members[1].id, "scull-1")).toBe(false);
      expect(meetsQualification(state, members[1].id, "sweep")).toBe(true);
      expect(meetsQualification(state, members[1].id, null)).toBe(true);
      expect(meetsQualification(state, members[0].id, "no-such-code")).toBe(false);
    });
  });

  describe("ending a membership", () => {
    it("blocks every adult at once, cancels their future bookings, and writes every change to the file", async () => {
      const { store, household, members } = await setup([ben, cy]);
      await grantQualification(store, ctx("2020-02-01"), members[0].id, "scull-2");
      const { ledger, calls } = fakeLedger({ [members[0].id]: ["b1"], [members[2].id]: ["b2", "b3"] });
      const result = await endHousehold(store, ledger, ctx("2026-10-01"), household.id);

      expect(result).toEqual({ endedOn: "2026-10-01", blocked: members.map((m) => m.id), cancelledBookings: ["b1", "b2", "b3"] });
      expect(calls).toHaveLength(1);
      expect(calls[0].memberIds).toEqual(members.map((m) => m.id));

      const state = await store.read();
      expect(state.households[0]).toMatchObject({ status: "ended", endedOn: "2026-10-01" });
      for (const m of members) {
        expect(state.members.find((x) => x.id === m.id)?.status).toBe("household_ended");
        expect(blockReasonFor(state, m.id)).toBe("This household's membership ended on Oct 1, 2026, so new bookings are closed.");
      }
      const kinds = historyOf(state, household.id).map((e) => e.kind);
      expect(kinds).toEqual(expect.arrayContaining(["membership_ended", "bookings_cancelled"]));
      const cancelled = historyOf(state, household.id).find((e) => e.kind === "bookings_cancelled");
      expect(cancelled).toMatchObject({ details: { count: 3 }, actor: staff });
    });

    it("leaves everything that happened before untouched", async () => {
      const { store, household, members } = await setup();
      await grantQualification(store, ctx("2020-02-01"), members[0].id, "scull-2");
      const before = await store.read();
      await endHousehold(store, NO_BOOKINGS_YET, ctx("2026-10-01"), household.id);
      const after = await store.read();
      // Every earlier history line is still there, word for word, and so are the qualifications and the people.
      for (const entry of before.history) expect(after.history).toContainEqual(entry);
      expect(after.history.length).toBe(before.history.length + 1);
      expect(after.memberQualifications).toEqual(before.memberQualifications);
      expect(after.members.map((m) => `${m.firstName} ${m.lastName}`)).toEqual(before.members.map((m) => `${m.firstName} ${m.lastName}`));
      expect(after.households[0].joinedOn).toBe("2020-01-15");
    });

    it("does not block people who had already left, and does not touch other households", async () => {
      const { store, household, members } = await setup([ben, cy]);
      const other = await createHousehold(store, ctx("2021-01-01"), { displayName: "The Other household", membershipType: "Intermediate", joinedOn: "2021-01-01", primary: { firstName: "Di", lastName: "Other", email: "di@example.com" } });
      await removeMember(store, NO_BOOKINGS_YET, ctx("2025-01-01"), members[1].id);
      await endHousehold(store, NO_BOOKINGS_YET, ctx("2026-10-01"), household.id);
      const state = await store.read();
      expect(state.members.find((m) => m.id === members[1].id)?.status).toBe("removed");
      expect(state.households.find((h) => h.id === other.household.id)?.status).toBe("active");
      expect(blockReasonFor(state, other.members[0].id)).toBeNull();
    });

    it("is all or nothing: if cancelling bookings fails, the household is still active", async () => {
      const { store, household, members } = await setup();
      const broken: BookingLedger = {
        async cancelFutureBookings() {
          throw new Error("calendar unavailable");
        },
      };
      await expect(endHousehold(store, broken, ctx("2026-10-01"), household.id)).rejects.toThrow("calendar unavailable");
      const state = await store.read();
      expect(state.households[0]).toMatchObject({ status: "active", endedOn: null });
      expect(blockReasonFor(state, members[0].id)).toBeNull();
      expect(historyOf(state, household.id).map((e) => e.kind)).not.toContain("membership_ended");
      // And the store still works afterwards.
      await endHousehold(store, NO_BOOKINGS_YET, ctx("2026-10-02"), household.id);
      expect((await store.read()).households[0].status).toBe("ended");
    });

    it("cannot be done twice, and nothing in an ended household can change", async () => {
      const { store, household, members } = await setup();
      await endHousehold(store, NO_BOOKINGS_YET, ctx("2026-10-01"), household.id);
      await expect(endHousehold(store, NO_BOOKINGS_YET, ctx("2026-10-02"), household.id)).rejects.toThrow("ended on Oct 1, 2026");
      await expect(addMember(store, ctx(), household.id, cy)).rejects.toMatchObject({ code: "conflict" });
      await expect(changeMembershipType(store, ctx(), household.id, "Intermediate")).rejects.toMatchObject({ code: "conflict" });
      await expect(removeMember(store, NO_BOOKINGS_YET, ctx(), members[1].id)).rejects.toMatchObject({ code: "conflict" });
    });

    it("is staff only, and a member cannot end their own household", async () => {
      const { store, household, members } = await setup();
      const self: Actor = { kind: "member", memberId: members[0].id, label: "Ada Quill" };
      await expect(endHousehold(store, NO_BOOKINGS_YET, ctx("2026-10-01", self), household.id)).rejects.toMatchObject({ code: "forbidden" });
      expect((await store.read()).households[0].status).toBe("active");
    });

    it("uses the Pacific date, so late evening on the 31st is still the 31st", async () => {
      const { store, household } = await setup();
      // 6:30 pm Pacific on Oct 31, 2026 is already Nov 1 in UTC.
      const result = await endHousehold(store, NO_BOOKINGS_YET, { actor: staff, now: new Date("2026-11-01T01:30:00Z") }, household.id);
      expect(result.endedOn).toBe("2026-10-31");
    });
  });

  describe("the store", () => {
    it("handles many changes arriving at the same moment without losing any", async () => {
      const { store, household } = await setup([]);
      await Promise.all(Array.from({ length: 25 }, (_, i) => addMember(store, ctx(), household.id, { firstName: `P${i}`, lastName: "Quill", email: `p${i}@example.com` })));
      const state = await store.read();
      expect(state.members).toHaveLength(26);
      expect(state.history.filter((e) => e.kind === "member_added")).toHaveLength(26);
      expect(new Set(state.members.map((m) => m.id)).size).toBe(26);
    });

    it("hands out copies, so changing a snapshot never changes the store", async () => {
      const { store } = await setup();
      const snapshot = await store.read();
      snapshot.households[0].displayName = "Tampered";
      snapshot.history.length = 0;
      const fresh = await store.read();
      expect(fresh.households[0].displayName).toBe("The Quill household");
      expect(fresh.history.length).toBeGreaterThan(0);
    });
  });
});
