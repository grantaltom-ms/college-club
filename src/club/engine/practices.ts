import { ClubError } from "../errors";
import { nameMatches } from "../name-filter";
import { classOf } from "../settings/rulebook";
import type { ClubStore } from "../store/memory";
import { addDays, formatRange, pacificDate, pacificDayStart } from "../time";
import {
  BOOKING_TYPE_INFO,
  HOLDING_STATUSES,
  SEAT_SIDES,
  type Actor,
  type Booking,
  type ClubState,
  type Item,
  type Member,
  type Practice,
  type PracticeBoat,
  type PracticeRules,
  type PracticeSeat,
  type RuleBook,
  type SeatSide,
} from "../types";
import { isPrivate, PEOPLE_SEARCH_MIN_LETTERS, PEOPLE_SEARCH_MOST, type BoatPeopleSearch } from "./boat-access";
import { blockReasonFor } from "./eligibility";
import { log, type Ctx } from "./households";
import { placesOf } from "./pools";
import { classClash, fullName, householdOf, memberById, practiceHold, practiceSeatClash } from "./queries";

/**
 * Practices and lineups: a coached or organized rowing session that reserves its boats and holds a crew list.
 *
 * The building comparison: booking the rooftop for a resident event. The office holds the roof (the boats) for the evening, so
 * no tenant can book it for themselves while the event runs, and the organizer writes down who stands where. Tenants who had
 * already booked the roof are not turned away by the system: they are flagged to the organizer and the office, who talk to them.
 *
 * Optional, and only for coached or organized sessions: an ordinary booking never needs one, and a member booking a boat and
 * naming their own crew is unchanged. The coach decides who sits where, so there is no skill check. What a coach cannot set
 * aside are the facts: nobody is in two boats (or a boat and a class) at once, only active members can be seated, a boat's seats
 * are never exceeded, and a private boat's owners decide who uses it, so a private boat never goes on a practice.
 *
 * Every boat and seat line is kept (ended, never removed), so a practice keeps the history of its lineup.
 */

const ms = (minutes: number) => minutes * 60000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Thrown when a practice, a boat or a seat cannot be changed. `message` is the first reason; `reasons` is all of them. */
export class PracticeRefused extends ClubError {
  constructor(public reasons: string[]) {
    super("refused", reasons[0] ?? "That cannot be done.");
  }
}

/* ---------- Who may run a practice ---------- */

/** A member marked as a coach who is still an active member of an active household. */
export function activeCoach(state: ClubState, memberId: string): Member | undefined {
  const m = memberById(state, memberId);
  return m && m.isCoach === true && blockReasonFor(state, memberId) === null ? m : undefined;
}

/** Staff, and members staff have marked as coaches, can set up practices and seat crews. Nothing else in the staff office. */
export function canRunPractices(state: ClubState, actor: Actor): boolean {
  if (actor.kind === "staff") return true;
  return actor.kind === "member" && activeCoach(state, actor.memberId) !== undefined;
}

/** Staff can change any practice. A coach can change the ones they run. */
export function canEditPractice(state: ClubState, actor: Actor, practice: Practice): boolean {
  if (actor.kind === "staff") return true;
  return actor.kind === "member" && practice.coachId === actor.memberId && activeCoach(state, actor.memberId) !== undefined;
}

/** Marking or unmarking a member as a coach. Staff only; the household's file records it. */
export async function setCoach(store: ClubStore, ctx: Ctx, memberId: string, coach: boolean): Promise<void> {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can mark someone as a coach.");
  await store.transaction(async (s, newId) => {
    const member = memberById(s, memberId);
    if (!member) throw new ClubError("not_found", "That member no longer exists.");
    if (coach && member.status !== "active") throw new ClubError("conflict", `${fullName(member)} is not an active member, so they cannot be made a coach.`);
    if ((member.isCoach === true) === coach) {
      throw new ClubError("conflict", coach ? `${fullName(member)} is already a coach.` : `${fullName(member)} is not marked as a coach.`);
    }
    if (coach) member.isCoach = true;
    else delete member.isCoach;
    log(
      s,
      newId,
      ctx,
      member.householdId,
      "coach_changed",
      coach ? `${fullName(member)} was marked as a coach by ${ctx.actor.label}.` : `${fullName(member)} is no longer marked as a coach (by ${ctx.actor.label}).`,
      { memberId, coach: coach ? "yes" : "no" },
    );
  });
}

