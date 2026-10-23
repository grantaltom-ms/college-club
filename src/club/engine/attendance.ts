import { ClubError } from "../errors";
import type { ClubStore, Settler } from "../store/memory";
import { RULE_BOOK, classOf } from "../settings/rulebook";
import { formatClock, formatMinutes } from "../time";
import type {
  Actor,
  AttendanceEntry,
  AttendanceKind,
  AttendanceOutcome,
  AttendanceRules,
  AttendanceVia,
  Booking,
  BookingType,
  ClubState,
  Rsvp,
  SignUp,
} from "../types";
import type { Ctx } from "./households";
import { fullName, householdOf, memberById } from "./queries";

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

/** What kind of booking an item takes (Shell, Room Space, ...), or null if its class is not in the rules file. */
function bookingTypeOf(s: ClubState, itemId: string): BookingType | null {
  const item = s.items.find((i) => i.id === itemId);
  if (!item) return null;
  try {
    return classOf(RULE_BOOK, item).type;
  } catch {
    return null;
  }
}

/** Whether a booking is the kind that gets checked in. The club room and work-from-club, say, are not. */
export function checkInNeeded(state: ClubState, booking: Booking, rules: AttendanceRules): boolean {
  const type = bookingTypeOf(state, booking.itemId);
  return type === null || !rules.defaults.checkInNotNeededFor.includes(type);
}

