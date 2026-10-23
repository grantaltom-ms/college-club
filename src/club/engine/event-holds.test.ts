import { describe, expect, it } from "vitest";
import { EVENT_RULES } from "../settings/event-rules";
import type { ClubState, EventRules } from "../types";
import { HOLD_RAN_OUT, cancelEvent, cancelRsvp, changeGuests, checkRsvp, createEvent, eventView, holdEndsAt, promoteWaitlist, renewHold, rsvp, updateEvent } from "./events";
import { NOW, STORE_KINDS, at, fixtureFor, memberCtx, staffCtx, type Fixture } from "./testkit";

/**
 * A place on an event's waiting list is held for one hour from the last time the member pressed a button on it, then it is
 * removed. These tests use the real rule (60 minutes) unless they say otherwise. "Dinner" is Sat Oct 31 at 6 pm; the clock
 * starts at Wed Oct 28, 1 pm.
 */
const HOUR = 3600000;
const after = (minutes: number) => new Date(NOW.getTime() + minutes * 60000);
const rules = (change: Partial<EventRules["defaults"]> = {}): EventRules => ({ placeholder: true, defaults: { ...EVENT_RULES.defaults, waitlistHoldMinutes: 60, ...change } });
const idOf = (f: Fixture, who: string) => f.m[who] ?? who;

const mkEvent = (f: Fixture, capacity: number | null = 1) => createEvent(f.store, staffCtx(), { title: "Dinner", startsAt: at(3, 18), endsAt: at(3, 21), capacity });
const go = (f: Fixture, who: string, eventId: string, guests = 0, now: Date = NOW, r: EventRules = rules()) => rsvp(f.store, r, memberCtx(idOf(f, who), who, now), { eventId, memberId: idOf(f, who), guests });
const leave = (f: Fixture, who: string, id: string, now: Date = NOW, r: EventRules = rules()) => cancelRsvp(f.store, r, memberCtx(idOf(f, who), who, now), id);
const keep = (f: Fixture, who: string, id: string, now: Date = NOW, r: EventRules = rules()) => renewHold(f.store, r, memberCtx(idOf(f, who), who, now), id);
const party = (f: Fixture, who: string, id: string, guests: number, now: Date = NOW, r: EventRules = rules()) => changeGuests(f.store, r, memberCtx(idOf(f, who), who, now), id, guests);
const lines = async (f: Fixture, who: string, eventId: string) => (await f.store.read()).rsvps.filter((r) => r.eventId === eventId && r.memberId === idOf(f, who));
const viewAt = (state: ClubState, event: ClubState["events"][number], who: string, f: Fixture, now: Date) => eventView(state, event, { kind: "member", memberId: idOf(f, who) }, now);

describe("the hold time", () => {
  it("is one hour from now, or never when the rule says 0", () => {
    expect(holdEndsAt(rules(), NOW)).toBe(after(60).toISOString());
    expect(holdEndsAt(rules({ waitlistHoldMinutes: 90 }), NOW)).toBe(after(90).toISOString());
    expect(holdEndsAt(rules({ waitlistHoldMinutes: 0 }), NOW)).toBeNull();
  });
});