/* ---------- Small helpers ---------- */

function practiceOrThrow(state: ClubState, id: string): Practice {
  const p = state.practices.find((x) => x.id === id);
  if (!p) throw new ClubError("not_found", "That practice no longer exists.");
  return p;
}

function itemById(state: ClubState, id: string): Item | undefined {
  return state.items.find((i) => i.id === id);
}

const activeBoats = (state: ClubState, practiceId: string): PracticeBoat[] => state.practiceBoats.filter((b) => b.practiceId === practiceId && b.endedAt === null);
const activeSeats = (state: ClubState, practiceId: string): PracticeSeat[] => state.practiceSeats.filter((s) => s.practiceId === practiceId && s.endedAt === null);

/** Control characters become spaces and runs of spaces collapse. For names. */
const cleanLine = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
/** Control characters other than line breaks become spaces. For notes. */
const cleanNote = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim();

function openForChanges(practice: Practice, now: Date): string | null {
  if (practice.status === "cancelled") return "That practice was cancelled, so it cannot be changed.";
  if (now.getTime() >= Date.parse(practice.endsAt)) return "That practice is over, so it cannot be changed.";
  return null;
}

function requireEditor(state: ClubState, ctx: Ctx, practice: Practice): void {
  if (!canEditPractice(state, ctx.actor, practice)) {
    throw new ClubError("forbidden", ctx.actor.kind === "member" && canRunPractices(state, ctx.actor) ? "Only the coach who runs this practice, or club staff, can change it." : "Only a coach or club staff can change a practice.");
  }
}

/* ---------- Bookings already made on a practice's boats ---------- */

