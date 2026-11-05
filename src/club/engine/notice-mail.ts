import type { OutgoingMail } from "../auth/mail";
import { formatClock, formatDay, formatDayLong, formatRange, pacificDate } from "../time";
import { formatMoney } from "./billing-words";
import type { BookingLine, Notice } from "./notices";

/**
 * The words of the emails the club sends when something changes (Nov 5, 2026). Plain text, one person at a time, written so each
 * email stands on its own: it says what happened, to whose place, what (if anything) to do, and how to reach the club.
 *
 * Replies go to the club's membership address (the real sender's reply-to), so every email ends the same way.
 */

/** Where the links in an email point. Both parts are optional: with no site address or no secret the email just leaves the link out. */
export interface MailLinks {
  /** The site's own address, like https://club.example.org, or null when none is set (a test build). */
  site: string | null;
  /** One adult's personal link for one event (a click to see or cancel their RSVP), or null where there is no link secret. */
  rsvp: (eventId: string, memberId: string) => string | null;
}

export const NO_LINKS: MailLinks = { site: null, rsvp: () => null };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Thursday, Oct 29, 5:00 to 6:00 pm". */
export function whenWords(startsAt: string, endsAt: string): string {
  return `${formatDayLong(pacificDate(new Date(startsAt)))}, ${formatRange(startsAt, endsAt)}`;
}

/** "Wednesday, Oct 28, 6:00 pm". */
export function momentWords(iso: string): string {
  return `${formatDayLong(pacificDate(new Date(iso)))}, ${formatClock(iso)}`;
}

const SIGN_OFF = ["Reply to this email or ask club staff if you have questions.", "", "College Club Seattle"];

const page = (links: MailLinks, path: string): string | null => (links.site ? `${links.site}${path}` : null);

const bookingLines = (bookings: BookingLine[]) => bookings.map((b) => `- ${whenWords(b.startsAt, b.endsAt)}`);

