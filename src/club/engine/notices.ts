import { classRulesFor } from "../settings/class-rules";
import type { ClassRules, ClubState, EventRules } from "../types";
import { promoteCutoff as classPromoteCutoff } from "./classes";
import { noticeWords, openDamageNotices } from "./damage";
import { promoteCutoff as eventPromoteCutoff } from "./events";
import { householdOf, memberById } from "./queries";

/**
 * Who should be told, and about what, after a change to the club's records. Pure: it takes what the records looked like before
 * a change (a small digest, `basisOf`) and after it, and says which emails the change calls for. It sends nothing and changes
 * nothing; the wrapper around the store (notify/notifying-store.ts) sends them once the change is saved.
 *
 * The building comparison: the notice board clerk. Every time the office changes something on the wall chart, the clerk
 * compares the chart before and after, and writes a short note to each tenant whose own place was moved.
 *
 * Why a comparison and not a call in every place that can cause one: a waiting list moves up from ten different places (a member
 * cancelling, a smaller party, staff raising the limit, a household leaving, a resignations file ...). One look at "who was waiting
 * and now has a place" covers all of them, and a future one, without anyone having to remember to send an email.
 *
 * Four kinds (Grant, Nov 5): a spot opened for you (a class or an event), an event was cancelled, an event's time or place changed,
 * and a boat you booked was taken out of service or had major damage reported.
 */

/** The person an email is for: an active adult of an active household, with an address on file. */
export interface Person {
  memberId: string;
  firstName: string;
  email: string;
}

/** One booking, for the words of a boat email. ISO moments. */
export interface BookingLine {
  startsAt: string;
  endsAt: string;
}

export type Notice =
  | {
      kind: "class_spot";
      to: Person;
      sessionId: string;
      className: string;
      startsAt: string;
      endsAt: string;
      roomName: string | null;
    }
  | {
      kind: "event_spot";
      to: Person;
      eventId: string;
      title: string;
      startsAt: string;
      endsAt: string;
      location: string;
      /** The member and their guests. */
      party: number;
      priceCents: number | null;
      /** The last moment to cancel without it counting as late (and being billed), or null when that has already passed. */
      cancelFreeUntil: string | null;
    }
  | {
      kind: "event_cancelled";
      to: Person;
      title: string;
      startsAt: string;
      endsAt: string;
      location: string;
      reason: string;
      wasWaiting: boolean;
      party: number;
      priceCents: number | null;
    }
  | {
      kind: "event_changed";
      to: Person;
      eventId: string;
      title: string;
      before: { startsAt: string; endsAt: string; location: string };
      after: { startsAt: string; endsAt: string; location: string };
      waiting: boolean;
      party: number;
    }
  | {
      kind: "boat_out_of_service";
      to: Person;
      itemName: string;
      from: string;
      until: string | null;
      expectedReturn: string | null;
      reason: string;
      bookings: BookingLine[];
    }
  | {
      kind: "boat_damage";
      to: Person;
      itemName: string;
      /** The same sentence members already read on the boat's page, so the email and the screen never disagree. */
      words: string;
      bookings: BookingLine[];
    };

/** What the records looked like before a change, as small as it can be. */
export interface ChangeBasis {
  waitingRsvps: ReadonlySet<string>;
  waitingSignups: ReadonlySet<string>;
  events: ReadonlyMap<string, EventBasis>;
  outOfService: ReadonlySet<string>;
  damageReports: ReadonlySet<string>;
}

interface EventBasis {
  status: string;
  startsAt: string;
  endsAt: string;
  location: string;
  /** Everyone on its list (going or waiting) at that moment. */
  live: { memberId: string; status: "going" | "waitlisted"; guests: number; priceCents: number | null }[];
}