export interface PracticeClash {
  bookingId: string;
  itemId: string;
  itemName: string;
  bookerId: string;
  bookerName: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Upcoming bookings on a practice's boats that overlap the practice. They are not cancelled: the coach and staff are shown the
 * list so someone can talk to the booker. Reads only.
 */
export function practiceClashes(state: ClubState, practiceId: string): PracticeClash[] {
  const practice = state.practices.find((p) => p.id === practiceId);
  if (!practice || practice.status !== "scheduled") return [];
  const start = Date.parse(practice.startsAt);
  const end = Date.parse(practice.endsAt);
  const boats = new Set(activeBoats(state, practiceId).map((b) => b.itemId));
  const out: PracticeClash[] = [];
  for (const b of state.bookings) {
    if (b.status !== "upcoming" || !boats.has(b.itemId)) continue;
    if (!(Date.parse(b.startsAt) < end && start < Date.parse(b.endsAt))) continue;
    const booker = memberById(state, b.bookerId);
    out.push({
      bookingId: b.id,
      itemId: b.itemId,
      itemName: itemById(state, b.itemId)?.name ?? "a boat",
      bookerId: b.bookerId,
      bookerName: booker ? fullName(booker) : "a member",
      startsAt: b.startsAt,
      endsAt: b.endsAt,
    });
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.itemName.localeCompare(b.itemName) || a.bookingId.localeCompare(b.bookingId));
}

/** A line for a member's own booking that a practice has since reserved the boat for, or null. */
export function practiceNoticeFor(state: ClubState, booking: Booking): string | null {
  if (booking.status !== "upcoming") return null;
  const held = practiceHold(state, booking.itemId, Date.parse(booking.startsAt), Date.parse(booking.endsAt));
  if (!held) return null;
  const boat = itemById(state, booking.itemId)?.name ?? "This boat";
  return `${boat} is also reserved for ${held.name} from ${formatRange(held.startsAt, held.endsAt)}. Please check with club staff before you go.`;
}

/* ---------- Which boats a practice can reserve ---------- */

/** Every reason this boat cannot be on a practice at these times. Empty means it can. Reads only. */
function boatReasons(state: ClubState, book: RuleBook, itemId: string, startsAt: Date, endsAt: Date, exceptPracticeId?: string): string[] {
  const item = itemById(state, itemId);
  if (!item) return ["That boat no longer exists."];
  if (isPrivate(item)) return [`${item.name} is a private boat. Its owners decide who uses it, so it cannot go on a practice.`];
  if (!BOOKING_TYPE_INFO[classOf(book, item).type].onWater || placesOf(item) > 1) return [`${item.name} is not a boat, so it cannot go on a practice.`];
  const reasons: string[] = [];
  const start = startsAt.getTime();
  const end = endsAt.getTime();
  for (const p of state.outOfService) {
    if (p.itemId !== item.id) continue;
    if (start < (p.until === null ? Infinity : Date.parse(p.until)) && Date.parse(p.from) < end) {
      reasons.push(`${item.name} is out of service${p.reason ? ` (${p.reason})` : ""}.`);
      break;
    }
  }
  const held = practiceHold(state, item.id, start, end, exceptPracticeId);
  if (held) reasons.push(`${item.name} is already reserved for ${held.name} from ${formatRange(held.startsAt, held.endsAt)}.`);
  return reasons;
}

/* ---------- Setting a practice up ---------- */

export interface PracticeInput {
  name: string;
  notes?: string;
  startsAt: Date;
  endsAt: Date;
  /** Staff may name a coach; a coach setting one up runs it themselves. Leave empty for a practice staff run. */
  coachId?: string | null;
  itemIds?: string[];
}

export interface PracticeCreated {
  practice: Practice;
  /** Bookings already made on its boats at that time. Nothing was cancelled; someone needs to talk to them. */
  clashes: PracticeClash[];
}

/** A coach or club staff sets up a practice and reserves its boats. Everything is checked and written as one all-or-nothing change. */
export async function createPractice(store: ClubStore, book: RuleBook, rules: PracticeRules, ctx: Ctx, input: PracticeInput): Promise<PracticeCreated> {
  const limits = rules.defaults;
  return store.transaction(async (s, newId) => {
    if (!canRunPractices(s, ctx.actor)) throw new ClubError("forbidden", "Only a coach or club staff can set up a practice.");
    const reasons: string[] = [];
    const name = cleanLine(input.name);
    const notes = cleanNote(input.notes ?? "");
    if (!name) reasons.push("Give the practice a name.");
    else if (name.length > limits.nameMax) reasons.push(`The name can be up to ${plural(limits.nameMax, "character")}.`);
    if (notes.length > limits.notesMax) reasons.push(`The note can be up to ${plural(limits.notesMax, "character")}.`);

    const start = input.startsAt.getTime();
    const end = input.endsAt.getTime();
    const now = ctx.now.getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) reasons.push("Give the practice a start and an end time.");
    else if (end <= start) reasons.push("The practice must end after it starts.");
    else {
      if (start <= now) reasons.push("That practice starts in the past. Choose a later time.");
      if (end - start > ms(limits.maxHours * 60)) reasons.push(`A practice can run up to ${plural(limits.maxHours, "hour")}.`);
      const farthest = pacificDayStart(addDays(pacificDate(ctx.now), limits.daysAhead + 1)).getTime();
      if (start >= farthest) reasons.push(`A practice can be set up up to ${plural(limits.daysAhead, "day")} ahead.`);
    }

    let coachId: string | null = null;
    if (ctx.actor.kind === "member") {
      coachId = ctx.actor.memberId;
      if (input.coachId && input.coachId !== ctx.actor.memberId) reasons.push("A coach can only set up a practice they run themselves.");
    } else if (input.coachId) {
      if (activeCoach(s, input.coachId)) coachId = input.coachId;
      else reasons.push("Choose a coach: a member staff have marked as one.");
    }

    const itemIds = input.itemIds ?? [];
    if (new Set(itemIds).size !== itemIds.length) reasons.push("The same boat is listed twice.");
    if (itemIds.length > limits.maxBoats) reasons.push(`A practice can reserve up to ${plural(limits.maxBoats, "boat")}.`);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
      for (const id of new Set(itemIds)) reasons.push(...boatReasons(s, book, id, input.startsAt, input.endsAt));
    }
    if (reasons.length > 0) throw new PracticeRefused(reasons);

    const at = ctx.now.toISOString();
    const practice: Practice = {
      id: newId(),
      name,
      notes,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      status: "scheduled",
      coachId,
      createdAt: at,
      createdBy: ctx.actor,
      statusChangedAt: at,
      cancelledBy: null,
      cancelReason: null,
    };
    s.practices.push(practice);
    for (const itemId of itemIds) s.practiceBoats.push({ id: newId(), practiceId: practice.id, itemId, addedAt: at, addedBy: ctx.actor, endedAt: null, endedBy: null });
    return { practice: structuredClone(practice), clashes: practiceClashes(s, practice.id) };
  });
}