/** The one email a notice calls for. */
export function noticeMail(notice: Notice, links: MailLinks = NO_LINKS): OutgoingMail {
  const hello = `Hello ${notice.to.firstName},`;
  const to = notice.to.email;

  switch (notice.kind) {
    case "class_spot": {
      const link = page(links, `/club/classes/${notice.sessionId}`);
      return {
        to,
        subject: `You have a place: ${notice.className}`,
        text: [
          hello,
          "",
          `A place has opened up in ${notice.className}, and the waiting list has moved you in.`,
          "",
          `${whenWords(notice.startsAt, notice.endsAt)}${notice.roomName ? ` at ${notice.roomName}` : ""}`,
          "",
          "You do not need to do anything to keep it. If you cannot come, please cancel on the class page so the next person can have your place.",
          ...(link ? ["", link] : []),
          "",
          ...SIGN_OFF,
        ].join("\n"),
      };
    }

    case "event_spot": {
      const link = links.rsvp(notice.eventId, notice.to.memberId);
      const priced = notice.priceCents !== null && notice.priceCents > 0;
      const cost = priced
        ? [
            `Cost: ${formatMoney(notice.priceCents!)} a place, ${formatMoney(notice.priceCents! * notice.party)} for your party, added to your household's bill with your dues.`,
            notice.cancelFreeUntil
              ? `You can cancel at no charge until ${momentWords(notice.cancelFreeUntil)}.`
              : "The time for cancelling at no charge has passed, so cancelling now would still be billed.",
          ]
        : [];
      return {
        to,
        subject: `You have a place: ${notice.title}`,
        text: [
          hello,
          "",
          `A place has opened up at ${notice.title}, and the waiting list has moved you in. Your party is ${plural(notice.party, "person", "people")}.`,
          "",
          whenWords(notice.startsAt, notice.endsAt),
          ...(notice.location ? [notice.location] : []),
          ...(cost.length ? ["", ...cost] : []),
          "",
          link ? "If you cannot come, please cancel your RSVP so the next person can have your places:" : "If you cannot come, please cancel your RSVP on the event page so the next person can have your places.",
          ...(link ? [link] : []),
          "",
          ...SIGN_OFF,
        ].join("\n"),
      };
    }

    case "event_cancelled": {
      const billed = !notice.wasWaiting && notice.priceCents !== null && notice.priceCents > 0;
      const released = notice.wasWaiting
        ? "Your place on the waiting list is released."
        : billed
          ? "Your places are released, and you will not be billed for them."
          : "Your places are released.";
      return {
        to,
        subject: `Event cancelled: ${notice.title}`,
        text: [
          hello,
          "",
          `${notice.title} on ${whenWords(notice.startsAt, notice.endsAt)}${notice.location ? ` at ${notice.location}` : ""} has been cancelled.`,
          ...(notice.reason ? ["", `Reason: ${notice.reason}`] : []),
          "",
          notice.wasWaiting ? "You were on the waiting list." : `You had places for ${plural(notice.party, "person", "people")}.`,
          `You do not need to do anything. ${released}`,
          "",
          ...SIGN_OFF,
        ].join("\n"),
      };
    }

    case "event_changed": {
      const link = links.rsvp(notice.eventId, notice.to.memberId);
      const timeChanged = Date.parse(notice.before.startsAt) !== Date.parse(notice.after.startsAt) || Date.parse(notice.before.endsAt) !== Date.parse(notice.after.endsAt);
      const placeChanged = notice.before.location.trim() !== notice.after.location.trim();
      const changes = [
        ...(timeChanged ? [`Time: now ${whenWords(notice.after.startsAt, notice.after.endsAt)} (it was ${whenWords(notice.before.startsAt, notice.before.endsAt)})`] : []),
        ...(placeChanged ? [`Place: now ${notice.after.location || "to be announced"} (it was ${notice.before.location || "not stated"})`] : []),
      ];
      return {
        to,
        subject: `Event changed: ${notice.title}`,
        text: [
          hello,
          "",
          `${notice.title} has changed.`,
          "",
          ...changes,
          "",
          notice.waiting ? "You are still on the waiting list." : notice.party === 1 ? "Your place is still held." : `Your ${notice.party} places are still held.`,
          "If this change means you cannot come, you can cancel your RSVP, or ask club staff:",
          ...(link ? [link] : ["Open the event page in the club app."]),
          "",
          ...SIGN_OFF,
        ].join("\n"),
      };
    }

    case "boat_out_of_service": {
      const link = page(links, "/club/my-bookings");
      const back = notice.until
        ? `It is out of service until ${momentWords(notice.until)}.`
        : notice.expectedReturn
          ? `Club staff expect it back around ${formatDay(notice.expectedReturn)}.`
          : "It is out of service until club staff return it to service.";
      return {
        to,
        subject: `Boat out of service: ${notice.itemName}`,
        text: [
          hello,
          "",
          `${notice.itemName} has been taken out of service.`,
          ...(notice.reason ? ["", `Reason: ${notice.reason}`] : []),
          back,
          "",
          `This affects your ${notice.bookings.length === 1 ? "booking" : "bookings"}:`,
          ...bookingLines(notice.bookings),
          "",
          "Your booking is still on the calendar, but the boat may not be usable then. Please check with club staff before you go. If you would rather cancel, you can do that under My bookings.",
          ...(link ? ["", link] : []),
          "",
          ...SIGN_OFF,
        ].join("\n"),
      };
    }

    case "boat_damage": {
      const link = page(links, "/club/my-bookings");
      return {
        to,
        subject: `Check before you go: ${notice.itemName} has damage reported`,
        text: [
          hello,
          "",
          `${notice.itemName}: ${notice.words}`,
          "",
          `You have ${notice.bookings.length === 1 ? "a booking" : "bookings"} on it:`,
          ...bookingLines(notice.bookings),
          "",
          "Your booking stays on the calendar. If you would rather cancel, you can do that under My bookings.",
          ...(link ? ["", link] : []),
          "",
          ...SIGN_OFF,
        ].join("\n"),
      };
    }
  }
}
