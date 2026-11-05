import { describe, expect, it } from "vitest";
import { CLASS_RULES } from "../settings/class-rules";
import { EVENT_RULES } from "../settings/event-rules";
import type { ClubState, EventRules } from "../types";
import { classRulesFor } from "../settings/class-rules";
import { createClass, promoteCutoff as classPromoteCutoff, scheduleSessions, signUp } from "./classes";
import { createEvent, rsvp } from "./events";
import { basisOf, emailable, noticesFromChange, type NoticeRules } from "./notices";
import { NOW, at, fixture, memberCtx, staffCtx } from "./testkit";

/**
 * The edges of "who should be told": the exact moments at which a waiting-list move-up stops being news, who can be emailed at
 * all, and that a change that is not one of the four kinds calls for nothing. The scenarios through the real engine, on both
 * stores, are in notify/notifying-store.test.ts.
 */
const EVENTS: EventRules = { placeholder: true, defaults: { ...EVENT_RULES.defaults, waitlistHoldMinutes: 0 } };
const RULES: NoticeRules = { events: EVENTS, classes: CLASS_RULES };

/** A full dinner (one place) with Ada going and Ben waiting, and the records as they stood, plus a copy where Ben has the place. */
async function dinner() {
  const f = await fixture(); // memory store
  const e = await createEvent(f.store, staffCtx(), { title: "Dinner", startsAt: at(3, 18), endsAt: at(3, 21), capacity: 1, priceCents: 4500 });
  await rsvp(f.store, EVENTS, memberCtx(f.m.Ada, "Ada"), { eventId: e.id, memberId: f.m.Ada, guests: 0 });
  await rsvp(f.store, EVENTS, memberCtx(f.m.Ben, "Ben"), { eventId: e.id, memberId: f.m.Ben, guests: 0 });
  const before = await f.store.read();
  const after = structuredClone(before);
  for (const r of after.rsvps) if (r.memberId === f.m.Ben) r.status = "going";
  return { f, e, before, after, basis: basisOf(before) };
}

describe("a spot opened for you: the moment it stops being news", () => {
  it("is news up to the moment the automatic move-up ends, and not from then on", async () => {
    const { e, after, basis } = await dinner();
    const cutoff = Date.parse(e.startsAt) - EVENTS.defaults.promoteUntilMinutesBefore * 60_000;
    expect(noticesFromChange(basis, after, new Date(cutoff - 1), RULES).map((n) => n.kind)).toEqual(["event_spot"]);
    expect(noticesFromChange(basis, after, new Date(cutoff), RULES)).toEqual([]);
    expect(noticesFromChange(basis, after, new Date(cutoff + 1), RULES)).toEqual([]);
  });

  it("is never news once the event has started or been cancelled", async () => {
    const { e, after, basis } = await dinner();
    expect(noticesFromChange(basis, after, new Date(Date.parse(e.startsAt) + 1), RULES)).toEqual([]);
    const cancelled = structuredClone(after);
    cancelled.events[0].status = "cancelled";
    expect(noticesFromChange(basis, cancelled, NOW, RULES).map((n) => n.kind)).toEqual(["event_cancelled", "event_cancelled"]);
  });

  it("says the free-cancel time has passed once the cutoff for cancelling is behind you", async () => {
    const { e, after, basis } = await dinner();
    const freeUntil = Date.parse(e.startsAt) - EVENTS.defaults.cancelCutoffMinutes * 60_000;
    const [early] = noticesFromChange(basis, after, new Date(freeUntil - 1), RULES);
    const [late] = noticesFromChange(basis, after, new Date(freeUntil), RULES);
    expect(early.kind === "event_spot" && early.cancelFreeUntil).toBe(new Date(freeUntil).toISOString());
    expect(late.kind === "event_spot" && late.cancelFreeUntil).toBeNull();
  });

  it("is not news for someone who was already going, or who is still waiting", async () => {
    const { f, after, basis } = await dinner();
    const same = structuredClone(after);
    for (const r of same.rsvps) if (r.memberId === f.m.Ben) r.status = "waitlisted";
    expect(noticesFromChange(basis, same, NOW, RULES)).toEqual([]);
    expect(noticesFromChange(basis, after, NOW, RULES).map((n) => n.to.firstName)).toEqual(["Ben"]);
  });
});