/** Cancels a practice before it starts. Its boats are free again at once. Nobody is told by email; the lineup simply disappears from their screen. */
export async function cancelPractice(store: ClubStore, rules: PracticeRules, ctx: Ctx, practiceId: string, reason?: string): Promise<Practice> {
  return store.transaction(async (s) => {
    const practice = practiceOrThrow(s, practiceId);
    requireEditor(s, ctx, practice);
    if (practice.status === "cancelled") throw new ClubError("conflict", "That practice is already cancelled.");
    if (ctx.now.getTime() >= Date.parse(practice.startsAt)) throw new ClubError("conflict", "That practice has already started, so it cannot be cancelled.");
    const why = cleanLine(reason ?? "");
    if (why.length > rules.defaults.reasonMax) throw new ClubError("invalid", `The reason can be up to ${plural(rules.defaults.reasonMax, "character")}.`);
    practice.status = "cancelled";
    practice.statusChangedAt = ctx.now.toISOString();
    practice.cancelledBy = ctx.actor;
    practice.cancelReason = why || null;
    return structuredClone(practice);
  });
}

/** Reserves one more boat for a practice. Returns the bookings already made on it at that time (nothing is cancelled). */
export async function addPracticeBoat(store: ClubStore, book: RuleBook, rules: PracticeRules, ctx: Ctx, practiceId: string, itemId: string): Promise<{ clashes: PracticeClash[] }> {
  return store.transaction(async (s, newId) => {
    const practice = practiceOrThrow(s, practiceId);
    requireEditor(s, ctx, practice);
    const closed = openForChanges(practice, ctx.now);
    if (closed) throw new PracticeRefused([closed]);
    const reasons: string[] = [];
    const item = itemById(s, itemId);
    if (item && activeBoats(s, practiceId).some((b) => b.itemId === itemId)) reasons.push(`${item.name} is already on this practice.`);
    else {
      if (activeBoats(s, practiceId).length >= rules.defaults.maxBoats) reasons.push(`A practice can reserve up to ${plural(rules.defaults.maxBoats, "boat")}.`);
      reasons.push(...boatReasons(s, book, itemId, new Date(practice.startsAt), new Date(practice.endsAt), practiceId));
    }
    if (reasons.length > 0) throw new PracticeRefused(reasons);
    s.practiceBoats.push({ id: newId(), practiceId, itemId, addedAt: ctx.now.toISOString(), addedBy: ctx.actor, endedAt: null, endedBy: null });
    return { clashes: practiceClashes(s, practiceId) };
  });
}

