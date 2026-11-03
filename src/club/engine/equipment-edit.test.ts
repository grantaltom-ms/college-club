import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { ATTENDANCE_RULES } from "../settings/attendance-rules";
import { CLASS_RULES } from "../settings/class-rules";
import { PRACTICE_RULES } from "../settings/practice-rules";
import type { Item } from "../types";
import { dayView } from "./availability";
import { addBoatOwner, itemVisibleTo, lockedBoats, privateBoats } from "./boat-access";
import { cancelBooking, createBooking, takeOutOfService } from "./bookings";
import { cancelSession, createClass, scheduleSessions } from "./classes";
import { officeSummary } from "./office";
import {
  ItemEditRefused,
  MAX_ITEM_NAME,
  equipmentList,
  itemFile,
  itemPage,
  planItemEdit,
  restoreItem,
  retireEffects,
  retireItem,
  skillWords,
  updateItem,
  type ItemEdit,
} from "./equipment-edit";
import { cancelPractice, createPractice, removePracticeBoat, reservableBoats, seatMember } from "./practices";
import { placesOf } from "./pools";
import { NOW, STORE_KINDS, at, bookAs, buildFixtureSettling, fixtureFor, memberCtx, refusedFor, request, staffCtx, type Fixture } from "./testkit";

const state = (f: Fixture) => f.store.read();
const edit = (f: Fixture, item: string, change: ItemEdit, ctx = staffCtx()) => updateItem(f.store, f.book, ctx, f.i[item], change);
const itemOf = async (f: Fixture, name: string): Promise<Item> => (await state(f)).items.find((i) => i.name === name)!;

/** Every problem an edit was refused with ([] when it went through). Anything else is rethrown. */
const problemsOf = async (attempt: Promise<unknown>): Promise<string[]> => {
  try {
    await attempt;
    return [];
  } catch (e) {
    if (e instanceof ItemEditRefused) return e.problems;
    throw e;
  }
};
const errorOf = async (attempt: Promise<unknown>) => {
  try {
    await attempt;
    return null;
  } catch (e) {
    if (e instanceof ClubError) return { code: e.code, message: e.message };
    throw e;
  }
};

/** A pool of dock berths with the given number of places, and its ID. */
async function addPool(f: Fixture, name = "Dock berths", places = 4): Promise<string> {
  await f.store.transaction(async (s, newId) => {
    s.items.push({ id: newId(), name, classCode: "dock-space", ruleOverrides: {}, places });
  });
  return (await itemOf(f, name)).id;
}

/** A booking on a pool for one member, on the given hour tomorrow (an hour long). */
const holdPlace = (f: Fixture, poolId: string, who: string, hour: number) =>
  createBooking(f.store, f.book, memberCtx(f.m[who] ?? who, who), { itemId: poolId, bookerId: f.m[who] ?? who, startsAt: at(1, hour), endsAt: at(1, hour + 1) });

