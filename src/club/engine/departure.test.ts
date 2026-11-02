import { describe, expect, it } from "vitest";
import { CLASS_RULES } from "../settings/class-rules";
import { EVENT_RULES } from "../settings/event-rules";
import type { ClubState } from "../types";
import { cancelBooking } from "./bookings";
import { createClass, scheduleSessions, signUp } from "./classes";
import { departurePreview } from "./departure";
import { createEvent, rsvp } from "./events";
import { endHousehold, removeMember } from "./households";
import { clubLedger } from "./ledger";
import { NOW, STORE_KINDS, at, bookAs, fixtureFor, memberCtx, staffCtx, type Fixture } from "./testkit";

/**
 * Before staff end a membership or remove an adult, they read what it will cancel. These tests hold the preview to the
 * real thing: whatever the preview names is exactly what the real step then cancels, on both stores.
 */

/** A busy club: bookings (future, under way, past, crewed), class chairs and waiting places, event spots and a waitlist place. */
async function busy(kind: (typeof STORE_KINDS)[number]) {
  const f = await fixtureFor(kind)();
  await f.store.transaction(async (s, newId) => {
    const id = newId();
    s.items.push({ id, name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
    f.i["Boathouse gym"] = id;
  });
  const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 1, defaultMinutes: 60, roomItemId: f.i["Boathouse gym"] });
  const [tomorrow, past] = [
    (await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(1, 9) }))[0],
    (await scheduleSessions(f.store, f.book, staffCtx(at(-5, 12)), { classId: yoga.id, startsAt: at(-2, 9) }))[0],
  ];
  const join = (who: string, sessionId: string, now: Date = NOW) => signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m[who], who, now), { sessionId, memberId: f.m[who] });
  await join("Ada", tomorrow.id); // a chair
  await join("Dee", tomorrow.id); // Dee is waiting: not a Quill
  await join("Ben", tomorrow.id); // Ben waits behind Dee
  await join("Ada", past.id, at(-3, 9));
  const dinner = await createEvent(f.store, staffCtx(), { title: "Dinner", startsAt: at(3, 18), endsAt: at(3, 21), capacity: 2 });
  const festival = await createEvent(f.store, staffCtx(), { title: "Regatta", startsAt: at(5, 10), endsAt: at(5, 14) });
  const go = (who: string, eventId: string, guests = 0) => rsvp(f.store, EVENT_RULES, memberCtx(f.m[who], who), { eventId, memberId: f.m[who], guests });
  await go("Ada", dinner.id, 1);
  await go("Dee", dinner.id); // Ada's party fills both spots, so Dee waits
  await go("Ben", dinner.id); // and Ben waits behind Dee
  await go("Cy", festival.id);
  const b1 = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
  const b2 = await bookAs(f, "Cy", "Otter", at(2, 7), at(2, 8));
  const crewed = await bookAs(f, "Eli", "Loon", at(3, 7), at(3, 8), ["Ben"]);
  const reeds = await bookAs(f, "Dee", "Otter", at(1, 7), at(1, 8));
  const underWay = await bookAs(f, "Ben", "Kingfisher", at(0, 12), at(0, 14), [], undefined, at(0, 9));
  const pastOuting = await bookAs(f, "Ben", "Skimmer", at(-2, 7), at(-2, 8), [], undefined, at(-3, 12));
  const cancelled = await bookAs(f, "Ada", "Pelican", at(4, 7), at(4, 8));
  await cancelBooking(f.store, f.book, memberCtx(f.m.Ada), cancelled.booking.id);
  return { f, ids: { b1: b1.booking.id, b2: b2.booking.id, crewed: crewed.booking.id, reeds: reeds.booking.id, underWay: underWay.booking.id, pastOuting: pastOuting.booking.id, cancelled: cancelled.booking.id } };
}

const flip = (before: ClubState, after: ClubState, key: "signups" | "rsvps") => {
  const was = new Map(before[key].map((x) => [x.id, x.status]));
  return after[key].filter((x) => was.get(x.id) !== x.status && x.status === "cancelled").map((x) => x.id).sort();
};

