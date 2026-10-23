import { formatDayLong, formatRange, pacificDate } from "../time";
import type { ClubState } from "../types";
import { holdExpired } from "./events";
import { fullName, memberById } from "./queries";

/**
 * What leaving the club does to a person's future, worked out WITHOUT changing anything, so staff can read it before they
 * press the button. It follows the same rules as the ledgers that really do it (bookingLedger, classLedger, eventLedger),
 * and a test holds the two together: the preview must name exactly what the real step then cancels.
 */

export interface DepartureLine {
  id: string;
  /** "Heron", "Morning Yoga", "Members' Dinner". */
  what: string;
  /** "Thursday, Oct 29, 7 to 8 am". */
  when: string;
  /** The start, for putting lines in time order. */
  startsAt: string;
  /** Whose it is. */
  who: string;
  /** Extra words, such as "on the waiting list" or "party of 3". */
  detail: string;
}

export interface DeparturePreview {
  /** Boat and space bookings that will be cancelled (the person is the booker). */
  bookings: DepartureLine[];
  /** Seats on other people's boats that will be given up; those bookings stay. */
  crewSeats: DepartureLine[];
  /** Class chairs and waiting places that will be cancelled. */
  signUps: DepartureLine[];
  /** Event RSVPs (spots and waitlist places) that will be cancelled. */
  rsvps: DepartureLine[];
  /** Everything counted. */
  total: number;
}

const when = (start: string, end: string) => `${formatDayLong(pacificDate(new Date(start)))}, ${formatRange(start, end)}`;
const nameOf = (state: ClubState, id: string) => fullName(memberById(state, id)!);

export function departurePreview(state: ClubState, memberIds: string[], now: Date): DeparturePreview {
  const leaving = new Set(memberIds);
  const bookings: DepartureLine[] = [];
  const crewSeats: DepartureLine[] = [];
  for (const b of state.bookings) {
    if (b.status !== "upcoming" || Date.parse(b.startsAt) <= now.getTime()) continue;
    const item = state.items.find((i) => i.id === b.itemId)?.name ?? "A booking";
    if (leaving.has(b.bookerId)) {
      bookings.push({ id: b.id, what: item, when: when(b.startsAt, b.endsAt), startsAt: b.startsAt, who: nameOf(state, b.bookerId), detail: b.crew.length > 0 ? `with ${b.crew.length} crew` : "" });
    } else {
      for (const id of b.crew.filter((c) => leaving.has(c))) {
        crewSeats.push({ id: `${b.id}:${id}`, what: item, when: when(b.startsAt, b.endsAt), startsAt: b.startsAt, who: nameOf(state, id), detail: `booked by ${nameOf(state, b.bookerId)}; the booking stays` });
      }
    }
  }

  const signUps: DepartureLine[] = [];
  for (const g of state.signups) {
    if (!leaving.has(g.memberId) || (g.status !== "enrolled" && g.status !== "waitlisted")) continue;
    const session = state.sessions.find((x) => x.id === g.sessionId);
    if (!session || session.status !== "scheduled" || Date.parse(session.startsAt) <= now.getTime()) continue;
    const name = state.classes.find((c) => c.id === session.classId)?.name ?? "A class";
    signUps.push({ id: g.id, what: name, when: when(session.startsAt, session.endsAt), startsAt: session.startsAt, who: nameOf(state, g.memberId), detail: g.status === "waitlisted" ? "on the waiting list" : "has a chair" });
  }

  const rsvps: DepartureLine[] = [];
  for (const r of state.rsvps) {
    if (!leaving.has(r.memberId) || (r.status !== "going" && r.status !== "waitlisted")) continue;
    // A waitlist place whose hour has run out is already gone; the real step removes it first.
    if (holdExpired(r, now)) continue;
    const event = state.events.find((x) => x.id === r.eventId);
    if (!event || event.status !== "scheduled" || Date.parse(event.startsAt) <= now.getTime()) continue;
    rsvps.push({ id: r.id, what: event.title, when: when(event.startsAt, event.endsAt), startsAt: event.startsAt, who: nameOf(state, r.memberId), detail: `${r.status === "waitlisted" ? "on the waitlist" : "going"}, party of ${1 + r.guests}` });
  }

  const byTime = (a: DepartureLine, b: DepartureLine) => a.startsAt.localeCompare(b.startsAt) || a.what.localeCompare(b.what) || a.who.localeCompare(b.who);
  for (const list of [bookings, crewSeats, signUps, rsvps]) list.sort(byTime);
  return { bookings, crewSeats, signUps, rsvps, total: bookings.length + crewSeats.length + signUps.length + rsvps.length };
}
