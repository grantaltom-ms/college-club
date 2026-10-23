import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { EVENT_RULES } from "../settings/event-rules";
import type { EventRules } from "../types";
import {
  LimitTooLow,
  RsvpRefused,
  cancelEvent,
  cancelRsvp,
  changeGuests,
  checkRsvp,
  createEvent,
  eventView,
  markRsvpAttendance,
  rsvp,
  updateEvent,
  type NewEvent,
} from "./events";
import { placesText, yoursEventText } from "./event-words";
import { endHousehold, removeMember } from "./households";
import { clubLedger } from "./ledger";
import { historyOf } from "./queries";
import { NOW, STORE_KINDS, addMembers, at, bookAs, fixtureFor, memberCtx, refusedFor, staffCtx, type Fixture } from "./testkit";

/**
 * Today is Wed Oct 28, 1 pm. The usual event is "Dinner", Sat Oct 31, 6 to 9 pm. With the placeholder rules:
 * RSVP closes an hour before (Sat 5 pm), cancelling is late inside 48 hours (after Thu 6 pm), and the waiting list moves
 * up by itself until two hours before (Sat 4 pm).
 */
const rulesWith = (change: Partial<EventRules["defaults"]>): EventRules => ({ placeholder: true, defaults: { ...EVENT_RULES.defaults, ...change } });
const idOf = (f: Fixture, who: string) => f.m[who] ?? who;

const mkEvent = (f: Fixture, over: Partial<NewEvent> = {}, now: Date = NOW) => createEvent(f.store, staffCtx(now), { title: "Dinner", startsAt: at(3, 18), endsAt: at(3, 21), ...over });
const go = (f: Fixture, who: string, eventId: string, guests = 0, now: Date = NOW, rules: EventRules = EVENT_RULES) =>
  rsvp(f.store, rules, memberCtx(idOf(f, who), who, now), { eventId, memberId: idOf(f, who), guests });
const leave = (f: Fixture, who: string, rsvpId: string, now: Date = NOW, rules: EventRules = EVENT_RULES) => cancelRsvp(f.store, rules, memberCtx(idOf(f, who), who, now), rsvpId);
const guestsOf = (f: Fixture, who: string, rsvpId: string, guests: number, now: Date = NOW, rules: EventRules = EVENT_RULES) => changeGuests(f.store, rules, memberCtx(idOf(f, who), who, now), rsvpId, guests);

const refusedCodes = async (attempt: Promise<unknown>) => {
  try {
    await attempt;
    return [];
  } catch (e) {
    if (e instanceof RsvpRefused) return e.reasons.map((r) => r.code);
    throw e;
  }
};
const refusedWords = async (attempt: Promise<unknown>) => {
  try {
    await attempt;
    return [];
  } catch (e) {
    if (e instanceof RsvpRefused) return e.reasons.map((r) => r.message);
    throw e;
  }
};
const linesOf = async (f: Fixture, who: string, eventId: string) => (await f.store.read()).rsvps.filter((r) => r.eventId === eventId && r.memberId === idOf(f, who));
const statuses = async (f: Fixture, eventId: string) => Object.fromEntries((await f.store.read()).rsvps.filter((r) => r.eventId === eventId).map((r) => [r.memberId, r.status]));
const eventOf = async (f: Fixture, eventId: string) => (await f.store.read()).events.find((e) => e.id === eventId)!;

