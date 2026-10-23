import { ClubError } from "../errors";
import { ClassRulesError, checkClassOverrides, classRulesFor } from "../settings/class-rules";
import { classOf } from "../settings/rulebook";
import type { ClubStore } from "../store/memory";
import { addDays, clockToMinutes, formatDayLong, formatMinutes, formatRange, pacificDate, pacificMinutes, pacificWall } from "../time";
import {
  BOOKING_TYPE_INFO,
  CLASS_ROOM_TYPES,
  HOLDING_STATUSES,
  type Actor,
  type ClassRules,
  type ClassRuleValues,
  type ClassSession,
  type ClassTemplate,
  type ClubState,
  type Item,
  type RuleBook,
  type SignUp,
} from "../types";
import { clockWords, opensAt } from "./bookings";
import { blockReasonFor } from "./eligibility";
import type { BookingLedger, Ctx } from "./households";
import { classClash, enrolledCount, fullName, memberById, ordinal, waitingCount, waitlistPlace } from "./queries";

/* ---------- Why a sign-up is refused ---------- */

export type SignUpReasonCode =
  | "member_blocked"
  | "class_cancelled"
  | "class_started"
  | "not_open_yet"
  | "closed"
  | "already_signed_up"
  | "waitlist_full"
  | "over_upcoming_limit"
  | "over_daily_limit"
  | "person_busy"
  | "boat_busy";

/** One plain-language reason a sign-up cannot be made. Unlike boat bookings, staff cannot set these aside: they can raise the chairs instead. */
export interface SignUpReason {
  code: SignUpReasonCode;
  message: string;
}

/** Thrown when staff ask for fewer chairs than there are people in them. */
export class ChairsTooFew extends ClubError {
  constructor(message: string) {
    super("conflict", message);
  }
}

/** Thrown when a sign-up cannot be made. `message` is the first reason; `reasons` is all of them. */
export class SignUpRefused extends ClubError {
  constructor(public reasons: SignUpReason[]) {
    super("refused", reasons[0]?.message ?? "That sign-up cannot be made.");
  }
}

const ms = (minutes: number) => minutes * 60000;
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function sessionOrThrow(state: ClubState, id: string): ClassSession {
  const session = state.sessions.find((x) => x.id === id);
  if (!session) throw new ClubError("not_found", "That class session no longer exists.");
  return session;
}

function templateOf(state: ClubState, session: Pick<ClassSession, "classId">): ClassTemplate {
  const template = state.classes.find((c) => c.id === session.classId);
  if (!template) throw new ClubError("not_found", "That class no longer exists.");
  return template;
}

function memberOrThrow(state: ClubState, id: string) {
  const member = memberById(state, id);
  if (!member) throw new ClubError("not_found", "That member no longer exists.");
  return member;
}

/** "Morning Yoga, Saturday, Oct 31, 7:30 to 8:30 am" */
export function sessionTitle(state: ClubState, session: ClassSession): string {
  return `${templateOf(state, session).name}, ${formatDayLong(pacificDate(new Date(session.startsAt)))}, ${formatRange(session.startsAt, session.endsAt)}`;
}

/** The last moment the waiting list moves up by itself. After it, a free chair goes to whoever asks first. */
export function promoteCutoff(session: ClassSession, rules: ClassRuleValues): number {
  return Date.parse(session.startsAt) - ms(rules.promoteUntilMinutesBefore);
}

/** The live (chair or waiting) line a member has on a session, if any. */
function liveSignUp(state: ClubState, sessionId: string, memberId: string): SignUp | undefined {
  return state.signups.find((g) => g.sessionId === sessionId && g.memberId === memberId && (g.status === "enrolled" || g.status === "waitlisted"));
}

/* ---------- Checking a sign-up ---------- */

export interface SignUpRequest {
  sessionId: string;
  memberId: string;
}

/**
 * Every reason this sign-up cannot be made, in a fixed order, in plain language. Empty means it can be.
 * Reads only. Used by the sign-up page (to explain) and by signUp (to decide).
 */
