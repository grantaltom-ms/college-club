import { describe, expect, it } from "vitest";
import { noticeMail, momentWords, whenWords, NO_LINKS, type MailLinks } from "./notice-mail";
import type { Notice, Person } from "./notices";

/** The words of each email, in full where it matters, and what a link adds. The people and times are invented. */
const ada: Person = { memberId: "m-ada", firstName: "Ada", email: "ada@example.com" };
const START = "2026-10-31T18:00:00-07:00";
const END = "2026-10-31T21:00:00-07:00";
const LINKS: MailLinks = { site: "https://club.example.org", rsvp: (eventId, memberId) => `https://club.example.org/club/rsvp/${eventId}/${memberId}/tok` };

const eventSpot = (over: Partial<Extract<Notice, { kind: "event_spot" }>> = {}): Notice => ({ kind: "event_spot", to: ada, eventId: "e1", title: "Dinner", startsAt: START, endsAt: END, location: "The boathouse", party: 2, priceCents: 4500, cancelFreeUntil: "2026-10-29T18:00:00-07:00", ...over });

describe("the words of the emails", () => {
  it("writes a moment and a stretch of time the way the rest of the club does", () => {
    expect(whenWords(START, END)).toBe("Saturday, Oct 31, 6:00 to 9:00 pm");
    expect(momentWords("2026-10-29T18:00:00-07:00")).toBe("Thursday, Oct 29, 6:00 pm");
  });

  it("ends every email the same way, so a reply goes to a person", () => {
    const kinds: Notice[] = [
      { kind: "class_spot", to: ada, sessionId: "s1", className: "Yoga", startsAt: START, endsAt: END, roomName: null },
      eventSpot(),
      { kind: "event_cancelled", to: ada, title: "Dinner", startsAt: START, endsAt: END, location: "", reason: "", wasWaiting: false, party: 1, priceCents: null },
      { kind: "event_changed", to: ada, eventId: "e1", title: "Dinner", before: { startsAt: START, endsAt: END, location: "A" }, after: { startsAt: START, endsAt: END, location: "B" }, waiting: false, party: 1 },
      { kind: "boat_out_of_service", to: ada, itemName: "Loon", from: START, until: null, expectedReturn: null, reason: "", bookings: [{ startsAt: START, endsAt: END }] },
      { kind: "boat_damage", to: ada, itemName: "Loon", words: "Major damage reported.", bookings: [{ startsAt: START, endsAt: END }] },
    ];
    for (const n of kinds) {
      const mail = noticeMail(n);
      expect(mail.to).toBe("ada@example.com");
      expect(mail.text.startsWith("Hello Ada,\n")).toBe(true);
      expect(mail.text.endsWith("Reply to this email or ask club staff if you have questions.\n\nCollege Club Seattle"), n.kind).toBe(true);
      expect(mail.subject.length).toBeGreaterThan(0);
    }
  });

  it("says a class place is yours, in which room, with no link when the site has no address", () => {
    const mail = noticeMail({ kind: "class_spot", to: ada, sessionId: "s1", className: "Yoga", startsAt: START, endsAt: END, roomName: "Boathouse gym" });
    expect(mail.text).toContain("Saturday, Oct 31, 6:00 to 9:00 pm at Boathouse gym");
    expect(mail.text).not.toContain("http");
    expect(noticeMail({ kind: "class_spot", to: ada, sessionId: "s1", className: "Yoga", startsAt: START, endsAt: END, roomName: null }).text).not.toContain(" at ");
  });

  it("links to the class page when the site has an address", () => {
    const mail = noticeMail({ kind: "class_spot", to: ada, sessionId: "s1", className: "Yoga", startsAt: START, endsAt: END, roomName: null }, LINKS);
    expect(mail.text).toContain("https://club.example.org/club/classes/s1");
  });

  it("an event place: the cost for the whole party, and when cancelling is free", () => {
    const text = noticeMail(eventSpot()).text;
    expect(text).toContain("Your party is 2 people.");
    expect(text).toContain("Cost: $45.00 a place, $90.00 for your party, added to your household's bill with your dues.");
    expect(text).toContain("You can cancel at no charge until Thursday, Oct 29, 6:00 pm.");
    expect(noticeMail(eventSpot({ party: 1 })).text).toContain("Your party is 1 person.");
  });

  it("an event place with no price says nothing about cost, and one past the free-cancel time says it would be billed", () => {
    expect(noticeMail(eventSpot({ priceCents: null })).text).not.toContain("Cost:");
    expect(noticeMail(eventSpot({ priceCents: 0 })).text).not.toContain("Cost:");
    expect(noticeMail(eventSpot({ cancelFreeUntil: null })).text).toContain("cancelling now would still be billed.");
  });

  it("an event place carries the person's own link only when there is one", () => {
    expect(noticeMail(eventSpot(), LINKS).text).toContain("https://club.example.org/club/rsvp/e1/m-ada/tok");
    expect(noticeMail(eventSpot(), { site: "https://club.example.org", rsvp: () => null }).text).not.toContain("http");
    expect(noticeMail(eventSpot(), NO_LINKS).text).toContain("on the event page");
  });

  it("a cancelled event: the reason, and whether the person had places or a waiting spot", () => {
    const base = { kind: "event_cancelled" as const, to: ada, title: "Dinner", startsAt: START, endsAt: END, location: "The boathouse", reason: "The venue is closed", wasWaiting: false, party: 3, priceCents: 4500 };
    const going = noticeMail(base).text;
    expect(going).toContain("Dinner on Saturday, Oct 31, 6:00 to 9:00 pm at The boathouse has been cancelled.");
    expect(going).toContain("Reason: The venue is closed");
    expect(going).toContain("You had places for 3 people.");
    expect(going).toContain("you will not be billed for them");
    const free = noticeMail({ ...base, priceCents: null }).text;
    expect(free).not.toContain("billed");
    expect(noticeMail({ ...base, reason: "" }).text).not.toContain("Reason:");
    const waiting = noticeMail({ ...base, wasWaiting: true }).text;
    expect(waiting).toContain("You were on the waiting list.");
    expect(waiting).not.toContain("billed");
  });

  it("a changed event lists only what changed, and says whether the place is still held", () => {
    const moved = { startsAt: "2026-10-31T19:00:00-07:00", endsAt: "2026-10-31T22:00:00-07:00" };
    const base = { kind: "event_changed" as const, to: ada, eventId: "e1", title: "Dinner", before: { startsAt: START, endsAt: END, location: "A" }, waiting: false, party: 1 };
    const time = noticeMail({ ...base, after: { ...moved, location: "A" } }).text;
    expect(time).toContain("Time: now Saturday, Oct 31, 7:00 to 10:00 pm (it was Saturday, Oct 31, 6:00 to 9:00 pm)");
    expect(time).not.toContain("Place:");
    expect(time).toContain("Your place is still held.");
    const place = noticeMail({ ...base, after: { startsAt: START, endsAt: END, location: "B" }, party: 3 }).text;
    expect(place).toContain("Place: now B (it was A)");
    expect(place).not.toContain("Time:");
    expect(place).toContain("Your 3 places are still held.");
    expect(noticeMail({ ...base, after: { startsAt: START, endsAt: END, location: "" }, before: { ...base.before, location: "" } , waiting: true }).text).toContain("still on the waiting list");
    expect(noticeMail({ ...base, after: { startsAt: START, endsAt: END, location: "" } }).text).toContain("Place: now to be announced (it was A)");
    expect(noticeMail({ ...base, after: { ...moved, location: "A" } }, LINKS).text).toContain("https://club.example.org/club/rsvp/e1/m-ada/tok");
  });

  it("a boat out of service: the reason, the period, and each booking it touches", () => {
    const base = { kind: "boat_out_of_service" as const, to: ada, itemName: "Loon", from: START, reason: "Rigger bent", bookings: [{ startsAt: START, endsAt: END }, { startsAt: "2026-11-01T07:00:00-08:00", endsAt: "2026-11-01T08:00:00-08:00" }] };
    const until = noticeMail({ ...base, until: "2026-11-03T12:00:00-08:00", expectedReturn: null }).text;
    expect(until).toContain("Loon has been taken out of service.");
    expect(until).toContain("Reason: Rigger bent");
    expect(until).toContain("It is out of service until Tuesday, Nov 3, 12:00 pm.");
    expect(until).toContain("This affects your bookings:");
    expect(until).toContain("- Saturday, Oct 31, 6:00 to 9:00 pm");
    expect(until).toContain("- Sunday, Nov 1, 7:00 to 8:00 am");
    const back = noticeMail({ ...base, until: null, expectedReturn: "2026-11-03", bookings: [base.bookings[0]] }).text;
    expect(back).toContain("Club staff expect it back around");
    expect(back).toContain("This affects your booking:");
    expect(noticeMail({ ...base, until: null, expectedReturn: null, reason: "" }).text).toContain("until club staff return it to service.");
    expect(noticeMail({ ...base, until: null, expectedReturn: null, reason: "" }).text).not.toContain("Reason:");
    expect(noticeMail({ ...base, until: null, expectedReturn: null }, LINKS).text).toContain("https://club.example.org/club/my-bookings");
  });

  it("a damaged boat: the same sentence the boat's page shows, and each booking", () => {
    const mail = noticeMail({ kind: "boat_damage", to: ada, itemName: "Heron", words: 'Major damage reported on Oct 28, 2026: "Bow rigger is bent" (Bow). Check with club staff before you use it.', bookings: [{ startsAt: START, endsAt: END }] });
    expect(mail.subject).toBe("Check before you go: Heron has damage reported");
    expect(mail.text).toContain('Heron: Major damage reported on Oct 28, 2026: "Bow rigger is bent" (Bow). Check with club staff before you use it.');
    expect(mail.text).toContain("You have a booking on it:");
    expect(mail.text).toContain("- Saturday, Oct 31, 6:00 to 9:00 pm");
  });
});