for (const kind of STORE_KINDS) {
  const fixture = fixtureFor(kind);

  describe(`fixing an item (${kind} store)`, () => {
    describe("who may change it", () => {
      it("is staff only, for the plan and for every step", async () => {
        const f = await fixture();
        const asMember = memberCtx(f.m.Ada, "Ada Quill");
        const asSystem = { actor: { kind: "system" as const, label: "System" }, now: NOW };
        const before = await state(f);
        for (const ctx of [asMember, asSystem]) {
          expect(await errorOf(updateItem(f.store, f.book, ctx, f.i.Heron, { name: "Heron II" }))).toMatchObject({ code: "forbidden" });
          expect(() => planItemEdit(before, f.book, ctx, f.i.Heron, { name: "Heron II" })).toThrow(/Only club staff/);
          expect(await errorOf(retireItem(f.store, ctx, f.i.Heron, { reason: "Sold" }))).toMatchObject({ code: "forbidden" });
          expect(await errorOf(restoreItem(f.store, ctx, f.i.Heron))).toMatchObject({ code: "forbidden" });
        }
        expect((await itemOf(f, "Heron")).name).toBe("Heron");
        expect((await state(f)).itemLog).toEqual([]);
      });
    });

    describe("the name", () => {
      it("renames an item, tidies the spaces, and writes a line in its file with the old and new name and who did it", async () => {
        const f = await fixture();
        const { item, changes } = await edit(f, "Heron", { name: "  Heron   II " });
        expect(item.name).toBe("Heron II");
        expect(changes).toEqual([{ field: "name", label: "Name", from: "Heron", to: "Heron II" }]);
        const s = await state(f);
        expect(s.items.find((i) => i.id === f.i.Heron)?.name).toBe("Heron II");
        expect(s.itemLog).toHaveLength(1);
        expect(s.itemLog[0]).toMatchObject({
          itemId: f.i.Heron,
          at: NOW.toISOString(),
          kind: "changed",
          by: { kind: "staff", label: "Test staff" },
          text: 'Changed by Test staff: name from "Heron" to "Heron II".',
          details: { nameFrom: "Heron", nameTo: "Heron II" },
        });
      });

      it("accepts a change of capital letters alone", async () => {
        const f = await fixture();
        await edit(f, "Heron", { name: "HERON" });
        expect((await itemOf(f, "HERON")).id).toBe(f.i.Heron);
      });

      it("refuses an empty name, a name over 80 characters (exactly 80 is fine) and one with a character that cannot be saved", async () => {
        const f = await fixture();
        expect(await problemsOf(edit(f, "Heron", { name: "   " }))).toEqual(["The name cannot be empty."]);
        expect(await problemsOf(edit(f, "Heron", { name: "x".repeat(MAX_ITEM_NAME + 1) }))).toEqual([`The name must be ${MAX_ITEM_NAME} characters or fewer.`]);
        expect(await problemsOf(edit(f, "Heron", { name: "Her\u0007on" }))).toEqual(["The name has a character that cannot be saved. Retype it."]);
        await edit(f, "Heron", { name: "y".repeat(MAX_ITEM_NAME) });
        expect((await itemOf(f, "y".repeat(MAX_ITEM_NAME))).id).toBe(f.i.Heron);
      });

      it("refuses a name another item already has, whatever the capitals or spacing, and says when that item is retired", async () => {
        const f = await fixture();
        expect(await problemsOf(edit(f, "Heron", { name: "  osprey " }))).toEqual(['There is already an item called "Osprey". Names have to be different, even for a retired item.']);
        await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Sold" });
        expect(await problemsOf(edit(f, "Heron", { name: "OSPREY" }))).toEqual(['There is already an item called "Osprey" (retired). Names have to be different, even for a retired item.']);
      });

      it("refuses a change that changes nothing, in words, and writes no line", async () => {
        const f = await fixture();
        expect(await errorOf(edit(f, "Heron", { name: " Heron " }))).toMatchObject({ code: "unchanged", message: "Nothing was changed: what you entered is what Heron already has." });
        expect(await errorOf(edit(f, "Heron", {}))).toMatchObject({ code: "unchanged" });
        expect((await state(f)).itemLog).toEqual([]);
      });

      it("refuses an item that does not exist", async () => {
        const f = await fixture();
        expect(await errorOf(updateItem(f.store, f.book, staffCtx(), "00000000-0000-4000-8000-0000000fffff", { name: "X" }))).toMatchObject({ code: "not_found" });
      });
    });

    describe("max weight in pounds", () => {
      it("sets, clears and refuses a silly number on a shell", async () => {
        const f = await fixture();
        const weight = await edit(f, "Heron", { maxWeightLbs: 205 });
        expect(weight.item.maxWeightLbs).toBe(205);
        expect(weight.changes).toEqual([{ field: "maxWeight", label: "Max weight", from: "not set", to: "205 lb" }]);
        expect((await state(f)).itemLog.at(-1)?.details).toMatchObject({ maxWeightFrom: "", maxWeightTo: "205" });
        await edit(f, "Heron", { maxWeightLbs: null });
        expect((await state(f)).items.find((i) => i.id === f.i.Heron)?.maxWeightLbs).toBeUndefined();
        expect(await problemsOf(updateItem(f.store, f.book, staffCtx(), f.i.Heron, { maxWeightLbs: 20 }))).toEqual([
          "Max weight must be a whole number from 50 to 800 pounds, or left blank.",
        ]);
      });
    });

    describe("the seats", () => {
      it("turns a single into a double, changing its class and so who may crew it, and says its usual skill level moves with it", async () => {
        const f = await fixture();
        const plan = planItemEdit(await state(f), f.book, staffCtx(), f.i.Heron, { seats: 2 });
        expect(plan.problems).toEqual([]);
        expect(plan.changes).toEqual([{ field: "seats", label: "Seats", from: "Single (1 seat)", to: "Double (2 seats)" }]);
        expect(plan.notices).toEqual(["Its skill level follows the kind of boat, so it goes from Sculling level 1 (placeholder) to Sculling level 2 (placeholder). Choose a level yourself to keep the old one."]);
        await edit(f, "Heron", { seats: 2 });
        expect((await itemOf(f, "Heron")).classCode).toBe("shell-double");
        expect((await state(f)).itemLog[0]).toMatchObject({
          kind: "changed",
          text: "Changed by Test staff: seats from Single (1 seat) to Double (2 seats).",
          details: { classFrom: "shell-single", classTo: "shell-double" },
        });
        // Now two people can be in it.
        await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8), ["Ben"]);
      });

      it("can go the other way, to a quad and back, and stays put when the number is the same", async () => {
        const f = await fixture();
        await edit(f, "Loon", { seats: 4 });
        expect((await itemOf(f, "Loon")).classCode).toBe("shell-quad");
        await edit(f, "Loon", { seats: 2 });
        expect((await itemOf(f, "Loon")).classCode).toBe("shell-double");
        expect(await errorOf(edit(f, "Loon", { seats: 2 }))).toMatchObject({ code: "unchanged" });
      });

      it("keeps a skill level staff chose themselves when the seats change, and says nothing about it", async () => {
        const f = await fixture();
        await edit(f, "Heron", { skill: { mode: "code", code: "scull-3" } });
        const plan = planItemEdit(await state(f), f.book, staffCtx(), f.i.Heron, { seats: 2 });
        expect(plan.notices).toEqual([]);
        await edit(f, "Heron", { seats: 2 });
        expect((await itemOf(f, "Heron")).requiredQualification).toBe("scull-3");
      });

      it("refuses a number of seats the kind of boat does not come in, in words", async () => {
        const f = await fixture();
        expect(await problemsOf(edit(f, "Heron", { seats: 3 }))).toEqual(["A shell can have 1, 2 or 4 seats, not 3."]);
        expect(await problemsOf(edit(f, "Otter", { seats: 4 }))).toEqual(["A kayak can have 1 or 2 seats, not 4."]);
        expect(await problemsOf(edit(f, "Skimmer", { seats: 2 }))).toEqual(["Skimmer is a paddle board, which has 1 seat, so its number of seats cannot change."]);
        expect(await problemsOf(edit(f, "Heron", { seats: 1.5 }))).toEqual(["Seats must be a whole number."]);
        expect((await state(f)).itemLog).toEqual([]);
      });

      it("never turns a shell into a kayak: the seats only choose another size of the same kind", async () => {
        const f = await fixture();
        await edit(f, "Otter", { seats: 2 });
        expect((await itemOf(f, "Otter")).classCode).toBe("kayak-double");
      });

      it("refuses a smaller boat than an upcoming booking has people for, until the crew is off or the booking is cancelled", async () => {
        const f = await fixture();
        const { booking } = await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ben"]);
        expect(await problemsOf(edit(f, "Loon", { seats: 1 }))).toEqual(["1 upcoming booking of Loon has more people in it than Single (1 seat) holds. Take the extra crew off, or cancel that booking, first."]);
        expect((await itemOf(f, "Loon")).classCode).toBe("shell-double");
        await cancelBooking(f.store, f.book, staffCtx(), booking.id);
        await edit(f, "Loon", { seats: 1 });
        expect((await itemOf(f, "Loon")).classCode).toBe("shell-single");
      });

      it("lets a smaller boat go ahead when the booking on it is just one person", async () => {
        const f = await fixture();
        await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8));
        await edit(f, "Loon", { seats: 1 });
        expect((await itemOf(f, "Loon")).classCode).toBe("shell-single");
      });

      it("refuses a smaller boat than a coach's lineup has seats for, until the person is taken out or the practice is cancelled", async () => {
        const f = await fixture();
        const { practice } = await createPractice(f.store, f.book, PRACTICE_RULES, staffCtx(), { name: "Morning session", startsAt: at(2, 7), endsAt: at(2, 9), itemIds: [f.i.Albatross] });
        await seatMember(f.store, f.book, staffCtx(), { practiceId: practice.id, itemId: f.i.Albatross, seat: 3, side: null, memberId: f.m.Ben });
        expect(await problemsOf(edit(f, "Albatross", { seats: 2 }))).toEqual(["1 person is seated in a coach's lineup in a seat that Double (2 seats) does not have. Take them out of that seat first."]);
        // Renaming it is fine while the lineup is there: only the size is held to the seats.
        await edit(f, "Albatross", { name: "Albatross II" });
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), practice.id);
        await edit(f, "Albatross", { seats: 2 });
        expect((await itemOf(f, "Albatross II")).classCode).toBe("shell-double");
      });

      it("lets a smaller boat go ahead when everyone in a lineup sits in a seat it still has", async () => {
        const f = await fixture();
        const { practice } = await createPractice(f.store, f.book, PRACTICE_RULES, staffCtx(), { name: "Morning session", startsAt: at(2, 7), endsAt: at(2, 9), itemIds: [f.i.Albatross] });
        await seatMember(f.store, f.book, staffCtx(), { practiceId: practice.id, itemId: f.i.Albatross, seat: 2, side: null, memberId: f.m.Ben });
        // A double has seats 1 and 2, so seat 2 is still there; it is seat 3 and 4 that would be lost.
        await edit(f, "Albatross", { seats: 2 });
        expect((await itemOf(f, "Albatross")).classCode).toBe("shell-double");
      });

      it("does not mind a lineup whose practice is over, even in a seat the smaller boat lacks", async () => {
        const f = await fixture();
        const { practice } = await createPractice(f.store, f.book, PRACTICE_RULES, staffCtx(), { name: "Morning session", startsAt: at(2, 7), endsAt: at(2, 9), itemIds: [f.i.Albatross] });
        await seatMember(f.store, f.book, staffCtx(), { practiceId: practice.id, itemId: f.i.Albatross, seat: 3, side: null, memberId: f.m.Ben });
        // The same change refused before the practice (above) goes through once its time has run out.
        expect(await problemsOf(edit(f, "Albatross", { seats: 2 }))).toHaveLength(1);
        await edit(f, "Albatross", { seats: 2 }, staffCtx(at(2, 12)));
        expect((await itemOf(f, "Albatross")).classCode).toBe("shell-double");
      });

      it("does not mind a past booking with a crowd in it", async () => {
        const f = await fixture();
        await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ben"]);
        await f.store.transaction(async (s) => {
          const b = s.bookings[0];
          b.status = "cancelled";
          b.statusChangedAt = NOW.toISOString();
          b.cancelledBy = { kind: "staff", label: "Test staff" };
          b.cancelReason = "Test";
        });
        await edit(f, "Loon", { seats: 1 });
        expect((await itemOf(f, "Loon")).classCode).toBe("shell-single");
      });
    });

    describe("the skill level", () => {
      it("can be none, a named level, or back to the usual one for the kind of boat, each with its own words in the file", async () => {
        const f = await fixture();
        await edit(f, "Heron", { skill: { mode: "none" } });
        expect((await itemOf(f, "Heron")).requiredQualification).toBeNull();
        await edit(f, "Heron", { skill: { mode: "code", code: "scull-3" } });
        expect((await itemOf(f, "Heron")).requiredQualification).toBe("scull-3");
        await edit(f, "Heron", { skill: { mode: "class" } });
        const heron = await itemOf(f, "Heron");
        expect(heron.requiredQualification).toBeUndefined();
        expect("requiredQualification" in heron).toBe(false);
        const file = itemFile(await state(f), f.i.Heron);
        expect(file.map((l) => l.text)).toEqual([
          "Changed by Test staff: skill level needed from Sculling level 3 (placeholder) to Sculling level 1 (placeholder) (usual for this kind of boat).",
          "Changed by Test staff: skill level needed from None needed to Sculling level 3 (placeholder).",
          "Changed by Test staff: skill level needed from Sculling level 1 (placeholder) (usual for this kind of boat) to None needed.",
        ]);
        expect((await state(f)).itemLog.map((l) => [l.details.skillFrom, l.details.skillTo])).toEqual([["class", "none"], ["none", "scull-3"], ["scull-3", "class"]]);
      });

      it("changes who the booking check lets in", async () => {
        const f = await fixture();
        await edit(f, "Heron", { skill: { mode: "code", code: "scull-3" } });
        expect(await refusedFor(bookAs(f, "Dee", "Heron", at(1, 7), at(1, 8)))).toContain("not_qualified");
        await edit(f, "Heron", { skill: { mode: "none" } });
        expect(await refusedFor(bookAs(f, "Cy", "Heron", at(1, 7), at(1, 8)))).toEqual([]);
      });

      it("refuses a level the club does not use, and a level that is already set", async () => {
        const f = await fixture();
        expect(await problemsOf(edit(f, "Heron", { skill: { mode: "code", code: "sweep-9" } }))).toEqual(['"sweep-9" is not a skill level the club uses.']);
        expect(await errorOf(edit(f, "Heron", { skill: { mode: "class" } }))).toMatchObject({ code: "unchanged" });
      });

      it("says a private boat's skill level is not checked", async () => {
        const f = await fixture();
        await f.store.transaction(async (s, newId) => {
          s.items.push({ id: newId(), name: "Kestrel", classCode: "shell-single", ruleOverrides: {}, isPrivate: true });
        });
        const k = await itemOf(f, "Kestrel");
        const plan = planItemEdit(await state(f), f.book, staffCtx(), k.id, { skill: { mode: "none" } });
        expect(plan.notices).toEqual(["Kestrel is a private boat, so its skill level is not checked when it is booked."]);
      });

      it("describes the level in words", async () => {
        const f = await fixture();
        const s = await state(f);
        expect(skillWords(s, f.book, s.items.find((i) => i.name === "Heron")!)).toBe("Sculling level 1 (placeholder) (usual for this kind of boat)");
        expect(skillWords(s, f.book, s.items.find((i) => i.name === "Otter")!)).toBe("None needed (usual for this kind of boat)");
        expect(skillWords(s, f.book, { ...s.items[0], requiredQualification: null })).toBe("None needed");
      });
    });

    describe("the places in a pool", () => {
      it("resizes a pool, and writes the old and new number in its file", async () => {
        const f = await fixture();
        const pool = await addPool(f, "Dock berths", 4);
        await updateItem(f.store, f.book, staffCtx(), pool, { places: 3 });
        expect(placesOf(await itemOf(f, "Dock berths"))).toBe(3);
        expect((await state(f)).itemLog[0]).toMatchObject({ text: "Changed by Test staff: places from 4 to 3.", details: { placesFrom: 4, placesTo: 3 } });
        await updateItem(f.store, f.book, staffCtx(), pool, { places: 60 });
        expect(placesOf(await itemOf(f, "Dock berths"))).toBe(60);
        expect(await errorOf(updateItem(f.store, f.book, staffCtx(), pool, { places: 60 }))).toMatchObject({ code: "unchanged" });
      });

      it("refuses a number outside 2 to 500, a part of a place, and an item that is not a pool", async () => {
        const f = await fixture();
        const pool = await addPool(f);
        const run = (places: number) => problemsOf(updateItem(f.store, f.book, staffCtx(), pool, { places }));
        expect(await run(1)).toEqual(["Places must be a whole number from 2 to 500."]);
        expect(await run(501)).toEqual(["Places must be a whole number from 2 to 500."]);
        expect(await run(2.5)).toEqual(["Places must be a whole number from 2 to 500."]);
        await updateItem(f.store, f.book, staffCtx(), pool, { places: 500 });
        await updateItem(f.store, f.book, staffCtx(), pool, { places: 2 });
        expect(await problemsOf(edit(f, "Heron", { places: 4 }))).toEqual(["Heron has a single place, so it is not a pool and has no number of places to change."]);
        expect(await problemsOf(edit(f, "Dock slip A", { places: 4 }))).toEqual(["Dock slip A has a single place, so it is not a pool and has no number of places to change."]);
      });

      it("will not go below the most people booked in at one moment, and says when that is, until some are cancelled", async () => {
        const f = await fixture();
        const pool = await addPool(f, "Dock berths", 4);
        const names = ["Ada", "Ben", "Dee", "Eli"];
        const made = [];
        for (const who of names) made.push(await holdPlace(f, pool, who, 8));
        expect(await problemsOf(updateItem(f.store, f.book, staffCtx(), pool, { places: 3 }))).toEqual([
          expect.stringMatching(/^4 people hold Dock berths at once from .*, so it cannot go below 4 places until some of those bookings are cancelled\.$/),
        ]);
        // Exactly the busiest moment is fine: it still fits.
        await updateItem(f.store, f.book, staffCtx(), pool, { places: 5 });
        await updateItem(f.store, f.book, staffCtx(), pool, { places: 4 });
        await cancelBooking(f.store, f.book, staffCtx(), made[0].booking.id);
        await updateItem(f.store, f.book, staffCtx(), pool, { places: 3 });
        expect(placesOf(await itemOf(f, "Dock berths"))).toBe(3);
      });

      it("counts the busiest moment, not the total: bookings one after another fit in a small pool", async () => {
        const f = await fixture();
        const pool = await addPool(f, "Dock berths", 4);
        for (const [who, hour] of [["Ada", 8], ["Ben", 9], ["Dee", 10], ["Eli", 11]] as const) await holdPlace(f, pool, who, hour);
        await updateItem(f.store, f.book, staffCtx(), pool, { places: 2 });
        expect(placesOf(await itemOf(f, "Dock berths"))).toBe(2);
      });

      it("does not count a booking that is already over, however busy that moment was", async () => {
        const clock = { now: NOW };
        const f = await buildFixtureSettling(kind, () => clock.now);
        const pool = await addPool(f, "Dock berths", 4);
        for (const who of ["Ada", "Ben", "Dee", "Eli"]) await holdPlace(f, pool, who, 8);
        expect(await problemsOf(updateItem(f.store, f.book, staffCtx(), pool, { places: 2 }))).toHaveLength(1);
        // Two days later those four bookings are long over, so the pool can go down to two places.
        clock.now = at(3, 12);
        await updateItem(f.store, f.book, staffCtx(clock.now), pool, { places: 2 });
        expect(placesOf(await itemOf(f, "Dock berths"))).toBe(2);
      });
    });

    describe("everything at once", () => {
      it("changes name, seats, skill and nothing else, in one step with one line", async () => {
        const f = await fixture();
        const { changes } = await edit(f, "Heron", { name: "Heron II", seats: 2, skill: { mode: "none" } });
        expect(changes.map((c) => c.field)).toEqual(["name", "seats", "skill"]);
        const heron = await itemOf(f, "Heron II");
        expect([heron.classCode, heron.requiredQualification]).toEqual(["shell-double", null]);
        expect((await state(f)).itemLog).toHaveLength(1);
        expect((await state(f)).itemLog[0].text).toBe(
          'Changed by Test staff: name from "Heron" to "Heron II"; seats from Single (1 seat) to Double (2 seats); skill level needed from Sculling level 1 (placeholder) (usual for this kind of boat) to None needed.',
        );
      });

      it("reports every problem together, and changes nothing", async () => {
        const f = await fixture();
        const problems = await problemsOf(edit(f, "Heron", { name: "  ", seats: 3, skill: { mode: "code", code: "nope" }, places: 9 }));
        expect(problems).toEqual([
          "The name cannot be empty.",
          "A shell can have 1, 2 or 4 seats, not 3.",
          '"nope" is not a skill level the club uses.',
          "Heron has a single place, so it is not a pool and has no number of places to change.",
        ]);
        expect(await itemOf(f, "Heron")).toMatchObject({ name: "Heron", classCode: "shell-single" });
        expect((await state(f)).itemLog).toEqual([]);
      });

      it("keeps two edits at the same moment in order, each line saying what it was", async () => {
        const f = await fixture();
        const results = await Promise.allSettled([edit(f, "Heron", { name: "Heron A" }), updateItem(f.store, f.book, staffCtx(), f.i.Heron, { name: "Heron B" })]);
        expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
        const log = (await state(f)).itemLog;
        expect(log).toHaveLength(2);
        expect(log[1].details.nameFrom).toBe(log[0].details.nameTo);
        expect((await itemOf(f, String(log[1].details.nameTo))).id).toBe(f.i.Heron);
      });
    });
  });

  describe(`retiring and bringing back (${kind} store)`, () => {
    describe("retiring", () => {
      it("marks the item retired with who, when and why, and writes the line in its file", async () => {
        const f = await fixture();
        const { item, effects } = await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "  Sold   to a club in Tacoma " });
        expect(item.retired).toEqual({ at: NOW.toISOString(), by: { kind: "staff", label: "Test staff" }, reason: "Sold to a club in Tacoma" });
        expect(effects).toEqual({ bookings: [], sessions: [], practices: [] });
        const s = await state(f);
        expect(s.items.find((i) => i.id === f.i.Osprey)?.retired).toEqual(item.retired);
        expect(s.itemLog).toHaveLength(1);
        expect(s.itemLog[0]).toMatchObject({
          itemId: f.i.Osprey,
          kind: "retired",
          by: { kind: "staff", label: "Test staff" },
          text: "Retired by Test staff. Reason: Sold to a club in Tacoma. Nothing was booked on it.",
          details: { reason: "Sold to a club in Tacoma" },
        });
      });

      it("needs a reason, of up to 200 characters, without a character that cannot be saved", async () => {
        const f = await fixture();
        expect(await errorOf(retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "   " }))).toMatchObject({ code: "invalid", message: "Say why it is being retired, for the record." });
        expect(await errorOf(retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "x".repeat(201) }))).toMatchObject({ code: "invalid", message: "The reason must be 200 characters or fewer." });
        expect(await errorOf(retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Sold\u0000" }))).toMatchObject({ code: "invalid" });
        await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "y".repeat(200) });
        expect((await itemOf(f, "Osprey")).retired?.reason).toHaveLength(200);
      });

      it("cannot retire what is already retired, or what does not exist", async () => {
        const f = await fixture();
        await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Sold" });
        expect(await errorOf(retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Sold again" }))).toMatchObject({ code: "conflict", message: "Osprey has already been retired." });
        expect(await errorOf(retireItem(f.store, staffCtx(), "00000000-0000-4000-8000-0000000fffff", { reason: "Sold" }))).toMatchObject({ code: "not_found" });
        expect((await state(f)).itemLog).toHaveLength(1);
      });

      it("cancels nothing: bookings stay upcoming, and staff are told who to contact, with every class and practice that reaches it", async () => {
        const f = await fixture();
        const { booking } = await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ben"]);
        await f.store.transaction(async (s, newId) => {
          s.items.push({ id: newId(), name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
        });
        const gym = (await itemOf(f, "Boathouse gym")).id;
        const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 3, defaultMinutes: 60, roomItemId: gym });
        const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(2, 8) });
        const { practice } = await createPractice(f.store, f.book, PRACTICE_RULES, staffCtx(), { name: "Morning session", startsAt: at(2, 7), endsAt: at(2, 9), itemIds: [f.i.Pelican] });

        const loon = await retireItem(f.store, staffCtx(), f.i.Loon, { reason: "Sold" });
        expect(loon.effects.bookings).toHaveLength(1);
        expect(loon.effects.bookings[0]).toMatchObject({ bookingId: booking.id, itemName: "Loon" });
        expect(loon.effects.bookings[0].people.map((p) => [p.name, p.role, p.email])).toEqual([["Ada Quill", "booker", "ada@example.com"], ["Ben Quill", "crew", "ben@example.com"]]);
        const room = await retireItem(f.store, staffCtx(), gym, { reason: "Gym closed" });
        expect(room.effects.sessions).toEqual([{ id: session.id, title: "Yoga", startsAt: session.startsAt, endsAt: session.endsAt }]);
        const pelican = await retireItem(f.store, staffCtx(), f.i.Pelican, { reason: "Sold" });
        expect(pelican.effects.practices).toEqual([{ id: practice.id, name: "Morning session", startsAt: practice.startsAt, endsAt: practice.endsAt }]);

        const s = await state(f);
        expect(s.bookings.find((b) => b.id === booking.id)?.status).toBe("upcoming");
        expect(s.sessions.find((x) => x.id === session.id)?.status).toBe("scheduled");
        expect(s.practices.find((x) => x.id === practice.id)?.status).toBe("scheduled");
        expect(s.itemLog.find((l) => l.itemId === f.i.Loon)?.text).toBe("Retired by Test staff. Reason: Sold. 1 upcoming booking was left in place; staff have the list to contact the people.");
        expect(s.itemLog.find((l) => l.itemId === gym)?.text).toBe("Retired by Test staff. Reason: Gym closed. 1 scheduled class was left in place; staff have the list to contact the people.");
        expect(s.itemLog.find((l) => l.itemId === f.i.Pelican)?.text).toBe("Retired by Test staff. Reason: Sold. 1 scheduled practice was left in place; staff have the list to contact the people.");
      });

      it("does not count a booking that is over, or a class or practice that has finished or been cancelled", async () => {
        const f = await fixture();
        const { booking } = await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8));
        await cancelBooking(f.store, f.book, staffCtx(), booking.id);
        const { practice } = await createPractice(f.store, f.book, PRACTICE_RULES, staffCtx(), { name: "Morning session", startsAt: at(2, 7), endsAt: at(2, 9), itemIds: [f.i.Loon] });
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), practice.id);
        const { effects } = await retireItem(f.store, staffCtx(), f.i.Loon, { reason: "Sold" });
        expect(effects).toEqual({ bookings: [], sessions: [], practices: [] });
      });

      it("does not count a class that was cancelled, a class or practice whose time has run out, or a boat taken off a practice", async () => {
        const f = await fixture();
        await f.store.transaction(async (s, newId) => {
          s.items.push({ id: newId(), name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
        });
        const gym = (await itemOf(f, "Boathouse gym")).id;
        const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 3, defaultMinutes: 60, roomItemId: gym });
        const [cancelled, second] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(2, 8), weeks: 2 });
        await cancelSession(f.store, staffCtx(), cancelled.id, { reason: "Teacher is away" });
        // A practice that will be over by the time of the retirement, and one whose boat was taken off before it.
        const over = await createPractice(f.store, f.book, PRACTICE_RULES, staffCtx(), { name: "Early session", startsAt: at(2, 5), endsAt: at(2, 6), itemIds: [f.i.Pelican] });
        const dropped = await createPractice(f.store, f.book, PRACTICE_RULES, staffCtx(), { name: "Late session", startsAt: at(2, 18), endsAt: at(2, 19), itemIds: [f.i.Pelican] });
        await removePracticeBoat(f.store, staffCtx(), dropped.practice.id, f.i.Pelican);

        // Before anything runs out: the class that is still on and the early practice are the only things left in place.
        const first = retireEffects(await state(f), NOW, gym);
        expect(first.sessions.map((x) => x.id)).toEqual([second.id]);
        expect(retireEffects(await state(f), NOW, f.i.Pelican).practices.map((x) => x.id)).toEqual([over.practice.id]);

        // A week later the second class is over too, and so is the early practice.
        const later = at(20, 12);
        expect(retireEffects(await state(f), later, gym).sessions).toEqual([]);
        expect(retireEffects(await state(f), later, f.i.Pelican).practices).toEqual([]);
        const done = await retireItem(f.store, staffCtx(later), gym, { reason: "Gym closed" });
        expect(done.effects.sessions).toEqual([]);
      });
    });

    describe("while it is retired", () => {
      it("refuses a booking in words, for staff booking past the rules too", async () => {
        const f = await fixture();
        await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Sold" });
        expect(await refusedFor(bookAs(f, "Ada", "Osprey", at(1, 7), at(1, 8)))).toEqual(["item_retired"]);
        const asStaff = createBooking(f.store, f.book, staffCtx(), request(f, "Ada", "Osprey", at(1, 7), at(1, 8)), { override: { reason: "A lesson" } });
        expect(await refusedFor(asStaff)).toContain("item_retired");
        await expect(bookAs(f, "Ada", "Osprey", at(1, 7), at(1, 8))).rejects.toThrow("Osprey has been retired and can no longer be booked.");
      });

      it("is shown to nobody: not on the day view, not to staff, not to a member, not in the boats a practice can reserve", async () => {
        const f = await fixture();
        const names = async () => dayView(await state(f), f.book, { day: "2026-10-29", now: NOW, viewer: { kind: "staff" } }).items.map((i) => i.item.name);
        expect(await names()).toContain("Osprey");
        await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Sold" });
        expect(await names()).not.toContain("Osprey");
        expect(await names()).toContain("Heron");
        const s = await state(f);
        const osprey = s.items.find((i) => i.name === "Osprey")!;
        expect(itemVisibleTo(s, osprey, { kind: "staff" })).toBe(false);
        expect(itemVisibleTo(s, osprey, { kind: "member", memberId: f.m.Ada })).toBe(false);
        expect(reservableBoats(s, f.book).map((b) => b.name)).not.toContain("Osprey");
        expect(reservableBoats(s, f.book).map((b) => b.name)).toContain("Heron");
      });

      it("is left off the staff board's out-of-service list, even when it was out of service when it was retired", async () => {
        const f = await fixture();
        await takeOutOfService(f.store, staffCtx(), f.i.Osprey, { reason: "Oar damage" });
        const board = async () => officeSummary(await state(f), NOW, ATTENDANCE_RULES).outOfService.map((x) => x.name);
        expect(await board()).toEqual(["Osprey"]);
        await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Sold" });
        expect(await board()).toEqual([]);
      });

      it("is left off the private boats lists and the locked boats to-do", async () => {
        const f = await fixture();
        await f.store.transaction(async (s, newId) => {
          s.items.push({ id: newId(), name: "Kestrel", classCode: "shell-single", ruleOverrides: {}, isPrivate: true });
        });
        const kestrel = (await itemOf(f, "Kestrel")).id;
        expect(lockedBoats(await state(f), NOW).map((b) => b.name)).toEqual(["Kestrel"]);
        await retireItem(f.store, staffCtx(), kestrel, { reason: "Sold" });
        expect(lockedBoats(await state(f), NOW)).toEqual([]);
        expect(privateBoats(await state(f), f.book, NOW)).toEqual([]);
        expect(await errorOf(addBoatOwner(f.store, staffCtx(), { itemId: kestrel, memberId: f.m.Ada }))).toMatchObject({ code: "conflict", message: "Kestrel has been retired, so its list of owners cannot change. Club staff can bring it back first." });
      });

      it("cannot be given to a class as its room or reserved for a practice", async () => {
        const f = await fixture();
        await f.store.transaction(async (s, newId) => {
          s.items.push({ id: newId(), name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
        });
        const gym = (await itemOf(f, "Boathouse gym")).id;
        await retireItem(f.store, staffCtx(), gym, { reason: "Closed" });
        await retireItem(f.store, staffCtx(), f.i.Heron, { reason: "Sold" });
        expect(await errorOf(createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 3, defaultMinutes: 60, roomItemId: gym }))).toMatchObject({ code: "invalid", message: "Boathouse gym has been retired, so a class cannot use it." });
        await expect(createPractice(f.store, f.book, PRACTICE_RULES, staffCtx(), { name: "Morning session", startsAt: at(2, 7), endsAt: at(2, 9), itemIds: [f.i.Heron] })).rejects.toMatchObject({ reasons: expect.arrayContaining(["Heron has been retired, so it cannot go on a practice."]) });
      });

      it("leaves a retired item out of service, and out of the staff office's out-of-service list", async () => {
        const f = await fixture();
        await takeOutOfService(f.store, staffCtx(), f.i.Osprey, { reason: "Cracked hull" });
        await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Written off" });
        const list = equipmentList(await state(f), f.book, NOW);
        expect(list.retired.map((l) => [l.name, l.status])).toEqual([["Osprey", "retired"]]);
      });

      it("can only be renamed: nothing else can be changed until it is brought back", async () => {
        const f = await fixture();
        await retireItem(f.store, staffCtx(), f.i.Loon, { reason: "Sold" });
        const refusal = ["Loon has been retired, so only its name can be changed. Bring it back to change anything else."];
        expect(await problemsOf(edit(f, "Loon", { seats: 1 }))).toEqual(refusal);
        expect(await problemsOf(edit(f, "Loon", { skill: { mode: "none" } }))).toEqual(refusal);
        await edit(f, "Loon", { name: "Loon (sold)" });
        expect((await itemOf(f, "Loon (sold)")).retired?.reason).toBe("Sold");
        await restoreItem(f.store, staffCtx(), f.i.Loon);
        await edit(f, "Loon", { seats: 1 });
        expect((await itemOf(f, "Loon (sold)")).classCode).toBe("shell-single");
      });

      it("keeps a retired pool's number of places as it was", async () => {
        const f = await fixture();
        const pool = await addPool(f, "Dock berths", 4);
        await retireItem(f.store, staffCtx(), pool, { reason: "Dock removed" });
        expect(await problemsOf(updateItem(f.store, f.book, staffCtx(), pool, { places: 6 }))).toEqual([
          "Dock berths has been retired, so only its name can be changed. Bring it back to change anything else.",
        ]);
        expect(placesOf(await itemOf(f, "Dock berths"))).toBe(4);
      });

      it("frees nothing in the name: a new item cannot take a retired item's name", async () => {
        const f = await fixture();
        await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Sold" });
        expect(await problemsOf(edit(f, "Heron", { name: "Osprey" }))).toEqual([expect.stringContaining('(retired)')]);
      });
    });

    describe("bringing it back", () => {
      it("makes it offered and bookable again, and writes the line", async () => {
        const f = await fixture();
        await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Sold" });
        const back = await restoreItem(f.store, staffCtx(), f.i.Osprey);
        expect(back.retired).toBeUndefined();
        expect("retired" in (await itemOf(f, "Osprey"))).toBe(false);
        await bookAs(f, "Ada", "Osprey", at(1, 7), at(1, 8));
        const file = itemFile(await state(f), f.i.Osprey);
        expect(file.map((l) => [l.kind, l.by, l.text])).toEqual([
          ["restored", "Test staff", "Brought back by Test staff. It can be booked again."],
          ["retired", "Test staff", "Retired by Test staff. Reason: Sold. Nothing was booked on it."],
        ]);
        expect(dayView(await state(f), f.book, { day: "2026-10-29", now: NOW, viewer: { kind: "staff" } }).items.map((i) => i.item.name)).toContain("Osprey");
      });

      it("can be retired again after coming back, with a new reason", async () => {
        const f = await fixture();
        await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Sold" });
        await restoreItem(f.store, staffCtx(), f.i.Osprey);
        await retireItem(f.store, staffCtx(), f.i.Osprey, { reason: "Sold after all" });
        expect((await itemOf(f, "Osprey")).retired?.reason).toBe("Sold after all");
        expect((await state(f)).itemLog.map((l) => l.kind)).toEqual(["retired", "restored", "retired"]);
      });

      it("refuses an item that is not retired, or does not exist", async () => {
        const f = await fixture();
        expect(await errorOf(restoreItem(f.store, staffCtx(), f.i.Osprey))).toMatchObject({ code: "conflict", message: "Osprey has not been retired." });
        expect(await errorOf(restoreItem(f.store, staffCtx(), "00000000-0000-4000-8000-0000000fffff"))).toMatchObject({ code: "not_found" });
        expect((await state(f)).itemLog).toEqual([]);
      });
    });
  });

  describe(`what staff see (${kind} store)`, () => {
    it("splits the items into in use and retired, by name, with each one's status, and counts the whole club", async () => {
      const f = await fixture();
      await takeOutOfService(f.store, staffCtx(), f.i.Otter, { reason: "Paddle mending", expectedReturn: "2026-11-05" });
      await retireItem(f.store, staffCtx(), f.i.Kingfisher, { reason: "Sold" });
      const list = equipmentList(await state(f), f.book, NOW);
      expect(list.total).toBe(9);
      expect(list.active.map((l) => l.name)).toEqual(["Albatross", "Dock slip A", "Heron", "Loon", "Osprey", "Otter", "Pelican", "Skimmer"]);
      expect(list.retired.map((l) => [l.name, l.status, l.retired?.by, l.retired?.reason])).toEqual([["Kingfisher", "retired", "Test staff", "Sold"]]);
      const otter = list.active.find((l) => l.name === "Otter")!;
      expect(otter).toMatchObject({ status: "out_of_service", className: "Kayak", seats: 1, pool: false, isPrivate: false, out: { reason: "Paddle mending", expectedReturn: "2026-11-05" } });
      expect(list.active.find((l) => l.name === "Heron")).toMatchObject({ status: "in_service", out: null, skill: "Sculling level 1 (placeholder) (usual for this kind of boat)" });
    });

    it("narrows by the first letters of any word of the name, in both lists, and still counts the whole club", async () => {
      const f = await fixture();
      await retireItem(f.store, staffCtx(), f.i.Kingfisher, { reason: "Sold" });
      const list = equipmentList(await state(f), f.book, NOW, "slip");
      expect(list.active.map((l) => l.name)).toEqual(["Dock slip A"]);
      expect(list.retired).toEqual([]);
      expect(list.total).toBe(9);
      expect(equipmentList(await state(f), f.book, NOW, "king").retired.map((l) => l.name)).toEqual(["Kingfisher"]);
      expect(equipmentList(await state(f), f.book, NOW, "zzz")).toMatchObject({ active: [], retired: [], total: 9 });
    });

    it("shows a pool's places and a private boat as private, and how many bookings still reach an item", async () => {
      const f = await fixture();
      await addPool(f, "Dock berths", 60);
      await f.store.transaction(async (s, newId) => {
        s.items.push({ id: newId(), name: "Kestrel", classCode: "shell-single", ruleOverrides: {}, isPrivate: true });
      });
      await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8));
      const list = equipmentList(await state(f), f.book, NOW);
      expect(list.active.find((l) => l.name === "Dock berths")).toMatchObject({ pool: true, places: 60 });
      expect(list.active.find((l) => l.name === "Kestrel")?.isPrivate).toBe(true);
      expect(list.active.find((l) => l.name === "Loon")?.upcoming).toBe(1);
      expect(list.active.find((l) => l.name === "Heron")?.upcoming).toBe(0);
    });

    it("keeps an item's file newest first, and shows what retiring it would leave in place on its page", async () => {
      const f = await fixture();
      await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8));
      await edit(f, "Loon", { name: "Loon II" });
      const later = new Date(NOW.getTime() + 60000);
      await retireItem(f.store, { actor: { kind: "staff", label: "Sam Staffer" }, now: later }, f.i.Loon, { reason: "Sold" });
      const page = itemPage(await state(f), f.book, NOW, f.i.Loon);
      expect(page.file.map((l) => [l.kind, l.by])).toEqual([["retired", "Sam Staffer"], ["changed", "Test staff"]]);
      expect(page.line).toMatchObject({ name: "Loon II", status: "retired" });
      // The booking stays, so a retired item's page still lists the person to contact.
      expect(page.effects.bookings.map((b) => b.people[0].name)).toEqual(["Ada Quill"]);
      const live = itemPage(await state(f), f.book, NOW, f.i.Pelican);
      expect(live.file).toEqual([]);
      expect(live.line.status).toBe("in_service");
    });

    it("counts only the bookings that still reach an item, never a cancelled one", async () => {
      const f = await fixture();
      const { booking } = await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8));
      await bookAs(f, "Ada", "Loon", at(2, 7), at(2, 8));
      expect(equipmentList(await state(f), f.book, NOW).active.find((l) => l.name === "Loon")?.upcoming).toBe(2);
      await cancelBooking(f.store, f.book, staffCtx(), booking.id);
      expect(equipmentList(await state(f), f.book, NOW).active.find((l) => l.name === "Loon")?.upcoming).toBe(1);
    });

    it("shows what retiring an item in use would leave in place", async () => {
      const f = await fixture();
      await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ben"]);
      const page = itemPage(await state(f), f.book, NOW, f.i.Loon);
      expect(page.effects.bookings).toHaveLength(1);
      expect(page.effects.bookings[0].people.map((p) => p.name)).toEqual(["Ada Quill", "Ben Quill"]);
    });
  });
}
