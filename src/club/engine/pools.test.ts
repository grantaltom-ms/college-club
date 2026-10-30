import { describe, expect, it } from "vitest";
import { CLASS_RULES } from "../settings/class-rules";
import type { RuleBook } from "../types";
import { HOLDING_STATUSES } from "../types";
import { dayView } from "./availability";
import { BookingRefused, cancelBooking, createBooking, takeOutOfService } from "./bookings";
import { cancelSession, createClass, scheduleSessions } from "./classes";
import { describeRules } from "./describe";
import { firstFullStretch, occupancy, placesOf } from "./pools";
import { NOW, STORE_KINDS, TODAY, addMembers, at, bookAs, fixtureFor, memberCtx, refusalMessages, refusedFor, request, ruleBookWith, staffCtx, type Fixture, type StoreKind } from "./testkit";

/**
 * Pools: a dock, the club room or the gym is one item with a number of places. The club counts how many are taken at each
 * moment; it never says which place a member has. A boat stays one booking at a time.
 */

/** The invented club plus a pool of `places` named "Dock pool" (dock space) and a single dock slip. */
async function poolClub(kind: StoreKind, places = 3, book?: RuleBook) {
  const f = await fixtureFor(kind)(book);
  await addPool(f, "Dock pool", "dock-space", places);
  return f;
}

async function addPool(f: Fixture, name: string, classCode: string, places: number) {
  await f.store.transaction(async (s, newId) => {
    const id = newId();
    s.items.push({ id, name, classCode, ruleOverrides: {}, ...(places > 1 ? { places } : {}) });
    f.i[name] = id;
  });
}

const held = async (f: Fixture, item: string) => (await f.store.read()).bookings.filter((b) => b.itemId === f.i[item] && HOLDING_STATUSES.includes(b.status));

