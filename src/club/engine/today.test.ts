import { describe, expect, it } from "vitest";
import { ATTENDANCE_RULES } from "../settings/attendance-rules";
import { CLASS_RULES } from "../settings/class-rules";
import { TODAY_RULES } from "../settings/today-rules";
import { addDays } from "../time";
import type { Booking, BookingStatus, ClassSession, ClassTemplate, ClubEvent, ClubState, Rsvp, SignUp, SignUpStatus, TodayRules } from "../types";
import { memberCheckIn } from "./attendance";
import { cancelBooking } from "./bookings";
import { createClass, scheduleSessions, signUp } from "./classes";
import { EVENT_RULES } from "../settings/event-rules";
import { createEvent, rsvp } from "./events";
import { HELLO_WORDS, TODAY_CATEGORIES, helloFor, helloNotesOn, helloOffWords, memberCount, refreshWords, summaryWords, todayAtTheClub, type TodayView } from "./today";
import { NOW, STORE_KINDS, TODAY, at, bookAs, buildFixture, buildFixtureSettling, mark, memberCtx, staff, staffCtx, type Fixture } from "./testkit";

/** Today at the front desk, on both stores for the real flows and on hand-built records for the edges. Today is Wed Oct 28, 1 pm Pacific. */

let counter = 5000;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const iso = (d: Date) => d.toISOString();

interface Club {
  f: Fixture;
  state: ClubState;
}

/** The invented club (Quill: Ada, Ben, Cy; Reed: Dee, Eli, all joined in 2020) as plain records a test can add to. */
async function club(): Promise<Club> {
  const f = await buildFixture("memory");
  const state = await f.store.read();
  for (const [name, classCode] of [["Boathouse gym", "gym-space"], ["Clubhouse room", "room-space"], ["Work table", "work-space"]]) {
    state.items.push({ id: newId(), name, classCode, ruleOverrides: {} });
  }
  return { f, state };
}

const itemId = (c: Club, name: string) => c.state.items.find((i) => i.name === name)!.id;

function addBooking(c: Club, who: string, item: string, start: Date, end: Date, status: BookingStatus = "upcoming", crew: string[] = []): Booking {
  const b: Booking = {
    id: newId(),
    itemId: itemId(c, item),
    bookerId: c.f.m[who],
    crew: crew.map((n) => c.f.m[n]),
    startsAt: iso(start),
    endsAt: iso(end),
    status,
    createdAt: iso(at(-30, 12)),
    createdBy: staff,
    statusChangedAt: iso(at(-30, 12)),
    cancelledBy: null,
    cancelReason: null,
    override: null,
    removedCrew: [],
  };
  c.state.bookings.push(b);
  return b;
}

function addClass(c: Club, name: string, start: Date, end: Date, people: [string, SignUpStatus][], sessionStatus: "scheduled" | "cancelled" = "scheduled"): ClassSession {
  let template = c.state.classes.find((k) => k.name === name);
  if (!template) {
    template = { id: newId(), name, description: "", instructor: "Instructor", defaultCapacity: 10, defaultMinutes: 60, roomItemId: null, rules: {} } satisfies ClassTemplate;
    c.state.classes.push(template);
  }
  const session: ClassSession = { id: newId(), classId: template.id, roomItemId: null, startsAt: iso(start), endsAt: iso(end), capacity: 10, status: sessionStatus, createdAt: iso(at(-30, 12)), createdBy: staff, statusChangedAt: iso(at(-30, 12)), cancelledBy: null, cancelReason: null };
  c.state.sessions.push(session);
  for (const [who, status] of people) {
    c.state.signups.push({ id: newId(), sessionId: session.id, memberId: c.f.m[who], status, createdAt: iso(at(-30, 12)), createdBy: staff, statusChangedAt: iso(at(-30, 12)), promotedAt: null, cancelledBy: null, cancelReason: null } satisfies SignUp);
  }
  return session;
}

function addEventRsvp(c: Club, who: string, start: Date, status: Rsvp["status"]) {
  const event: ClubEvent = { id: newId(), title: "A social", description: "", location: "", startsAt: iso(start), endsAt: iso(new Date(start.getTime() + 7200000)), capacity: null, priceCents: null, replyBy: null, status: "scheduled", createdAt: iso(at(-60, 12)), createdBy: staff, statusChangedAt: iso(at(-60, 12)), cancelledBy: null, cancelReason: null };
  c.state.events.push(event);
  c.state.rsvps.push({ id: newId(), eventId: event.id, memberId: c.f.m[who], guests: 0, status, priceCents: null, via: "page", createdAt: iso(at(-60, 12)), createdBy: staff, statusChangedAt: iso(at(-60, 12)), promotedAt: null, holdUntil: null, cancelledBy: null, cancelReason: null });
}

/** One event with a list of people on it, each in the state given: going, attended, waitlisted and so on. */
function addEvent(c: Club, title: string, start: Date, end: Date, people: [string, Rsvp["status"]][], status: ClubEvent["status"] = "scheduled"): ClubEvent {
  const event: ClubEvent = { id: newId(), title, description: "", location: "", startsAt: iso(start), endsAt: iso(end), capacity: null, priceCents: null, replyBy: null, status, createdAt: iso(at(-60, 12)), createdBy: staff, statusChangedAt: iso(at(-60, 12)), cancelledBy: null, cancelReason: null };
  c.state.events.push(event);
  for (const [name, rsvpStatus] of people) {
    c.state.rsvps.push({ id: newId(), eventId: event.id, memberId: c.f.m[name], guests: 0, status: rsvpStatus, priceCents: null, via: "page", createdAt: iso(at(-60, 12)), createdBy: staff, statusChangedAt: iso(at(-60, 12)), promotedAt: null, holdUntil: null, cancelledBy: null, cancelReason: null });
  }
  return event;
}

