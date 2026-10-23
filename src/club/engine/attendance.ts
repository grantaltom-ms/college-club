import { ClubError } from "../errors";
import type { ClubStore, Settler } from "../store/memory";
import { formatClock, formatMinutes } from "../time";
import type {
  Actor,
  AttendanceEntry,
  AttendanceKind,
  AttendanceOutcome,
  AttendanceRules,
  Booking,
  ClubState,
  Rsvp,
  SignUp,
} from "../types";
import type { Ctx } from "./households";
import { fullName, memberById } from "./queries";

/**
 * Who came and who did not, for boat and space bookings, class chairs and event RSVPs.
 *
 * The building comparison: the sign-in clipboard at the front desk. Every line says who was ticked off, when, and by whom.
 * A booking or class chair nobody checked in for is marked a no-show by the system when its time ends; staff can put that
 * right afterwards, and the correction is a new line on the clipboard, never an erased one. Events are not marked
 * automatically (there may be no iPad at the door); staff mark them.
 */

/** The system's own signature on the lines it writes. */
export const AUTOMATIC: Actor = { kind: "system", label: "Automatic no-show" };

const NOTE_MAX = 300;

/** What a stored status stands for, or null while nobody has been recorded. */
export function outcomeOf(status: string): AttendanceOutcome | null {
  if (status === "completed" || status === "attended") return "attended";
  if (status === "no_show") return "no_show";
  return null;
}

export const OUTCOME_WORDS: Record<AttendanceOutcome, string> = { attended: "checked in", no_show: "a no-show" };

/** Everything the three kinds of record have in common, as far as attendance goes. */
interface Target {
  kind: AttendanceKind;
  id: string;
  memberId: string;
  /** Everyone who is part of it, booker first. */
  people: string[];
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  /** Why this record cannot be checked in at all, or null. */
  blocked: string | null;
  record: Booking | SignUp | Rsvp;
}

function bookingTarget(s: ClubState, b: Booking): Target {
  const item = s.items.find((i) => i.id === b.itemId);
  return {
    kind: "booking",
    id: b.id,
    memberId: b.bookerId,
    people: [b.bookerId, ...b.crew],
    title: item?.name ?? "A booking",
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    status: b.status,
    blocked: b.status === "cancelled" || b.status === "late_cancelled" ? "That booking was cancelled, so there is nothing to check in." : null,
    record: b,
  };
}

function signUpTarget(s: ClubState, g: SignUp): Target | null {
  const session = s.sessions.find((x) => x.id === g.sessionId);
  if (!session) return null;
  const template = s.classes.find((c) => c.id === session.classId);
  return {
    kind: "class",
    id: g.id,
    memberId: g.memberId,
    people: [g.memberId],
    title: template?.name ?? "A class",
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    status: g.status,
    blocked:
      g.status === "waitlisted"
        ? "That person is on the waiting list without a chair, so there is nothing to check in."
        : g.status === "cancelled" || g.status === "late_cancelled"
          ? "That sign-up was cancelled, so there is nothing to check in."
          : session.status === "cancelled"
            ? "That class was cancelled."
            : null,
    record: g,
  };
}

function rsvpTarget(s: ClubState, r: Rsvp): Target | null {
  const event = s.events.find((x) => x.id === r.eventId);
  if (!event) return null;
  return {
    kind: "event",
    id: r.id,
    memberId: r.memberId,
    people: [r.memberId],
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    status: r.status,
    blocked:
      r.status === "waitlisted"
        ? "That person is on the waitlist without spots, so there is nothing to check in."
        : r.status === "cancelled" || r.status === "late_cancelled"
          ? "That RSVP was cancelled, so there is nothing to check in."
          : event.status === "cancelled"
            ? "That event was cancelled."
            : null,
    record: r,
  };
}

function targetOf(s: ClubState, kind: AttendanceKind, id: string): Target {
  const found =
    kind === "booking"
      ? (() => {
          const b = s.bookings.find((x) => x.id === id);
          return b ? bookingTarget(s, b) : null;
        })()
      : kind === "class"
        ? (() => {
            const g = s.signups.find((x) => x.id === id);
            return g ? signUpTarget(s, g) : null;
          })()
        : (() => {
            const r = s.rsvps.find((x) => x.id === id);
            return r ? rsvpTarget(s, r) : null;
          })();
  if (!found) throw new ClubError("not_found", "That reservation no longer exists.");
  return found;
}

/** The lines about one record, oldest first. */
export function linesFor(state: ClubState, kind: AttendanceKind, recordId: string): AttendanceEntry[] {
  return state.attendance.filter((l) => l.kind === kind && l.recordId === recordId);
}