/** Takes a boat off a practice: it is free to book again, and everyone seated in it is taken out of their seat. */
export async function removePracticeBoat(store: ClubStore, ctx: Ctx, practiceId: string, itemId: string): Promise<{ unseated: number }> {
  return store.transaction(async (s) => {
    const practice = practiceOrThrow(s, practiceId);
    requireEditor(s, ctx, practice);
    const closed = openForChanges(practice, ctx.now);
    if (closed) throw new PracticeRefused([closed]);
    const line = activeBoats(s, practiceId).find((b) => b.itemId === itemId);
    if (!line) throw new ClubError("not_found", "That boat is not on this practice.");
    const at = ctx.now.toISOString();
    line.endedAt = at;
    line.endedBy = ctx.actor;
    const name = itemById(s, itemId)?.name ?? "The boat";
    const seats = activeSeats(s, practiceId).filter((x) => x.itemId === itemId);
    for (const seat of seats) {
      seat.endedAt = at;
      seat.endedBy = ctx.actor;
      seat.endedReason = `${name} came off the practice`;
    }
    return { unseated: seats.length };
  });
}

/* ---------- The lineup ---------- */

export interface SeatRequest {
  practiceId: string;
  itemId: string;
  /** Counting from 1. */
  seat: number;
  /** The side this person rows on, or null (sculling, or not decided). */
  side: SeatSide | null;
  memberId: string;
}

/**
 * Every reason this person cannot sit in this seat, in a fixed order, in plain language. Empty means they can. Reads only.
 * None of these can be set aside: they are facts, not club rules. There is no skill check: the coach decides.
 */
export function checkSeat(state: ClubState, book: RuleBook, ctx: Ctx, req: SeatRequest): string[] {
  const practice = practiceOrThrow(state, req.practiceId);
  const closed = openForChanges(practice, ctx.now);
  if (closed) return [closed];
  const line = activeBoats(state, practice.id).find((b) => b.itemId === req.itemId);
  const item = itemById(state, req.itemId);
  if (!line || !item) return ["That boat is not on this practice."];
  const reasons: string[] = [];
  const seats = classOf(book, item).seats;
  if (!Number.isInteger(req.seat) || req.seat < 1 || req.seat > seats) {
    reasons.push(`${item.name} has ${plural(seats, "seat")}, so there is no seat ${Number.isInteger(req.seat) ? req.seat : "like that"}.`);
  } else {
    const taken = activeSeats(state, practice.id).find((x) => x.itemId === item.id && x.seat === req.seat);
    if (taken) reasons.push(`Seat ${req.seat} in ${item.name} is already taken by ${nameOf(state, taken.memberId)}.`);
  }
  if (req.side !== null && !SEAT_SIDES.includes(req.side)) reasons.push("The side must be port, starboard or left empty.");

  const member = memberById(state, req.memberId);
  if (!member) {
    reasons.push("That member no longer exists.");
    return reasons;
  }
  const who = fullName(member);
  const blocked = blockReasonFor(state, member.id, "they cannot be seated");
  if (blocked) reasons.push(`${who} cannot be seated: ${blocked}`);
  const here = activeSeats(state, practice.id).find((x) => x.memberId === member.id);
  if (here) reasons.push(`${who} is already in this practice: ${itemById(state, here.itemId)?.name ?? "a boat"}, seat ${here.seat}. Take them out of that seat first.`);

  // Nobody is in two places at once: a boat they booked or are crew in, a class, or another practice.
  const start = Date.parse(practice.startsAt);
  const end = Date.parse(practice.endsAt);
  const boat = state.bookings.find((b) => {
    if (!HOLDING_STATUSES.includes(b.status) || !(b.bookerId === member.id || b.crew.includes(member.id))) return false;
    const booked = itemById(state, b.itemId);
    return !!booked && BOOKING_TYPE_INFO[classOf(book, booked).type].onWater && Date.parse(b.startsAt) < end && start < Date.parse(b.endsAt);
  });
  if (boat) reasons.push(`${who} has ${itemById(state, boat.itemId)?.name ?? "a boat"} booked from ${formatRange(boat.startsAt, boat.endsAt)}.`);
  const cls = classClash(state, member.id, start, end);
  if (cls) reasons.push(`${who} is ${cls.waiting ? "on the waiting list for" : "signed up for"} ${cls.className} from ${formatRange(cls.startsAt, cls.endsAt)}.`);
  const other = practiceSeatClash(state, member.id, start, end, practice.id);
  if (other) reasons.push(`${who} is in the lineup for ${other.practiceName} from ${formatRange(other.startsAt, other.endsAt)}.`);
  return reasons;
}