describe.each(STORE_KINDS)("what leaving cancels, on the %s store", (kind) => {
  it("names exactly what ending a household then cancels", async () => {
    const { f, ids } = await busy(kind);
    const before = await f.store.read();
    const quill = [f.m.Ada, f.m.Ben, f.m.Cy];
    const preview = departurePreview(before, quill, NOW);
    const result = await endHousehold(f.store, clubLedger, staffCtx(), f.h.Quill);
    const after = await f.store.read();

    expect(preview.bookings.map((l) => l.id).sort()).toEqual([...result.cancelledBookings].sort());
    expect(preview.bookings.map((l) => l.id).sort()).toEqual([ids.b1, ids.b2].sort());
    expect(preview.signUps.map((l) => l.id).sort()).toEqual(flip(before, after, "signups"));
    expect(preview.rsvps.map((l) => l.id).sort()).toEqual(flip(before, after, "rsvps"));
    // Ben leaves Eli's double: the seat goes, the booking stays.
    expect(preview.crewSeats).toHaveLength(1);
    expect(after.bookings.find((b) => b.id === ids.crewed)).toMatchObject({ status: "upcoming", crew: [] });
    // Under way, past, cancelled and other households' bookings are not in the preview and were not touched.
    for (const untouched of [ids.underWay, ids.pastOuting, ids.cancelled, ids.reeds]) expect(preview.bookings.map((l) => l.id)).not.toContain(untouched);
    expect(after.bookings.find((b) => b.id === ids.underWay)!.status).toBe("upcoming");
    expect(preview.total).toBe(preview.bookings.length + preview.crewSeats.length + preview.signUps.length + preview.rsvps.length);
  });

  it("names exactly what removing one adult then cancels", async () => {
    const { f, ids } = await busy(kind);
    const before = await f.store.read();
    const preview = departurePreview(before, [f.m.Ben], NOW);
    await removeMember(f.store, clubLedger, staffCtx(), f.m.Ben);
    const after = await f.store.read();
    expect(preview.bookings).toEqual([]); // Ben's only future booking is a crew seat
    expect(preview.crewSeats.map((l) => l.id)).toEqual([`${ids.crewed}:${f.m.Ben}`]);
    expect(preview.signUps.map((l) => l.id).sort()).toEqual(flip(before, after, "signups"));
    expect(preview.rsvps.map((l) => l.id).sort()).toEqual(flip(before, after, "rsvps"));
    expect(preview.signUps).toHaveLength(1);
    expect(preview.signUps[0]).toMatchObject({ what: "Yoga", who: "Ben Quill", detail: "on the waiting list" });
    expect(preview.rsvps[0]).toMatchObject({ what: "Dinner", who: "Ben Quill", detail: "on the waitlist, party of 1" });
  });

  it("words each line so staff can read it", async () => {
    const { f } = await busy(kind);
    const preview = departurePreview(await f.store.read(), [f.m.Ada], NOW);
    expect(preview.bookings[0]).toMatchObject({ what: "Heron", who: "Ada Quill", when: "Thursday, Oct 29, 7:00 to 8:00 am", detail: "" });
    expect(preview.signUps[0]).toMatchObject({ what: "Yoga", when: "Thursday, Oct 29, 9:00 to 10:00 am", detail: "has a place" });
    expect(preview.rsvps[0]).toMatchObject({ what: "Dinner", detail: "going, party of 2" });
  });

  it("lists lines in time order and leaves out a waitlist place whose hour has run out", async () => {
    const { f } = await busy(kind);
    // Ben's waitlist place for the dinner is given a hold that ended an hour ago.
    await f.store.transaction(async (s) => {
      const line = s.rsvps.find((r) => r.memberId === f.m.Ben && r.status === "waitlisted")!;
      line.holdUntil = new Date(NOW.getTime() - 3600000).toISOString();
    });
    const preview = departurePreview(await f.store.read(), [f.m.Ben], NOW);
    expect(preview.rsvps).toEqual([]);
    const all = departurePreview(await f.store.read(), [f.m.Ada, f.m.Ben, f.m.Cy], NOW);
    expect(all.bookings.map((l) => l.startsAt)).toEqual([...all.bookings.map((l) => l.startsAt)].sort());
  });

  it("lists bookings in time order even when they were made in another order", async () => {
    const f = await fixtureFor(kind)();
    await bookAs(f, "Ada", "Heron", at(3, 7), at(3, 8));
    await bookAs(f, "Ada", "Osprey", at(1, 7), at(1, 8));
    const preview = departurePreview(await f.store.read(), [f.m.Ada], NOW);
    expect(preview.bookings.map((l) => l.what)).toEqual(["Osprey", "Heron"]);
  });

  it("is empty for someone with nothing coming up", async () => {
    const f: Fixture = await fixtureFor(kind)();
    expect(departurePreview(await f.store.read(), [f.m.Dee], NOW)).toEqual({ bookings: [], crewSeats: [], signUps: [], rsvps: [], total: 0 });
  });
});