export function checkSignUp(state: ClubState, book: RuleBook, classRules: ClassRules, ctx: Ctx, req: SignUpRequest): SignUpReason[] {
  const session = sessionOrThrow(state, req.sessionId);
  const template = templateOf(state, session);
  const rules = classRulesFor(classRules, template);
  const member = memberOrThrow(state, req.memberId);
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  const now = ctx.now.getTime();
  const isYou = ctx.actor.kind === "member" && ctx.actor.memberId === member.id;
  const who = isYou ? "You" : fullName(member);
  const reasons: SignUpReason[] = [];
  const add = (code: SignUpReasonCode, message: string) => reasons.push({ code, message });

  const blocked = blockReasonFor(state, member.id, "class sign-ups are closed");
  if (blocked) add("member_blocked", blocked);

  if (session.status === "cancelled") {
    add("class_cancelled", `${template.name} on ${formatDayLong(pacificDate(new Date(session.startsAt)))} was cancelled.`);
    return reasons;
  }
  if (now >= start) {
    add("class_started", `${template.name} has already started.`);
    return reasons;
  }

  // Already on the sheet. A waiting place can turn into a chair once the automatic move-up has ended and a chair is free.
  const existing = liveSignUp(state, session.id, member.id);
  if (existing) {
    const claim = existing.status === "waitlisted" && enrolledCount(state, session.id) < session.capacity && now >= promoteCutoff(session, rules);
    if (!claim) {
      const place = waitlistPlace(state, existing.id);
      add("already_signed_up", existing.status === "enrolled" ? `${who} ${isYou ? "are" : "is"} already in this class.` : `${who} ${isYou ? "are" : "is"} already on the waiting list, ${ordinal(place ?? 1)} in line.`);
      return reasons;
    }
  }

  const closes = start - ms(rules.closeMinutesBefore);
  if (now >= closes) {
    add("closed", `Sign-up for ${template.name} closed ${formatMinutes(rules.closeMinutesBefore)} before it starts.`);
  }
  const day = pacificDate(new Date(start));
  const opens = opensAt(day, rules.signUpDaysAhead, rules.opensAt);
  if (now < opens.getTime()) {
    const openDay = pacificDate(opens);
    add(
      "not_open_yet",
      `You can sign up for classes up to ${plural(rules.signUpDaysAhead, "day")} ahead. ${formatDayLong(day)} opens ${formatDayLong(openDay)} at ${clockWords(openDay, clockToMinutes(rules.opensAt))}.`,
    );
  }
  if (existing) return reasons;

  // Full, and the waiting list is full too.
  if (enrolledCount(state, session.id) >= session.capacity && waitingCount(state, session.id) >= rules.waitlistMax) {
    add(
      "waitlist_full",
      rules.waitlistMax === 0
        ? `${template.name} is full, and it has no waiting list.`
        : `${template.name} is full, and its waiting list is full too (${plural(rules.waitlistMax, "person").replace("persons", "people")}).`,
    );
  }

  // Limits. A waiting-list place counts like a chair: it holds the person's time.
  const sessionById = new Map(state.sessions.map((x) => [x.id, x]));
  const mine = state.signups.filter((g) => g.memberId === member.id);
  const upcoming = mine.filter((g) => {
    const s = sessionById.get(g.sessionId);
    return (g.status === "enrolled" || g.status === "waitlisted") && s?.status === "scheduled" && Date.parse(s.endsAt) > now;
  }).length;
  if (upcoming >= rules.maxUpcomingPerMember) {
    add(
      "over_upcoming_limit",
      `${who} already ${isYou ? "hold" : "holds"} ${plural(upcoming, "class place")} (chairs and waiting-list spots), the most allowed at once. Leave one or wait until a class is done.`,
    );
  }
  const sameDay = mine.filter((g) => {
    const s = sessionById.get(g.sessionId);
    return (g.status === "enrolled" || g.status === "waitlisted" || g.status === "attended" || g.status === "no_show") && s?.status === "scheduled" && pacificDate(new Date(s.startsAt)) === day;
  }).length;
  if (sameDay >= rules.maxPerDayPerMember) {
    add(
      "over_daily_limit",
      `${who} can sign up for ${plural(rules.maxPerDayPerMember, "class")} a day, and ${isYou ? "you" : "they"} already have ${sameDay === 1 ? "one" : sameDay} on ${formatDayLong(day)}.`,
    );
  }

  // One place at a time: another class, or a boat.
  const clash = classClash(state, member.id, start, end, session.id);
  if (clash) {
    add("person_busy", `${who} ${isYou ? "are" : "is"} already ${clash.waiting ? "on the waiting list for" : "signed up for"} ${clash.className} from ${formatRange(clash.startsAt, clash.endsAt)}.`);
  }
  const boat = state.bookings.find((b) => {
    if (!HOLDING_STATUSES.includes(b.status) || !(b.bookerId === member.id || b.crew.includes(member.id))) return false;
    const item = state.items.find((i) => i.id === b.itemId);
    return !!item && BOOKING_TYPE_INFO[classOf(book, item).type].onWater && overlaps(start, end, Date.parse(b.startsAt), Date.parse(b.endsAt));
  });
  if (boat) {
    const itemName = state.items.find((i) => i.id === boat.itemId)?.name ?? "a boat";
    add("boat_busy", `${who} ${isYou ? "have" : "has"} ${itemName} booked from ${formatRange(boat.startsAt, boat.endsAt)}.`);
  }
  return reasons;
}

