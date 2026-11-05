import { describe, expect, it } from "vitest";
import type { Mailer, OutgoingMail } from "../auth/mail";
import { cancelBooking, takeOutOfService } from "../engine/bookings";
import { cancelSession, createClass, leaveClass, scheduleSessions, signUp } from "../engine/classes";
import { fileDamageReport } from "../engine/damage";
import { cancelEvent, cancelRsvp, createEvent, rsvp, updateEvent } from "../engine/events";
import { endHousehold } from "../engine/households";
import { clubLedger } from "../engine/ledger";
import { NO_LINKS } from "../engine/notice-mail";
import { NOW, STORE_KINDS, at, bookAs, fixtureFor, memberCtx, staffCtx, type Fixture } from "../engine/testkit";
import { CLASS_RULES } from "../settings/class-rules";
import { DAMAGE_RULES } from "../settings/damage-rules";
import { EVENT_RULES } from "../settings/event-rules";
import type { EventRules } from "../types";
import { afterResponse } from "./after";
import { notifyingStore, type NotifyDeps } from "./notifying-store";

/**
 * The emails a change sends (Nov 5, 2026): a spot opened for you (a class or an event), an event cancelled, an event's time or place
 * changed, and a boat you booked taken out of service or reported with major damage. Each scenario goes through the real engine
 * on both stores, with the club store wrapped the way the running server wraps it, and a mailer that only writes things down.
 *
 * Today is Wed Oct 28, 1 pm. The usual event is "Dinner", Sat Oct 31, 6 to 9 pm: cancelling is late inside 48 hours (after
 * Thu 6 pm) and the waiting list moves up by itself until two hours before (Sat 4 pm).
 */

/** Holds off the one-hour waiting-list hold so a waiting place lasts as long as a test needs. */
const RULES: EventRules = { placeholder: true, defaults: { ...EVENT_RULES.defaults, waitlistHoldMinutes: 0 } };

interface Harness {
  f: Fixture;
  store: ReturnType<typeof notifyingStore>;
  sent: OutgoingMail[];
  logged: string[];
  clock: { now: Date };
}

/** A club store with a mailer that keeps what it was asked to send. `clock.now` is "now" for the notice rules; the engine calls take their own. */
async function harness(kind: (typeof STORE_KINDS)[number], over: Partial<NotifyDeps> = {}): Promise<Harness> {
  const f = await fixtureFor(kind)();
  const sent: OutgoingMail[] = [];
  const logged: string[] = [];
  const clock = { now: NOW };
  const mailer: Mailer = {
    async send(mail) {
      sent.push(mail);
    },
  };
  const store = notifyingStore(f.store, {
    now: () => clock.now,
    rules: { events: RULES, classes: CLASS_RULES },
    mailer: () => mailer,
    links: () => NO_LINKS,
    run: (job) => job(),
    log: (line) => logged.push(line),
    ...over,
  });
  return { f, store, sent, logged, clock };
}

const idOf = (f: Fixture, who: string) => f.m[who] ?? who;
const mkEvent = (h: Harness, over: Record<string, unknown> = {}) => createEvent(h.store, staffCtx(), { title: "Dinner", startsAt: at(3, 18), endsAt: at(3, 21), ...over });
const go = (h: Harness, who: string, eventId: string, guests = 0, now: Date = NOW) => rsvp(h.store, RULES, memberCtx(idOf(h.f, who), who, now), { eventId, memberId: idOf(h.f, who), guests });
const leave = (h: Harness, who: string, rsvpId: string, now: Date = NOW) => cancelRsvp(h.store, RULES, memberCtx(idOf(h.f, who), who, now), rsvpId);
const to = (h: Harness, who: string) => h.sent.filter((m) => m.to === `${who.toLowerCase()}@example.com`);