function nameOf(state: ClubState, memberId: string): string {
  const m = memberById(state, memberId);
  return m ? fullName(m) : "a member";
}

/** Puts a person in a seat. A coach seats people in the practices they run; staff in any. */
export async function seatMember(store: ClubStore, book: RuleBook, ctx: Ctx, req: SeatRequest): Promise<PracticeSeat> {
  return store.transaction(async (s, newId) => {
    const practice = practiceOrThrow(s, req.practiceId);
    requireEditor(s, ctx, practice);
    const reasons = checkSeat(s, book, ctx, req);
    if (reasons.length > 0) throw new PracticeRefused(reasons);
    const seat: PracticeSeat = {
      id: newId(),
      practiceId: req.practiceId,
      itemId: req.itemId,
      seat: req.seat,
      side: req.side,
      memberId: req.memberId,
      addedAt: ctx.now.toISOString(),
      addedBy: ctx.actor,
      endedAt: null,
      endedBy: null,
      endedReason: null,
    };
    s.practiceSeats.push(seat);
    return structuredClone(seat);
  });
}

/** Takes the person out of a seat. The line is kept, with who took them out. */
export async function clearSeat(store: ClubStore, rules: PracticeRules, ctx: Ctx, input: { practiceId: string; itemId: string; seat: number; reason?: string }): Promise<void> {
  await store.transaction(async (s) => {
    const practice = practiceOrThrow(s, input.practiceId);
    requireEditor(s, ctx, practice);
    const closed = openForChanges(practice, ctx.now);
    if (closed) throw new PracticeRefused([closed]);
    const line = activeSeats(s, input.practiceId).find((x) => x.itemId === input.itemId && x.seat === input.seat);
    if (!line) throw new ClubError("conflict", "Nobody is in that seat.");
    const why = cleanLine(input.reason ?? "");
    if (why.length > rules.defaults.reasonMax) throw new ClubError("invalid", `The reason can be up to ${plural(rules.defaults.reasonMax, "character")}.`);
    line.endedAt = ctx.now.toISOString();
    line.endedBy = ctx.actor;
    line.endedReason = `Taken out by ${ctx.actor.label}${why ? `: ${why}` : ""}`;
  });
}

/* ---------- Finding a rower to seat ---------- */

/**
 * Like the other name searches: nothing until three letters are typed, never more than six names, only active members who are not
 * already in this practice, names only (no email or phone), and two people with one name told apart by household.
 */
export function findRowers(state: ClubState, practiceId: string, typed: string): BoatPeopleSearch {
  const wanted = typed.trim();
  const letters = wanted.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "");
  if (letters.length < PEOPLE_SEARCH_MIN_LETTERS) return { tooShort: true, people: [], more: false };
  const seated = new Set(activeSeats(state, practiceId).map((x) => x.memberId));
  const found = state.members
    .filter((m) => !seated.has(m.id) && blockReasonFor(state, m.id) === null && nameMatches(fullName(m), wanted))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id));
  const shown = found.slice(0, PEOPLE_SEARCH_MOST);
  const counts = new Map<string, number>();
  for (const m of shown) counts.set(fullName(m), (counts.get(fullName(m)) ?? 0) + 1);
  return {
    tooShort: false,
    people: shown.map((m) => ({ memberId: m.id, name: fullName(m), household: (counts.get(fullName(m)) ?? 0) > 1 ? householdOf(state, m.householdId)!.displayName : null })),
    more: found.length > shown.length,
  };
}

/* ---------- What people see ---------- */

export interface SeatView {
  seat: number;
  side: SeatSide | null;
  memberId: string | null;
  name: string | null;
  /** False for someone who has left the club since they were seated: the seat shows it, and no longer holds their time. */
  active: boolean;
}

export interface PracticeBoatView {
  itemId: string;
  name: string;
  className: string;
  seats: SeatView[];
}