/** Takes the digest. Cheap: one pass over the lists a notice can come from. */
export function basisOf(state: ClubState): ChangeBasis {
  const events = new Map<string, EventBasis>();
  for (const e of state.events) events.set(e.id, { status: e.status, startsAt: e.startsAt, endsAt: e.endsAt, location: e.location, live: [] });
  const waitingRsvps = new Set<string>();
  for (const r of state.rsvps) {
    if (r.status === "waitlisted") waitingRsvps.add(r.id);
    if (r.status === "going" || r.status === "waitlisted") events.get(r.eventId)?.live.push({ memberId: r.memberId, status: r.status, guests: r.guests, priceCents: r.priceCents });
  }
  return {
    waitingRsvps,
    waitingSignups: new Set(state.signups.filter((g) => g.status === "waitlisted").map((g) => g.id)),
    events,
    outOfService: new Set(state.outOfService.map((p) => p.id)),
    damageReports: new Set(state.damageReports.map((r) => r.id)),
  };
}

export interface NoticeRules {
  events: EventRules;
  classes: ClassRules;
}

/** An active adult of an active household who has an address on file. Anyone else cannot be emailed. */
export function emailable(state: ClubState, memberId: string): Person | null {
  const member = memberById(state, memberId);
  if (!member || member.status !== "active") return null;
  if (householdOf(state, member.householdId)?.status !== "active") return null;
  const email = member.email.trim();
  if (!email) return null;
  return { memberId: member.id, firstName: member.firstName.trim() || "there", email };
}

const ms = (minutes: number) => minutes * 60_000;
const at = (iso: string) => Date.parse(iso);