for (const kind of STORE_KINDS) {
  describe(`pools on the ${kind} store`, () => {
    describe("counting places", () => {
      it("lets as many people hold the pool at once as it has places, and tells the next one it is full, in words", async () => {
        const f = await poolClub(kind, 3);
        const people = await addMembers(f, 4);
        for (const id of people.slice(0, 3)) expect(await refusedFor(bookAs(f, id, "Dock pool", at(1, 9), at(1, 10)))).toEqual([]);
        expect(await refusalMessages(bookAs(f, people[3], "Dock pool", at(1, 9), at(1, 10)))).toEqual(["Dock pool is full from 9:00 to 10:00 am: all 3 places are booked."]);
        expect(await held(f, "Dock pool")).toHaveLength(3);
      });

      it("gives a different time its own count: back to back bookings never count together", async () => {
        const f = await poolClub(kind, 2);
        const [a, b, c, d] = await addMembers(f, 4);
        await bookAs(f, a, "Dock pool", at(1, 9), at(1, 10));
        await bookAs(f, b, "Dock pool", at(1, 9), at(1, 10));
        // Full from 9 to 10, but the very next half hour and the one before are free.
        expect(await refusedFor(bookAs(f, c, "Dock pool", at(1, 10), at(1, 10, 30)))).toEqual([]);
        expect(await refusedFor(bookAs(f, d, "Dock pool", at(1, 8, 30), at(1, 9)))).toEqual([]);
      });

      it("counts the busiest moment inside a booking, so a long booking fits where a shorter pair together would not", async () => {
        // Two places. A 9 to 10 and B 10 to 11 each hold one place at a time. C 9 to 11 needs one place the whole time: at no
        // moment are both taken, so it fits. A numbered place could not say so (no single place is free for the whole two hours).
        const f = await poolClub(kind, 2);
        const [a, b, c, d, e] = await addMembers(f, 5);
        await bookAs(f, a, "Dock pool", at(1, 9), at(1, 10));
        await bookAs(f, b, "Dock pool", at(1, 10), at(1, 11));
        expect(await refusedFor(bookAs(f, c, "Dock pool", at(1, 9), at(1, 11)))).toEqual([]);
        // Now 9 to 10 holds A and C, and 10 to 11 holds B and C: both full. D starting at 9:30 meets the full stretch from 9:30 to 10.
        expect(await refusalMessages(bookAs(f, d, "Dock pool", at(1, 9, 30), at(1, 10, 30)))).toEqual(["Dock pool is full from 9:30 to 10:30 am: all 2 places are booked."]);
        expect(await refusedFor(bookAs(f, e, "Dock pool", at(1, 11), at(1, 11, 30)))).toEqual([]);
      });

      it("names the first stretch that is full when only part of the booking is, and joins stretches that follow each other", async () => {
        const f = await poolClub(kind, 1 + 1);
        const [a, b, c] = await addMembers(f, 3);
        await bookAs(f, a, "Dock pool", at(1, 10), at(1, 11));
        await bookAs(f, b, "Dock pool", at(1, 10), at(1, 11));
        expect(await refusalMessages(bookAs(f, c, "Dock pool", at(1, 9, 30), at(1, 11, 30)))).toEqual(["Dock pool is full from 10:00 to 11:00 am: all 2 places are booked."]);
      });

      it("frees a place the moment a booking is cancelled, and the pool is full again when the place is taken", async () => {
        const f = await poolClub(kind, 1 + 1);
        const [a, b, c, d] = await addMembers(f, 4);
        const first = await bookAs(f, a, "Dock pool", at(1, 9), at(1, 10));
        await bookAs(f, b, "Dock pool", at(1, 9), at(1, 10));
        expect(await refusedFor(bookAs(f, c, "Dock pool", at(1, 9), at(1, 10)))).toEqual(["slot_taken"]);
        await cancelBooking(f.store, f.book, memberCtx(a, "Extra0"), first.booking.id);
        expect(await refusedFor(bookAs(f, c, "Dock pool", at(1, 9), at(1, 10)))).toEqual([]);
        // Two places, held by Extra1 and Extra2: full again.
        expect(await refusedFor(bookAs(f, d, "Dock pool", at(1, 9), at(1, 10)))).toEqual(["slot_taken"]);
      });
    });

    describe("one place at a time for one person", () => {
      it("refuses a second place in the same pool at an overlapping time, even for staff booking past the rules", async () => {
        const f = await poolClub(kind, 5);
        const [a] = await addMembers(f, 1);
        await bookAs(f, a, "Dock pool", at(1, 9), at(1, 10));
        expect(await refusedFor(bookAs(f, a, "Dock pool", at(1, 9, 30), at(1, 10, 30)))).toEqual(expect.arrayContaining(["already_has_place"]));
        expect(await refusalMessages(bookAs(f, a, "Dock pool", at(1, 9, 30), at(1, 10, 30)))).toEqual(
          expect.arrayContaining(["You already have a place in Dock pool from 9:00 to 10:00 am. It is one place at a time."]),
        );
        await expect(createBooking(f.store, f.book, staffCtx(), request(f, a, "Dock pool", at(1, 9, 30), at(1, 10, 30)), { override: { reason: "Please" } })).rejects.toBeInstanceOf(BookingRefused);
        // Straight after it (one ends as the next starts) is a different time, so the same person can book the pool again. The usual
        // limits still apply, so staff set that rule aside.
        const later = await createBooking(f.store, f.book, staffCtx(), request(f, a, "Dock pool", at(1, 10), at(1, 11)), { override: { reason: "Second visit" } });
        expect(later.waived).toEqual(["over_daily_limit"]);
        expect(await held(f, "Dock pool")).toHaveLength(2);
      });

      it("says 'has' instead of 'have' when staff are looking at someone else's refusal", async () => {
        const f = await poolClub(kind, 5);
        const [a] = await addMembers(f, 1);
        await bookAs(f, a, "Dock pool", at(1, 9), at(1, 10));
        const staffTry = createBooking(f.store, f.book, staffCtx(), request(f, a, "Dock pool", at(1, 9), at(1, 10)), { override: { reason: "x" } });
        await expect(staffTry).rejects.toMatchObject({ reasons: expect.arrayContaining([expect.objectContaining({ code: "already_has_place", message: expect.stringContaining("Extra0 Member already has a place") })]) });
      });
    });

    describe("the usual rules still apply to a pool", () => {
      it("keeps the daily limit, the window, the hours and the step, and never asks for a gap between bookings", async () => {
        const f = await poolClub(kind, 5, ruleBookWith({ gapMinutes: 30 }));
        const [a, b] = await addMembers(f, 2);
        await bookAs(f, a, "Dock pool", at(1, 9), at(1, 10));
        // One dock booking a day for a member, whatever the pool.
        expect(await refusedFor(bookAs(f, a, "Dock pool", at(1, 11), at(1, 12)))).toEqual(["over_daily_limit"]);
        // Two bookings back to back by different people need no gap in a pool (a single dock slip would).
        expect(await refusedFor(bookAs(f, b, "Dock pool", at(1, 10), at(1, 11)))).toEqual([]);
        expect(await refusedFor(bookAs(f, "Dee", "Dock slip A", at(2, 9), at(2, 10)))).toEqual([]);
        expect(await refusedFor(bookAs(f, "Eli", "Dock slip A", at(2, 10), at(2, 11)))).toEqual(["gap_needed"]);
        // Outside the window and outside the hours.
        expect(await refusedFor(bookAs(f, "Ada", "Dock pool", at(9, 9), at(9, 10)))).toEqual(["too_far_ahead"]);
        expect(await refusedFor(bookAs(f, "Ben", "Dock pool", at(1, 4), at(1, 5)))).toEqual(["outside_hours"]);
      });

      it("refuses a pool that is out of service, whatever its places", async () => {
        const f = await poolClub(kind, 5);
        await takeOutOfService(f.store, staffCtx(), f.i["Dock pool"], { reason: "Dock repair" });
        expect(await refusedFor(bookAs(f, "Ada", "Dock pool", at(1, 9), at(1, 10)))).toEqual(["out_of_service"]);
      });

      it("treats a pool of one place as the single item it is: the old overlap rule and message", async () => {
        const f = await poolClub(kind, 1);
        expect(placesOf((await f.store.read()).items.find((i) => i.name === "Dock pool")!)).toBe(1);
        await bookAs(f, "Ada", "Dock pool", at(1, 9), at(1, 10));
        expect(await refusalMessages(bookAs(f, "Ben", "Dock pool", at(1, 9, 30), at(1, 10, 30)))).toEqual(["Dock pool is already booked from 9:00 to 10:00 am."]);
      });
    });

    describe("a class holds the whole room", () => {
      it("keeps members from booking any place of a pool while a class runs, and keeps a class off a pool someone has a place in", async () => {
        const f = await poolClub(kind, 4);
        await addPool(f, "Weight room", "gym-space", 4);
        const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 3, defaultMinutes: 60, roomItemId: f.i["Weight room"] });
        const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(1, 9) });
        expect(await refusalMessages(bookAs(f, "Ada", "Weight room", at(1, 9, 30), at(1, 10)))).toEqual(["Weight room is being used for Yoga from 9:00 to 10:00 am."]);
        // A member with a place for 11 o'clock blocks a class at that time, naming who.
        await bookAs(f, "Ben", "Weight room", at(1, 11), at(1, 12));
        await expect(scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(1, 11) })).rejects.toThrow(/Weight room/);
        await cancelSession(f.store, staffCtx(), session.id, { reason: "Instructor is ill" });
        expect(await refusedFor(bookAs(f, "Cy", "Weight room", at(1, 9, 30), at(1, 10)))).toEqual([]);
      });
    });

    describe("what members and staff see", () => {
      it("shows how many places are left in each slot, yours as yours, and a full slot as booked", async () => {
        const f = await poolClub(kind, 2);
        const [a, b] = await addMembers(f, 2);
        await bookAs(f, a, "Dock pool", at(1, 9), at(1, 10));
        await bookAs(f, b, "Dock pool", at(1, 9, 30), at(1, 10, 30));
        const state = await f.store.read();
        const view = (viewer: Parameters<typeof dayView>[2]["viewer"]) => dayView(state, f.book, { day: dayOfAt(1), now: NOW, viewer }).items.find((i) => i.item.name === "Dock pool")!;
        const slot = (v: ReturnType<typeof view>, hh: number, mm = 0) => v.slots.find((s) => s.startsAt === at(1, hh, mm).toISOString())!;
        const asA = view({ kind: "member", memberId: a });
        expect(asA.places).toBe(2);
        expect(slot(asA, 8, 30)).toMatchObject({ state: "free", placesLeft: 2, holders: [], bookedBy: null });
        expect(slot(asA, 9)).toMatchObject({ state: "yours", placesLeft: 1, bookingId: expect.any(String) });
        expect(slot(asA, 9, 30)).toMatchObject({ state: "yours", placesLeft: 0 });
        expect(slot(asA, 10)).toMatchObject({ state: "free", placesLeft: 1, bookingId: null });
        expect(slot(asA, 11)).toMatchObject({ state: "free", placesLeft: 2 });
        // A third member sees the stretch where both places are taken as booked, and never a name.
        const asC = view({ kind: "member", memberId: f.m.Cy });
        expect(slot(asC, 9, 30)).toMatchObject({ state: "booked", placesLeft: 0, holders: [], bookedBy: null, bookingId: null });
        expect(slot(asC, 9)).toMatchObject({ state: "free", placesLeft: 1 });
      });

      it("shows staff who holds the places, and a class as holding the whole pool", async () => {
        const f = await poolClub(kind, 3);
        const [a, b] = await addMembers(f, 2);
        await bookAs(f, a, "Dock pool", at(1, 9), at(1, 10));
        await bookAs(f, b, "Dock pool", at(1, 9), at(1, 10));
        await addPool(f, "Weight room", "gym-space", 3);
        const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 3, defaultMinutes: 60, roomItemId: f.i["Weight room"] });
        await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(1, 11) });
        const state = await f.store.read();
        const staffView = dayView(state, f.book, { day: dayOfAt(1), now: NOW, viewer: { kind: "staff" } });
        const dock = staffView.items.find((i) => i.item.name === "Dock pool")!;
        const nine = dock.slots.find((s) => s.startsAt === at(1, 9).toISOString())!;
        expect(nine.holders.sort()).toEqual(["Extra0 Member", "Extra1 Member"]);
        expect(nine.placesLeft).toBe(1);
        const gym = staffView.items.find((i) => i.item.name === "Weight room")!;
        const eleven = gym.slots.find((s) => s.startsAt === at(1, 11).toISOString())!;
        expect(eleven).toMatchObject({ state: "class", heldFor: "Yoga", placesLeft: 0 });
      });

      it("gives a boat a single place and no count", async () => {
        const f = await poolClub(kind, 3);
        const state = await f.store.read();
        const heron = dayView(state, f.book, { day: dayOfAt(1), now: NOW, viewer: { kind: "staff" } }).items.find((i) => i.item.name === "Heron")!;
        expect(heron.places).toBe(1);
        expect(heron.slots.every((s) => s.placesLeft === null)).toBe(true);
      });

      it("says in the rules that a pool is shared, counted and one place at a time", async () => {
        const f = await poolClub(kind, 8);
        const state = await f.store.read();
        const words = describeRules(state, f.book, state.items.find((i) => i.name === "Dock pool")!).lines;
        expect(words[0]).toBe("Dock pool has 8 places, shared by everyone. You book a time and the club counts how many places are left; you are not given a place number. You can hold one place at a time.");
        await addPool(f, "Dock pair", "dock-space", 2);
        const two = (await f.store.read()).items.find((i) => i.name === "Dock pair")!;
        expect(describeRules(await f.store.read(), f.book, two).lines[0]).toContain("Dock pair has 2 places, shared by everyone.");
        const boat = describeRules(state, f.book, state.items.find((i) => i.name === "Heron")!).lines;
        expect(boat.join(" ")).not.toContain("places, shared");
      });
    });

    describe("the pool is kept exactly as it was made", () => {
      it("reads back its places, and a boat reads back with none", async () => {
        const f = await poolClub(kind, 12);
        const items = (await f.store.read()).items;
        expect(items.find((i) => i.name === "Dock pool")!.places).toBe(12);
        expect(items.find((i) => i.name === "Heron")!.places).toBeUndefined();
        expect(placesOf(items.find((i) => i.name === "Dock pool")!)).toBe(12);
        expect(placesOf(items.find((i) => i.name === "Heron")!)).toBe(1);
      });
    });

    describe("many people at once", () => {
      it("twenty members grab a pool of three at the same moment: exactly three get a place and the rest are told it is full", async () => {
        const f = await poolClub(kind, 3);
        const people = await addMembers(f, 20);
        const outcomes = await Promise.allSettled(people.map((id) => bookAs(f, id, "Dock pool", at(1, 9), at(1, 10))));
        expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(3);
        const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
        expect(lost).toHaveLength(17);
        for (const l of lost) expect((l.reason as BookingRefused).reasons.map((r) => r.code)).toEqual(["slot_taken"]);
        expect(await held(f, "Dock pool")).toHaveLength(3);
      }, 30_000);

      it("books, cancels and rebooks a pool many times over and the count stays right", async () => {
        const f = await poolClub(kind, 2);
        const [a, b, c] = await addMembers(f, 3);
        for (let round = 0; round < 6; round++) {
          const x = await bookAs(f, a, "Dock pool", at(1, 9), at(1, 10));
          const y = await bookAs(f, b, "Dock pool", at(1, 9), at(1, 10));
          expect(await refusedFor(bookAs(f, c, "Dock pool", at(1, 9), at(1, 10)))).toEqual(["slot_taken"]);
          await cancelBooking(f.store, f.book, memberCtx(a, "A"), x.booking.id);
          await cancelBooking(f.store, f.book, memberCtx(b, "B"), y.booking.id);
        }
        expect(await held(f, "Dock pool")).toHaveLength(0);
        expect((await f.store.read()).bookings).toHaveLength(12);
      }, 30_000);
    });
  });
}