/* ---------- The waiting list ---------- */

/**
 * Moves the waiting list up into free chairs, first in line first, until the chairs are full or nobody is waiting.
 * Only until `promoteUntilMinutesBefore` before the start: after that a free chair goes to whoever asks first.
 * Works on the all-or-nothing change's copy of the data. Returns the sign-ups that got a chair.
 */
export function promoteWaitlist(state: ClubState, classRules: ClassRules, sessionId: string, now: Date): SignUp[] {
  const session = sessionOrThrow(state, sessionId);
  if (session.status !== "scheduled") return [];
  if (now.getTime() >= promoteCutoff(session, classRulesFor(classRules, templateOf(state, session)))) return [];
  const promoted: SignUp[] = [];
  let enrolled = enrolledCount(state, session.id);
  for (const line of state.signups) {
    if (enrolled >= session.capacity) break;
    if (line.sessionId !== session.id || line.status !== "waitlisted") continue;
    line.status = "enrolled";
    line.promotedAt = now.toISOString();
    line.statusChangedAt = now.toISOString();
    promoted.push(line);
    enrolled++;
  }
  return promoted;
}

/* ---------- Signing up and leaving ---------- */

export interface SignUpResult {
  signUp: SignUp;
  outcome: "enrolled" | "waitlisted";
  /** Counting from 1, when waiting. */
  place: number | null;
}

/**
 * Signs a member up: a chair if one is free, otherwise the end of the waiting list. A member signs themself up;
 * staff can sign anyone up, under the same rules. Everything is checked and written as one all-or-nothing change.
 */
export async function signUp(store: ClubStore, book: RuleBook, classRules: ClassRules, ctx: Ctx, req: SignUpRequest): Promise<SignUpResult> {
  if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only a member or club staff can sign someone up.");
  if (ctx.actor.kind === "member" && ctx.actor.memberId !== req.memberId) throw new ClubError("forbidden", "You can only sign yourself up.");
  return store.transaction(async (s, newId) => {
    const reasons = checkSignUp(s, book, classRules, ctx, req);
    if (reasons.length > 0) throw new SignUpRefused(reasons);
    const session = sessionOrThrow(s, req.sessionId);
    const at = ctx.now.toISOString();

    // Someone waiting whose chair is free after the automatic move-up ended: the waiting place becomes the chair.
    const waiting = liveSignUp(s, session.id, req.memberId);
    if (waiting) {
      waiting.status = "enrolled";
      waiting.promotedAt = at;
      waiting.statusChangedAt = at;
      return { signUp: structuredClone(waiting), outcome: "enrolled" as const, place: null };
    }

    // Chairs free while people wait would be unfair to the line; the line moves first.
    promoteWaitlist(s, classRules, session.id, ctx.now);
    const free = enrolledCount(s, session.id) < session.capacity;
    const line: SignUp = {
      id: newId(),
      sessionId: session.id,
      memberId: req.memberId,
      status: free ? "enrolled" : "waitlisted",
      createdAt: at,
      createdBy: ctx.actor,
      statusChangedAt: at,
      promotedAt: null,
      cancelledBy: null,
      cancelReason: null,
    };
    s.signups.push(line);
    return { signUp: structuredClone(line), outcome: line.status as "enrolled" | "waitlisted", place: free ? null : waitlistPlace(s, line.id) };
  });
}