describe.each(STORE_KINDS)("the one-hour hold on the waiting list, on the %s store", (kind) => {
  const fixture = fixtureFor(kind);

  async function fullDinner() {
    const f = await fixture();
    const e = await mkEvent(f, 1);
    const ada = await go(f, "Ada", e.id);
    const ben = await go(f, "Ben", e.id);
    return { f, e, ada, ben };
  }

  it("gives a waiting place a hold of exactly one hour, and places that are going none", async () => {
    const { ada, ben } = await fullDinner();
    expect(ada.rsvp).toMatchObject({ status: "going", holdUntil: null });
    expect(ben.rsvp).toMatchObject({ status: "waitlisted", holdUntil: after(60).toISOString() });
  });

  it("keeps the place for 59 minutes: someone cancelling then still moves it up", async () => {
    const { f, e, ada } = await fullDinner();
    const result = await leave(f, "Ada", ada.rsvp.id, after(59));
    expect(result.promoted.map((p) => p.memberId)).toEqual([f.m.Ben]);
    expect(result.promoted[0]).toMatchObject({ status: "going", holdUntil: null });
    expect((await lines(f, "Ben", e.id))[0].status).toBe("going");
  });

  it("removes the place at exactly one hour: it is not moved up, and the screens already ignore it", async () => {
    const { f, e, ada } = await fullDinner();
    const state = await f.store.read();
    expect(viewAt(state, e, "Ben", f, after(59))).toMatchObject({ waiting: 1, yours: { status: "waitlisted", holdUntil: after(60).toISOString() } });
    expect(viewAt(state, e, "Ben", f, after(60))).toMatchObject({ waiting: 0, yours: null });
    // Before anything is saved the record still says waiting; the next change tidies it.
    expect((await lines(f, "Ben", e.id))[0].status).toBe("waitlisted");

    const result = await leave(f, "Ada", ada.rsvp.id, after(60));
    expect(result.promoted).toEqual([]);
    const ben = (await lines(f, "Ben", e.id))[0];
    expect(ben).toMatchObject({ status: "cancelled", holdUntil: null, cancelReason: HOLD_RAN_OUT, cancelledBy: { kind: "system", label: "Waiting-list hold ran out" } });
  });

  it("does not count a removed place against the waiting list's length, so someone else can join it", async () => {
    const f = await fixture();
    const e = await mkEvent(f, 1);
    await go(f, "Ada", e.id);
    await go(f, "Ben", e.id, 0, NOW, rules({ waitlistMax: 1 }));
    // The list is full for an hour; after that Ben's place is gone and Cy takes the one spot on it.
    await expect(go(f, "Cy", e.id, 0, after(30), rules({ waitlistMax: 1 }))).rejects.toThrow("its waitlist is full too (1 party)");
    const cy = await go(f, "Cy", e.id, 0, after(61), rules({ waitlistMax: 1 }));
    expect(cy).toMatchObject({ outcome: "waitlisted", place: 1 });
  });

  it("sends someone whose place ran out to the end of the line when they join again", async () => {
    const f = await fixture();
    const e = await mkEvent(f, 1);
    await go(f, "Ada", e.id);
    await go(f, "Ben", e.id);
    await go(f, "Cy", e.id, 0, after(30)); // Cy keeps pressing buttons; Ben does not
    await keep(f, "Cy", (await lines(f, "Cy", e.id))[0].id, after(80));
    const again = await go(f, "Ben", e.id, 0, after(90));
    expect(again).toMatchObject({ outcome: "waitlisted", place: 2 });
    expect((await lines(f, "Ben", e.id)).map((r) => r.status)).toEqual(["cancelled", "waitlisted"]);
    expect((await lines(f, "Cy", e.id))[0].status).toBe("waitlisted");
  });

  it("holds the place for another hour each time the member presses Keep my place", async () => {
    const { f, e, ada, ben } = await fullDinner();
    const kept = await keep(f, "Ben", ben.rsvp.id, after(40));
    expect(kept.holdUntil).toBe(after(100).toISOString());
    // Past the first hour it is still held.
    expect((await leave(f, "Ada", ada.rsvp.id, after(99))).promoted.map((p) => p.memberId)).toEqual([f.m.Ben]);
    expect((await lines(f, "Ben", e.id))[0].status).toBe("going");
  });

  it("removes a kept place at the new end, not the old one", async () => {
    const { f, e, ada, ben } = await fullDinner();
    await keep(f, "Ben", ben.rsvp.id, after(40));
    expect((await leave(f, "Ada", ada.rsvp.id, after(100))).promoted).toEqual([]);
    expect((await lines(f, "Ben", e.id))[0].cancelReason).toBe(HOLD_RAN_OUT);
  });

  it("holds the place again when the party is changed, and moves it up if the new party fits", async () => {
    const f = await fixture();
    const e = await mkEvent(f, 3);
    await go(f, "Dee", e.id);
    await go(f, "Ada", e.id); // 2 of 3
    const ben = await go(f, "Ben", e.id, 2); // 3 people, 1 spot: waits
    expect(ben.outcome).toBe("waitlisted");

    // Two people still do not fit; the hold starts over from this button press.
    const two = await party(f, "Ben", ben.rsvp.id, 1, after(20));
    expect(two.rsvp).toMatchObject({ status: "waitlisted", guests: 1, holdUntil: after(80).toISOString() });
    expect(two.promoted).toEqual([]);
    // One person fits the one spot: moved up at once, and the hold is gone.
    const one = await party(f, "Ben", ben.rsvp.id, 0, after(30));
    expect(one.rsvp).toMatchObject({ status: "going", guests: 0, holdUntil: null });
    expect(one.promoted.map((p) => p.memberId)).toEqual([f.m.Ben]);
  });

  it("says plainly when a place has already run out, instead of acting on it", async () => {
    const { f, ada, ben } = await fullDinner();
    await expect(keep(f, "Ben", ben.rsvp.id, after(61))).rejects.toThrow(HOLD_RAN_OUT);
    await expect(party(f, "Ben", ben.rsvp.id, 1, after(62))).rejects.toThrow(HOLD_RAN_OUT);
    await expect(leave(f, "Ben", ben.rsvp.id, after(63))).rejects.toThrow(HOLD_RAN_OUT);
    // Someone with places has nothing to keep; nobody keeps someone else's place.
    await expect(keep(f, "Ada", ada.rsvp.id)).rejects.toThrow("You already have spots, so there is nothing to keep.");
    await expect(keep(f, "Cy", ben.rsvp.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses to keep a place once the event has started", async () => {
    const f = await fixture();
    const e = await mkEvent(f, 1);
    const forever = rules({ waitlistHoldMinutes: 0 });
    await go(f, "Ada", e.id, 0, NOW, forever);
    const ben = await go(f, "Ben", e.id, 0, NOW, forever);
    await expect(keep(f, "Ben", ben.rsvp.id, at(3, 18, 5), forever)).rejects.toThrow("That event has already started, so this can no longer be changed here. Ask club staff.");
  });

  it("never counts a removed place as a late cancellation, and never lists it when the event is cancelled", async () => {
    const { f, e } = await fullDinner();
    const { affected } = await cancelEvent(f.store, staffCtx(after(61)), e.id, { reason: "Storm" });
    expect(affected.map((a) => a.name)).toEqual(["Ada Quill"]);
    const ben = (await lines(f, "Ben", e.id))[0];
    expect(ben.status).toBe("cancelled");
    expect(ben.cancelReason).toBe(HOLD_RAN_OUT);
  });

  it("does not move a removed place up when the limit is raised", async () => {
    const { f, e } = await fullDinner();
    const { promoted } = await updateEvent(f.store, rules(), staffCtx(after(61)), e.id, { capacity: 3 });
    expect(promoted).toEqual([]);
    expect((await lines(f, "Ben", e.id))[0].status).toBe("cancelled");
    // Someone still held is moved up.
    const g = await fixture();
    const e2 = await mkEvent(g, 1);
    await go(g, "Ada", e2.id);
    await go(g, "Ben", e2.id);
    const raised = await updateEvent(g.store, rules(), staffCtx(after(59)), e2.id, { capacity: 3 });
    expect(raised.promoted.map((p) => p.memberId)).toEqual([g.m.Ben]);
  });

  it("is respected by the move-up itself, even when called on records nobody has tidied yet", async () => {
    const { f, e } = await fullDinner();
    const draft = structuredClone(await f.store.read());
    draft.rsvps.find((r) => r.memberId === f.m.Ada)!.status = "cancelled"; // Ada's places are free; Ben's hold ran out meanwhile
    expect(promoteWaitlist(draft, rules(), e.id, after(61))).toEqual([]);
    expect(draft.rsvps.find((r) => r.memberId === f.m.Ben)).toMatchObject({ status: "cancelled", cancelReason: HOLD_RAN_OUT });
    const fresh = structuredClone(await f.store.read());
    fresh.rsvps.find((r) => r.memberId === f.m.Ada)!.status = "cancelled";
    expect(promoteWaitlist(fresh, rules(), e.id, after(59)).map((r) => r.memberId)).toEqual([f.m.Ben]);
  });

  it("is ignored by the page's own check too: a removed place does not make the waiting list look full", async () => {
    const f = await fixture();
    const e = await mkEvent(f, 1);
    await go(f, "Ada", e.id);
    await go(f, "Ben", e.id, 0, NOW, rules({ waitlistMax: 1 }));
    const state = await f.store.read(); // nothing has tidied Ben's place yet
    const reasonsAt = (minutes: number) => checkRsvp(state, rules({ waitlistMax: 1 }), memberCtx(f.m.Cy, "Cy", after(minutes)), { eventId: e.id, memberId: f.m.Cy }).map((r) => r.code);
    expect(reasonsAt(30)).toEqual(["waitlist_full"]);
    expect(reasonsAt(61)).toEqual([]);
  });

  it("never runs out when the rule is 0", async () => {
    const f = await fixture();
    const e = await mkEvent(f, 1);
    const forever = rules({ waitlistHoldMinutes: 0 });
    const ada = await go(f, "Ada", e.id, 0, NOW, forever);
    const ben = await go(f, "Ben", e.id, 0, NOW, forever);
    expect(ben.rsvp.holdUntil).toBeNull();
    const twoDays = new Date(NOW.getTime() + 47 * HOUR);
    expect((await leave(f, "Ada", ada.rsvp.id, twoDays, forever)).promoted.map((p) => p.memberId)).toEqual([f.m.Ben]);
  });

  it("shows staff how long each waiting place has left, and members only their own", async () => {
    const { f, e } = await fullDinner();
    const state = await f.store.read();
    const staff = eventView(state, e, { kind: "staff" }, after(10));
    expect(staff.sheet.filter((l) => l.status === "waitlisted").map((l) => l.holdUntil)).toEqual([after(60).toISOString()]);
    const cy = viewAt(state, e, "Cy", f, after(10));
    expect(cy.sheet).toEqual([]);
    expect(cy.yours).toBeNull();
  });
});