/** The most places taken at any one moment between `start` and `end`. */
const busiest = (state: Parameters<typeof occupancy>[0], itemId: string, start: number, end: number) => Math.max(0, ...occupancy(state, itemId, start, end).map((x) => x.count));

describe("the count itself", () => {
  const stateWith = (spans: [number, number][]) => ({
    bookings: spans.map(([s, e], i) => ({ id: `b${i}`, itemId: "pool", status: "upcoming", startsAt: new Date(s * 3600000).toISOString(), endsAt: new Date(e * 3600000).toISOString() })),
  }) as unknown as Parameters<typeof occupancy>[0];
  const H = 3600000;

  it("counts places stretch by stretch, with bookings that touch never counted together", () => {
    const state = stateWith([[9, 10], [10, 11], [9, 11]]);
    expect(occupancy(state, "pool", 9 * H, 11 * H)).toEqual([
      { from: 9 * H, to: 10 * H, count: 2 },
      { from: 10 * H, to: 11 * H, count: 2 },
    ]);
    expect(busiest(state, "pool", 9 * H, 11 * H)).toBe(2);
  });

  it("finds the first full stretch and where it ends, joining stretches that follow each other and stopping at the first gap", () => {
    const state = stateWith([[9, 10], [9, 10], [10, 11], [10, 11], [12, 13], [12, 13]]);
    expect(firstFullStretch(state, "pool", 8 * H, 14 * H, 2)).toEqual({ from: 9 * H, to: 11 * H });
    expect(firstFullStretch(state, "pool", 11 * H, 12 * H, 2)).toBeNull();
    expect(firstFullStretch(state, "pool", 11 * H, 14 * H, 2)).toEqual({ from: 12 * H, to: 13 * H });
    expect(firstFullStretch(state, "pool", 9 * H, 10 * H, 3)).toBeNull();
  });

  it("counts a booking that is over or marked no-show for the time it covered, and not one that was cancelled", () => {
    const state = stateWith([[9, 10], [9, 10], [9, 10], [9, 10]]);
    const statuses = ["upcoming", "completed", "no_show", "late_cancelled"];
    state.bookings.forEach((b, i) => ((b as { status: string }).status = statuses[i]));
    expect(busiest(state, "pool", 9 * H, 10 * H)).toBe(3);
  });

  it("ignores other items and bookings that are cancelled, and counts a moment inside a booking only for bookings that cover it", () => {
    const state = stateWith([[9, 10]]);
    (state.bookings[0] as { status: string }).status = "cancelled";
    expect(busiest(state, "pool", 8 * H, 11 * H)).toBe(0);
    (state.bookings[0] as { status: string }).status = "upcoming";
    expect(busiest(state, "other", 8 * H, 11 * H)).toBe(0);
    // A booking that ends exactly as the question starts, or starts exactly as it ends, is outside it.
    expect(busiest(state, "pool", 10 * H, 11 * H)).toBe(0);
    expect(busiest(state, "pool", 8 * H, 9 * H)).toBe(0);
  });
});

/** The Pacific day, as YYYY-MM-DD, that is `n` days after the fixture's today. */
function dayOfAt(n: number): string {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
