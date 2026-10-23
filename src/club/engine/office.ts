import { addDays, pacificDate } from "../time";
import type { AttendanceRules, ClubState } from "../types";
import { needsALook, type AttendanceRow } from "./attendance";
import { holdExpired, placesTaken } from "./events";
import { outOfServiceAt } from "./bookings";

/**
 * What staff see first thing: what needs a look, what is on today, what is out of service and what has people waiting.
 * The building comparison: the manager's board by the front desk. Everything here is worked out from the club's records;
 * nothing is stored for it.
 */

export interface OfficeWaiting {
  kind: "class" | "event";
  id: string;
  title: string;
  startsAt: string;
  /** "4 of 4 chairs" or "40 of 40 spots". */
  fullness: string;
  waiting: number;
}

export interface OfficeSummary {
  /** Counts for today on the Pacific clock. Cancelled things are not counted. */
  today: { bookings: number; classes: number; events: number };
  /** Automatic no-shows from the last few days that nobody has looked at. */
  needsLook: AttendanceRow[];
  /** Things out of service right now. */
  outOfService: { itemId: string; name: string; reason: string; expectedReturn: string | null; since: string }[];
  /** Classes and events in the next week with people waiting. */
  waiting: OfficeWaiting[];
}

const WAITING_DAYS = 7;

export function officeSummary(state: ClubState, now: Date, rules: AttendanceRules): OfficeSummary {
  const today = pacificDate(now);
  const isToday = (iso: string) => pacificDate(new Date(iso)) === today;
  const withinWeek = (iso: string) => {
    const t = Date.parse(iso);
    return t > now.getTime() && pacificDate(new Date(iso)) <= addDays(today, WAITING_DAYS);
  };

  const outOfService = state.items
    .map((item) => ({ item, period: outOfServiceAt(state, item.id, now) }))
    .filter((x): x is { item: (typeof state.items)[number]; period: NonNullable<ReturnType<typeof outOfServiceAt>> } => x.period !== undefined)
    .map(({ item, period }) => ({ itemId: item.id, name: item.name, reason: period.reason, expectedReturn: period.expectedReturn, since: period.from }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const waiting: OfficeWaiting[] = [];
  for (const session of state.sessions) {
    if (session.status !== "scheduled" || !withinWeek(session.startsAt)) continue;
    const lines = state.signups.filter((g) => g.sessionId === session.id);
    const queue = lines.filter((g) => g.status === "waitlisted").length;
    if (queue === 0) continue;
    const taken = lines.filter((g) => g.status === "enrolled").length;
    waiting.push({ kind: "class", id: session.id, title: state.classes.find((c) => c.id === session.classId)?.name ?? "A class", startsAt: session.startsAt, fullness: `${taken} of ${session.capacity} chairs`, waiting: queue });
  }
  for (const event of state.events) {
    if (event.status !== "scheduled" || !withinWeek(event.startsAt)) continue;
    const queue = state.rsvps.filter((r) => r.eventId === event.id && r.status === "waitlisted" && !holdExpired(r, now)).length;
    if (queue === 0) continue;
    waiting.push({ kind: "event", id: event.id, title: event.title, startsAt: event.startsAt, fullness: `${placesTaken(state, event.id)} of ${event.capacity ?? "no limit"} spots`, waiting: queue });
  }
  waiting.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));

  return {
    today: {
      bookings: state.bookings.filter((b) => b.status !== "cancelled" && b.status !== "late_cancelled" && isToday(b.startsAt)).length,
      classes: state.sessions.filter((s) => s.status === "scheduled" && isToday(s.startsAt)).length,
      events: state.events.filter((e) => e.status === "scheduled" && isToday(e.startsAt)).length,
    },
    needsLook: needsALook(state, now, rules),
    outOfService,
    waiting,
  };
}