const view = (c: Club, now: Date = NOW, rules: TodayRules = TODAY_RULES): TodayView => todayAtTheClub(c.state, now, rules, ATTENDANCE_RULES);
const who = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("today at the club: the heading and the figures' time", () => {
  it("names the Pacific day and says when the figures were worked out", async () => {
    const v = view(await club());
    expect(v.day).toBe("2026-10-28");
    expect(v.heading).toBe("Wednesday, October 28");
    expect(v.asOf).toBe(NOW.toISOString());
    expect(v.asOfClock).toBe("1:00 pm");
  });

  it("is the Pacific day, not the world's: 6 pm Pacific is already the next day in UTC", async () => {
    const c = await club();
    const evening = new Date("2026-10-29T01:30:00Z"); // 6:30 pm Pacific on Oct 28
    expect(view(c, evening).heading).toBe("Wednesday, October 28");
    const lateNight = new Date("2026-10-29T06:59:00Z"); // 11:59 pm Pacific on Oct 28
    expect(view(c, lateNight).day).toBe("2026-10-28");
    expect(view(c, new Date("2026-10-29T07:00:00Z")).day).toBe("2026-10-29");
  });

  it("with nothing booked says so, and both lists are empty", async () => {
    const v = view(await club());
    expect(v.summary).toEqual({ total: 0, parts: [], words: "No reservations today." });
    expect(v.here).toEqual([]);
    expect(v.upcoming).toEqual([]);
  });
});

describe("the one-line summary", () => {
  it("reads like Grant's example: biggest first, singular for one, class places for classes", () => {
    const parts = [
      { count: 6, one: "boat", many: "boats" },
      { count: 3, one: "gym", many: "gym" },
      { count: 2, one: "dock", many: "dock" },
      { count: 2, one: "class place", many: "class places" },
      { count: 1, one: "room", many: "room" },
    ];
    expect(summaryWords(14, parts)).toBe("14 reservations today — 6 boats, 3 gym, 2 dock, 2 class places, 1 room");
    expect(summaryWords(1, [{ count: 1, one: "boat", many: "boats" }])).toBe("1 reservation today — 1 boat");
    expect(summaryWords(0, [])).toBe("No reservations today.");
  });

  it("uses only the categories the app already has, in a fixed order for ties", () => {
    expect(TODAY_CATEGORIES.map((x) => x.key)).toEqual(["boat", "gym", "dock", "class", "event", "room", "work"]);
    // Every booking type belongs to exactly one category, so a type cannot be forgotten or counted twice.
    const types = TODAY_CATEGORIES.flatMap((x) => x.types);
    expect(types.sort()).toEqual(["Dock Space", "Gym Space", "Kayak", "Paddle Board", "Room Space", "Shell", "Work Space"]);
  });

  it("counts what starts today by kind: boats (shells, kayaks and paddle boards), spaces and class places, finished ones too", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", at(0, 7), at(0, 8), "completed"); // finished
    addBooking(c, "Ben", "Loon", at(0, 12), at(0, 14), "upcoming", ["Cy"]); // one booking for two people: one reservation
    addBooking(c, "Dee", "Otter", at(0, 15), at(0, 16)); // a kayak is a boat
    addBooking(c, "Eli", "Skimmer", at(0, 16), at(0, 17)); // so is a paddle board
    addBooking(c, "Ada", "Boathouse gym", at(0, 9), at(0, 10), "no_show"); // a no-show was still a reservation
    addBooking(c, "Dee", "Dock slip A", at(0, 17), at(0, 18));
    addBooking(c, "Eli", "Clubhouse room", at(0, 9), at(0, 10));
    addBooking(c, "Ben", "Work table", at(0, 9), at(0, 10));
    addClass(c, "Yoga", at(0, 12), at(0, 13), [["Ada", "enrolled"], ["Cy", "attended"], ["Dee", "no_show"]]);
    const v = view(c);
    expect(v.summary.words).toBe("11 reservations today — 4 boats, 3 class places, 1 gym, 1 dock, 1 room, 1 work space");
    expect(v.summary.total).toBe(11);
    expect(v.summary.parts.map((p) => [p.key, p.count])).toEqual([["boat", 4], ["class", 3], ["gym", 1], ["dock", 1], ["room", 1], ["work", 1]]);
  });

  it("does not count cancelled things, waiting-list places, other days or cancelled classes", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", at(0, 9), at(0, 10), "cancelled");
    addBooking(c, "Ada", "Osprey", at(0, 9), at(0, 10), "late_cancelled");
    addBooking(c, "Ben", "Heron", at(1, 9), at(1, 10)); // tomorrow
    addBooking(c, "Ben", "Osprey", at(-1, 9), at(-1, 10), "completed"); // yesterday
    addClass(c, "Yoga", at(0, 12), at(0, 13), [["Ada", "waitlisted"], ["Ben", "cancelled"], ["Cy", "late_cancelled"]]);
    addClass(c, "Spin", at(0, 14), at(0, 15), [["Dee", "enrolled"]], "cancelled");
    expect(view(c).summary).toEqual({ total: 0, parts: [], words: "No reservations today." });
  });

  it("counts a booking by the Pacific day it starts on, not the world's", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", new Date("2026-10-29T01:00:00Z"), new Date("2026-10-29T02:00:00Z")); // 6 pm Pacific on the 28th
    addBooking(c, "Ben", "Osprey", new Date("2026-10-29T07:30:00Z"), new Date("2026-10-29T08:30:00Z")); // 12:30 am Pacific on the 29th
    expect(view(c).summary.total).toBe(1);
  });

  it("the member count words", () => {
    expect(memberCount(0)).toBe("0 members");
    expect(memberCount(1)).toBe("1 member");
    expect(memberCount(9)).toBe("9 members");
  });

  it("says how often the page refreshes itself", () => {
    expect(refreshWords(120)).toBe("2 minutes");
    expect(refreshWords(60)).toBe("minute");
    expect(refreshWords(300)).toBe("5 minutes");
    expect(refreshWords(90)).toBe("90 seconds");
    expect(refreshWords(30)).toBe("30 seconds");
  });
});