/** The emails a change calls for. `after` is the records as the change left them; `now` is the moment of the change. */
export function noticesFromChange(basis: ChangeBasis, after: ClubState, now: Date, rules: NoticeRules): Notice[] {
  const notices: Notice[] = [];
  const nowMs = now.getTime();

  /* ---------- A spot opened for you ---------- */
  // After the automatic move-up ends, a waiting member can only claim free places themself (and has just pressed the button), so a
  // move from waiting to a place after that moment is never news to them. Before it, only the waiting list moving up does that.
  const spotted = new Set<string>();
  for (const line of after.signups) {
    if (line.status !== "enrolled" || !basis.waitingSignups.has(line.id)) continue;
    const session = after.sessions.find((s) => s.id === line.sessionId);
    const template = session && after.classes.find((c) => c.id === session.classId);
    if (!session || !template || session.status !== "scheduled" || at(session.startsAt) <= nowMs) continue;
    if (nowMs >= classPromoteCutoff(session, classRulesFor(rules.classes, template))) continue;
    const to = emailable(after, line.memberId);
    if (!to) continue;
    spotted.add(`${session.id}|${line.memberId}`);
    notices.push({
      kind: "class_spot",
      to,
      sessionId: session.id,
      className: template.name,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      roomName: (session.roomItemId && after.items.find((i) => i.id === session.roomItemId)?.name) || null,
    });
  }
  for (const line of after.rsvps) {
    if (line.status !== "going" || !basis.waitingRsvps.has(line.id)) continue;
    const event = after.events.find((e) => e.id === line.eventId);
    if (!event || event.status !== "scheduled" || at(event.startsAt) <= nowMs || nowMs >= eventPromoteCutoff(event, rules.events)) continue;
    const to = emailable(after, line.memberId);
    if (!to) continue;
    spotted.add(`${event.id}|${line.memberId}`);
    const freeUntil = at(event.startsAt) - ms(rules.events.defaults.cancelCutoffMinutes);
    notices.push({
      kind: "event_spot",
      to,
      eventId: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      location: event.location,
      party: 1 + line.guests,
      priceCents: line.priceCents,
      cancelFreeUntil: nowMs < freeUntil ? new Date(freeUntil).toISOString() : null,
    });
  }

  /* ---------- An event was cancelled, or its time or place changed ---------- */
  for (const event of after.events) {
    const was = basis.events.get(event.id);
    if (!was || was.status !== "scheduled") continue;
    if (event.status === "cancelled") {
      for (const line of was.live) {
        const to = emailable(after, line.memberId);
        if (!to) continue;
        notices.push({
          kind: "event_cancelled",
          to,
          title: event.title,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          location: event.location,
          reason: (event.cancelReason ?? "").trim(),
          wasWaiting: line.status === "waitlisted",
          party: 1 + line.guests,
          priceCents: line.priceCents,
        });
      }
      continue;
    }
    if (event.status !== "scheduled") continue;
    const moved = at(event.startsAt) !== at(was.startsAt) || at(event.endsAt) !== at(was.endsAt) || event.location.trim() !== was.location.trim();
    if (!moved) continue;
    for (const line of after.rsvps) {
      if (line.eventId !== event.id || (line.status !== "going" && line.status !== "waitlisted")) continue;
      // Someone the waiting list moved up in this same change already gets an email with the new details.
      if (spotted.has(`${event.id}|${line.memberId}`)) continue;
      const to = emailable(after, line.memberId);
      if (!to) continue;
      notices.push({
        kind: "event_changed",
        to,
        eventId: event.id,
        title: event.title,
        before: { startsAt: was.startsAt, endsAt: was.endsAt, location: was.location },
        after: { startsAt: event.startsAt, endsAt: event.endsAt, location: event.location },
        waiting: line.status === "waitlisted",
        party: 1 + line.guests,
      });
    }
  }

  /* ---------- A boat you booked is out of service, or has major damage ---------- */
  const upcomingOn = (itemId: string) => after.bookings.filter((b) => b.itemId === itemId && b.status === "upcoming" && at(b.endsAt) > nowMs);
  /** Each booker and crew member with the bookings that matter to them, in the order the bookings are listed. */
  const byPerson = (bookings: ReturnType<typeof upcomingOn>) => {
    const out = new Map<string, BookingLine[]>();
    for (const b of bookings) for (const id of [b.bookerId, ...b.crew]) out.set(id, [...(out.get(id) ?? []), { startsAt: b.startsAt, endsAt: b.endsAt }]);
    return out;
  };
  const periodSpan = (p: { from: string; until: string | null }) => ({ from: at(p.from), until: p.until === null ? Infinity : at(p.until) });

  for (const period of after.outOfService) {
    if (basis.outOfService.has(period.id)) continue;
    const item = after.items.find((i) => i.id === period.itemId);
    const span = periodSpan(period);
    if (!item || span.until <= nowMs) continue;
    const hit = upcomingOn(item.id).filter((b) => at(b.startsAt) < span.until && at(b.endsAt) > span.from);
    for (const [memberId, bookings] of byPerson(hit)) {
      const to = emailable(after, memberId);
      if (!to) continue;
      notices.push({ kind: "boat_out_of_service", to, itemName: item.name, from: period.from, until: period.until, expectedReturn: period.expectedReturn, reason: period.reason, bookings });
    }
  }

  for (const report of after.damageReports) {
    if (basis.damageReports.has(report.id) || !report.major || report.status !== "open") continue;
    const item = after.items.find((i) => i.id === report.itemId);
    const notice = openDamageNotices(after, report.itemId).find((n) => n.reportId === report.id);
    if (!item || !notice) continue;
    // Anyone whose booking is already covered by an earlier out-of-service period was told then; do not say it twice.
    const covered = after.outOfService.filter((p) => basis.outOfService.has(p.id) && p.itemId === item.id).map(periodSpan);
    const hit = upcomingOn(item.id).filter((b) => !covered.some((c) => at(b.startsAt) < c.until && at(b.endsAt) > c.from));
    for (const [memberId, bookings] of byPerson(hit)) {
      // The member who filed the report knows about it.
      if (report.reportedBy.kind === "member" && report.reportedBy.memberId === memberId) continue;
      const to = emailable(after, memberId);
      if (!to) continue;
      notices.push({ kind: "boat_damage", to, itemName: item.name, words: noticeWords(notice), bookings });
    }
  }

  return notices;
}