describe.each(STORE_KINDS)("events on the %s store", (kind) => {
  const fixture = fixtureFor(kind);

  describe("staff set up events", () => {
    it("lets staff add an event, tidied up, and nobody else", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { title: "  Fall Regatta Social ", capacity: 40, priceCents: 2500, location: "The boathouse" });
      expect(e).toMatchObject({ title: "Fall Regatta Social", capacity: 40, priceCents: 2500, location: "The boathouse", status: "scheduled", replyBy: null, startsAt: at(3, 18).toISOString(), endsAt: at(3, 21).toISOString() });
      expect((await f.store.read()).events).toHaveLength(1);
      await expect(createEvent(f.store, memberCtx(f.m.Ada, "Ada"), { title: "Mine", startsAt: at(3, 18), endsAt: at(3, 21) })).rejects.toMatchObject({ code: "forbidden" });
    });

    it("refuses nonsense in plain words", async () => {
      const f = await fixture();
      await expect(mkEvent(f, { title: "  " })).rejects.toThrow("Give the event a title.");
      await expect(mkEvent(f, { endsAt: at(3, 17) })).rejects.toThrow("The event must end after it starts.");
      await expect(mkEvent(f, { startsAt: at(0, 12), endsAt: at(0, 14) })).rejects.toThrow("The event must start in the future.");
      await expect(mkEvent(f, { capacity: 0 })).rejects.toThrow("The limit must be a whole number from 1 to 2000, or empty for no limit.");
      await expect(mkEvent(f, { priceCents: -5 })).rejects.toThrow("The price must be between $0 and $10,000.");
      await expect(mkEvent(f, { replyBy: at(3, 19) })).rejects.toThrow("The reply-by time must be before the event starts.");
      expect((await f.store.read()).events).toHaveLength(0);
    });

    it("lets staff change an event; a new price applies only to RSVPs made afterwards", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { priceCents: 2500 });
      const early = await go(f, "Ada", e.id);
      const { event } = await updateEvent(f.store, EVENT_RULES, staffCtx(), e.id, { title: "Harvest Dinner", location: "The clubhouse", priceCents: 3000 });
      expect(event).toMatchObject({ title: "Harvest Dinner", location: "The clubhouse", priceCents: 3000 });
      const late = await go(f, "Ben", e.id);
      expect(early.rsvp.priceCents).toBe(2500);
      expect(late.rsvp.priceCents).toBe(3000);
      expect((await f.store.read()).rsvps.map((r) => r.priceCents)).toEqual([2500, 3000]);
    });

    it("refuses changes by members, to a cancelled event, to one that has started, or to a time already gone", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      await expect(updateEvent(f.store, EVENT_RULES, memberCtx(f.m.Ada, "Ada"), e.id, { title: "Mine" })).rejects.toMatchObject({ code: "forbidden" });
      await expect(updateEvent(f.store, EVENT_RULES, staffCtx(), e.id, { startsAt: at(0, 12) })).rejects.toThrow("The event must start in the future.");
      await expect(updateEvent(f.store, EVENT_RULES, staffCtx(at(3, 18, 1)), e.id, { title: "Late" })).rejects.toThrow("That event has already started, so it cannot be changed.");
      await cancelEvent(f.store, staffCtx(), e.id, { reason: "Storm" });
      await expect(updateEvent(f.store, EVENT_RULES, staffCtx(), e.id, { title: "Back" })).rejects.toThrow("That event was cancelled, so it cannot be changed.");
    });
  });

  describe("RSVPing", () => {
    it("claims places for the member and each guest; members see counts and their own line, staff see names", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 10, priceCents: 2500 });
      const result = await go(f, "Ada", e.id, 2);
      expect(result).toMatchObject({ outcome: "going", place: null, rsvp: { memberId: f.m.Ada, guests: 2, status: "going", priceCents: 2500, via: "page", eventId: e.id } });

      const state = await f.store.read();
      const asDee = eventView(state, e, { kind: "member", memberId: f.m.Dee });
      expect(asDee).toMatchObject({ going: 3, left: 7, waiting: 0, full: false, yours: null, sheet: [] });
      expect(JSON.stringify(asDee)).not.toMatch(/Ada|Quill/);
      expect(placesText(asDee)).toBe("7 places left");
      const asAda = eventView(state, e, { kind: "member", memberId: f.m.Ada });
      expect(asAda.yours).toMatchObject({ status: "going", guests: 2, name: null });
      expect(yoursEventText(asAda.yours)).toBe("You are going, with 2 guests.");
      const asStaff = eventView(state, e, { kind: "staff" });
      expect(asStaff.sheet.map((l) => [l.name, l.guests])).toEqual([["Ada Quill", 2]]);
    });

    it("remembers that an RSVP came from an emailed link", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      const result = await rsvp(f.store, EVENT_RULES, memberCtx(f.m.Ada, "Ada"), { eventId: e.id, memberId: f.m.Ada }, { via: "email_link" });
      expect(result.rsvp.via).toBe("email_link");
      expect((await f.store.read()).rsvps[0].via).toBe("email_link");
    });

    it("lets a member RSVP only for themself, and staff for anyone", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      await expect(rsvp(f.store, EVENT_RULES, memberCtx(f.m.Ada, "Ada"), { eventId: e.id, memberId: f.m.Ben })).rejects.toMatchObject({ code: "forbidden" });
      const byStaff = await rsvp(f.store, EVENT_RULES, staffCtx(), { eventId: e.id, memberId: f.m.Ben });
      expect(byStaff.rsvp.createdBy).toEqual({ kind: "staff", label: "Test staff" });
    });

    it("counts guests toward the limit, and puts the next person on the waiting list in order", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 5 });
      await go(f, "Ada", e.id, 2);
      await go(f, "Dee", e.id, 1);
      const state = await f.store.read();
      expect(eventView(state, e, { kind: "staff" })).toMatchObject({ going: 5, left: 0, full: true });
      const ben = await go(f, "Ben", e.id);
      const cy = await go(f, "Cy", e.id);
      expect([ben.outcome, ben.place, cy.outcome, cy.place]).toEqual(["waitlisted", 1, "waitlisted", 2]);
      expect(placesText(eventView(await f.store.read(), e, { kind: "staff" }))).toBe("Full, 2 waiting");
      expect(yoursEventText(eventView(await f.store.read(), e, { kind: "member", memberId: f.m.Cy }).yours)).toBe("You are on the waiting list, 2nd in line.");
    });

    it("keeps a group together: if all of them do not fit they all wait, and a smaller newcomer who fits goes in", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 4 });
      await go(f, "Ada", e.id); // 1 of 4
      const ben = await go(f, "Ben", e.id, 3); // needs 4, 3 left
      expect(ben).toMatchObject({ outcome: "waitlisted", place: 1, rsvp: { guests: 3 } });
      const dee = await go(f, "Dee", e.id); // needs 1: fits
      expect(dee.outcome).toBe("going");
      expect(await statuses(f, e.id)).toEqual({ [f.m.Ada]: "going", [f.m.Ben]: "waitlisted", [f.m.Dee]: "going" });
    });

    it("moves the first group that fits up when places free, and a bigger group keeps its place in line until it fits", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 4 });
      const ada = await go(f, "Ada", e.id);
      const dee = await go(f, "Dee", e.id);
      const eli = await go(f, "Eli", e.id, 1); // 4 of 4
      await go(f, "Ben", e.id, 3); // waits, first in line, needs 4
      await go(f, "Cy", e.id, 1); // waits, second in line, needs 2

      expect((await leave(f, "Ada", ada.rsvp.id)).promoted).toEqual([]); // 1 free: nobody fits
      const afterDee = await leave(f, "Dee", dee.rsvp.id); // 2 free: Cy fits, Ben does not
      expect(afterDee.promoted.map((p) => p.memberId)).toEqual([f.m.Cy]);
      expect(afterDee.promoted[0]).toMatchObject({ status: "going", promotedAt: NOW.toISOString() });
      expect((await statuses(f, e.id))[f.m.Ben]).toBe("waitlisted");
      expect(eventView(await f.store.read(), e, { kind: "member", memberId: f.m.Ben }).yours).toMatchObject({ place: 1 });

      expect((await leave(f, "Eli", eli.rsvp.id)).promoted).toEqual([]); // 2 free (Cy has 2): Ben still needs 4
      const cyLine = (await linesOf(f, "Cy", e.id))[0];
      expect((await leave(f, "Cy", cyLine.id)).promoted.map((p) => p.memberId)).toEqual([f.m.Ben]); // 4 free
    });

    it("sends someone who cancels and comes back to the end of the line", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 1 });
      await go(f, "Ada", e.id);
      const ben = await go(f, "Ben", e.id);
      await go(f, "Cy", e.id);
      await leave(f, "Ben", ben.rsvp.id);
      const again = await go(f, "Ben", e.id);
      expect(again).toMatchObject({ outcome: "waitlisted", place: 2 });
      expect((await linesOf(f, "Ben", e.id)).map((r) => r.status)).toEqual(["cancelled", "waitlisted"]);
    });

    it("lets an event with no limit take everyone, with no waiting list", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: null });
      const people = await addMembers(f, 20);
      for (const id of people) expect((await go(f, id, e.id, 1)).outcome).toBe("going");
      const view = eventView(await f.store.read(), e, { kind: "staff" });
      expect(view).toMatchObject({ going: 40, left: null, full: false, waiting: 0 });
      expect(placesText(view)).toBe("40 going");
    });

    it("does not mind a boat booking or a class at the same time: you can row and go to dinner on the same night", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      await bookAs(f, "Ada", "Heron", at(3, 18), at(3, 19));
      expect((await go(f, "Ada", e.id)).outcome).toBe("going");
      expect(await refusedFor(bookAs(f, "Dee", "Osprey", at(3, 18), at(3, 19)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ben", "Kingfisher", at(3, 18), at(3, 19)))).toEqual([]);
      await go(f, "Ben", e.id);
      expect((await statuses(f, e.id))[f.m.Ben]).toBe("going");
    });
  });

  describe("what is refused, in words", () => {
    it("refuses too many guests, and anything that is not a whole number", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      expect(await refusedWords(go(f, "Ada", e.id, 5))).toEqual(["You can bring up to 4 guests."]);
      expect(await refusedWords(go(f, "Ada", e.id, 2, NOW, rulesWith({ maxGuests: 1 })))).toEqual(["You can bring up to 1 guest."]);
      expect(await refusedWords(go(f, "Ada", e.id, 1, NOW, rulesWith({ maxGuests: 0 })))).toEqual(["Guests cannot be added to an RSVP for this event."]);
      await expect(go(f, "Ada", e.id, -1)).rejects.toThrow("The number of guests must be a whole number, 0 or more.");
      await expect(go(f, "Ada", e.id, 1.5)).rejects.toThrow(ClubError);
      expect((await go(f, "Ada", e.id, 4)).outcome).toBe("going");
    });

    it("says where someone already stands", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 2 });
      await go(f, "Ada", e.id);
      await go(f, "Dee", e.id, 0);
      await go(f, "Ben", e.id, 1);
      expect(await refusedWords(go(f, "Ada", e.id))).toEqual(["You are already going."]);
      expect(await refusedWords(go(f, "Ben", e.id))).toEqual(["You are already on the waiting list with 1 guest, 1st in line."]);
      expect(await linesOf(f, "Ben", e.id)).toHaveLength(1);
    });

    it("closes an hour before the start: a minute earlier is fine, the exact moment is refused", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      expect(await refusedCodes(go(f, "Ben", e.id, 0, at(3, 16, 59)))).toEqual([]);
      expect(await refusedWords(go(f, "Ada", e.id, 0, at(3, 17)))).toEqual(["RSVPs for Dinner closed 1 hour before it starts."]);
    });

    it("closes at the moment staff set, when they set one", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { replyBy: at(1, 12) });
      expect(await refusedCodes(go(f, "Ben", e.id, 0, at(1, 11, 59)))).toEqual([]);
      expect(await refusedWords(go(f, "Ada", e.id, 0, at(1, 12)))).toEqual(["RSVPs for Dinner closed Thursday, Oct 29 at 12:00 pm."]);
    });

    it("refuses an event that has started or was cancelled", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      const other = await mkEvent(f, { title: "Work party", startsAt: at(4, 9), endsAt: at(4, 12) });
      expect(await refusedWords(go(f, "Ada", e.id, 0, at(3, 18, 5)))).toEqual(["Dinner has already started."]);
      await cancelEvent(f.store, staffCtx(), other.id, { reason: "Storm" });
      expect(await refusedWords(go(f, "Ada", other.id))).toEqual(["Work party on Sunday, Nov 1 was cancelled."]);
    });

    it("refuses a household that has ended", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Reed);
      expect(await refusedWords(go(f, "Dee", e.id))).toEqual(["This household's membership ended on Oct 28, 2026, so RSVPs are closed."]);
    });

    it("says when the waiting list is full too, how many places are left, or that there is no list", async () => {
      const f = await fixture();
      const full = await mkEvent(f, { capacity: 1 });
      await go(f, "Ada", full.id);
      await go(f, "Ben", full.id, 0, NOW, rulesWith({ waitlistMax: 2 }));
      await go(f, "Cy", full.id, 0, NOW, rulesWith({ waitlistMax: 2 }));
      expect(await refusedWords(go(f, "Dee", full.id, 0, NOW, rulesWith({ waitlistMax: 2 })))).toEqual(["Dinner is full, and its waiting list is full too (2 people)."]);

      const partial = await mkEvent(f, { title: "Brunch", startsAt: at(4, 10), endsAt: at(4, 12), capacity: 3 });
      await go(f, "Ada", partial.id);
      await go(f, "Ben", partial.id, 2, NOW, rulesWith({ waitlistMax: 1 })); // needs 3, 2 left: waits
      expect(await refusedWords(go(f, "Cy", partial.id, 2, NOW, rulesWith({ waitlistMax: 1 })))).toEqual(["Brunch has only 2 places left and this RSVP needs 3, and its waiting list is full too (1 person)."]);

      const none = await mkEvent(f, { title: "Lunch", startsAt: at(5, 10), endsAt: at(5, 12), capacity: 1 });
      await go(f, "Ada", none.id);
      expect(await refusedWords(go(f, "Ben", none.id, 0, NOW, rulesWith({ waitlistMax: 0 })))).toEqual(["Lunch is full, and it has no waiting list."]);
    });

    it("checkRsvp lists every reason at once without RSVPing anyone", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      const state = await f.store.read();
      const reasons = checkRsvp(state, EVENT_RULES, memberCtx(f.m.Ada, "Ada", at(3, 17, 30)), { eventId: e.id, memberId: f.m.Ada, guests: 9 });
      expect(reasons.map((r) => r.code)).toEqual(["closed", "too_many_guests"]);
      expect((await f.store.read()).rsvps).toHaveLength(0);
    });
  });

  describe("the waiting list stops moving by itself two hours before", () => {
    it("moves up at 3:59 pm, but at 4:00 pm and after a free place goes to whoever asks first", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 1 });
      const ada = await go(f, "Ada", e.id);
      await go(f, "Ben", e.id);
      expect((await leave(f, "Ada", ada.rsvp.id, at(3, 15, 59))).promoted.map((p) => p.memberId)).toEqual([f.m.Ben]);

      const g = await fixture();
      const e2 = await mkEvent(g, { capacity: 1 });
      const ada2 = await go(g, "Ada", e2.id);
      await go(g, "Ben", e2.id);
      expect((await leave(g, "Ada", ada2.rsvp.id, at(3, 16))).promoted).toEqual([]);
      expect((await statuses(g, e2.id))[g.m.Ben]).toBe("waitlisted");
      // A newcomer takes the free place ahead of Ben.
      expect((await go(g, "Cy", e2.id, 0, at(3, 16, 5))).outcome).toBe("going");
      expect(await refusedWords(go(g, "Ben", e2.id, 0, at(3, 16, 6)))).toEqual(["You are already on the waiting list, 1st in line."]);
    });

    it("lets someone already waiting take free places after that, if their whole group fits", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 1 });
      const ada = await go(f, "Ada", e.id);
      await go(f, "Ben", e.id);
      await leave(f, "Ada", ada.rsvp.id, at(3, 16, 30));
      expect(await refusedCodes(go(f, "Ben", e.id, 0, at(3, 16, 31)))).toEqual([]);
      const lines = await linesOf(f, "Ben", e.id);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ status: "going", promotedAt: at(3, 16, 31).toISOString() });

      const g = await fixture();
      const e2 = await mkEvent(g, { capacity: 3 });
      const a = await go(g, "Ada", e2.id);
      await go(g, "Dee", e2.id);
      await go(g, "Ben", e2.id, 2); // needs 3, 1 left: waits
      await leave(g, "Ada", a.rsvp.id, at(3, 16, 30)); // 2 left: still not enough for 3
      expect(await refusedWords(go(g, "Ben", e2.id, 0, at(3, 16, 31)))).toEqual(["You are already on the waiting list with 2 guests, 1st in line."]);
    });
  });

  describe("changing guests", () => {
    it("lets guests be added while they fit, and says how many more fit when they do not", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 4 });
      const ada = await go(f, "Ada", e.id);
      await go(f, "Dee", e.id, 1); // 3 of 4
      await expect(guestsOf(f, "Ada", ada.rsvp.id, 3)).rejects.toThrow("Only 1 place is left, so you can add up to 1 more guest.");
      expect((await guestsOf(f, "Ada", ada.rsvp.id, 1)).rsvp.guests).toBe(1);
      await expect(guestsOf(f, "Ada", ada.rsvp.id, 2)).rejects.toThrow("Dinner is full, so no more guests can be added.");
      await expect(guestsOf(f, "Ada", ada.rsvp.id, 5)).rejects.toThrow("You can bring up to 4 guests.");
      expect((await linesOf(f, "Ada", e.id))[0].guests).toBe(1);
    });

    it("gives places back to the waiting list at once when guests are removed", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 6 });
      const ada = await go(f, "Ada", e.id, 3); // 4 of 6
      await go(f, "Dee", e.id, 1); // 6 of 6
      await go(f, "Ben", e.id, 2); // needs 3: waits
      const result = await guestsOf(f, "Ada", ada.rsvp.id, 0); // 3 places freed
      expect(result.promoted.map((p) => p.memberId)).toEqual([f.m.Ben]);
      expect(await statuses(f, e.id)).toEqual({ [f.m.Ada]: "going", [f.m.Dee]: "going", [f.m.Ben]: "going" });
      expect(eventView(await f.store.read(), e, { kind: "staff" })).toMatchObject({ going: 6, left: 0 });
    });

    it("lets someone waiting change their group size, and checks it only when places free up", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 1 });
      await go(f, "Ada", e.id);
      const ben = await go(f, "Ben", e.id);
      expect((await guestsOf(f, "Ben", ben.rsvp.id, 2)).rsvp.guests).toBe(2);
      expect((await statuses(f, e.id))[f.m.Ben]).toBe("waitlisted");
    });

    it("stops adding guests once RSVPs close, but still lets them be removed", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      const ada = await go(f, "Ada", e.id, 1);
      await expect(guestsOf(f, "Ada", ada.rsvp.id, 2, at(3, 17))).rejects.toThrow("RSVPs have closed, so guests can no longer be added.");
      expect((await guestsOf(f, "Ada", ada.rsvp.id, 0, at(3, 17, 30))).rsvp.guests).toBe(0);
    });

    it("keeps people out of each other's RSVPs, finished ones, and events that have started", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      const ada = await go(f, "Ada", e.id);
      await expect(guestsOf(f, "Ben", ada.rsvp.id, 1)).rejects.toMatchObject({ code: "forbidden" });
      await expect(guestsOf(f, "Ada", ada.rsvp.id, 1, at(3, 18, 5))).rejects.toThrow("That event has already started, so this can no longer be changed here. Ask club staff.");
      await leave(f, "Ada", ada.rsvp.id);
      await expect(guestsOf(f, "Ada", ada.rsvp.id, 1)).rejects.toThrow("That RSVP is already cancelled.");
    });
  });

  describe("cancelling an RSVP", () => {
    it("records a late cancellation only for someone with places who cancels inside 48 hours", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      const ada = await go(f, "Ada", e.id);
      const ben = await go(f, "Ben", e.id);
      expect((await leave(f, "Ada", ada.rsvp.id, at(1, 18))).late).toBe(false); // exactly 48 hours before: still on time
      const late = await leave(f, "Ben", ben.rsvp.id, at(1, 18, 1));
      expect(late.late).toBe(true);
      expect(late.rsvp).toMatchObject({ status: "late_cancelled", cancelledBy: { kind: "member" } });
      expect((await linesOf(f, "Ada", e.id))[0].status).toBe("cancelled");
    });

    it("never counts leaving a waiting list as late, nor staff cancelling for a member", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 1 });
      await go(f, "Ada", e.id);
      const ben = await go(f, "Ben", e.id);
      expect((await leave(f, "Ben", ben.rsvp.id, at(3, 12))).late).toBe(false);
      const adaLine = (await linesOf(f, "Ada", e.id))[0];
      const byStaff = await cancelRsvp(f.store, EVENT_RULES, staffCtx(at(3, 12)), adaLine.id, { reason: "Asked at the desk" });
      expect(byStaff).toMatchObject({ late: false, rsvp: { status: "cancelled", cancelReason: "Asked at the desk" } });
    });

    it("keeps people from cancelling someone else's RSVP, a finished one, or one for an event that has started", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      const ada = await go(f, "Ada", e.id);
      await expect(leave(f, "Ben", ada.rsvp.id)).rejects.toMatchObject({ code: "forbidden" });
      await expect(leave(f, "Ada", ada.rsvp.id, at(3, 18, 1))).rejects.toThrow("That event has already started, so the RSVP cannot be cancelled here. Ask club staff.");
      await leave(f, "Ada", ada.rsvp.id);
      await expect(leave(f, "Ada", ada.rsvp.id)).rejects.toThrow("That RSVP is already cancelled.");
    });
  });

  describe("changing the limit", () => {
    it("moves the waiting list up in order when the limit is raised, and everyone when it is removed", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 2 });
      for (const who of ["Ada", "Ben", "Cy", "Dee", "Eli"]) await go(f, who, e.id);
      const raised = await updateEvent(f.store, EVENT_RULES, staffCtx(), e.id, { capacity: 4 });
      expect(raised.promoted.map((p) => p.memberId)).toEqual([f.m.Cy, f.m.Dee]);
      expect((await statuses(f, e.id))[f.m.Eli]).toBe("waitlisted");
      const removed = await updateEvent(f.store, EVENT_RULES, staffCtx(), e.id, { capacity: null });
      expect(removed.promoted.map((p) => p.memberId)).toEqual([f.m.Eli]);
      expect((await eventOf(f, e.id)).capacity).toBeNull();
    });

    it("refuses a limit below the people already going, counting guests", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 10 });
      await go(f, "Ada", e.id, 2);
      await go(f, "Dee", e.id, 1);
      await expect(updateEvent(f.store, EVENT_RULES, staffCtx(), e.id, { capacity: 4 })).rejects.toThrow("5 people are already going, so the limit cannot go below 5. Cancel some RSVPs first.");
      await expect(updateEvent(f.store, EVENT_RULES, staffCtx(), e.id, { capacity: 4 })).rejects.toBeInstanceOf(LimitTooLow);
      expect((await updateEvent(f.store, EVENT_RULES, staffCtx(), e.id, { capacity: 5 })).event.capacity).toBe(5);
      const open = await mkEvent(f, { title: "Open house", startsAt: at(5, 10), endsAt: at(5, 12), capacity: null });
      for (const who of await addMembers(f, 20)) await go(f, who, open.id);
      await expect(updateEvent(f.store, EVENT_RULES, staffCtx(), open.id, { capacity: 3 })).rejects.toThrow("20 people are already going");
    });
  });

  describe("cancelling an event", () => {
    it("takes everyone off, not as late cancellations, and lists them for staff to contact", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 1 });
      await go(f, "Ada", e.id);
      await go(f, "Ben", e.id, 1);
      const { event, affected } = await cancelEvent(f.store, staffCtx(at(1, 8)), e.id, { reason: "Venue flooded" });
      expect(event).toMatchObject({ status: "cancelled", cancelReason: "Venue flooded", cancelledBy: { kind: "staff" } });
      expect(affected.map((a) => [a.name, a.status, a.guests, a.email])).toEqual([["Ada Quill", "going", 0, "ada@example.com"], ["Ben Quill", "waitlisted", 1, "ben@example.com"]]);
      expect(await statuses(f, e.id)).toEqual({ [f.m.Ada]: "cancelled", [f.m.Ben]: "cancelled" });
      expect((await f.store.read()).rsvps.every((r) => r.cancelReason === "The event was cancelled: Venue flooded")).toBe(true);
    });

    it("cannot be done by members, twice, without a reason, or after the start", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      await expect(cancelEvent(f.store, memberCtx(f.m.Ada, "Ada"), e.id, { reason: "x" })).rejects.toMatchObject({ code: "forbidden" });
      await expect(cancelEvent(f.store, staffCtx(), e.id, { reason: "  " })).rejects.toThrow("Say why the event is cancelled; members will see the reason.");
      await expect(cancelEvent(f.store, staffCtx(at(3, 18, 1)), e.id, { reason: "late" })).rejects.toThrow("That event has already started, so it cannot be cancelled.");
      await cancelEvent(f.store, staffCtx(), e.id, { reason: "Storm" });
      await expect(cancelEvent(f.store, staffCtx(), e.id, { reason: "again" })).rejects.toThrow("That event is already cancelled.");
    });
  });

  describe("attendance", () => {
    it("lets staff mark places as attended or a no-show once the event has started, and nobody else", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 1 });
      const ada = await go(f, "Ada", e.id);
      const ben = await go(f, "Ben", e.id);
      await expect(markRsvpAttendance(f.store, staffCtx(at(3, 17)), ada.rsvp.id, "attended")).rejects.toThrow("That event has not started yet.");
      await expect(markRsvpAttendance(f.store, memberCtx(f.m.Ada, "Ada", at(3, 19)), ada.rsvp.id, "attended")).rejects.toMatchObject({ code: "forbidden" });
      await expect(markRsvpAttendance(f.store, staffCtx(at(3, 19)), ben.rsvp.id, "attended")).rejects.toThrow(/only be recorded for someone with places/);
      expect(await markRsvpAttendance(f.store, staffCtx(at(3, 19)), ada.rsvp.id, "attended")).toMatchObject({ status: "attended" });
      await expect(markRsvpAttendance(f.store, staffCtx(at(3, 20)), ada.rsvp.id, "no_show")).rejects.toThrow(/is attended/);
    });
  });

  describe("when a household leaves", () => {
    it("takes every adult off future events, places and waiting lists alike, moves the lines up behind them, and logs it", async () => {
      const f = await fixture();
      const dinner = await mkEvent(f, { capacity: 3 });
      const brunch = await mkEvent(f, { title: "Brunch", startsAt: at(4, 10), endsAt: at(4, 12), capacity: 1 });
      await go(f, "Ada", dinner.id, 1); // 2 places
      await go(f, "Ben", dinner.id); // 3 of 3
      await go(f, "Dee", dinner.id); // waits
      await go(f, "Eli", dinner.id); // waits
      await go(f, "Cy", brunch.id);
      await go(f, "Dee", brunch.id); // waits
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Quill);
      expect(await statuses(f, dinner.id)).toEqual({ [f.m.Ada]: "cancelled", [f.m.Ben]: "cancelled", [f.m.Dee]: "going", [f.m.Eli]: "going" });
      expect(await statuses(f, brunch.id)).toEqual({ [f.m.Cy]: "cancelled", [f.m.Dee]: "going" });
      const state = await f.store.read();
      expect(state.rsvps.filter((r) => r.status === "cancelled").every((r) => r.cancelReason === "The household's membership ended" && r.cancelledBy?.kind === "staff")).toBe(true);
      expect(state.rsvps.find((r) => r.memberId === f.m.Dee && r.eventId === dinner.id)?.promotedAt).toBe(NOW.toISOString());
      expect(historyOf(state, f.h.Quill).find((h) => h.kind === "rsvps_cancelled")).toMatchObject({ summary: "3 future event RSVPs cancelled because the membership ended.", details: { count: 3 } });
    });

    it("leaves events already under way and past ones exactly as they were", async () => {
      const f = await fixture();
      const past = await mkEvent(f, { title: "Last week", startsAt: at(-2, 18), endsAt: at(-2, 21) }, at(-5, 12));
      const underWay = await mkEvent(f, { title: "Right now", startsAt: at(0, 12), endsAt: at(0, 15) }, at(-1, 12));
      await go(f, "Ada", past.id, 0, at(-3, 9));
      await go(f, "Ada", underWay.id, 0, at(-1, 13));
      await markRsvpAttendance(f.store, staffCtx(at(-2, 19)), (await linesOf(f, "Ada", past.id))[0].id, "attended");
      const before = (await f.store.read()).rsvps;
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Quill);
      expect((await f.store.read()).rsvps).toEqual(before);
      expect((await f.store.read()).history.some((h) => h.kind === "rsvps_cancelled")).toBe(false);
    });

    it("does the same for one adult who is removed", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 1 });
      await go(f, "Ben", e.id);
      await go(f, "Dee", e.id);
      const later = await mkEvent(f, { title: "Brunch", startsAt: at(4, 10), endsAt: at(4, 12) });
      await go(f, "Ada", later.id);
      await removeMember(f.store, clubLedger, staffCtx(), f.m.Ben);
      expect(await statuses(f, e.id)).toEqual({ [f.m.Ben]: "cancelled", [f.m.Dee]: "going" });
      expect(await statuses(f, later.id)).toEqual({ [f.m.Ada]: "going" });
      expect(historyOf(await f.store.read(), f.h.Quill).find((h) => h.kind === "rsvps_cancelled")).toMatchObject({ summary: "1 future event RSVP cancelled for Ben Quill." });
    });

    it("changes nothing if anything fails: the household is not half ended", async () => {
      const f = await fixture();
      const e = await mkEvent(f);
      await go(f, "Ada", e.id);
      const before = await f.store.read();
      const broken = { ...clubLedger, cancelFutureRsvps: async () => { throw new Error("boom"); } };
      await expect(endHousehold(f.store, broken, staffCtx(), f.h.Quill)).rejects.toThrow("boom");
      expect(await f.store.read()).toEqual(before);
    });
  });

  describe("many people at once", () => {
    it("never gives out more places than the limit when 20 members RSVP at the same moment", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 6 });
      const people = await addMembers(f, 20);
      const results = await Promise.allSettled(people.map((id, i) => go(f, id, e.id, i % 3 === 0 ? 1 : 0)));
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const state = await f.store.read();
      expect(placesLeftOf(state, e.id)).toBeGreaterThanOrEqual(0);
      expect(eventView(state, e, { kind: "staff" }).going).toBeLessThanOrEqual(6);
      expect(new Set(state.rsvps.map((r) => r.memberId)).size).toBe(state.rsvps.length);
      // Every waiting group really did not fit when it was put on the list: nobody waiting could have used the free places now.
      const left = 6 - eventView(state, e, { kind: "staff" }).going;
      for (const r of state.rsvps.filter((x) => x.status === "waitlisted")) expect(1 + r.guests).toBeGreaterThan(left);
    }, 60000);

    it("keeps the count right through many rounds of everyone joining, changing guests and leaving", async () => {
      const f = await fixture();
      const e = await mkEvent(f, { capacity: 3 });
      const people = await addMembers(f, 6);
      for (let round = 0; round < 4; round++) {
        for (const id of people) await go(f, id, e.id);
        // Everyone waiting brings a guest (always allowed on the list); the three with places are full, so they cannot.
        for (const line of (await f.store.read()).rsvps.filter((r) => r.status === "waitlisted")) await guestsOf(f, line.memberId, line.id, 1);
        for (const line of (await f.store.read()).rsvps.filter((r) => r.status === "going")) await expect(guestsOf(f, line.memberId, line.id, 1)).rejects.toThrow("Dinner is full, so no more guests can be added.");
        const mid = await f.store.read();
        expect(eventView(mid, e, { kind: "staff" }).going).toBeLessThanOrEqual(3);
        for (const line of mid.rsvps.filter((r) => r.status === "going" || r.status === "waitlisted")) await leave(f, line.memberId, line.id);
        const after = await f.store.read();
        expect(after.rsvps.filter((r) => r.status === "going" || r.status === "waitlisted")).toHaveLength(0);
      }
      expect((await f.store.read()).rsvps).toHaveLength(24);
    }, 60000);
  });
});

function placesLeftOf(state: Awaited<ReturnType<Fixture["store"]["read"]>>, eventId: string): number {
  const event = state.events.find((e) => e.id === eventId)!;
  return event.capacity! - state.rsvps.filter((r) => r.eventId === eventId && r.status === "going").reduce((n, r) => n + 1 + r.guests, 0);
}