describe("who is here now, and who is still to come", () => {
  it("lists a member whose reservation is under way as here, and one that has not started as upcoming", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", at(0, 12), at(0, 14));
    addBooking(c, "Ben", "Osprey", at(0, 14), at(0, 15));
    const v = view(c);
    expect(who(v.here)).toEqual(["Ada Quill"]);
    expect(who(v.upcoming)).toEqual(["Ben Quill"]);
    expect(v.here[0].what).toEqual([{ title: "Heron", category: "Boat" }]);
    expect(v.upcoming[0].what).toEqual([{ title: "Osprey", category: "Boat" }]);
  });

  it("counts someone who has checked in as here, even before their reservation has started", async () => {
    const c = await club();
    addBooking(c, "Dee", "Skimmer", at(0, 13, 20), at(0, 14), "completed");
    addBooking(c, "Eli", "Otter", at(0, 13, 20), at(0, 14)); // opens for check-in, nobody has tapped yet: still to come
    const v = view(c);
    expect(who(v.here)).toEqual(["Dee Reed"]);
    expect(who(v.upcoming)).toEqual(["Eli Reed"]);
  });

  it("leaves out a member whose reservation has ended, in neither list, however it ended", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", at(0, 9), at(0, 10), "completed"); // came, and went
    addBooking(c, "Ben", "Osprey", at(0, 9), at(0, 10), "no_show"); // did not come
    addBooking(c, "Cy", "Clubhouse room", at(0, 9), at(0, 10)); // a room needs no check-in, so it is simply over
    addClass(c, "Yoga", at(0, 10), at(0, 11), [["Dee", "attended"], ["Eli", "no_show"]]);
    const v = view(c);
    expect(v.here).toEqual([]);
    expect(v.upcoming).toEqual([]);
    // They did happen today, so they are still part of the day's total.
    expect(v.summary.total).toBe(5);
  });

  it("leaves out cancelled bookings, waiting-list places, cancelled classes and bookings on another day", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", at(0, 12), at(0, 14), "cancelled");
    addBooking(c, "Ada", "Osprey", at(0, 14), at(0, 15), "late_cancelled");
    addBooking(c, "Ben", "Heron", at(1, 9), at(1, 10));
    addClass(c, "Yoga", at(0, 12), at(0, 14), [["Cy", "waitlisted"], ["Dee", "cancelled"]]);
    addClass(c, "Spin", at(0, 12), at(0, 14), [["Eli", "enrolled"]], "cancelled");
    const v = view(c);
    expect(v.here).toEqual([]);
    expect(v.upcoming).toEqual([]);
  });

  it("a member marked a no-show while their reservation is still under way is not here", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", at(0, 12), at(0, 14), "no_show");
    expect(view(c).here).toEqual([]);
  });

  it("counts the exact start as here, the exact end as over, and a moment before the start as still to come", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", at(0, 13), at(0, 14));
    expect(who(view(c, new Date(NOW.getTime() - 1)).upcoming)).toEqual(["Ada Quill"]);
    expect(who(view(c, NOW).here)).toEqual(["Ada Quill"]);
    expect(who(view(c, at(0, 13, 59)).here)).toEqual(["Ada Quill"]);
    const atEnd = view(c, at(0, 14));
    expect(atEnd.here).toEqual([]);
    expect(atEnd.upcoming).toEqual([]);
  });

  it("a club room or work space reservation under way counts as here, though nobody ever checks in for it", async () => {
    const c = await club();
    addBooking(c, "Ada", "Clubhouse room", at(0, 12), at(0, 14));
    addBooking(c, "Ben", "Work table", at(0, 12), at(0, 14));
    const v = view(c);
    expect(v.here.map((r) => [r.name, r.what[0].category])).toEqual([["Ada Quill", "Room"], ["Ben Quill", "Work space"]]);
  });

  it("lists everyone on a boat, crew as well as the booker, once each", async () => {
    const c = await club();
    addBooking(c, "Ben", "Loon", at(0, 12), at(0, 14), "upcoming", ["Ada"]);
    const v = view(c);
    expect(who(v.here)).toEqual(["Ada Quill", "Ben Quill"]);
    expect(v.here.every((r) => r.what.length === 1 && r.what[0].title === "Loon")).toBe(true);
  });

  it("lists classes by their name, with the class tag: here when under way or marked attended, upcoming before the start", async () => {
    const c = await club();
    addClass(c, "Morning Yoga", at(0, 12, 30), at(0, 13, 30), [["Ada", "enrolled"], ["Ben", "attended"]]);
    addClass(c, "Erg Conditioning", at(0, 15), at(0, 16), [["Cy", "enrolled"]]);
    addClass(c, "Early Stretch", at(0, 13, 30), at(0, 14), [["Dee", "attended"]]); // ticked off early, not started
    const v = view(c);
    expect(v.here.map((r) => [r.name, r.what])).toEqual([
      ["Ada Quill", [{ title: "Morning Yoga", category: "Class" }]],
      ["Ben Quill", [{ title: "Morning Yoga", category: "Class" }]],
      ["Dee Reed", [{ title: "Early Stretch", category: "Class" }]],
    ]);
    expect(v.upcoming.map((r) => [r.name, r.what])).toEqual([["Cy Quill", [{ title: "Erg Conditioning", category: "Class" }]]]);
  });

  it("puts a member with two reservations on one row, soonest first, and in both lists when one is under way and one is to come", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", at(0, 12), at(0, 14));
    addBooking(c, "Ada", "Dock slip A", at(0, 16), at(0, 17));
    addBooking(c, "Ben", "Osprey", at(0, 17), at(0, 18));
    addBooking(c, "Ben", "Clubhouse room", at(0, 15), at(0, 16));
    const v = view(c);
    expect(v.here.map((r) => [r.name, r.what.map((w) => w.title)])).toEqual([["Ada Quill", ["Heron"]]]);
    expect(v.upcoming.map((r) => [r.name, r.what.map((w) => w.title)])).toEqual([["Ben Quill", ["Clubhouse room", "Osprey"]], ["Ada Quill", ["Dock slip A"]]]);
  });

  it("puts everyone here in name order, and those still to come soonest first, then by name", async () => {
    const c = await club();
    for (const [name, item] of [["Eli", "Heron"], ["Cy", "Osprey"], ["Dee", "Kingfisher"], ["Ada", "Otter"]]) addBooking(c, name, item, at(0, 12), at(0, 14));
    addBooking(c, "Ben", "Skimmer", at(0, 18), at(0, 19));
    addBooking(c, "Eli", "Dock slip A", at(0, 15), at(0, 16));
    addBooking(c, "Dee", "Clubhouse room", at(0, 15), at(0, 16));
    addBooking(c, "Cy", "Work table", at(0, 16), at(0, 17));
    const v = view(c);
    expect(who(v.here)).toEqual(["Ada Quill", "Cy Quill", "Dee Reed", "Eli Reed"]);
    expect(who(v.upcoming)).toEqual(["Dee Reed", "Eli Reed", "Cy Quill", "Ben Quill"]);
  });

  it("does not list someone who has left or whose household has ended", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", at(0, 12), at(0, 14));
    addBooking(c, "Dee", "Osprey", at(0, 12), at(0, 14));
    addBooking(c, "Eli", "Kingfisher", at(0, 12), at(0, 14));
    c.state.members.find((m) => m.id === c.f.m.Ada)!.status = "removed";
    c.state.households.find((h) => h.id === c.f.h.Reed)!.status = "ended";
    c.state.members.filter((m) => m.householdId === c.f.h.Reed).forEach((m) => (m.status = "household_ended"));
    expect(who(view(c).here)).toEqual([]);
  });

  it("does not list a practice, which has its own lineup", async () => {
    const c = await club();
    expect(c.state.practices).toEqual([]);
    c.state.practices.push({ id: newId(), name: "Morning session", notes: "", startsAt: iso(at(0, 12)), endsAt: iso(at(0, 14)), status: "scheduled", coachId: null, createdAt: iso(at(-30, 12)), createdBy: staff, statusChangedAt: iso(at(-30, 12)), cancelledBy: null, cancelReason: null });
    expect(view(c).here).toEqual([]);
    expect(view(c).upcoming).toEqual([]);
    expect(view(c).summary.total).toBe(0);
  });

  it("shows no reservation time anywhere in what it returns, only the one time the figures were worked out", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", at(0, 12, 15), at(0, 14, 45));
    addBooking(c, "Ben", "Osprey", at(0, 15, 30), at(0, 16));
    addClass(c, "Yoga", at(0, 17), at(0, 18), [["Cy", "enrolled"]]);
    const { asOf, asOfClock, ...rest } = view(c);
    void asOf;
    void asOfClock;
    const text = JSON.stringify(rest);
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/\b(am|pm)\b/i);
    expect(text).not.toMatch(/T\d{2}:/);
    expect(Object.keys(rest.here[0]).sort()).toEqual(["hello", "memberId", "name", "what"]);
    expect(Object.keys(rest.upcoming[0].what[0]).sort()).toEqual(["category", "title"]);
  });

  it("is the same whoever asks and changes nothing however often it is asked", async () => {
    const c = await club();
    addBooking(c, "Ada", "Heron", at(0, 12), at(0, 14));
    const before = JSON.stringify(c.state);
    const first = view(c);
    expect(view(c)).toEqual(first);
    expect(JSON.stringify(c.state)).toBe(before);
  });
});