export interface LeaveResult {
  signUp: SignUp;
  /** True if a member with a chair left later than the class's cutoff. Leaving a waiting list is never late. */
  late: boolean;
  /** The people the waiting list moved up into the chair that was freed. */
  promoted: SignUp[];
}

/**
 * The member (or staff) takes a name off the sheet. A chair is freed and the first person waiting gets it at once.
 * A member with a chair who leaves after the cutoff is recorded as a late cancellation; staff cancelling are never
 * recorded against the member.
 */
export async function leaveClass(store: ClubStore, classRules: ClassRules, ctx: Ctx, signUpId: string, options: { reason?: string } = {}): Promise<LeaveResult> {
  return store.transaction(async (s) => {
    const line = s.signups.find((g) => g.id === signUpId);
    if (!line) throw new ClubError("not_found", "That sign-up no longer exists.");
    if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only the member, or club staff, can cancel a sign-up.");
    if (ctx.actor.kind === "member" && ctx.actor.memberId !== line.memberId) throw new ClubError("forbidden", "You can only cancel your own sign-up.");
    if (line.status !== "enrolled" && line.status !== "waitlisted") throw new ClubError("conflict", `That sign-up is already ${line.status.replace("_", " ")}.`);
    const session = sessionOrThrow(s, line.sessionId);
    if (ctx.now.getTime() >= Date.parse(session.startsAt)) throw new ClubError("conflict", "That class has already started, so it cannot be cancelled here. Ask club staff.");
    const rules = classRulesFor(classRules, templateOf(s, session));
    const hadChair = line.status === "enrolled";
    const late = ctx.actor.kind === "member" && hadChair && ctx.now.getTime() > Date.parse(session.startsAt) - ms(rules.cancelCutoffMinutes);
    line.status = late ? "late_cancelled" : "cancelled";
    line.statusChangedAt = ctx.now.toISOString();
    line.cancelledBy = ctx.actor;
    line.cancelReason = options.reason?.trim() || null;
    const promoted = hadChair ? promoteWaitlist(s, classRules, session.id, ctx.now) : [];
    return { signUp: structuredClone(line), late, promoted: structuredClone(promoted) };
  });
}

/* ---------- Staff: classes, sessions, chairs ---------- */

function requireStaff(actor: Actor) {
  if (actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can do that.");
}

function whole(value: number | undefined, label: string, min: number, max: number): number {
  if (value === undefined || !Number.isInteger(value) || value < min || value > max) throw new ClubError("invalid", `${label} must be a whole number from ${min} to ${max}.`);
  return value;
}

export interface NewClass {
  name: string;
  description?: string;
  instructor?: string;
  defaultCapacity: number;
  defaultMinutes: number;
  /** The gym or room the class uses, if any. */
  roomItemId?: string | null;
  /** Rules for this class only; anything not listed follows the club's class rules. */
  rules?: Partial<ClassRuleValues>;
}

function roomOrThrow(state: ClubState, book: RuleBook, itemId: string): Item {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) throw new ClubError("not_found", "That room no longer exists.");
  if (!CLASS_ROOM_TYPES.includes(classOf(book, item).type)) throw new ClubError("invalid", `${item.name} is not a gym or room, so a class cannot use it.`);
  return item;
}