function setOutcome(t: Target, outcome: AttendanceOutcome, at: string) {
  // On a boat or space booking "attended" is stored as "completed".
  (t.record as { status: string }).status = t.kind === "booking" && outcome === "attended" ? "completed" : outcome;
  (t.record as { statusChangedAt: string }).statusChangedAt = at;
}

/**
 * Marks as no-shows everything whose time has run out with nobody checked in: boat and space bookings, and class chairs.
 * Works on the given working copy and returns the lines it wrote. The moment recorded is when it came due (the end plus the
 * grace minutes), not when this happened to run, so the result is the same whenever it is first noticed.
 */
export function settleAttendance(state: ClubState, now: Date, rules: AttendanceRules, newId: () => string): AttendanceEntry[] {
  const grace = rules.defaults.noShowAfterEndMinutes * 60000;
  const written: AttendanceEntry[] = [];
  const mark = (t: Target) => {
    const due = Date.parse(t.endsAt) + grace;
    if (due > now.getTime()) return;
    const at = new Date(due).toISOString();
    setOutcome(t, "no_show", at);
    written.push({ id: newId(), kind: t.kind, recordId: t.id, memberId: t.memberId, at, outcome: "no_show", previous: null, by: AUTOMATIC, via: "automatic", note: null });
  };
  for (const b of state.bookings) if (b.status === "upcoming") mark(bookingTarget(state, b));
  for (const g of state.signups) {
    if (g.status !== "enrolled") continue;
    const t = signUpTarget(state, g);
    if (t && t.blocked === null) mark(t);
  }
  state.attendance.push(...written);
  return written;
}

/** The automatic no-show, in the form a store wants it: runs on the given clock whenever the club is read or changed. */
export function attendanceSettler(rules: AttendanceRules, clock: () => Date): Settler {
  return (state, newId) => {
    settleAttendance(state, clock(), rules, newId);
  };
}

export interface RecordInput {
  kind: AttendanceKind;
  id: string;
  outcome: AttendanceOutcome;
  /** On a boat or space outing: which of the people on it this is for. Defaults to the booker. */
  memberId?: string;
  note?: string;
}

/**
 * Staff check someone in, mark a no-show, put right a mistake (or the system's automatic no-show), or confirm that an
 * automatic no-show was right. Every one of those writes a line; nothing is ever erased.
 */
export async function recordAttendance(store: ClubStore, ctx: Ctx, rules: AttendanceRules, input: RecordInput): Promise<AttendanceEntry> {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can record attendance.");
  if (input.outcome !== "attended" && input.outcome !== "no_show") throw new ClubError("invalid", "Choose checked in or no-show.");
  const note = (input.note ?? "").trim();
  if (note.length > NOTE_MAX) throw new ClubError("invalid", `The note must be ${NOTE_MAX} characters or fewer.`);

  return store.transaction(async (s, newId) => {
    const t = targetOf(s, input.kind, input.id);
    if (t.blocked) throw new ClubError("conflict", t.blocked);

    const who = input.memberId ?? t.memberId;
    if (!t.people.includes(who)) throw new ClubError("invalid", "That person is not on this reservation.");

    const current = outcomeOf(t.status);
    const latest = linesFor(s, input.kind, input.id).at(-1);
    const now = ctx.now.getTime();
    if (current === null) {
      const opens = Date.parse(t.startsAt) - rules.defaults.checkInOpensMinutesBefore * 60000;
      if (input.outcome === "attended" && now < opens) {
        throw new ClubError("conflict", `Check-in for ${t.title} opens at ${formatClock(new Date(opens))}${rules.defaults.checkInOpensMinutesBefore > 0 ? `, ${formatMinutes(rules.defaults.checkInOpensMinutesBefore)} before the start` : ""}.`);
      }
      if (input.outcome === "no_show" && now < Date.parse(t.startsAt)) {
        throw new ClubError("conflict", `${t.title} has not started yet, so it cannot be a no-show.`);
      }
    } else if (current === input.outcome && latest?.via !== "automatic") {
      throw new ClubError("conflict", `That is already recorded as ${OUTCOME_WORDS[current]}.`);
    }

    const at = ctx.now.toISOString();
    if (current !== input.outcome) setOutcome(t, input.outcome, at);
    const entry: AttendanceEntry = {
      id: newId(),
      kind: input.kind,
      recordId: input.id,
      memberId: who,
      at,
      outcome: input.outcome,
      previous: current,
      by: ctx.actor,
      via: "staff",
      note: note || null,
    };
    s.attendance.push(entry);
    return structuredClone(entry);
  });
}

/* ---------- What staff see ---------- */