describe("events on the page", () => {
  it("counts one RSVP for each member going, attended or marked a no-show, on events that start today and are still on", async () => {
    const c = await club();
    addEvent(c, "Coffee Hour", at(0, 12), at(0, 14), [["Ada", "going"], ["Ben", "attended"], ["Cy", "no_show"], ["Dee", "waitlisted"], ["Eli", "cancelled"]]);
    addEvent(c, "Evening Talk", at(0, 18), at(0, 19), [["Ada", "late_cancelled"]]);
    addEvent(c, "Called off", at(0, 15), at(0, 16), [["Dee", "going"]], "cancelled");
    addEvent(c, "Tomorrow's lunch", at(1, 12), at(1, 14), [["Eli", "going"]]);
    addEvent(c, "Yesterday's lunch", at(-1, 12), at(-1, 14), [["Eli", "attended"]]);
    expect(view(c).summary).toEqual({ total: 3, parts: [{ key: "event", count: 3, words: "3 event RSVPs" }], words: "3 reservations today — 3 event RSVPs" });
  });

  it("says one event RSVP in the singular", async () => {
    const c = await club();
    addEvent(c, "Coffee Hour", at(0, 12), at(0, 14), [["Ada", "going"]]);
    expect(view(c).summary.words).toBe("1 reservation today — 1 event RSVP");
  });

  it("keeps events after class places and before rooms when the counts tie", async () => {
    const c = await club();
    addClass(c, "Yoga", at(0, 15), at(0, 16), [["Ada", "enrolled"]]);
    addEvent(c, "Coffee Hour", at(0, 16), at(0, 17), [["Ben", "going"]]);
    addBooking(c, "Cy", "Clubhouse room", at(0, 17), at(0, 18));
    expect(view(c).summary.words).toBe("3 reservations today — 1 class place, 1 event RSVP, 1 room");
  });

  it("lists a member going to an event under way as here, and one going to a later event as upcoming, with the event's name and the Event tag", async () => {
    const c = await club();
    addEvent(c, "Coffee Hour", at(0, 12), at(0, 14), [["Ada", "going"], ["Ben", "attended"], ["Cy", "no_show"], ["Dee", "waitlisted"]]);
    addEvent(c, "Evening Talk", at(0, 18), at(0, 19), [["Eli", "going"]]);
    const v = view(c);
    expect(v.here.map((r) => [r.name, r.what])).toEqual([
      ["Ada Quill", [{ title: "Coffee Hour", category: "Event" }]],
      ["Ben Quill", [{ title: "Coffee Hour", category: "Event" }]],
    ]);
    expect(v.upcoming.map((r) => [r.name, r.what])).toEqual([["Eli Reed", [{ title: "Evening Talk", category: "Event" }]]]);
  });

  it("counts someone staff marked attended as here before the event has started, since staff mark events", async () => {
    const c = await club();
    addEvent(c, "Evening Talk", at(0, 18), at(0, 19), [["Ada", "attended"], ["Ben", "going"]]);
    const v = view(c);
    expect(who(v.here)).toEqual(["Ada Quill"]);
    expect(who(v.upcoming)).toEqual(["Ben Quill"]);
  });

  it("counts the exact start as here, the exact end as over, and a moment before the start as still to come", async () => {
    const c = await club();
    addEvent(c, "Starts now", NOW, new Date(NOW.getTime() + 3600000), [["Ada", "going"]]);
    addEvent(c, "Ends now", new Date(NOW.getTime() - 3600000), NOW, [["Ben", "going"]]);
    addEvent(c, "Starts in a minute", new Date(NOW.getTime() + 60000), new Date(NOW.getTime() + 3600000), [["Cy", "going"]]);
    const v = view(c);
    expect(who(v.here)).toEqual(["Ada Quill"]);
    expect(who(v.upcoming)).toEqual(["Cy Quill"]);
  });

  it("leaves out an event that ended, a cancelled one, one on another day and a waiting-list place", async () => {
    const c = await club();
    addEvent(c, "Over", at(0, 9), at(0, 11), [["Ada", "going"], ["Ben", "attended"]]);
    addEvent(c, "Called off", at(0, 12), at(0, 14), [["Cy", "going"]], "cancelled");
    addEvent(c, "Tomorrow", at(1, 12), at(1, 14), [["Dee", "going"]]);
    addEvent(c, "Full", at(0, 18), at(0, 19), [["Eli", "waitlisted"]]);
    expect(view(c).here).toEqual([]);
    expect(view(c).upcoming).toEqual([]);
  });

  it("puts a member with a class and an event on one row, soonest first, with each kind of thing tagged", async () => {
    const c = await club();
    addEvent(c, "Evening Talk", at(0, 18), at(0, 19), [["Ada", "going"]]);
    addClass(c, "Yoga", at(0, 15), at(0, 16), [["Ada", "enrolled"]]);
    const row = view(c).upcoming[0];
    expect(row.what).toEqual([{ title: "Yoga", category: "Class" }, { title: "Evening Talk", category: "Event" }]);
  });

  it("lists only members: the guests someone brings are not members and are not listed or counted", async () => {
    const c = await club();
    const e = addEvent(c, "Coffee Hour", at(0, 12), at(0, 14), [["Ada", "going"]]);
    c.state.rsvps.find((r) => r.eventId === e.id)!.guests = 4;
    const v = view(c);
    expect(who(v.here)).toEqual(["Ada Quill"]);
    expect(v.summary.total).toBe(1);
  });

  it("does not list someone who has left or whose household ended, though the RSVP is still on the event", async () => {
    const c = await club();
    addEvent(c, "Coffee Hour", at(0, 12), at(0, 14), [["Ada", "going"], ["Dee", "going"]]);
    c.state.members.find((m) => m.id === c.f.m.Ada)!.status = "removed";
    c.state.households.find((h) => h.id === c.f.h.Reed)!.status = "ended";
    c.state.members.filter((m) => m.householdId === c.f.h.Reed).forEach((m) => (m.status = "household_ended"));
    expect(view(c).here).toEqual([]);
  });

  it("shows no event time either, only the day and the time the figures were worked out", async () => {
    const c = await club();
    addEvent(c, "Coffee Hour", at(0, 12, 15), at(0, 14, 45), [["Ada", "going"]]);
    addEvent(c, "Evening Talk", at(0, 17, 30), at(0, 19), [["Ben", "going"]]);
    const { asOf, asOfClock, ...rest } = view(c);
    void asOf;
    void asOfClock;
    const text = JSON.stringify(rest);
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/T\d{2}:/);
  });
});