describe("a spot opened for you: a class", () => {
  /** A full Yoga class (one place) with Ada enrolled and Ben waiting, and a copy of the records where Ben has the place. */
  async function yoga() {
    const f = await fixture();
    await f.store.transaction(async (st, newId) => {
      const id = newId();
      st.items.push({ id, name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
      f.i["Boathouse gym"] = id;
    });
    const template = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 1, defaultMinutes: 60, roomItemId: f.i["Boathouse gym"] });
    const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: template.id, startsAt: at(1, 9) });
    for (const who of ["Ada", "Ben"]) await signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m[who], who), { sessionId: session.id, memberId: f.m[who] });
    const before = await f.store.read();
    const after = structuredClone(before);
    for (const g of after.signups) if (g.memberId === f.m.Ben) g.status = "enrolled";
    return { session, template, basis: basisOf(before), after };
  }

  it("is news up to the moment the automatic move-up ends, and not from then on", async () => {
    const { session, template, basis, after } = await yoga();
    const cutoff = classPromoteCutoff(session, classRulesFor(CLASS_RULES, template));
    expect(noticesFromChange(basis, after, new Date(cutoff - 1), RULES).map((n) => n.kind)).toEqual(["class_spot"]);
    expect(noticesFromChange(basis, after, new Date(cutoff), RULES)).toEqual([]);
  });

  it("is never news once the class has started or been cancelled", async () => {
    const { session, basis, after } = await yoga();
    expect(noticesFromChange(basis, after, new Date(Date.parse(session.startsAt) + 1), RULES)).toEqual([]);
    const cancelled = structuredClone(after);
    cancelled.sessions[0].status = "cancelled";
    expect(noticesFromChange(basis, cancelled, NOW, RULES)).toEqual([]);
  });
});

describe("who can be emailed", () => {
  it("is an active adult of an active household with an address on file, and nobody else", async () => {
    const { f, after, basis } = await dinner();
    const email = (state: ClubState) => emailable(state, f.m.Ben);
    expect(email(after)?.email).toBe("ben@example.com");

    const left = structuredClone(after);
    left.members.find((m) => m.id === f.m.Ben)!.status = "removed";
    expect(email(left)).toBeNull();
    expect(noticesFromChange(basis, left, NOW, RULES)).toEqual([]);

    const ended = structuredClone(after);
    ended.households.find((h) => h.id === f.h.Quill)!.status = "ended";
    expect(email(ended)).toBeNull();

    const blank = structuredClone(after);
    blank.members.find((m) => m.id === f.m.Ben)!.email = "   ";
    expect(email(blank)).toBeNull();

    expect(emailable(after, "nobody-with-this-id")).toBeNull();
  });

  it("falls back to a friendly name when the first name is empty", async () => {
    const { f, after } = await dinner();
    after.members.find((m) => m.id === f.m.Ben)!.firstName = "  ";
    expect(emailable(after, f.m.Ben)?.firstName).toBe("there");
  });
});

describe("a change that calls for nothing", () => {
  it("is a change that touches none of the four kinds", async () => {
    const { before, basis } = await dinner();
    expect(noticesFromChange(basis, structuredClone(before), NOW, RULES)).toEqual([]);
  });

  it("is an event that was already cancelled being cancelled again", async () => {
    const { before, after } = await dinner();
    const cancelledBefore = structuredClone(before);
    cancelledBefore.events[0].status = "cancelled";
    const basis = basisOf(cancelledBefore);
    const again = structuredClone(after);
    again.events[0].status = "cancelled";
    expect(noticesFromChange(basis, again, NOW, RULES)).toEqual([]);
  });

  it("is a time given as another spelling of the same moment", async () => {
    const { after, basis } = await dinner();
    const same = structuredClone(after);
    same.events[0].startsAt = new Date(same.events[0].startsAt).toISOString().replace("Z", "+00:00");
    expect(noticesFromChange(basis, same, NOW, RULES).filter((n) => n.kind === "event_changed")).toEqual([]);
  });
});