export interface PracticeClashView extends PracticeClash {
  /** Only staff see how to reach the booker. */
  contact: { email: string; phone: string } | null;
}

export interface PracticeDetail {
  id: string;
  name: string;
  notes: string;
  startsAt: string;
  endsAt: string;
  status: Practice["status"];
  cancelReason: string | null;
  /** "Staff" when staff run it. */
  coachName: string;
  /** False when the coach has since been unmarked or has left: staff can still change the practice. */
  coachActive: boolean;
  started: boolean;
  ended: boolean;
  canEdit: boolean;
  boats: PracticeBoatView[];
  /** Bookings already made on its boats at that time; only for people who can change the practice. */
  clashes: PracticeClashView[];
  /** The viewer's own place, if they are seated. */
  mine: { boat: string; seat: number; side: SeatSide | null } | null;
}

function seatViews(state: ClubState, book: RuleBook, practiceId: string, item: Item): SeatView[] {
  const seats = classOf(book, item).seats;
  const lines = activeSeats(state, practiceId).filter((x) => x.itemId === item.id);
  return Array.from({ length: seats }, (_, i) => {
    const line = lines.find((x) => x.seat === i + 1);
    const member = line ? memberById(state, line.memberId) : undefined;
    return { seat: i + 1, side: line?.side ?? null, memberId: line?.memberId ?? null, name: member ? fullName(member) : null, active: line ? blockReasonFor(state, line.memberId) === null : true };
  });
}

/**
 * One practice as this person may see it, or null if they may not. Staff and coaches see everything. A member who is seated sees
 * the practice and their own boat with the names of the people in it, nothing else.
 */
export function practiceDetail(state: ClubState, book: RuleBook, practiceId: string, viewer: Actor, now: Date): PracticeDetail | null {
  const practice = state.practices.find((p) => p.id === practiceId);
  if (!practice) return null;
  const runner = canRunPractices(state, viewer);
  const seatOf = viewer.kind === "member" ? activeSeats(state, practiceId).find((x) => x.memberId === viewer.memberId) : undefined;
  if (!runner && (!seatOf || practice.status !== "scheduled")) return null;
  const canEdit = canEditPractice(state, viewer, practice);
  const boats = activeBoats(state, practiceId)
    .filter((b) => runner || b.itemId === seatOf?.itemId)
    .map((b) => ({ boat: b, item: itemById(state, b.itemId) }))
    .filter((x): x is { boat: PracticeBoat; item: Item } => x.item !== undefined)
    .sort((a, b) => a.item.name.localeCompare(b.item.name))
    .map(({ item }): PracticeBoatView => ({ itemId: item.id, name: item.name, className: classOf(book, item).name, seats: seatViews(state, book, practiceId, item) }));
  const coach = practice.coachId ? memberById(state, practice.coachId) : undefined;
  const clashes: PracticeClashView[] = canEdit
    ? practiceClashes(state, practiceId).map((c) => {
        const booker = memberById(state, c.bookerId);
        return { ...c, contact: viewer.kind === "staff" && booker ? { email: booker.email, phone: booker.phone } : null };
      })
    : [];
  return {
    id: practice.id,
    name: practice.name,
    notes: practice.notes,
    startsAt: practice.startsAt,
    endsAt: practice.endsAt,
    status: practice.status,
    cancelReason: practice.cancelReason,
    coachName: coach ? fullName(coach) : "Staff",
    coachActive: !practice.coachId || activeCoach(state, practice.coachId) !== undefined,
    started: now.getTime() >= Date.parse(practice.startsAt),
    ended: now.getTime() >= Date.parse(practice.endsAt),
    canEdit: canEdit && openForChanges(practice, now) === null,
    boats,
    clashes,
    mine: seatOf ? { boat: itemById(state, seatOf.itemId)?.name ?? "a boat", seat: seatOf.seat, side: seatOf.side } : null,
  };
}