describe("when the say-hello notes are on", () => {
  const start = "2026-07-01";

  it("is on for a test version whatever the rules say, because the invented club has its own history", () => {
    expect(helloNotesOn({ ...TODAY_RULES, historyStartsOn: null }, TODAY, true)).toBe(true);
    expect(helloNotesOn({ ...TODAY_RULES, historyStartsOn: TODAY }, TODAY, true)).toBe(true);
  });

  it("is off on a real server while the day the records began is not set", () => {
    expect(helloNotesOn({ ...TODAY_RULES, historyStartsOn: null }, TODAY, false)).toBe(false);
    expect(helloNotesOn({ ...TODAY_RULES, historyStartsOn: null }, "2030-01-01", false)).toBe(false);
  });

  it("turns on exactly 90 days after the records began, and not a day before", () => {
    const rules: TodayRules = { ...TODAY_RULES, historyStartsOn: start };
    expect(rules.defaults.helloAfterHistoryDays).toBe(90);
    expect(helloNotesOn(rules, addDays(start, 89), false)).toBe(false);
    expect(helloNotesOn(rules, addDays(start, 90), false)).toBe(true);
    expect(helloNotesOn(rules, addDays(start, 400), false)).toBe(true);
  });

  it("is off before the records began, and on the day itself", () => {
    const rules: TodayRules = { ...TODAY_RULES, historyStartsOn: start };
    expect(helloNotesOn(rules, addDays(start, -1), false)).toBe(false);
    expect(helloNotesOn(rules, start, false)).toBe(false);
  });

  it("follows the number of days in the rules file, not a number written in the code", () => {
    const rules: TodayRules = { ...TODAY_RULES, historyStartsOn: start, defaults: { ...TODAY_RULES.defaults, helloAfterHistoryDays: 30 } };
    expect(helloNotesOn(rules, addDays(start, 29), false)).toBe(false);
    expect(helloNotesOn(rules, addDays(start, 30), false)).toBe(true);
  });

  it("tells staff in one line why the notes are off, with the day they switch on once the start is set", () => {
    expect(helloOffWords({ ...TODAY_RULES, historyStartsOn: null })).toBe("The say-hello notes are switched off until the club's own records cover 90 days. The day the records began has not been set yet.");
    expect(helloOffWords({ ...TODAY_RULES, historyStartsOn: "2026-12-01" })).toBe("The say-hello notes are switched off until the club's own records cover 90 days. They switch on Mar 1, 2027.");
  });

  it("with the notes off, no row carries one, even for a rare visitor and a new member, and the lists are otherwise the same", async () => {
    const c = await club();
    c.state.households.find((h) => h.id === c.f.h.Reed)!.joinedOn = addDays(TODAY, -3);
    addBooking(c, "Ada", "Heron", at(0, 12), at(0, 14));
    addBooking(c, "Dee", "Osprey", at(0, 15), at(0, 16));
    const on = todayAtTheClub(c.state, NOW, TODAY_RULES, ATTENDANCE_RULES);
    const off = todayAtTheClub(c.state, NOW, TODAY_RULES, ATTENDANCE_RULES, { hello: false });
    expect(on.helloOn).toBe(true);
    expect(on.here[0].hello?.kind).toBe("rare");
    expect(on.upcoming[0].hello?.kind).toBe("new");
    expect(off.helloOn).toBe(false);
    expect([...off.here, ...off.upcoming].map((r) => r.hello)).toEqual([null, null]);
    expect(off.summary).toEqual(on.summary);
    expect(off.here.map((r) => [r.name, r.what])).toEqual(on.here.map((r) => [r.name, r.what]));
    expect(off.upcoming.map((r) => [r.name, r.what])).toEqual(on.upcoming.map((r) => [r.name, r.what]));
  });

  it("is on unless told otherwise", async () => {
    const c = await club();
    expect(view(c).helloOn).toBe(true);
  });
});