function bookingTarget(s: ClubState, b: Booking, rules: AttendanceRules): Target {
  const item = s.items.find((i) => i.id === b.itemId);
  const type = bookingTypeOf(s, b.itemId);
  return {
    kind: "booking",
    id: b.id,
    memberId: b.bookerId,
    people: [b.bookerId, ...b.crew],
    title: item?.name ?? "A booking",
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    status: b.status,
    blocked:
      b.status === "cancelled" || b.status === "late_cancelled"
        ? "That booking was cancelled, so there is nothing to check in."
        : !checkInNeeded(s, b, rules)
          ? `${type} reservations do not need a check-in.`
          : null,
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

function targetOf(s: ClubState, kind: AttendanceKind, id: string, rules: AttendanceRules): Target {
  const found =
    kind === "booking"
      ? (() => {
          const b = s.bookings.find((x) => x.id === id);
          return b ? bookingTarget(s, b, rules) : null;
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
  for (const b of state.bookings) {
    if (b.status !== "upcoming") continue;
    const t = bookingTarget(state, b, rules);
    if (t.blocked === null) mark(t);
  }
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
    const t = targetOf(s, input.kind, input.id, rules);
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

/* ---------- Members checking themselves in ---------- */

/** The two ways a member checks in without staff: on the front-desk iPad, or on their own phone. */
export const SELF_CHECK_IN_VIA = ["ipad", "phone"] as const;
export type SelfCheckInVia = (typeof SELF_CHECK_IN_VIA)[number];

export interface SelfCheckInInput {
  kind: AttendanceKind;
  id: string;
  via: SelfCheckInVia;
}

/** The moment an unchecked booking or chair becomes a no-show: the end plus the grace minutes. */
const dueAt = (t: Target, rules: AttendanceRules) => Date.parse(t.endsAt) + rules.defaults.noShowAfterEndMinutes * 60000;
const opensAt = (t: Target, rules: AttendanceRules) => Date.parse(t.startsAt) - rules.defaults.checkInOpensMinutesBefore * 60000;

/** Whether a member may check in for things at all: still an active adult in a household that is still active. */
function canCheckIn(state: ClubState, memberId: string): boolean {
  const member = memberById(state, memberId);
  return member?.status === "active" && householdOf(state, member.householdId)?.status === "active";
}

/**
 * A member checks themselves in, on the iPad or on their own phone: "I'm here". The building comparison: signing the
 * clipboard yourself instead of asking the front desk to.
 *
 * Only for a boat or space outing or a class chair they are really on (the booker or crew, or the person with the chair),
 * from when check-in opens until the time runs out. Events are ticked off by staff. Club room and work-from-club reservations
 * need no check-in at all. A member can only say "I came": they cannot undo it, and a no-show is put right by staff. On a
 * multi-seat boat there is one outcome per outing, so anyone on it can tap and the line records who did.
 */
export async function memberCheckIn(store: ClubStore, ctx: Ctx, rules: AttendanceRules, input: SelfCheckInInput): Promise<AttendanceEntry> {
  if (ctx.actor.kind !== "member") throw new ClubError("forbidden", "Only a member can check themselves in.");
  if (!(SELF_CHECK_IN_VIA as readonly string[]).includes(input.via)) throw new ClubError("invalid", "Choose the iPad or the phone.");
  if (input.kind === "event") throw new ClubError("forbidden", "Events are checked off by club staff.");
  const who = ctx.actor.memberId;

  return store.transaction(async (s, newId) => {
    if (!canCheckIn(s, who)) throw new ClubError("forbidden", "Only active members can check in.");
    const t = targetOf(s, input.kind, input.id, rules);
    if (t.blocked) throw new ClubError("conflict", t.blocked);
    if (!t.people.includes(who)) throw new ClubError("forbidden", "That is not your reservation.");

    const current = outcomeOf(t.status);
    if (current === "attended") throw new ClubError("already_recorded", `${t.title} is already checked in.`);
    if (current === "no_show") throw new ClubError("too_late", `${t.title} was marked a no-show. Ask club staff to put it right.`);
    const now = ctx.now.getTime();
    if (now < opensAt(t, rules)) {
      throw new ClubError("not_open", `Check-in for ${t.title} opens at ${formatClock(new Date(opensAt(t, rules)))}.`);
    }
    if (now >= dueAt(t, rules)) throw new ClubError("too_late", `The time for ${t.title} has passed. Ask club staff to put it right.`);

    const at = ctx.now.toISOString();
    setOutcome(t, "attended", at);
    const entry: AttendanceEntry = { id: newId(), kind: input.kind, recordId: input.id, memberId: who, at, outcome: "attended", previous: null, by: ctx.actor, via: input.via, note: null };
    s.attendance.push(entry);
    return structuredClone(entry);
  });
}

/** Where one reservation stands for the person looking at it: not open yet, open now, or already checked in. */
export type SelfCheckInPhase = { phase: "not_yet"; opensAt: string } | { phase: "open" } | { phase: "done" };

/** One thing a member can check in for (or just did), as the iPad and the phone show it. */
export interface CheckInChoice {
  kind: AttendanceKind;
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  /** The others on a boat or space outing. */
  withNames: string[];
  state: SelfCheckInPhase;
}

function phaseOf(t: Target, memberId: string, state: ClubState, now: Date, rules: AttendanceRules): SelfCheckInPhase | null {
  if (t.blocked !== null || t.kind === "event" || !t.people.includes(memberId) || !canCheckIn(state, memberId)) return null;
  const outcome = outcomeOf(t.status);
  const ms = now.getTime();
  if (outcome === "attended") return ms < Date.parse(t.endsAt) ? { phase: "done" } : null;
  if (outcome === "no_show") return null;
  if (ms >= dueAt(t, rules)) return null;
  const opens = opensAt(t, rules);
  return ms >= opens ? { phase: "open" } : { phase: "not_yet", opensAt: new Date(opens).toISOString() };
}

function choiceOf(state: ClubState, t: Target, memberId: string, phase: SelfCheckInPhase): CheckInChoice {
  return {
    kind: t.kind,
    id: t.id,
    title: t.title,
    startsAt: t.startsAt,
    endsAt: t.endsAt,
    withNames: t.people.filter((p) => p !== memberId).map((p) => fullName(memberById(state, p)!)),
    state: phase,
  };
}

/** Where one reservation stands for this member, or null when it is not theirs, needs no check-in, is over, or is cancelled. */
export function selfCheckInPhase(state: ClubState, kind: AttendanceKind, id: string, memberId: string, now: Date, rules: AttendanceRules): SelfCheckInPhase | null {
  try {
    return phaseOf(targetOf(state, kind, id, rules), memberId, state, now, rules);
  } catch {
    return null;
  }
}

/**
 * What one member can check in for right now (open), has just checked in for and is still under way (done), or will be able
 * to check in for within `hoursAhead` hours (not yet). Boat and space outings and class chairs only, by start time.
 */
export function checkInChoices(state: ClubState, memberId: string, now: Date, rules: AttendanceRules, hoursAhead = 24): CheckInChoice[] {
  const until = now.getTime() + hoursAhead * 3600000;
  const choices: CheckInChoice[] = [];
  for (const t of everyTarget(state, rules)) {
    const phase = phaseOf(t, memberId, state, now, rules);
    if (!phase) continue;
    if (phase.phase === "not_yet" && Date.parse(phase.opensAt) > until) continue;
    choices.push(choiceOf(state, t, memberId, phase));
  }
  return choices.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
}

/** A person the iPad lists: they have something to check in for right now. */
export interface CheckInPerson {
  memberId: string;
  name: string;
  /** Only when someone else listed has the same name: their household, so the two can be told apart. */
  household: string | null;
}

/**
 * Who the front-desk iPad lists: only members with something they can check in for this minute (not the whole membership),
 * by last name. Two people with the same name are told apart by their household.
 */
export function checkInPeople(state: ClubState, now: Date, rules: AttendanceRules): CheckInPerson[] {
  const open = new Set<string>();
  for (const t of everyTarget(state, rules)) {
    for (const p of t.people) if (phaseOf(t, p, state, now, rules)?.phase === "open") open.add(p);
  }
  const people = [...open].map((id) => memberById(state, id)!).sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  for (const m of people) counts.set(fullName(m), (counts.get(fullName(m)) ?? 0) + 1);
  return people.map((m) => ({ memberId: m.id, name: fullName(m), household: (counts.get(fullName(m)) ?? 0) > 1 ? householdOf(state, m.householdId)!.displayName : null }));
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
  /** How the latest line was written (the front desk, the iPad, a phone, the system), or null while nothing is recorded. */
  via: AttendanceVia | null;
  /** Who wrote the latest line, when that is not the person the row is for (a crew member's tap, say). */
  recordedBy: string | null;
  /** The others on a boat or space outing. */
  withNames: string[];
  /** Check-in is open now (or was, and nothing has been recorded). */
  checkInOpen: boolean;
  started: boolean;
}

/**
 * How a check-in was made, in words for staff to read after "checked in": nothing when staff did it themselves,
 * " from their phone" or " on the iPad" when the member did, with " by Ben Quill" when it was someone else on the outing.
 */
export function howCheckedIn(row: Pick<AttendanceRow, "outcome" | "via" | "recordedBy">): string {
  if (row.outcome !== "attended" || (row.via !== "ipad" && row.via !== "phone")) return "";
  return `${row.recordedBy ? ` by ${row.recordedBy}` : ""} ${row.via === "ipad" ? "on the iPad" : "from their phone"}`;
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
    via: latest?.via ?? null,
    recordedBy: latest && latest.by.kind === "member" && latest.by.memberId !== memberId ? latest.by.label : null,
    withNames: t.people.filter((p) => p !== memberId).map((p) => fullName(memberById(state, p)!)),
    checkInOpen: now.getTime() >= startsAt - rules.defaults.checkInOpensMinutesBefore * 60000,
    started: now.getTime() >= startsAt,
  };
}

/** One reservation as staff would see it, or null when it cannot be checked in (cancelled, or waiting without a chair). */
export function rowFor(state: ClubState, kind: AttendanceKind, id: string, now: Date, rules: AttendanceRules, memberId?: string): AttendanceRow | null {
  try {
    const t = targetOf(state, kind, id, rules);
    return t.blocked === null ? rowOf(state, t, memberId ?? t.memberId, now, rules) : null;
  } catch {
    return null;
  }
}

function everyTarget(state: ClubState, rules: AttendanceRules): Target[] {
  return [
    ...state.bookings.map((b) => bookingTarget(state, b, rules)),
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
  return everyTarget(state, rules)
    .filter((t) => t.people.includes(memberId) && Date.parse(t.endsAt) >= from && Date.parse(t.startsAt) <= until)
    .map((t) => rowOf(state, t, memberId, now, rules))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
}

/** Everything on or about to start across the club, from a couple of hours back to a couple of hours ahead, for the front desk. */
export function aroundNow(state: ClubState, now: Date, rules: AttendanceRules, hours = 2): AttendanceRow[] {
  const from = now.getTime() - hours * 3600000;
  const until = now.getTime() + hours * 3600000;
  return everyTarget(state, rules)
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
  return everyTarget(state, rules)
    .filter((t) => Date.parse(t.endsAt) >= from && Date.parse(t.endsAt) <= now.getTime())
    .map((t) => rowOf(state, t, t.memberId, now, rules))
    .filter((r) => r.automatic)
    .sort((a, b) => b.endsAt.localeCompare(a.endsAt) || a.title.localeCompare(b.title));
}

const listOf = (items: string[]) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** The rules in plain words, for the staff screens. */
export function describeAttendanceRules(rules: AttendanceRules): string[] {
  const { checkInOpensMinutesBefore: opens, noShowAfterEndMinutes: grace } = rules.defaults;
  return [
    opens > 0 ? `Check-in opens ${formatMinutes(opens)} before the start.` : "Check-in opens at the start.",
    grace > 0
      ? `A boat or space booking, or a class chair, that nobody checked in for becomes a no-show ${formatMinutes(grace)} after it ends.`
      : "A boat or space booking, or a class chair, that nobody checked in for becomes a no-show the moment it ends.",
    ...(rules.defaults.checkInNotNeededFor.length > 0 ? [`${listOf(rules.defaults.checkInNotNeededFor)} reservations do not need a check-in: they are never marked a no-show.`] : []),
    "Members can check themselves in on the front-desk iPad or on their own phone while check-in is open; the record shows which. Events are not checked in by members.",
    "Events are not marked automatically; staff mark who came.",
    "Staff can correct any of these afterwards. The correction is added to the record; nothing is erased.",
  ];
}
