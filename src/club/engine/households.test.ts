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
  removeMember,
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
      // Nothing half-made is left behind after a refusal.
      expect((await store.read()).households).toHaveLength(0);
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