describe("the warm hello note", () => {
  const rules = TODAY_RULES;
  const longAgo = "2020-01-01";
  const day = (n: number) => addDays(TODAY, n);

  it("wears exactly Grant's words, never a number, a score or a label like at-risk", () => {
    expect(HELLO_WORDS.rare).toBe("Say hello — first visit in a while");
    expect(HELLO_WORDS.new).toBe("New member — say hello");
    for (const words of Object.values(HELLO_WORDS)) {
      expect(words).not.toMatch(/\d/);
      expect(words).not.toMatch(/risk|score|visits|low|inactive|churn/i);
    }
  });

  describe("by the rules, on plain history", () => {
    const visits = (...daysAgo: number[]) => ({ visitDays: daysAgo.map((n) => day(-n)), hasEarlierRecord: true });
    const flag = (joinedOn: string, history: { visitDays: string[]; hasEarlierRecord: boolean }) => helloFor(joinedOn, history, TODAY, rules)?.kind ?? null;

    it("is rare for someone with no completed visit in 60 days or more, and not at 59", () => {
      expect(flag(longAgo, visits(60, 70))).toBe("rare");
      expect(flag(longAgo, visits(59, 70))).toBeNull();
      expect(flag(longAgo, visits(1, 2))).toBeNull();
    });

    it("is rare for someone with fewer than 2 visits in the last 90 days, counting the 90th day back as outside", () => {
      expect(flag(longAgo, visits(5))).toBe("rare");
      expect(flag(longAgo, visits(5, 89))).toBeNull();
      expect(flag(longAgo, visits(5, 90))).toBe("rare");
      expect(flag(longAgo, visits(5, 6))).toBeNull();
    });

    it("is rare for someone who has never completed a visit, as long as they are not new", () => {
      expect(flag(longAgo, { visitDays: [], hasEarlierRecord: true })).toBe("rare");
    });

    it("is new for a household that joined in the last 30 days, and not at 30", () => {
      expect(flag(day(0), visits(1, 2, 3))).toBe("new");
      expect(flag(day(-29), visits(1, 2, 3))).toBe("new");
      expect(flag(day(-30), visits(1, 2, 3))).toBeNull();
    });

    it("is new for a first-ever booking, when the records cover their whole membership (joined within 90 days)", () => {
      const nothingBefore = { visitDays: [], hasEarlierRecord: false };
      expect(flag(day(-45), nothingBefore)).toBe("new");
      expect(flag(day(-89), nothingBefore)).toBe("new");
      // Joined long ago, so the records may simply not reach back far enough: not called new, just not seen in a while.
      expect(flag(day(-90), nothingBefore)).toBe("rare");
      expect(flag(longAgo, nothingBefore)).toBe("rare");
    });

    it("someone who has booked before is not a first-ever booking, even if they never came", () => {
      expect(flag(day(-45), { visitDays: [], hasEarlierRecord: true })).toBe("rare");
    });

    it("new wins over rare, and a regular who is not new has no note", () => {
      expect(flag(day(-5), { visitDays: [], hasEarlierRecord: false })).toBe("new");
      expect(flag(longAgo, visits(3, 10, 20))).toBeNull();
    });

    it("follows the numbers in the rules file, not numbers written in the code", () => {
      const strict: TodayRules = { placeholder: true, historyStartsOn: null, defaults: { ...rules.defaults, noVisitDays: 10, fewVisitsBelow: 3, newMemberDays: 5, fewVisitsDays: 30 } };
      expect(helloFor(longAgo, visits(10, 11, 12), TODAY, strict)?.kind).toBe("rare");
      expect(helloFor(longAgo, visits(9, 10, 11), TODAY, strict)).toBeNull();
      expect(helloFor(longAgo, visits(1, 2), TODAY, strict)?.kind).toBe("rare"); // two is fewer than three
      expect(helloFor(longAgo, visits(1, 2, 31), TODAY, strict)?.kind).toBe("rare"); // the 31st day back is outside 30
      expect(helloFor(day(-4), visits(1, 2, 3), TODAY, strict)?.kind).toBe("new");
      expect(helloFor(day(-5), visits(1, 2, 3), TODAY, strict)).toBeNull();
    });
  });

  describe("from the club's own records", () => {
    /** Ada is here now (a boat under way) and the test gives her a history; her household joined long ago unless said. */
    async function adaWith(history: (c: Club) => void, joinedOn = longAgo) {
      const c = await club();
      c.state.households.find((h) => h.id === c.f.h.Quill)!.joinedOn = joinedOn;
      history(c);
      addBooking(c, "Ada", "Heron", at(0, 12), at(0, 14));
      return view(c).here.find((r) => r.name === "Ada Quill")!;
    }

    it("flags a rare visitor in both lists, with the same words", async () => {
      const c = await club();
      addBooking(c, "Ada", "Heron", at(0, 12), at(0, 14));
      addBooking(c, "Ada", "Dock slip A", at(0, 16), at(0, 17));
      addBooking(c, "Ben", "Osprey", at(0, 12), at(0, 14));
      addBooking(c, "Ben", "Kingfisher", at(0, 16), at(0, 17));
      for (const day of [-3, -9, -20]) addBooking(c, "Ben", "Loon", at(day, 8), at(day, 9), "completed");
      const v = view(c);
      expect(v.here.find((r) => r.name === "Ada Quill")!.hello).toEqual({ kind: "rare", words: "Say hello — first visit in a while" });
      expect(v.upcoming.find((r) => r.name === "Ada Quill")!.hello).toEqual({ kind: "rare", words: "Say hello — first visit in a while" });
      expect(v.here.find((r) => r.name === "Ben Quill")!.hello).toBeNull();
      expect(v.upcoming.find((r) => r.name === "Ben Quill")!.hello).toBeNull();
    });

    it("counts a checked-in boat booking, an attended class and an attended event as visits, on the day they started", async () => {
      expect((await adaWith((c) => { addBooking(c, "Ada", "Osprey", at(-3, 8), at(-3, 9), "completed"); addBooking(c, "Ada", "Osprey", at(-9, 8), at(-9, 9), "completed"); })).hello).toBeNull();
      expect((await adaWith((c) => { addClass(c, "Yoga", at(-3, 8), at(-3, 9), [["Ada", "attended"]]); addClass(c, "Yoga", at(-9, 8), at(-9, 9), [["Ada", "attended"]]); })).hello).toBeNull();
      expect((await adaWith((c) => { addEventRsvp(c, "Ada", at(-3, 18), "attended"); addEventRsvp(c, "Ada", at(-9, 18), "attended"); })).hello).toBeNull();
    });

    it("counts a visit made as crew, not only as the booker", async () => {
      const ada = await adaWith((c) => { addBooking(c, "Ben", "Loon", at(-3, 8), at(-3, 9), "completed", ["Ada"]); addBooking(c, "Ben", "Loon", at(-9, 8), at(-9, 9), "completed", ["Ada"]); });
      expect(ada.hello).toBeNull();
    });

    it("counts a club room or work space booking that is over and was not cancelled, because nobody ever checks in for those", async () => {
      expect((await adaWith((c) => { addBooking(c, "Ada", "Clubhouse room", at(-3, 8), at(-3, 9)); addBooking(c, "Ada", "Work table", at(-9, 8), at(-9, 9)); })).hello).toBeNull();
      // A boat booking that nobody checked in for is not a visit (the running app marks it a no-show; here it is left as it was written).
      expect((await adaWith((c) => { addBooking(c, "Ada", "Osprey", at(-3, 8), at(-3, 9)); addBooking(c, "Ada", "Osprey", at(-9, 8), at(-9, 9)); })).hello?.kind).toBe("rare");
    });

    it("does not count a no-show, a cancellation, a class never attended or an event nobody marked", async () => {
      const ada = await adaWith((c) => {
        addBooking(c, "Ada", "Osprey", at(-3, 8), at(-3, 9), "no_show");
        addBooking(c, "Ada", "Osprey", at(-4, 8), at(-4, 9), "cancelled");
        addBooking(c, "Ada", "Osprey", at(-5, 8), at(-5, 9), "late_cancelled");
        addClass(c, "Yoga", at(-6, 8), at(-6, 9), [["Ada", "no_show"]]);
        addClass(c, "Yoga", at(-7, 8), at(-7, 9), [["Ada", "cancelled"]]);
        addEventRsvp(c, "Ada", at(-8, 18), "going");
        addEventRsvp(c, "Ada", at(-9, 18), "no_show");
      });
      expect(ada.hello?.kind).toBe("rare");
    });

    it("leaves today out: a rare visitor who has just checked in is still flagged, and a visit earlier today does not help", async () => {
      expect((await adaWith((c) => addBooking(c, "Ada", "Osprey", at(0, 6), at(0, 7), "completed"))).hello?.kind).toBe("rare");
      expect((await adaWith((c) => addBooking(c, "Ada", "Osprey", at(0, 12), at(0, 13), "completed"))).hello?.kind).toBe("rare");
      // A visit last night, in Pacific time, is yesterday, though it is already today in UTC.
      const lateLastNight = (c: Club) => addBooking(c, "Ada", "Osprey", new Date("2026-10-28T05:30:00Z"), new Date("2026-10-28T06:30:00Z"), "completed"); // 10:30 pm on the 27th
      expect((await adaWith((c) => { lateLastNight(c); addBooking(c, "Ada", "Osprey", at(-2, 8), at(-2, 9), "completed"); })).hello).toBeNull();
    });

    it("flags a household that joined this month as new, and one that has never booked before as new while the records cover them", async () => {
      expect((await adaWith(() => undefined, day(-10))).hello).toEqual({ kind: "new", words: "New member — say hello" });
      expect((await adaWith(() => undefined, day(-60))).hello?.kind).toBe("new"); // first-ever booking
      expect((await adaWith((c) => addBooking(c, "Ada", "Osprey", at(-5, 8), at(-5, 9), "cancelled"), day(-60))).hello?.kind).toBe("rare"); // booked before, never came
    });

    it("gives the note per person: two adults of one household can differ", async () => {
      const c = await club();
      for (const d of [-2, -8]) addBooking(c, "Ben", "Loon", at(d, 8), at(d, 9), "completed");
      addBooking(c, "Ada", "Heron", at(0, 12), at(0, 14));
      addBooking(c, "Ben", "Osprey", at(0, 12), at(0, 14));
      const v = view(c);
      expect(v.here.map((r) => [r.name, r.hello?.kind ?? null])).toEqual([["Ada Quill", "rare"], ["Ben Quill", null]]);
    });
  });
});