export interface PracticeRow {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: Practice["status"];
  coachName: string;
  boats: number;
  seated: number;
  seatsTotal: number;
  /** Bookings already made on its boats at that time. */
  clashes: number;
  canEdit: boolean;
}

/** The list for staff and coaches: practices still to come (soonest first), or past and cancelled ones (newest first, 50 at most). */
export function practiceList(state: ClubState, book: RuleBook, viewer: Actor, now: Date, which: "upcoming" | "past"): PracticeRow[] {
  if (!canRunPractices(state, viewer)) return [];
  const upcoming = (p: Practice) => p.status === "scheduled" && Date.parse(p.endsAt) > now.getTime();
  const rows = state.practices
    .filter((p) => (which === "upcoming" ? upcoming(p) : !upcoming(p)))
    .sort((a, b) => (which === "upcoming" ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt)) || a.id.localeCompare(b.id))
    .slice(0, which === "past" ? 50 : undefined)
    .map((p): PracticeRow => {
      const coach = p.coachId ? memberById(state, p.coachId) : undefined;
      const boats = activeBoats(state, p.id);
      const items = boats.map((b) => itemById(state, b.itemId)).filter((i): i is Item => i !== undefined);
      return {
        id: p.id,
        name: p.name,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        status: p.status,
        coachName: coach ? fullName(coach) : "Staff",
        boats: boats.length,
        seated: activeSeats(state, p.id).length,
        seatsTotal: items.reduce((sum, i) => sum + classOf(book, i).seats, 0),
        clashes: practiceClashes(state, p.id).length,
        canEdit: canEditPractice(state, viewer, p) && openForChanges(p, now) === null,
      };
    });
  return rows;
}

export interface MyPracticeLine {
  practiceId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  coachName: string;
  boat: string;
  seat: number;
  side: SeatSide | null;
  /** The other people in the same boat. */
  crew: string[];
}

/** The practices still to come that this member is seated in, soonest first. */
export function myPractices(state: ClubState, memberId: string, now: Date): MyPracticeLine[] {
  const lines: MyPracticeLine[] = [];
  for (const seat of state.practiceSeats.filter((x) => x.memberId === memberId && x.endedAt === null)) {
    const p = state.practices.find((x) => x.id === seat.practiceId);
    if (!p || p.status !== "scheduled" || Date.parse(p.endsAt) <= now.getTime()) continue;
    if (!activeBoats(state, p.id).some((b) => b.itemId === seat.itemId)) continue;
    const coach = p.coachId ? memberById(state, p.coachId) : undefined;
    lines.push({
      practiceId: p.id,
      name: p.name,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      coachName: coach ? fullName(coach) : "Staff",
      boat: itemById(state, seat.itemId)?.name ?? "a boat",
      seat: seat.seat,
      side: seat.side,
      crew: activeSeats(state, p.id)
        .filter((x) => x.itemId === seat.itemId && x.memberId !== memberId)
        .sort((a, b) => a.seat - b.seat)
        .map((x) => nameOf(state, x.memberId)),
    });
  }
  return lines.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.practiceId.localeCompare(b.practiceId));
}

/** "Port", "Starboard" or "No side". */
export const sideWords = (side: SeatSide | null): string => (side === "port" ? "Port" : side === "starboard" ? "Starboard" : "No side");

/* ---------- Choices for the screens ---------- */

/** The boats that can go on a practice: club boats, kayaks and paddle boards (not a private boat, a dock or a room), by name. */
export function reservableBoats(state: ClubState, book: RuleBook): { id: string; name: string; className: string; seats: number }[] {
  return state.items
    .filter((i) => !isPrivate(i) && placesOf(i) === 1 && BOOKING_TYPE_INFO[classOf(book, i).type].onWater)
    .map((i) => ({ id: i.id, name: i.name, className: classOf(book, i).name, seats: classOf(book, i).seats }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Members staff have marked as coaches who are still active, by last name. Names only. */
export function activeCoaches(state: ClubState): { id: string; name: string }[] {
  return state.members
    .filter((m) => activeCoach(state, m.id) !== undefined)
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, name: fullName(m) }));
}
