import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { dayView } from "./availability";
import {
  PEOPLE_SEARCH_MIN_LETTERS,
  PEOPLE_SEARCH_MOST,
  accessKind,
  activeAccess,
  activeOwners,
  addBoatOwner,
  boatAccessLog,
  boatLocked,
  findBoatPeople,
  inviteToBoat,
  itemVisibleTo,
  lockedBoats,
  myInvitedBoats,
  myOwnedBoats,
  privateBoats,
  removalEffect,
  removeFromBoat,
} from "./boat-access";
import { bookingLedger, createBooking } from "./bookings";
import { createHousehold, endHousehold } from "./households";
import { NOW, STORE_KINDS, at, bookAs, fixtureFor, memberCtx, refusalMessages, refusedFor, request, staffCtx, type Fixture } from "./testkit";

/**
 * Private boats: who may book and sit in them, how the list of owners and invited people changes, what is hidden from whom, and
 * what happens when the last owner leaves. Every test runs on both stores, so the in-memory copy and Postgres must agree.
 */

/** Adds a private boat to the invented club, with its owners (named by staff) and invited people. */
async function privateBoat(f: Fixture, name: string, classCode: string, owners: string[] = [], invited: string[] = []): Promise<string> {
  await f.store.transaction(async (s, newId) => {
    s.items.push({ id: newId(), name, classCode, ruleOverrides: {}, isPrivate: true });
  });
  const id = (await f.store.read()).items.find((i) => i.name === name)!.id;
  f.i[name] = id;
  for (const o of owners) await addBoatOwner(f.store, staffCtx(), { itemId: id, memberId: f.m[o] });
  for (const p of invited) await inviteToBoat(f.store, staffCtx(), { itemId: id, memberId: f.m[p] });
  return id;
}

const asMember = (f: Fixture, name: string) => memberCtx(f.m[name], `${name} Quill`);
const refusedWith = async (attempt: Promise<unknown>) => {
  try {
    await attempt;
    return null;
  } catch (e) {
    if (e instanceof ClubError) return { code: e.code, message: e.message };
    throw e;
  }
};