/** Staff add a kind of class ("Morning Yoga"). Dated sessions are scheduled separately. */
export async function createClass(store: ClubStore, book: RuleBook, classRules: ClassRules, ctx: Ctx, input: NewClass): Promise<ClassTemplate> {
  requireStaff(ctx.actor);
  const name = input.name.trim();
  if (!name) throw new ClubError("invalid", "Give the class a name.");
  if (name.length > 80) throw new ClubError("invalid", "The class name must be 80 characters or fewer.");
  const description = (input.description ?? "").trim();
  if (description.length > 500) throw new ClubError("invalid", "The description must be 500 characters or fewer.");
  const instructor = (input.instructor ?? "").trim();
  if (instructor.length > 120) throw new ClubError("invalid", "The instructor's name must be 120 characters or fewer.");
  const defaultCapacity = whole(input.defaultCapacity, "Chairs", 1, 200);
  const defaultMinutes = whole(input.defaultMinutes, "Length in minutes", 15, 480);
  const rules = input.rules ?? {};
  try {
    checkClassOverrides(classRules.defaults, rules, `Class "${name}"`);
  } catch (e) {
    if (e instanceof ClassRulesError) throw new ClubError("invalid", e.message);
    throw e;
  }
  return store.transaction(async (s, newId) => {
    if (s.classes.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new ClubError("conflict", `There is already a class called "${name}".`);
    if (input.roomItemId) roomOrThrow(s, book, input.roomItemId);
    const template: ClassTemplate = { id: newId(), name, description, instructor, defaultCapacity, defaultMinutes, roomItemId: input.roomItemId ?? null, rules: { ...rules } };
    s.classes.push(template);
    return structuredClone(template);
  });
}

export interface NewSessions {
  classId: string;
  /** The first session's start. */
  startsAt: Date;
  /** Same time of day every week for this many weeks (1 for a single session). Follows the Pacific clock, so a 7:30 am class stays at 7:30 am across the clock change. */
  weeks?: number;
  /** Chairs. Defaults to the class's. */
  capacity?: number;
  /** Length. Defaults to the class's. */
  minutes?: number;
  /** A different room than the class's usual one; null for none. */
  roomItemId?: string | null;
}

/**
 * What scheduling would do, without doing it: the sessions it would make and, in words, everything that stands in the
 * way (a room already used, booked by a member, or out of service; a time already gone). Used by the scheduling form to
 * explain, and by scheduleSessions to decide. Reads only.
 */
export function planSessions(state: ClubState, book: RuleBook, ctx: Ctx, input: NewSessions, newId: () => string): { sessions: ClassSession[]; problems: string[] } {
  const weeks = whole(input.weeks ?? 1, "Weeks", 1, 52);
  if (Number.isNaN(input.startsAt.getTime())) throw new ClubError("invalid", "Choose a start time.");
  const template = templateOf(state, { classId: input.classId });
  const capacity = whole(input.capacity ?? template.defaultCapacity, "Chairs", 1, 200);
  const minutes = whole(input.minutes ?? template.defaultMinutes, "Length in minutes", 15, 480);
  const roomItemId = input.roomItemId === undefined ? template.roomItemId : input.roomItemId;
  const room = roomItemId ? roomOrThrow(state, book, roomItemId) : null;
  const firstDay = pacificDate(input.startsAt);
  const wall = pacificMinutes(input.startsAt);
  const now = ctx.now.getTime();

  const sessions: ClassSession[] = [];
  const problems: string[] = [];
  for (let n = 0; n < weeks; n++) {
    const startsAt = n === 0 ? input.startsAt : pacificWall(addDays(firstDay, 7 * n), wall);
    const endsAt = new Date(startsAt.getTime() + ms(minutes));
    const start = startsAt.getTime();
    const end = endsAt.getTime();
    const when = `${formatDayLong(pacificDate(startsAt))}, ${formatRange(startsAt, endsAt)}`;
    if (start <= now) {
      problems.push(`${when} has already started.`);
      continue;
    }
    if (room) {
      const other = state.sessions.find((x) => x.status === "scheduled" && x.roomItemId === room.id && overlaps(start, end, Date.parse(x.startsAt), Date.parse(x.endsAt)));
      if (other) problems.push(`${room.name} is already used for ${templateOf(state, other).name} on ${formatDayLong(pacificDate(new Date(other.startsAt)))}, ${formatRange(other.startsAt, other.endsAt)}.`);
      const booked = state.bookings.filter((b) => b.itemId === room.id && HOLDING_STATUSES.includes(b.status) && overlaps(start, end, Date.parse(b.startsAt), Date.parse(b.endsAt)));
      for (const b of booked) {
        const who = memberById(state, b.bookerId);
        problems.push(`${room.name} is booked by ${who ? fullName(who) : "a member"} on ${formatDayLong(pacificDate(new Date(b.startsAt)))}, ${formatRange(b.startsAt, b.endsAt)}. Cancel that booking first.`);
      }
      if (state.outOfService.some((p) => p.itemId === room.id && overlaps(start, end, Date.parse(p.from), p.until === null ? Infinity : Date.parse(p.until)))) {
        problems.push(`${room.name} is out of service on ${when}.`);
      }
    }
    sessions.push({
      id: newId(),
      classId: template.id,
      roomItemId: room?.id ?? null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      capacity,
      status: "scheduled",
      createdAt: ctx.now.toISOString(),
      createdBy: ctx.actor,
      statusChangedAt: ctx.now.toISOString(),
      cancelledBy: null,
      cancelReason: null,
    });
  }
  return { sessions, problems };
}

/** The words for a list of scheduling problems: the first three, then a count. */
export function schedulingMessage(problems: string[]): string {
  return `Nothing was scheduled. ${problems.slice(0, 3).join(" ")}${problems.length > 3 ? ` (${problems.length - 3} more problems.)` : ""}`;
}

/**
 * Staff schedule a single class or a weekly series. The room is held for the whole length: if a member has booked it,
 * another class has it, or it is out of service, nothing is scheduled and the message names every clash.
 */
export async function scheduleSessions(store: ClubStore, book: RuleBook, ctx: Ctx, input: NewSessions): Promise<ClassSession[]> {
  requireStaff(ctx.actor);
  return store.transaction(async (s, newId) => {
    const { sessions, problems } = planSessions(s, book, ctx, input, newId);
    if (problems.length > 0) throw new ClubError("conflict", schedulingMessage(problems));
    s.sessions.push(...sessions);
    return structuredClone(sessions);
  });
}

/** A person staff need to tell when a class is cancelled. */
export interface AffectedSignUp {
  signUpId: string;
  memberId: string;
  name: string;
  email: string;
  phone: string;
  status: "enrolled" | "waitlisted";
}

/** Staff cancel one session. Everyone on its sheet is taken off (not as a late cancellation) and listed so staff can contact them. */
export async function cancelSession(store: ClubStore, ctx: Ctx, sessionId: string, input: { reason: string }): Promise<{ session: ClassSession; affected: AffectedSignUp[] }> {
  requireStaff(ctx.actor);
  const reason = input.reason.trim();
  if (!reason) throw new ClubError("invalid", "Say why the class is cancelled; members will see the reason.");
  if (reason.length > 300) throw new ClubError("invalid", "The reason must be 300 characters or fewer.");
  return store.transaction(async (s) => {
    const session = sessionOrThrow(s, sessionId);
    if (session.status === "cancelled") throw new ClubError("conflict", "That class is already cancelled.");
    if (ctx.now.getTime() >= Date.parse(session.startsAt)) throw new ClubError("conflict", "That class has already started, so it cannot be cancelled.");
    const at = ctx.now.toISOString();
    session.status = "cancelled";
    session.statusChangedAt = at;
    session.cancelledBy = ctx.actor;
    session.cancelReason = reason;
    const affected: AffectedSignUp[] = [];
    for (const line of s.signups) {
      if (line.sessionId !== session.id || (line.status !== "enrolled" && line.status !== "waitlisted")) continue;
      const member = memberOrThrow(s, line.memberId);
      affected.push({ signUpId: line.id, memberId: member.id, name: fullName(member), email: member.email, phone: member.phone, status: line.status });
      line.status = "cancelled";
      line.statusChangedAt = at;
      line.cancelledBy = ctx.actor;
      line.cancelReason = `The class was cancelled: ${reason}`.slice(0, 300);
    }
    return { session: structuredClone(session), affected };
  });
}

/**
 * Staff change the number of chairs. Raising them moves the waiting list up at once (while the automatic move-up is
 * still running). Chairs cannot go below the people already in them: staff cancel those sign-ups first.
 */
export async function setCapacity(store: ClubStore, classRules: ClassRules, ctx: Ctx, sessionId: string, capacity: number): Promise<{ session: ClassSession; promoted: SignUp[] }> {
  requireStaff(ctx.actor);
  const chairs = whole(capacity, "Chairs", 1, 200);
  return store.transaction(async (s) => {
    const session = sessionOrThrow(s, sessionId);
    if (session.status !== "scheduled") throw new ClubError("conflict", "That class was cancelled, so its chairs cannot change.");
    if (Date.parse(session.endsAt) <= ctx.now.getTime()) throw new ClubError("conflict", "That class is over, so its chairs cannot change.");
    const taken = enrolledCount(s, session.id);
    if (chairs < taken) throw new ChairsTooFew(`${plural(taken, "person").replace("persons", "people")} already have chairs, so chairs cannot go below ${taken}. Cancel some sign-ups first.`);
    session.capacity = chairs;
    const promoted = promoteWaitlist(s, classRules, session.id, ctx.now);
    return { session: structuredClone(session), promoted: structuredClone(promoted) };
  });
}

/* ---------- Reading the sheet ---------- */

export interface SheetLine {
  signUpId: string;
  memberId: string;
  /** Staff only; null for members. */
  name: string | null;
  status: SignUp["status"];
  /** Counting from 1, when waiting. */
  place: number | null;
  mine: boolean;
}

export interface SessionView {
  session: ClassSession;
  template: ClassTemplate;
  roomName: string | null;
  enrolled: number;
  waiting: number;
  full: boolean;
  /** The viewing member's own line on the sheet, if any. */
  yours: SheetLine | null;
  /** Everyone, for staff. Empty for members: they see only counts and their own place. */
  sheet: SheetLine[];
}

/** A session as a viewer may see it. Members see "full" and their own place, never others' names. */
export function sessionView(state: ClubState, session: ClassSession, viewer: { kind: "member"; memberId: string } | { kind: "staff" }): SessionView {
  const lines = state.signups
    .filter((g) => g.sessionId === session.id)
    .map((g): SheetLine => {
      const member = memberById(state, g.memberId);
      return {
        signUpId: g.id,
        memberId: g.memberId,
        name: viewer.kind === "staff" && member ? fullName(member) : null,
        status: g.status,
        place: waitlistPlace(state, g.id),
        mine: viewer.kind === "member" && viewer.memberId === g.memberId,
      };
    });
  const enrolled = enrolledCount(state, session.id);
  return {
    session,
    template: templateOf(state, session),
    roomName: session.roomItemId ? (state.items.find((i) => i.id === session.roomItemId)?.name ?? null) : null,
    enrolled,
    waiting: waitingCount(state, session.id),
    full: enrolled >= session.capacity,
    yours: lines.find((l) => l.mine && (l.status === "enrolled" || l.status === "waitlisted")) ?? null,
    sheet: viewer.kind === "staff" ? lines : [],
  };
}

/* ---------- When a member leaves ---------- */

/**
 * Takes these members off the sign-up sheets of classes still to come, in the same all-or-nothing change that removes
 * them from the club, then moves the waiting lists up behind them. Not recorded as late: it was not their choice.
 * Classes already under way, and past ones, are history and stay. Returns the IDs of the sign-ups cancelled.
 */
export function classLedger(classRules: ClassRules): Required<Pick<BookingLedger, "cancelFutureSignUps">> {
  return {
    async cancelFutureSignUps({ state, memberIds, now, reason, actor }) {
      const leaving = new Set(memberIds);
      const cancelled: string[] = [];
      const touched = new Set<string>();
      for (const line of state.signups) {
        if (!leaving.has(line.memberId) || (line.status !== "enrolled" && line.status !== "waitlisted")) continue;
        const session = state.sessions.find((x) => x.id === line.sessionId);
        if (!session || session.status !== "scheduled" || Date.parse(session.startsAt) <= now.getTime()) continue;
        if (line.status === "enrolled") touched.add(session.id);
        line.status = "cancelled";
        line.statusChangedAt = now.toISOString();
        line.cancelledBy = actor;
        line.cancelReason = reason;
        cancelled.push(line.id);
      }
      for (const sessionId of touched) promoteWaitlist(state, classRules, sessionId, now);
      return cancelled;
    },
  };
}