export interface AttendanceRow {
  kind: AttendanceKind;
  id: string;
  /** The person this row is for. */
  memberId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** What is recorded now, or null while nobody has been checked in. */
  outcome: AttendanceOutcome | null;
  /** True when the system recorded the no-show and no person has looked at it since. */
  automatic: boolean;
  /** The others on a boat or space outing. */
  withNames: string[];
  /** Check-in is open now (or was, and nothing has been recorded). */
  checkInOpen: boolean;
  started: boolean;
}

function rowOf(state: ClubState, t: Target, memberId: string, now: Date, rules: AttendanceRules): AttendanceRow {
  const latest = linesFor(state, t.kind, t.id).at(-1);
  const startsAt = Date.parse(t.startsAt);
  return {
    kind: t.kind,
    id: t.id,
    memberId,
    title: t.title,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    outcome: outcomeOf(t.status),
    automatic: outcomeOf(t.status) === "no_show" && latest?.via === "automatic",
    withNames: t.people.filter((p) => p !== memberId).map((p) => fullName(memberById(state, p)!)),
    checkInOpen: now.getTime() >= startsAt - rules.defaults.checkInOpensMinutesBefore * 60000,
    started: now.getTime() >= startsAt,
  };
}

/** One reservation as staff would see it, or null when it cannot be checked in (cancelled, or waiting without a chair). */
export function rowFor(state: ClubState, kind: AttendanceKind, id: string, now: Date, rules: AttendanceRules, memberId?: string): AttendanceRow | null {
  try {
    const t = targetOf(state, kind, id);
    return t.blocked === null ? rowOf(state, t, memberId ?? t.memberId, now, rules) : null;
  } catch {
    return null;
  }
}

function everyTarget(state: ClubState): Target[] {
  return [
    ...state.bookings.map((b) => bookingTarget(state, b)),
    ...state.signups.map((g) => signUpTarget(state, g)).filter((t): t is Target => t !== null),
    ...state.rsvps.map((r) => rsvpTarget(state, r)).filter((t): t is Target => t !== null),
  ].filter((t) => t.blocked === null);
}

/**
 * Everything one person is down for around now (a day back to a day ahead by default), for the staff check-in page:
 * boat and space outings they are in, classes with a chair, events with spots.
 */
export function reservationsFor(state: ClubState, memberId: string, now: Date, rules: AttendanceRules, window: { hoursBack?: number; hoursAhead?: number } = {}): AttendanceRow[] {
  const from = now.getTime() - (window.hoursBack ?? 24) * 3600000;
  const until = now.getTime() + (window.hoursAhead ?? 24) * 3600000;
  return everyTarget(state)
    .filter((t) => t.people.includes(memberId) && Date.parse(t.endsAt) >= from && Date.parse(t.startsAt) <= until)
    .map((t) => rowOf(state, t, memberId, now, rules))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
}

/** Everything on or about to start across the club, from a couple of hours back to a couple of hours ahead, for the front desk. */
export function aroundNow(state: ClubState, now: Date, rules: AttendanceRules, hours = 2): AttendanceRow[] {
  const from = now.getTime() - hours * 3600000;
  const until = now.getTime() + hours * 3600000;
  return everyTarget(state)
    .filter((t) => Date.parse(t.endsAt) >= from && Date.parse(t.startsAt) <= until)
    .map((t) => rowOf(state, t, t.memberId, now, rules))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/**
 * Automatic no-shows from the last few days that no person has looked at yet: each is either right (nobody came) or a
 * forgotten iPad tap that staff can put right. Newest first.
 */
export function needsALook(state: ClubState, now: Date, rules: AttendanceRules, days = 3): AttendanceRow[] {
  const from = now.getTime() - days * 86400000;
  return everyTarget(state)
    .filter((t) => Date.parse(t.endsAt) >= from && Date.parse(t.endsAt) <= now.getTime())
    .map((t) => rowOf(state, t, t.memberId, now, rules))
    .filter((r) => r.automatic)
    .sort((a, b) => b.endsAt.localeCompare(a.endsAt) || a.title.localeCompare(b.title));
}

/** The rules in plain words, for the staff screens. */
export function describeAttendanceRules(rules: AttendanceRules): string[] {
  const { checkInOpensMinutesBefore: opens, noShowAfterEndMinutes: grace } = rules.defaults;
  return [
    opens > 0 ? `Check-in opens ${formatMinutes(opens)} before the start.` : "Check-in opens at the start.",
    grace > 0
      ? `A boat or space booking, or a class chair, that nobody checked in for becomes a no-show ${formatMinutes(grace)} after it ends.`
      : "A boat or space booking, or a class chair, that nobody checked in for becomes a no-show the moment it ends.",
    "Events are not marked automatically; staff mark who came.",
    "Staff can correct any of these afterwards. The correction is added to the record; nothing is erased.",
  ];
}