for (const kind of STORE_KINDS) {
  describe(`private boats on the ${kind} store`, () => {
    const fixture = fixtureFor(kind);

    describe("who may book", () => {
      it("refuses someone who is not on the list, even one with the skill, and says why", async () => {
        const f = await fixture();
        await privateBoat(f, "Kestrel", "shell-single", ["Ada"]);
        expect(await refusedFor(bookAs(f, "Eli", "Kestrel", at(1, 7), at(1, 8)))).toEqual(["not_allowed_on_boat"]);
        expect(await refusalMessages(bookAs(f, "Eli", "Kestrel", at(1, 7), at(1, 8)))).toEqual(["Kestrel is a private boat. You are not one of its owners or someone an owner has invited."]);
        expect((await f.store.read()).bookings).toEqual([]);
      });

      it("lets an owner and an invited person book it, and does not check their skill level", async () => {
        const f = await fixture();
        // The quad needs level 3 for a club boat. Cy holds nothing, and Dee holds level 1.
        await privateBoat(f, "Big Quad", "shell-quad", ["Cy"], ["Dee"]);
        expect(await refusedFor(bookAs(f, "Cy", "Big Quad", at(1, 7), at(1, 8)))).toEqual([]);
        expect(await refusedFor(bookAs(f, "Dee", "Big Quad", at(1, 9), at(1, 10)))).toEqual([]);
        // The same club quad is still closed to them.
        expect(await refusedFor(bookAs(f, "Cy", "Albatross", at(2, 7), at(2, 8)))).toEqual(["not_qualified"]);
      });

      it("needs everyone in the boat to be an owner or invited, and checks no skill for them either", async () => {
        const f = await fixture();
        await privateBoat(f, "Twin", "shell-double", ["Ada"], ["Cy"]);
        // Eli holds level 3 but is not on the list. Cy holds nothing, is on the list, and the double needs level 2 on a club boat.
        expect(await refusedFor(bookAs(f, "Ada", "Twin", at(1, 7), at(1, 8), ["Eli"]))).toEqual(["crew_not_allowed"]);
        expect(await refusalMessages(bookAs(f, "Ada", "Twin", at(1, 7), at(1, 8), ["Eli"]))).toEqual(["Eli Reed is not one of Twin's owners or someone an owner has invited, so cannot be in the boat."]);
        expect(await refusedFor(bookAs(f, "Ada", "Twin", at(1, 7), at(1, 8), ["Cy"]))).toEqual([]);
        await inviteToBoat(f.store, asMember(f, "Ada"), { itemId: f.i.Twin, memberId: f.m.Eli });
        expect(await refusedFor(bookAs(f, "Ada", "Twin", at(2, 7), at(2, 8), ["Eli"]))).toEqual([]);
      });

      it("never lets staff set it aside: it is the owner's say, not a club rule", async () => {
        const f = await fixture();
        await privateBoat(f, "Kestrel", "shell-single", ["Ada"]);
        const attempt = createBooking(f.store, f.book, staffCtx(), request(f, "Eli", "Kestrel", at(1, 7), at(1, 8)), { override: { reason: "A lesson" } });
        expect(await refusedFor(attempt)).toEqual(["not_allowed_on_boat"]);
        const crew = createBooking(f.store, f.book, staffCtx(), request(f, "Ada", "Kestrel", at(1, 7), at(1, 8), ["Eli"]), { override: { reason: "A lesson" } });
        expect(await refusedFor(crew)).toEqual(expect.arrayContaining(["crew_not_allowed", "too_many_crew"]));
      });

      it("still applies the usual window and limits to owners", async () => {
        const f = await fixture();
        await privateBoat(f, "Kestrel", "shell-single", ["Ada"]);
        expect(await refusedFor(bookAs(f, "Ada", "Kestrel", at(9, 7), at(9, 8)))).toEqual(["too_far_ahead"]);
        expect(await refusedFor(bookAs(f, "Ada", "Kestrel", at(1, 7), at(1, 8)))).toEqual([]);
        // One shell a day, club boat or private boat.
        expect(await refusedFor(bookAs(f, "Ada", "Heron", at(1, 9), at(1, 10)))).toEqual(["over_daily_limit"]);
        // The boat is taken for that time, whoever asks.
        await inviteToBoat(f.store, staffCtx(), { itemId: f.i.Kestrel, memberId: f.m.Dee });
        expect(await refusedFor(bookAs(f, "Dee", "Kestrel", at(1, 7), at(1, 8)))).toEqual(["slot_taken"]);
      });

      it("cannot be booked by anyone while it has no owner, and says it is locked", async () => {
        const f = await fixture();
        await privateBoat(f, "Wren", "shell-single");
        const state = await f.store.read();
        expect(boatLocked(state, state.items.find((i) => i.name === "Wren")!)).toBe(true);
        expect(await refusedFor(bookAs(f, "Ada", "Wren", at(1, 7), at(1, 8)))).toEqual(["boat_locked", "not_allowed_on_boat"]);
        expect((await refusalMessages(bookAs(f, "Ada", "Wren", at(1, 7), at(1, 8))))[0]).toBe("Wren is a private boat with no owner who can use it right now, so it cannot be booked until club staff add an owner.");
      });
    });

    describe("when the last owner leaves", () => {
      it("locks the boat, cancels the leaver's bookings, keeps an invited person's, and unlocks when staff add an owner", async () => {
        const f = await fixture();
        await privateBoat(f, "Kestrel", "shell-single", ["Ada"], ["Dee"]);
        await bookAs(f, "Dee", "Kestrel", at(2, 7), at(2, 8));
        await bookAs(f, "Ada", "Kestrel", at(3, 7), at(3, 8));
        await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill);

        const state = await f.store.read();
        const boat = state.items.find((i) => i.name === "Kestrel")!;
        expect(boatLocked(state, boat)).toBe(true);
        expect(activeOwners(state, boat.id)).toEqual([]);
        expect(state.bookings.map((b) => [b.bookerId === f.m.Ada ? "Ada" : "Dee", b.status])).toEqual([
          ["Dee", "upcoming"],
          ["Ada", "cancelled"],
        ]);
        expect(lockedBoats(state, NOW)).toEqual([{ itemId: boat.id, name: "Kestrel", upcoming: 1 }]);
        expect(await refusedFor(bookAs(f, "Dee", "Kestrel", at(4, 7), at(4, 8)))).toEqual(["boat_locked"]);

        await addBoatOwner(f.store, staffCtx(), { itemId: boat.id, memberId: f.m.Eli });
        expect(boatLocked(await f.store.read(), boat)).toBe(false);
        expect(await refusedFor(bookAs(f, "Dee", "Kestrel", at(4, 7), at(4, 8)))).toEqual([]);
      });

      it("does not count an owner who has left as an owner, and cannot add a member who has left", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada", "Dee"]);
        await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill);
        const state = await f.store.read();
        expect(activeOwners(state, id).map((m) => m.firstName)).toEqual(["Dee"]);
        expect(boatLocked(state, state.items.find((i) => i.id === id)!)).toBe(false);
        // Ada's line is still on the list as history, and shows as no longer active.
        expect(privateBoats(state, f.book, NOW)[0].owners.map((o) => [o.name, o.active])).toEqual([
          ["Ada Quill", false],
          ["Dee Reed", true],
        ]);
        expect(await refusedWith(inviteToBoat(f.store, staffCtx(), { itemId: id, memberId: f.m.Ben }))).toMatchObject({ code: "invalid" });
        expect((await refusedWith(addBoatOwner(f.store, staffCtx(), { itemId: id, memberId: f.m.Cy })))?.message).toContain("cannot be added");
      });
    });

    describe("changing the list", () => {
      it("lets staff name owners, and only staff", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single");
        expect(await refusedWith(addBoatOwner(f.store, asMember(f, "Ada"), { itemId: id, memberId: f.m.Ada }))).toEqual({ code: "forbidden", message: "Only club staff can name the owners of a boat." });
        expect(await refusedWith(addBoatOwner(f.store, { actor: { kind: "system", label: "x" }, now: NOW }, { itemId: id, memberId: f.m.Ada }))).toMatchObject({ code: "forbidden" });
        const line = await addBoatOwner(f.store, staffCtx(), { itemId: id, memberId: f.m.Ada });
        expect(line).toMatchObject({ itemId: id, memberId: f.m.Ada, kind: "owner", addedBy: { kind: "staff", label: "Test staff" }, addedAt: NOW.toISOString(), endedAt: null, endedBy: null, endedReason: null });
        expect(await refusedWith(addBoatOwner(f.store, staffCtx(), { itemId: id, memberId: f.m.Ada }))).toEqual({ code: "conflict", message: "Ada Quill is already an owner of Kestrel." });
      });

      it("lets an owner invite, at once, and nobody else but staff", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada"], ["Ben"]);
        // Dee is not on the list, Ben is only invited: neither may invite.
        for (const who of ["Dee", "Ben"]) {
          expect(await refusedWith(inviteToBoat(f.store, asMember(f, who), { itemId: id, memberId: f.m.Eli }))).toEqual({ code: "forbidden", message: "Only an owner of Kestrel, or club staff, can invite people to it." });
        }
        expect(await refusedFor(bookAs(f, "Eli", "Kestrel", at(1, 7), at(1, 8)))).toEqual(["not_allowed_on_boat"]);
        const line = await inviteToBoat(f.store, asMember(f, "Ada"), { itemId: id, memberId: f.m.Eli });
        expect(line).toMatchObject({ kind: "invited", memberId: f.m.Eli, addedBy: { kind: "member", memberId: f.m.Ada } });
        expect(await refusedFor(bookAs(f, "Eli", "Kestrel", at(1, 7), at(1, 8)))).toEqual([]);
        expect(await refusedWith(inviteToBoat(f.store, asMember(f, "Ada"), { itemId: id, memberId: f.m.Eli }))).toEqual({ code: "conflict", message: "Eli Reed is already invited to Kestrel." });
        expect(await refusedWith(inviteToBoat(f.store, asMember(f, "Ada"), { itemId: id, memberId: f.m.Ada }))).toEqual({ code: "conflict", message: "Ada Quill is already an owner of Kestrel." });
        expect(await refusedWith(inviteToBoat(f.store, { actor: { kind: "system", label: "x" }, now: NOW }, { itemId: id, memberId: f.m.Cy }))).toMatchObject({ code: "forbidden" });
      });

      it("does not let an owner who has left the club invite anyone, and a club boat has no list", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada", "Dee"]);
        await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill);
        expect(await refusedWith(inviteToBoat(f.store, asMember(f, "Ada"), { itemId: id, memberId: f.m.Eli }))).toMatchObject({ code: "forbidden" });
        expect(await refusedWith(inviteToBoat(f.store, staffCtx(), { itemId: f.i.Heron, memberId: f.m.Eli }))).toEqual({ code: "invalid", message: "Heron is a club boat, not a private one, so it has no list of owners." });
        expect(await refusedWith(addBoatOwner(f.store, staffCtx(), { itemId: f.i.Heron, memberId: f.m.Eli }))).toMatchObject({ code: "invalid" });
        expect(await refusedWith(inviteToBoat(f.store, staffCtx(), { itemId: "00000000-0000-4000-8000-0000000000ff", memberId: f.m.Eli }))).toMatchObject({ code: "not_found" });
        expect(await refusedWith(inviteToBoat(f.store, staffCtx(), { itemId: id, memberId: "00000000-0000-4000-8000-0000000000ff" }))).toMatchObject({ code: "not_found" });
      });

      it("makes an invited person an owner by ending the invitation, so they hold one line", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada"], ["Dee"]);
        await addBoatOwner(f.store, staffCtx(), { itemId: id, memberId: f.m.Dee });
        const state = await f.store.read();
        expect(activeAccess(state, id).map((a) => [a.memberId === f.m.Ada ? "Ada" : "Dee", a.kind])).toEqual([
          ["Ada", "owner"],
          ["Dee", "owner"],
        ]);
        const ended = state.boatAccess.find((a) => a.kind === "invited")!;
        expect(ended).toMatchObject({ endedAt: NOW.toISOString(), endedBy: { kind: "staff" }, endedReason: "Became an owner" });
        expect(accessKind(state, id, f.m.Dee)).toBe("owner");
      });

      it("takes someone off: their upcoming bookings on the boat are cancelled (never late), their crew seat goes, the rest stays", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Twin", "shell-double", ["Ada"], ["Dee", "Eli"]);
        await bookAs(f, "Dee", "Twin", at(1, 7), at(1, 8)); // Dee's own outing
        await bookAs(f, "Ada", "Twin", at(2, 7), at(2, 8), ["Dee"]); // Dee is crew in Ada's
        await bookAs(f, "Eli", "Twin", at(3, 7), at(3, 8)); // someone else's, untouched
        // Dee's other bookings, on a club boat and as crew on another private boat, are not about this boat and must stay.
        await bookAs(f, "Dee", "Heron", at(4, 7), at(4, 8));
        const other = await privateBoat(f, "Other Twin", "shell-double", ["Ada"], ["Dee"]);
        await bookAs(f, "Ada", "Other Twin", at(4, 9), at(4, 10), ["Dee"]);
        const dee = activeAccess(await f.store.read(), id).find((a) => a.memberId === f.m.Dee)!;
        expect(removalEffect(await f.store.read(), dee.id, NOW)).toEqual({ bookings: 1, crewSeats: 1 });

        const result = await removeFromBoat(f.store, asMember(f, "Ada"), { accessId: dee.id });
        expect(result).toMatchObject({ cancelled: 1, crewRemoved: 1, access: { endedAt: NOW.toISOString(), endedReason: "Taken off by Ada Quill", endedBy: { kind: "member", memberId: f.m.Ada } } });
        const state = await f.store.read();
        expect(accessKind(state, id, f.m.Dee)).toBeNull();
        const onTwin = state.bookings.filter((b) => b.itemId === id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        expect(onTwin.map((b) => b.status)).toEqual(["cancelled", "upcoming", "upcoming"]);
        expect(onTwin[0].cancelReason).toBe("Dee Reed is no longer allowed on Twin.");
        expect(onTwin[0].cancelledBy).toMatchObject({ kind: "member", memberId: f.m.Ada });
        expect(onTwin[1].crew).toEqual([]);
        expect(onTwin[1].removedCrew).toMatchObject([{ memberId: f.m.Dee, reason: "Dee Reed is no longer allowed on Twin." }]);
        // Her bookings on other boats are untouched: the club single, and her seat in the other private double.
        const elsewhere = state.bookings.filter((b) => b.itemId !== id);
        expect(elsewhere.map((b) => b.status)).toEqual(["upcoming", "upcoming"]);
        expect(elsewhere.find((b) => b.itemId === other)!.crew).toEqual([f.m.Dee]);
        expect(elsewhere.find((b) => b.itemId === other)!.removedCrew).toEqual([]);
        // Dee can no longer book it.
        expect(await refusedFor(bookAs(f, "Dee", "Twin", at(5, 7), at(5, 8)))).toEqual(["not_allowed_on_boat"]);
      });

      it("leaves bookings under way and past ones alone", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada"], ["Dee"]);
        await bookAs(f, "Dee", "Kestrel", at(0, 14), at(0, 15)); // later today: upcoming
        const dee = activeAccess(await f.store.read(), id).find((a) => a.memberId === f.m.Dee)!;
        // Two hours later the outing is under way.
        const later = new Date(NOW.getTime() + 90 * 60000);
        const result = await removeFromBoat(f.store, { actor: staffCtx().actor, now: later }, { accessId: dee.id });
        expect(result.cancelled).toBe(0);
        expect((await f.store.read()).bookings[0].status).toBe("upcoming");
      });

      it("lets an owner take off invited people but not an owner, lets staff take off anyone, and refuses everyone else", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada", "Ben"], ["Dee"]);
        const state = await f.store.read();
        const line = (name: string) => activeAccess(state, id).find((a) => a.memberId === f.m[name])!.id;
        expect(await refusedWith(removeFromBoat(f.store, asMember(f, "Ada"), { accessId: line("Ben") }))).toEqual({ code: "forbidden", message: "Ben Quill is an owner of Kestrel. Only club staff can change the owners." });
        expect(await refusedWith(removeFromBoat(f.store, asMember(f, "Dee"), { accessId: line("Dee") }))).toEqual({ code: "forbidden", message: "Only an owner of Kestrel, or club staff, can take people off it." });
        expect(await refusedWith(removeFromBoat(f.store, asMember(f, "Eli"), { accessId: line("Dee") }))).toMatchObject({ code: "forbidden" });
        expect(await refusedWith(removeFromBoat(f.store, { actor: { kind: "system", label: "x" }, now: NOW }, { accessId: line("Dee") }))).toMatchObject({ code: "forbidden" });
        await removeFromBoat(f.store, staffCtx(), { accessId: line("Ben") });
        expect((await f.store.read()).boatAccess.find((a) => a.id === line("Ben"))).toMatchObject({ endedBy: { kind: "staff" }, endedReason: "Taken off by club staff" });
        expect(await refusedWith(removeFromBoat(f.store, staffCtx(), { accessId: line("Ben") }))).toEqual({ code: "conflict", message: "That person is already off the boat's list." });
        expect(await refusedWith(removeFromBoat(f.store, staffCtx(), { accessId: "00000000-0000-4000-8000-0000000000ff" }))).toMatchObject({ code: "not_found" });
        // They can be put back: a new line, with the old one kept as history.
        await inviteToBoat(f.store, staffCtx(), { itemId: id, memberId: f.m.Ben });
        const after = await f.store.read();
        expect(after.boatAccess.filter((a) => a.memberId === f.m.Ben).map((a) => [a.kind, a.endedAt !== null])).toEqual([
          ["owner", true],
          ["invited", false],
        ]);
      });

      it("takes a boat's last owner off, and the boat locks", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada"], ["Dee"]);
        const ada = activeAccess(await f.store.read(), id).find((a) => a.memberId === f.m.Ada)!;
        await removeFromBoat(f.store, staffCtx(), { accessId: ada.id });
        const state = await f.store.read();
        expect(boatLocked(state, state.items.find((i) => i.id === id)!)).toBe(true);
        expect(await refusedFor(bookAs(f, "Dee", "Kestrel", at(1, 7), at(1, 8)))).toEqual(["boat_locked"]);
      });

      it("invites someone once however many owners press at the same moment", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada", "Ben"]);
        const results = await Promise.allSettled([
          inviteToBoat(f.store, asMember(f, "Ada"), { itemId: id, memberId: f.m.Dee }),
          inviteToBoat(f.store, asMember(f, "Ben"), { itemId: id, memberId: f.m.Dee }),
          inviteToBoat(f.store, staffCtx(), { itemId: id, memberId: f.m.Dee }),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        for (const r of results.filter((x): x is PromiseRejectedResult => x.status === "rejected")) expect(r.reason).toMatchObject({ code: "conflict" });
        expect(activeAccess(await f.store.read(), id).filter((a) => a.memberId === f.m.Dee)).toHaveLength(1);
      });
    });

    describe("who sees what", () => {
      it("shows a private boat only to staff and the people on its list", async () => {
        const f = await fixture();
        await privateBoat(f, "Kestrel", "shell-single", ["Ada"], ["Dee"]);
        const state = await f.store.read();
        const boat = state.items.find((i) => i.name === "Kestrel")!;
        const heron = state.items.find((i) => i.name === "Heron")!;
        expect(itemVisibleTo(state, boat, { kind: "staff" })).toBe(true);
        expect(itemVisibleTo(state, boat, { kind: "member", memberId: f.m.Ada })).toBe(true);
        expect(itemVisibleTo(state, boat, { kind: "member", memberId: f.m.Dee })).toBe(true);
        expect(itemVisibleTo(state, boat, { kind: "member", memberId: f.m.Eli })).toBe(false);
        expect(itemVisibleTo(state, heron, { kind: "member", memberId: f.m.Eli })).toBe(true);

        const names = (viewer: Parameters<typeof dayView>[2]["viewer"]) => dayView(state, f.book, { day: "2026-10-29", now: NOW, viewer }).items.map((i) => i.item.name);
        expect(names({ kind: "member", memberId: f.m.Eli })).not.toContain("Kestrel");
        expect(names({ kind: "member", memberId: f.m.Dee })).toContain("Kestrel");
        expect(names({ kind: "staff" })).toContain("Kestrel");
        const view = dayView(state, f.book, { day: "2026-10-29", now: NOW, viewer: { kind: "member", memberId: f.m.Dee } }).items.find((i) => i.item.name === "Kestrel")!;
        expect(view).toMatchObject({ isPrivate: true, locked: false, needs: null, qualified: null });
        // Filtering by type hides it just the same.
        expect(dayView(state, f.book, { day: "2026-10-29", now: NOW, viewer: { kind: "member", memberId: f.m.Eli }, type: "Shell" }).items.map((i) => i.item.name)).not.toContain("Kestrel");
      });

      it("does not show a booking on a private boat to anyone not on its list, only 'Booked' to those who are", async () => {
        const f = await fixture();
        await privateBoat(f, "Kestrel", "shell-single", ["Ada"], ["Dee"]);
        await bookAs(f, "Ada", "Kestrel", at(1, 7), at(1, 8));
        const state = await f.store.read();
        const row = (viewer: Parameters<typeof dayView>[2]["viewer"]) => dayView(state, f.book, { day: "2026-10-29", now: NOW, viewer }).items.find((i) => i.item.name === "Kestrel")?.slots.find((s) => s.startsAt === at(1, 7).toISOString());
        expect(row({ kind: "member", memberId: f.m.Eli })).toBeUndefined();
        expect(row({ kind: "member", memberId: f.m.Dee })).toMatchObject({ state: "booked", bookedBy: null, bookingId: null });
        expect(row({ kind: "member", memberId: f.m.Ada })).toMatchObject({ state: "yours" });
        expect(row({ kind: "staff" })).toMatchObject({ state: "booked", bookedBy: "Ada Quill" });
      });

      it("marks a boat with no owner as locked in the day view", async () => {
        const f = await fixture();
        await privateBoat(f, "Wren", "shell-single");
        const view = dayView(await f.store.read(), f.book, { day: "2026-10-29", now: NOW, viewer: { kind: "staff" } }).items.find((i) => i.item.name === "Wren")!;
        expect(view).toMatchObject({ isPrivate: true, locked: true });
      });
    });

    describe("finding people to add", () => {
      it("shows nothing for fewer than three letters, names only, never anyone already on the list, and never more than six", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada"]);
        expect(PEOPLE_SEARCH_MIN_LETTERS).toBe(3);
        expect(PEOPLE_SEARCH_MOST).toBe(6);
        expect(findBoatPeople(await f.store.read(), id, "qu")).toEqual({ tooShort: true, people: [], more: false });
        expect(findBoatPeople(await f.store.read(), id, "  !! ").tooShort).toBe(true);
        // "Quill" finds Ben and Cy but not Ada, who is already an owner.
        const found = findBoatPeople(await f.store.read(), id, "quill");
        expect(found.people.map((p) => p.name)).toEqual(["Ben Quill", "Cy Quill"]);
        expect(Object.keys(found.people[0]).sort()).toEqual(["household", "memberId", "name"]);
        expect(found.more).toBe(false);
        expect(findBoatPeople(await f.store.read(), id, "zzz").people).toEqual([]);
        expect(findBoatPeople(await f.store.read(), id, "DEE r").people.map((p) => p.name)).toEqual(["Dee Reed"]);
      });

      it("leaves out members who have left, tells two people with one name apart by household, and says when there are more", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada"]);
        for (let n = 0; n < 8; n++) {
          await createHousehold(f.store, staffCtx(), { displayName: `The Extra${n} household`, membershipType: "Resident", joinedOn: "2020-01-01", primary: { firstName: "Sam", lastName: `Crowd${n}`, email: `sam${n}@example.com` } });
        }
        await createHousehold(f.store, staffCtx(), { displayName: "The Other Reed household", membershipType: "Resident", joinedOn: "2020-01-01", primary: { firstName: "Dee", lastName: "Reed", email: "dee2@example.com" } });
        const many = findBoatPeople(await f.store.read(), id, "crowd");
        expect(many.people).toHaveLength(6);
        expect(many.more).toBe(true);
        const twins = findBoatPeople(await f.store.read(), id, "dee reed");
        expect(twins.people.map((p) => p.household).sort()).toEqual(["The Other Reed household", "The Reed household"]);
        await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Reed);
        expect(findBoatPeople(await f.store.read(), id, "dee reed").people.map((p) => p.household)).toEqual([null]);
        expect(findBoatPeople(await f.store.read(), id, "eli").people).toEqual([]);
      });
    });

    describe("the lists staff and owners see", () => {
      it("lists private boats for staff with locked ones first, and each member's own boats", async () => {
        const f = await fixture();
        await privateBoat(f, "Kestrel", "shell-single", ["Ada"], ["Dee"]);
        await privateBoat(f, "Starling", "shell-double", ["Ada", "Ben"]);
        await privateBoat(f, "Wren", "shell-single");
        const state = await f.store.read();
        expect(privateBoats(state, f.book, NOW).map((b) => [b.name, b.locked, b.owners.length, b.invited.length])).toEqual([
          ["Wren", true, 0, 0],
          ["Kestrel", false, 1, 1],
          ["Starling", false, 2, 0],
        ]);
        expect(myOwnedBoats(state, f.book, f.m.Ada, NOW).map((b) => b.name)).toEqual(["Kestrel", "Starling"]);
        expect(myOwnedBoats(state, f.book, f.m.Dee, NOW)).toEqual([]);
        expect(myInvitedBoats(state, f.book, f.m.Dee)).toEqual([{ itemId: f.i.Kestrel, name: "Kestrel", className: "Single", locked: false }]);
        expect(myInvitedBoats(state, f.book, f.m.Ada)).toEqual([]);
        expect(lockedBoats(state, NOW).map((b) => b.name)).toEqual(["Wren"]);
      });

      it("keeps a record in words of who was let on and taken off, newest first, with who did it", async () => {
        const f = await fixture();
        const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada"]);
        await inviteToBoat(f.store, asMember(f, "Ada"), { itemId: id, memberId: f.m.Dee });
        const dee = activeAccess(await f.store.read(), id).find((a) => a.memberId === f.m.Dee)!;
        await removeFromBoat(f.store, staffCtx(), { accessId: dee.id });
        expect(boatAccessLog(await f.store.read(), id).map((l) => l.text)).toEqual([
          "Dee Reed is no longer invited. Taken off by club staff.",
          "Dee Reed was made invited by Ada Quill.",
          "Ada Quill was made an owner by Test staff.",
        ]);
      });
    });

    it("keeps every line exactly as written when the records are read back", async () => {
      const f = await fixture();
      const id = await privateBoat(f, "Kestrel", "shell-single", ["Ada"]);
      await inviteToBoat(f.store, asMember(f, "Ada"), { itemId: id, memberId: f.m.Dee });
      const dee = activeAccess(await f.store.read(), id).find((a) => a.memberId === f.m.Dee)!;
      await removeFromBoat(f.store, asMember(f, "Ada"), { accessId: dee.id });
      const state = await f.store.read();
      expect(state.items.find((i) => i.id === id)!.isPrivate).toBe(true);
      expect(state.items.find((i) => i.name === "Heron")!.isPrivate).toBeUndefined();
      expect(state.boatAccess).toHaveLength(2);
      expect(state.boatAccess[0]).toEqual({ id: expect.any(String), itemId: id, memberId: f.m.Ada, kind: "owner", addedAt: NOW.toISOString(), addedBy: { kind: "staff", label: "Test staff" }, endedAt: null, endedBy: null, endedReason: null });
      expect(state.boatAccess[1]).toEqual({
        id: dee.id,
        itemId: id,
        memberId: f.m.Dee,
        kind: "invited",
        addedAt: NOW.toISOString(),
        addedBy: { kind: "member", memberId: f.m.Ada, label: "Ada Quill" },
        endedAt: NOW.toISOString(),
        endedBy: { kind: "member", memberId: f.m.Ada, label: "Ada Quill" },
        endedReason: "Taken off by Ada Quill",
      });
    });
  });
}