async function classClub(kind: (typeof STORE_KINDS)[number]) {
  const h = await harness(kind);
  await h.f.store.transaction(async (s, newId) => {
    const id = newId();
    s.items.push({ id, name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
    h.f.i["Boathouse gym"] = id;
  });
  const yoga = await createClass(h.store, h.f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 1, defaultMinutes: 60, roomItemId: h.f.i["Boathouse gym"] });
  const [session] = await scheduleSessions(h.store, h.f.book, staffCtx(), { classId: yoga.id, startsAt: at(1, 9) });
  return { h, session };
}

describe.each(STORE_KINDS)("emails when something changes, on the %s store", (kind) => {
  describe("a spot opened for you: an event", () => {
    it("emails the person the waiting list moves up, and only them, when someone cancels", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h, { capacity: 2, priceCents: 4500, location: "The boathouse" });
      const ada = await go(h, "Ada", e.id, 1);
      await go(h, "Ben", e.id, 0);
      await go(h, "Cy", e.id, 0);
      expect(h.sent).toEqual([]); // joining and waiting tell nobody anything new
      await leave(h, "Ada", ada.rsvp.id);
      expect(h.sent.map((m) => m.to)).toEqual(["ben@example.com", "cy@example.com"]); // two places freed, two people waiting
      const mail = to(h, "Ben")[0];
      expect(mail.subject).toBe("You have a place: Dinner");
      expect(mail.text).toContain("Hello Ben,");
      expect(mail.text).toContain("Saturday, Oct 31, 6:00 to 9:00 pm");
      expect(mail.text).toContain("The boathouse");
      expect(mail.text).toContain("Your party is 1 person.");
      expect(mail.text).toContain("Cost: $45.00 a place, $45.00 for your party");
      expect(mail.text).toContain("You can cancel at no charge until Thursday, Oct 29, 6:00 pm.");
    });

    it("says when the time for cancelling free has already passed", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h, { capacity: 1, priceCents: 4500 });
      const ada = await go(h, "Ada", e.id);
      await go(h, "Ben", e.id);
      const later = new Date(at(3, 18).getTime() - 10 * 3_600_000); // Sat 8 am: inside the 48 hours, before the move-up ends
      h.clock.now = later;
      await rsvpLeave(h, "Ada", ada.rsvp.id, later);
      expect(to(h, "Ben")[0].text).toContain("The time for cancelling at no charge has passed, so cancelling now would still be billed.");
    });

    it("emails when staff raise the limit, and for a party bigger than one", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h, { capacity: 1 });
      await go(h, "Ada", e.id);
      await go(h, "Ben", e.id, 2);
      await updateEvent(h.store, RULES, staffCtx(), e.id, { capacity: 4 });
      const mail = to(h, "Ben")[0];
      expect(mail.text).toContain("Your party is 3 people.");
      expect(h.sent).toHaveLength(1);
    });

    it("does not email someone who simply takes free places after the automatic move-up has ended", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h, { capacity: 1 });
      const ada = await go(h, "Ada", e.id);
      await go(h, "Ben", e.id);
      const late = new Date(at(3, 18).getTime() - 90 * 60_000); // Sat 4:30 pm: the line no longer moves by itself
      h.clock.now = late;
      await rsvpLeave(h, "Ada", ada.rsvp.id, late);
      expect(h.sent).toEqual([]); // nobody was moved up
      await go(h, "Ben", e.id, 0, late); // Ben presses the button himself
      expect(h.sent).toEqual([]); // he knows
    });

    it("emails the person a leaving household makes room for", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h, { capacity: 1 });
      await go(h, "Ada", e.id);
      await go(h, "Dee", e.id);
      await endHousehold(h.store, clubLedger, staffCtx(), h.f.h.Quill);
      expect(h.sent.map((m) => m.to)).toEqual(["dee@example.com"]);
    });

    it("sends nothing for a change that is thrown out", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h, { capacity: 1 });
      await go(h, "Ada", e.id);
      await go(h, "Ben", e.id);
      await expect(
        h.store.transaction(async (s) => {
          for (const r of s.rsvps) if (r.status === "waitlisted") r.status = "going";
          throw new Error("something went wrong after the list moved");
        }),
      ).rejects.toThrow("something went wrong");
      expect(h.sent).toEqual([]);
    });
  });

  describe("a spot opened for you: a class", () => {
    it("emails the person the waiting list moves into the place, with the room and the time", async () => {
      const { h, session } = await classClub(kind);
      const ada = await signUp(h.store, h.f.book, CLASS_RULES, memberCtx(h.f.m.Ada, "Ada"), { sessionId: session.id, memberId: h.f.m.Ada });
      await signUp(h.store, h.f.book, CLASS_RULES, memberCtx(h.f.m.Ben, "Ben"), { sessionId: session.id, memberId: h.f.m.Ben });
      expect(h.sent).toEqual([]);
      await leaveClass(h.store, CLASS_RULES, memberCtx(h.f.m.Ada, "Ada"), ada.signUp.id);
      expect(h.sent).toHaveLength(1);
      const mail = h.sent[0];
      expect(mail.to).toBe("ben@example.com");
      expect(mail.subject).toBe("You have a place: Yoga");
      expect(mail.text).toContain("Thursday, Oct 29, 9:00 to 10:00 am at Boathouse gym");
      expect(mail.text).toContain("please cancel on the class page");
    });

    it("sends nothing for a cancelled class (the class's own cancellation email is a separate one)", async () => {
      const { h, session } = await classClub(kind);
      await signUp(h.store, h.f.book, CLASS_RULES, memberCtx(h.f.m.Ada, "Ada"), { sessionId: session.id, memberId: h.f.m.Ada });
      await signUp(h.store, h.f.book, CLASS_RULES, memberCtx(h.f.m.Ben, "Ben"), { sessionId: session.id, memberId: h.f.m.Ben });
      await cancelSession(h.store, staffCtx(), session.id, { reason: "Instructor ill" });
      expect(h.sent).toEqual([]);
    });
  });

  describe("an event is cancelled", () => {
    it("emails everyone going or waiting, with the reason, and not people who had already cancelled", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h, { capacity: 2, priceCents: 4500, location: "The boathouse" });
      await go(h, "Ada", e.id, 1);
      await go(h, "Ben", e.id);
      const cy = await go(h, "Cy", e.id);
      await leave(h, "Cy", cy.rsvp.id);
      h.sent.length = 0;
      await cancelEvent(h.store, staffCtx(), e.id, { reason: "The venue is closed" });
      expect(h.sent.map((m) => m.to).sort()).toEqual(["ada@example.com", "ben@example.com"]);
      const going = to(h, "Ada")[0];
      expect(going.subject).toBe("Event cancelled: Dinner");
      expect(going.text).toContain("Dinner on Saturday, Oct 31, 6:00 to 9:00 pm at The boathouse has been cancelled.");
      expect(going.text).toContain("Reason: The venue is closed");
      expect(going.text).toContain("You had places for 2 people.");
      expect(going.text).toContain("you will not be billed for them");
      const waiting = to(h, "Ben")[0];
      expect(waiting.text).toContain("You were on the waiting list.");
      expect(waiting.text).toContain("Your place on the waiting list is released.");
    });

    it("sends nothing when somebody who is not staff tries", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h);
      await go(h, "Ada", e.id);
      await expect(cancelEvent(h.store, memberCtx(h.f.m.Ben, "Ben"), e.id, { reason: "No" })).rejects.toThrow();
      expect(h.sent).toEqual([]);
    });
  });

  describe("an event's time or place changes", () => {
    it("emails everyone going or waiting, saying what changed", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h, { capacity: 1, location: "The boathouse" });
      await go(h, "Ada", e.id);
      await go(h, "Ben", e.id, 1);
      await updateEvent(h.store, RULES, staffCtx(), e.id, { startsAt: at(3, 19), endsAt: at(3, 22), location: "The clubhouse" });
      expect(h.sent.map((m) => m.to).sort()).toEqual(["ada@example.com", "ben@example.com"]);
      const going = to(h, "Ada")[0];
      expect(going.subject).toBe("Event changed: Dinner");
      expect(going.text).toContain("Time: now Saturday, Oct 31, 7:00 to 10:00 pm (it was Saturday, Oct 31, 6:00 to 9:00 pm)");
      expect(going.text).toContain("Place: now The clubhouse (it was The boathouse)");
      expect(going.text).toContain("Your place is still held.");
      expect(to(h, "Ben")[0].text).toContain("You are still on the waiting list.");
    });

    it("says only what changed", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h, { location: "The boathouse" });
      await go(h, "Ada", e.id, 2);
      await updateEvent(h.store, RULES, staffCtx(), e.id, { location: "The clubhouse" });
      const text = to(h, "Ada")[0].text;
      expect(text).toContain("Place: now The clubhouse (it was The boathouse)");
      expect(text).not.toContain("Time:");
      expect(text).toContain("Your 3 places are still held.");
    });

    it("sends nothing for a change of price, title, description or limit alone, or for a save that changes nothing", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h, { capacity: 5, location: "The boathouse" });
      await go(h, "Ada", e.id);
      await updateEvent(h.store, RULES, staffCtx(), e.id, { priceCents: 3000, title: "Autumn dinner", description: "Bring a dish", capacity: 8 });
      await updateEvent(h.store, RULES, staffCtx(), e.id, { location: "The boathouse" });
      expect(h.sent).toEqual([]);
    });

    it("tells someone the waiting list moves up in the same change once, with the new details", async () => {
      const h = await harness(kind);
      const e = await mkEvent(h, { capacity: 1, location: "The boathouse" });
      await go(h, "Ada", e.id);
      await go(h, "Ben", e.id);
      await updateEvent(h.store, RULES, staffCtx(), e.id, { capacity: 2, location: "The clubhouse" });
      expect(to(h, "Ada").map((m) => m.subject)).toEqual(["Event changed: Dinner"]);
      expect(to(h, "Ben").map((m) => m.subject)).toEqual(["You have a place: Dinner"]);
      expect(to(h, "Ben")[0].text).toContain("The clubhouse");
    });
  });

  describe("a boat you booked is taken out of service", () => {
    it("emails the booker and the crew of each booking the period touches, and nobody else", async () => {
      const h = await harness(kind);
      await bookAs(h.f, "Ada", "Loon", at(3, 7), at(3, 8), ["Ben"]); // Saturday: inside the period
      await bookAs(h.f, "Dee", "Heron", at(3, 7), at(3, 8)); // another boat
      await bookAs(h.f, "Eli", "Loon", at(7, 7), at(7, 8)); // after the period ends
      await bookAs(h.f, "Eli", "Osprey", at(3, 7), at(3, 8)); // the same morning, another boat
      await takeOutOfService(h.store, staffCtx(), h.f.i.Loon, { until: at(5, 12), reason: "Rigger bent", expectedReturn: "2026-11-03" });
      expect(h.sent.map((m) => m.to).sort()).toEqual(["ada@example.com", "ben@example.com"]);
      const mail = to(h, "Ada")[0];
      expect(mail.subject).toBe("Boat out of service: Loon");
      expect(mail.text).toContain("Loon has been taken out of service.");
      expect(mail.text).toContain("Reason: Rigger bent");
      expect(mail.text).toContain("- Saturday, Oct 31, 7:00 to 8:00 am");
      expect(mail.text).toContain("Please check with club staff before you go.");
      expect(to(h, "Ben")[0].text).toContain("- Saturday, Oct 31, 7:00 to 8:00 am");
    });

    it("lists a member's bookings together in one email, and skips a booking that was cancelled", async () => {
      const h = await harness(kind);
      await bookAs(h.f, "Ada", "Heron", at(3, 7), at(3, 8));
      const second = await bookAs(h.f, "Ada", "Heron", at(4, 7), at(4, 8));
      await cancelBooking(h.f.store, h.f.book, memberCtx(h.f.m.Ada, "Ada"), second.booking.id); // a limit of two held at once: free one, then add another
      await bookAs(h.f, "Ada", "Heron", at(5, 7), at(5, 8));
      await takeOutOfService(h.store, staffCtx(), h.f.i.Heron, { reason: "Hull repair" });
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0].text).toContain("- Saturday, Oct 31, 7:00 to 8:00 am");
      expect(h.sent[0].text).toContain("- Monday, Nov 2, 7:00 to 8:00 am");
      expect(h.sent[0].text).not.toContain("Sunday, Nov 1");
      expect(h.sent[0].text).toContain("It is out of service until club staff return it to service.");
    });

    it("sends nothing when no booking is touched", async () => {
      const h = await harness(kind);
      await takeOutOfService(h.store, staffCtx(), h.f.i.Heron, { reason: "Hull repair" });
      expect(h.sent).toEqual([]);
    });
  });

  describe("a boat you booked has major damage reported", () => {
    const report = (h: Harness, who: string, item: string, major: boolean) =>
      fileDamageReport(h.store, memberCtx(h.f.m[who], who), DAMAGE_RULES, { itemId: h.f.i[item], description: "Bow rigger is bent", location: "Bow", major });

    it("emails the people with upcoming bookings the same words the boat's page shows, but not the person who filed it", async () => {
      const h = await harness(kind);
      await bookAs(h.f, "Dee", "Heron", at(3, 9), at(3, 10));
      await bookAs(h.f, "Eli", "Heron", at(4, 9), at(4, 10)); // Eli files the report below
      await report(h, "Eli", "Heron", true);
      expect(h.sent.map((m) => m.to)).toEqual(["dee@example.com"]);
      const mail = h.sent[0];
      expect(mail.subject).toBe("Check before you go: Heron has damage reported");
      expect(mail.text).toContain('Major damage reported on Oct 28, 2026: "Bow rigger is bent" (Bow). Check with club staff before you use it.');
      expect(mail.text).toContain("- Saturday, Oct 31, 9:00 to 10:00 am");
    });

    it("sends nothing for minor damage", async () => {
      const h = await harness(kind);
      await bookAs(h.f, "Dee", "Heron", at(3, 9), at(3, 10));
      await report(h, "Cy", "Heron", false);
      expect(h.sent).toEqual([]);
    });

    it("does not say it twice to someone already told the boat is out of service for their booking", async () => {
      const h = await harness(kind);
      await bookAs(h.f, "Dee", "Heron", at(3, 9), at(3, 10));
      await takeOutOfService(h.store, staffCtx(), h.f.i.Heron, { reason: "Hull repair" });
      expect(h.sent).toHaveLength(1); // the out-of-service email
      await report(h, "Cy", "Heron", true);
      expect(h.sent).toHaveLength(1);
    });
  });

  describe("when sending goes wrong", () => {
    it("never undoes or fails the change when the mailer refuses, and still sends the others", async () => {
      const sent: OutgoingMail[] = [];
      const mailer: Mailer = {
        async send(mail) {
          if (mail.to === "ben@example.com") throw new Error("Resend answered 500");
          sent.push(mail);
        },
      };
      const h = await harness(kind, { mailer: () => mailer });
      const e = await mkEvent(h, { capacity: 1 });
      const ada = await go(h, "Ada", e.id);
      await go(h, "Ben", e.id);
      await go(h, "Cy", e.id);
      await expect(updateEvent(h.store, RULES, staffCtx(), e.id, { capacity: 3 })).resolves.toBeDefined();
      expect(sent.map((m) => m.to)).toEqual(["cy@example.com"]);
      expect(h.logged).toEqual(['Could not email a "event_spot" notice: Resend answered 500']);
      // The change itself was saved.
      const state = await h.f.store.read();
      expect(state.rsvps.filter((r) => r.eventId === e.id && r.status === "going")).toHaveLength(3);
      expect(ada.rsvp.status).toBe("going");
    });

    it("sends nothing, and fails nothing, when nobody is switched on to send", async () => {
      const h = await harness(kind, { mailer: () => null });
      const e = await mkEvent(h, { capacity: 1 });
      const ada = await go(h, "Ada", e.id);
      await go(h, "Ben", e.id);
      await expect(leave(h, "Ada", ada.rsvp.id)).resolves.toBeDefined();
      expect(h.sent).toEqual([]);
    });

    it("hands the sending to the runner and lets the change finish first", async () => {
      const jobs: (() => Promise<void>)[] = [];
      const h = await harness(kind, { run: async (job) => void jobs.push(job) });
      const e = await mkEvent(h, { capacity: 1 });
      const ada = await go(h, "Ada", e.id);
      await go(h, "Ben", e.id);
      await leave(h, "Ada", ada.rsvp.id);
      expect(h.sent).toEqual([]); // nothing has gone out yet
      expect(jobs).toHaveLength(1);
      await jobs[0]();
      expect(h.sent.map((m) => m.to)).toEqual(["ben@example.com"]);
    });

    it("tells nobody about a change it could not understand, and says so in the log", async () => {
      const h = await harness(kind, { rules: { events: undefined as unknown as EventRules, classes: CLASS_RULES } });
      const e = await mkEvent(h, { capacity: 1 });
      const ada = await go(h, "Ada", e.id);
      await go(h, "Ben", e.id);
      await expect(leave(h, "Ada", ada.rsvp.id)).resolves.toBeDefined();
      expect(h.sent).toEqual([]);
      expect(h.logged.some((l) => l.startsWith("Could not work out who to email about a change"))).toBe(true);
    });
  });

  it("carries the club's reading through untouched", async () => {
    const h = await harness(kind);
    expect(await h.store.read()).toEqual(await h.f.store.read());
  });
});

describe("afterResponse", () => {
  it("runs the job at once when there is no response to wait for (the tests, a script)", async () => {
    let ran = false;
    await afterResponse(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

/** Leaving with a moment of its own (the harness's `leave` uses today's). */
async function rsvpLeave(h: Harness, who: string, rsvpId: string, now: Date) {
  return cancelRsvp(h.store, RULES, memberCtx(idOf(h.f, who), who, now), rsvpId);
}