/* ---------- The real engine, on both stores ---------- */

describe.each(STORE_KINDS)("today at the club from the real records on the %s store", (kind) => {
  it("tells the whole story of a day: under way, checked in, still to come, finished, and who to say hello to", async () => {
    const f = await buildFixtureSettling(kind, () => NOW);
    await f.store.transaction(async (s, id) => {
      s.items.push({ id: id(), name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
    });
    const gym = (await f.store.read()).items.find((i) => i.name === "Boathouse gym")!.id;
    const yesterday = at(-1, 12);

    // Dee's two earlier visits, and Ben's one: boat bookings made in advance, then checked in by staff.
    for (const [who, item, day] of [["Dee", "Heron", -10], ["Dee", "Heron", -30], ["Ben", "Osprey", -10]] as const) {
      const made = await bookAs(f, who, item, at(day, 8), at(day, 9), [], undefined, at(day - 1, 12));
      await mark(f.store, staffCtx(), "booking", made.booking.id, "attended");
    }

    // Today. Ada's single is under way. Eli's double, with Ben as crew, has been checked in on a phone. Ben has a single for later.
    // Cy's kayak ended this morning with nobody checked in, and Dee's single for the afternoon was cancelled: neither is in a list.
    await bookAs(f, "Ada", "Heron", at(0, 12), at(0, 13, 30), [], undefined, yesterday);
    const loon = await bookAs(f, "Eli", "Loon", at(0, 12, 30), at(0, 13, 30), ["Ben"], undefined, yesterday);
    await memberCheckIn(f.store, memberCtx(f.m.Eli, "Eli", NOW), ATTENDANCE_RULES, { kind: "booking", id: loon.booking.id, via: "phone" });
    await bookAs(f, "Ben", "Osprey", at(0, 14), at(0, 15), [], undefined, yesterday);
    await bookAs(f, "Cy", "Otter", at(0, 7), at(0, 8), [], undefined, yesterday);
    const dropped = await bookAs(f, "Dee", "Osprey", at(0, 16), at(0, 17), [], undefined, yesterday);
    await cancelBooking(f.store, f.book, memberCtx(f.m.Dee, "Dee"), dropped.booking.id);

    // Classes: Dee is in Yoga, under way; Ada has a later one.
    const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(yesterday), { name: "Morning Yoga", defaultCapacity: 8, defaultMinutes: 60, roomItemId: gym });
    const [under] = await scheduleSessions(f.store, f.book, staffCtx(yesterday), { classId: yoga.id, startsAt: at(0, 12, 30) });
    const [later] = await scheduleSessions(f.store, f.book, staffCtx(yesterday), { classId: yoga.id, startsAt: at(0, 15) });
    await signUp(f.store, f.book, CLASS_RULES, staffCtx(yesterday), { sessionId: under.id, memberId: f.m.Dee });
    await signUp(f.store, f.book, CLASS_RULES, staffCtx(yesterday), { sessionId: later.id, memberId: f.m.Ada });

    const v = todayAtTheClub(await f.store.read(), NOW, TODAY_RULES, ATTENDANCE_RULES);
    expect(v.heading).toBe("Wednesday, October 28");
    expect(v.summary.words).toBe("6 reservations today — 4 boats, 2 class places");
    const shape = (rows: TodayView["here"]) => rows.map((r) => [r.name, r.what.map((w) => `${w.title} (${w.category})`), r.hello?.kind ?? null]);
    expect(shape(v.here)).toEqual([
      ["Ada Quill", ["Heron (Boat)"], "rare"],
      ["Ben Quill", ["Loon (Boat)"], "rare"],
      ["Dee Reed", ["Morning Yoga (Class)"], null],
      ["Eli Reed", ["Loon (Boat)"], "rare"],
    ]);
    expect(shape(v.upcoming)).toEqual([
      ["Ben Quill", ["Osprey (Boat)"], "rare"],
      ["Ada Quill", ["Morning Yoga (Class)"], "rare"],
    ]);
  });

  it("lists a member going to an event made through the real engine: under way is here, a later one is upcoming, and both are counted", async () => {
    const f = await buildFixtureSettling(kind, () => NOW);
    const yesterday = at(-1, 12);
    const coffee = await createEvent(f.store, staffCtx(yesterday), { title: "Coffee Hour", startsAt: at(0, 12, 30), endsAt: at(0, 14), capacity: 20 });
    const talk = await createEvent(f.store, staffCtx(yesterday), { title: "Evening Talk", startsAt: at(0, 17, 30), endsAt: at(0, 19), capacity: 20 });
    await rsvp(f.store, EVENT_RULES, staffCtx(yesterday), { eventId: coffee.id, memberId: f.m.Cy, guests: 2 });
    await rsvp(f.store, EVENT_RULES, staffCtx(yesterday), { eventId: talk.id, memberId: f.m.Ada, guests: 0 });
    const v = todayAtTheClub(await f.store.read(), NOW, TODAY_RULES, ATTENDANCE_RULES);
    expect(v.summary.words).toBe("2 reservations today — 2 event RSVPs");
    expect(v.here.map((r) => [r.name, r.what])).toEqual([["Cy Quill", [{ title: "Coffee Hour", category: "Event" }]]]);
    expect(v.upcoming.map((r) => [r.name, r.what])).toEqual([["Ada Quill", [{ title: "Evening Talk", category: "Event" }]]]);
  });

  it("changes nothing in the club's records by looking", async () => {
    const f = await buildFixtureSettling(kind, () => NOW);
    await bookAs(f, "Ada", "Heron", at(0, 12), at(0, 14), [], undefined, at(-1, 12));
    const before = JSON.stringify(await f.store.read());
    todayAtTheClub(await f.store.read(), NOW, TODAY_RULES, ATTENDANCE_RULES);
    todayAtTheClub(await f.store.read(), at(0, 15), TODAY_RULES, ATTENDANCE_RULES);
    expect(JSON.stringify(await f.store.read())).toBe(before);
  });

  it("moves a booking from upcoming to here to gone as the clock runs", async () => {
    let clock = NOW;
    const f = await buildFixtureSettling(kind, () => clock);
    await bookAs(f, "Ada", "Heron", at(0, 14), at(0, 15), [], undefined, at(-1, 12));
    const at_ = async (t: Date) => {
      clock = t;
      const v = todayAtTheClub(await f.store.read(), t, TODAY_RULES, ATTENDANCE_RULES);
      return [who(v.here), who(v.upcoming)];
    };
    expect(await at_(at(0, 13))).toEqual([[], ["Ada Quill"]]);
    expect(await at_(at(0, 14, 30))).toEqual([["Ada Quill"], []]);
    expect(await at_(at(0, 15, 1))).toEqual([[], []]);
  });
});
