import { ClubError } from "../errors";
import { classOf, rulesFor } from "../settings/rulebook";
import type { ClubStore } from "../store/memory";
import {
  addDays,
  clockToMinutes,
  formatClock,
  formatDay,
  formatDayLong,
  formatMinutes,
  formatRange,
  pacificDate,
  pacificWall,
} from "../time";
import {
  BOOKING_TYPE_INFO,
  HOLDING_STATUSES,
  type Booking,
  type ClubState,
  type Item,
  type OutOfServicePeriod,
  type RuleBook,
} from "../types";
import { accessKind, boatLocked, crewNotAllowedWords, isPrivate, lockedWords, notAllowedWords } from "./boat-access";
import { bookingBlockReason, meetsQualification } from "./eligibility";
import type { BookingLedger, Ctx } from "./households";
import { firstFullStretch, holdingIn, placesOf } from "./pools";
import { classClash, fullName, householdOf, memberById } from "./queries";

/* ---------- Why a booking is refused ---------- */

export type ReasonCode =
  | "member_blocked"
  | "crew_blocked"
  | "boat_locked"
  | "not_allowed_on_boat"
  | "crew_not_allowed"
  | "out_of_service"
  | "starts_in_past"
  | "too_far_ahead"
  | "outside_hours"
  | "not_on_slot"
  | "too_short"
  | "too_long"
  | "not_qualified"
  | "crew_not_qualified"
  | "too_many_crew"
  | "over_future_limit"
  | "over_daily_limit"
  | "slot_taken"
  | "already_has_place"
  | "gap_needed"
  | "person_busy"
  | "in_class"
  | "room_in_use";

/** One plain-language reason a booking cannot be made. */
export interface Reason {
  code: ReasonCode;
  message: string;
  /** True for club rules staff may set aside (with a logged reason). False for facts: the boat is taken, the member left. */
  overridable: boolean;
}

/**
 * The rules staff can book past. Never the facts: a taken slot, a boat out of service, a member who has left, a time already gone,
 * and who may use a private boat (that is the owner's say, not the club's).
 */
const OVERRIDABLE: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  "too_far_ahead",
  "outside_hours",
  "not_on_slot",
  "too_short",
  "too_long",
  "not_qualified",
  "crew_not_qualified",
  "over_future_limit",
  "over_daily_limit",
  "gap_needed",
]);

/** Thrown when a booking cannot be made. `message` is the first reason; `reasons` is all of them. */
export class BookingRefused extends ClubError {
  constructor(public reasons: Reason[]) {
    super("refused", reasons[0]?.message ?? "That booking cannot be made.");
  }
}

export interface BookingRequest {
  itemId: string;
  /** The person who owns the booking and is in the boat. */
  bookerId: string;
  startsAt: Date;
  endsAt: Date;
  /** Other members in a multi-seat boat. */
  crewIds?: string[];
}

const ms = (minutes: number) => minutes * 60000;
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function itemById(state: ClubState, id: string): Item {
  const item = state.items.find((i) => i.id === id);
  if (!item) throw new ClubError("not_found", "That item no longer exists.");
  return item;
}

function memberOrThrow(state: ClubState, id: string) {
  const member = memberById(state, id);
  if (!member) throw new ClubError("not_found", "That member no longer exists.");
  return member;
}

/** The moment a given day opens for booking under these rules. */
export function opensAt(day: string, windowDays: number, opens: string): Date {
  return pacificWall(addDays(day, -windowDays), clockToMinutes(opens));
}

/** The first and last bookable moments of a day. */
export function dayWindow(day: string, dayStart: string, dayEnd: string): { open: Date; close: Date } {
  const end = clockToMinutes(dayEnd);
  return { open: pacificWall(day, clockToMinutes(dayStart)), close: end >= 1440 ? pacificWall(addDays(day, 1), 0) : pacificWall(day, end) };
}

/** "midnight" for 00:00, otherwise "7:30 am". */
export function clockWords(day: string, minutes: number): string {
  return minutes === 0 ? "midnight" : formatClock(pacificWall(day, minutes));
}

/**
 * Every reason this booking cannot be made, in a fixed order, in plain language. Empty means it can be.
 * Reads only: nothing is booked. Used both by the booking form (to explain) and by createBooking (to decide).
 */
export function checkBooking(state: ClubState, book: RuleBook, ctx: Ctx, req: BookingRequest): Reason[] {
  const item = itemById(state, req.itemId);
  const booker = memberOrThrow(state, req.bookerId);
  const { cls, rules, requiredQualification } = rulesFor(book, item);
  const start = req.startsAt.getTime();
  const end = req.endsAt.getTime();
  const now = ctx.now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return [{ code: "starts_in_past", message: "The end time must be after the start time.", overridable: false }];
  }

  const crewIds = req.crewIds ?? [];
  if (new Set(crewIds).size !== crewIds.length) throw new ClubError("invalid", "The same person is listed twice in the crew.");
  if (crewIds.includes(req.bookerId)) throw new ClubError("invalid", "The person booking is already in the boat; list only the other crew.");
  const crew = crewIds.map((id) => memberOrThrow(state, id));

  const isYou = (id: string) => ctx.actor.kind === "member" && ctx.actor.memberId === id;
  const who = (id: string) => (isYou(id) ? "You" : fullName(memberOrThrow(state, id)));
  const reasons: Reason[] = [];
  const add = (code: ReasonCode, message: string) => reasons.push({ code, message, overridable: OVERRIDABLE.has(code) });

  // Who may book at all.
  const blocked = bookingBlockReason(booker, householdOf(state, booker.householdId));
  if (blocked) add("member_blocked", blocked);
  for (const m of crew) {
    const why = bookingBlockReason(m, householdOf(state, m.householdId));
    if (why) add("crew_blocked", `${fullName(m)} cannot be added to the crew: ${why}`);
  }

  // A private boat: only its owners and the people they invited, in the booker's seat and in every other seat.
  if (isPrivate(item)) {
    if (boatLocked(state, item)) add("boat_locked", lockedWords(item));
    if (accessKind(state, item.id, booker.id) === null) add("not_allowed_on_boat", notAllowedWords(item, { name: fullName(booker), you: isYou(booker.id) }));
    for (const m of crew) {
      if (accessKind(state, item.id, m.id) === null) add("crew_not_allowed", crewNotAllowedWords(item, fullName(m)));
    }
  }

  // The item.
  for (const p of state.outOfService) {
    if (p.itemId !== item.id) continue;
    if (overlaps(start, end, Date.parse(p.from), p.until === null ? Infinity : Date.parse(p.until))) {
      add("out_of_service", `${item.name} is out of service${p.reason ? ` (${p.reason})` : ""}${p.expectedReturn ? `, expected back ${formatDay(p.expectedReturn)}` : ""}.`);
      break;
    }
  }

  // When.
  const day = pacificDate(req.startsAt);
  if (start < now) add("starts_in_past", "That time has already started. Choose a later time.");
  const opens = opensAt(day, rules.windowDays, rules.opensAt);
  if (now < opens.getTime()) {
    const openDay = pacificDate(opens);
    add(
      "too_far_ahead",
      `You can book up to ${plural(rules.windowDays, "day")} ahead. ${formatDayLong(day)} opens ${formatDayLong(openDay)} at ${clockWords(openDay, clockToMinutes(rules.opensAt))}.`,
    );
  }
  const { open, close } = dayWindow(day, rules.dayStart, rules.dayEnd);
  if (start < open.getTime() || end > close.getTime()) {
    add("outside_hours", `${item.name} can be booked from ${formatClock(open)} to ${formatClock(close)}.`);
  }
  if ((start - open.getTime()) % ms(rules.slotMinutes) !== 0 || (end - start) % ms(rules.slotMinutes) !== 0) {
    add("not_on_slot", `Bookings run in ${rules.slotMinutes}-minute steps, counted from ${formatClock(open)}.`);
  }
  const minutes = (end - start) / 60000;
  if (minutes < rules.minMinutes) add("too_short", `The shortest booking is ${formatMinutes(rules.minMinutes)}.`);
  if (minutes > rules.maxMinutes) add("too_long", `The longest booking is ${formatMinutes(rules.maxMinutes)}.`);

  // Skill. A private boat's skill level is not checked: its owner vouches for who uses it.
  const need = requiredQualification && !isPrivate(item) ? state.qualifications.find((q) => q.code === requiredQualification) : undefined;
  if (need && !meetsQualification(state, booker.id, need.code)) {
    add("not_qualified", `${who(booker.id)} ${isYou(booker.id) ? "need" : "needs"} ${need.name} to use ${item.name}.`);
  }

  // Crew.
  if (crew.length > cls.seats - 1) {
    add("too_many_crew", cls.seats === 1 ? `${item.name} has room for one person.` : `${item.name} has ${cls.seats} seats, so there is room for ${plural(cls.seats - 1, "other person").replace("persons", "people")}.`);
  }
  if (need) {
    for (const m of crew) {
      if (!meetsQualification(state, m.id, need.code)) add("crew_not_qualified", `${fullName(m)} needs ${need.name} to crew ${item.name}.`);
    }
  }

  // Limits on the booker. Crew do not count toward their own limits.
  const mine = state.bookings.filter((b) => b.bookerId === booker.id && sameType(state, book, b, item));
  const holding = mine.filter((b) => b.status === "upcoming" && Date.parse(b.endsAt) > now).length;
  if (rules.maxFuturePerType > 0 && holding >= rules.maxFuturePerType) {
    add(
      "over_future_limit",
      `${who(booker.id)} already ${isYou(booker.id) ? "hold" : "holds"} ${plural(holding, cls.type.toLowerCase() + " booking")}, the most allowed at once. Cancel one or wait until one is done.`,
    );
  }
  const sameDay = mine.filter((b) => HOLDING_STATUSES.includes(b.status) && pacificDate(new Date(b.startsAt)) === day).length;
  if (rules.maxPerDayPerType > 0 && sameDay >= rules.maxPerDayPerType) {
    add(
      "over_daily_limit",
      `${who(booker.id)} can have ${plural(rules.maxPerDayPerType, cls.type.toLowerCase() + " booking")} a day, and ${isYou(booker.id) ? "you" : "they"} already have ${sameDay === 1 ? "one" : sameDay} on ${formatDayLong(day)}.`,
    );
  }

  // The item is free. A pool is counted: at no moment may more people hold it than it has places. Nobody holds two places of one
  // pool at once. A single item is simply taken or not, and may ask for a gap between bookings.
  const places = placesOf(item);
  if (places > 1) {
    const mineHere = holdingIn(state, item.id, start, end).find((b) => b.bookerId === booker.id);
    if (mineHere) {
      add("already_has_place", `${who(booker.id)} already ${isYou(booker.id) ? "have" : "has"} a place in ${item.name} from ${formatRange(mineHere.startsAt, mineHere.endsAt)}. It is one place at a time.`);
    }
    const full = firstFullStretch(state, item.id, start, end, places);
    if (full) {
      add("slot_taken", `${item.name} is full from ${formatRange(new Date(full.from).toISOString(), new Date(full.to).toISOString())}: all ${places} places are booked.`);
    }
  } else {
    const gap = ms(rules.gapMinutes);
    for (const b of state.bookings) {
      if (b.itemId !== item.id || !HOLDING_STATUSES.includes(b.status)) continue;
      const bs = Date.parse(b.startsAt);
      const be = Date.parse(b.endsAt);
      if (overlaps(start, end, bs, be)) {
        add("slot_taken", `${item.name} is already booked from ${formatRange(b.startsAt, b.endsAt)}.`);
        break;
      }
      if (gap > 0 && overlaps(start, end, bs - gap, be + gap)) {
        add("gap_needed", `${item.name} needs ${formatMinutes(rules.gapMinutes)} free between bookings.`);
        break;
      }
    }
  }

  // Nobody is in two boats at once.
  if (BOOKING_TYPE_INFO[cls.type].onWater) {
    for (const person of [booker, ...crew]) {
      const clash = state.bookings.find(
        (b) =>
          HOLDING_STATUSES.includes(b.status) &&
          (b.bookerId === person.id || b.crew.includes(person.id)) &&
          BOOKING_TYPE_INFO[classOf(book, itemById(state, b.itemId)).type].onWater &&
          overlaps(start, end, Date.parse(b.startsAt), Date.parse(b.endsAt)),
      );
      if (clash) add("person_busy", `${who(person.id)} ${isYou(person.id) ? "are" : "is"} already on another boat from ${formatRange(clash.startsAt, clash.endsAt)}.`);
    }
  }

  // Nobody is in a class and on the water at once. A place on a waiting list holds the time too.
  if (BOOKING_TYPE_INFO[cls.type].onWater) {
    for (const person of [booker, ...crew]) {
      const clash = classClash(state, person.id, start, end);
      if (clash) {
        add("in_class", `${who(person.id)} ${isYou(person.id) ? "are" : "is"} ${clash.waiting ? "on the waiting list for" : "signed up for"} ${clash.className} from ${formatRange(clash.startsAt, clash.endsAt)}.`);
      }
    }
  }

  // A class holds its room while it runs.
  if (state.sessions.length > 0) {
    const held = state.sessions.find(
      (x) => x.status === "scheduled" && x.roomItemId === item.id && overlaps(start, end, Date.parse(x.startsAt), Date.parse(x.endsAt)),
    );
    if (held) {
      const name = state.classes.find((k) => k.id === held.classId)?.name ?? "a class";
      add("room_in_use", `${item.name} is being used for ${name} from ${formatRange(held.startsAt, held.endsAt)}.`);
    }
  }
  return reasons;
}

function sameType(state: ClubState, book: RuleBook, booking: Booking, item: Item): boolean {
  return classOf(book, itemById(state, booking.itemId)).type === classOf(book, item).type;
}

/* ---------- Booking ---------- */

export interface BookingOptions {
  /** Staff only: book past the club rules. A reason is required and is recorded with exactly which rules were set aside. */
  override?: { reason: string };
}

export async function createBooking(
  store: ClubStore,
  book: RuleBook,
  ctx: Ctx,
  req: BookingRequest,
  options: BookingOptions = {},
): Promise<{ booking: Booking; waived: ReasonCode[] }> {
  if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only a member or club staff can make a booking.");
  if (ctx.actor.kind === "member" && ctx.actor.memberId !== req.bookerId) throw new ClubError("forbidden", "You can only make bookings for yourself.");
  let overrideReason: string | null = null;
  if (options.override) {
    if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can book past the rules.");
    overrideReason = options.override.reason.trim();
    if (!overrideReason) throw new ClubError("invalid", "Say why the rules are being set aside; the reason is kept in the record.");
    if (overrideReason.length > 300) throw new ClubError("invalid", "The reason must be 300 characters or fewer.");
  }
  return store.transaction(async (s, newId) => {
    const reasons = checkBooking(s, book, ctx, req);
    const blocking = reasons.filter((r) => !overrideReason || !r.overridable);
    if (blocking.length > 0) throw new BookingRefused(blocking);
    const waived = reasons.map((r) => r.code);
    const at = ctx.now.toISOString();
    const booking: Booking = {
      id: newId(),
      itemId: req.itemId,
      bookerId: req.bookerId,
      crew: [...(req.crewIds ?? [])],
      startsAt: req.startsAt.toISOString(),
      endsAt: req.endsAt.toISOString(),
      status: "upcoming",
      createdAt: at,
      createdBy: ctx.actor,
      statusChangedAt: at,
      cancelledBy: null,
      cancelReason: null,
      override: overrideReason && waived.length > 0 ? { reason: overrideReason, actor: ctx.actor, waived } : null,
      removedCrew: [],
    };
    s.bookings.push(booking);
    return { booking: structuredClone(booking), waived };
  });
}

/* ---------- Cancelling and attendance ---------- */

const STATUS_WORDS: Record<Booking["status"], string> = {
  upcoming: "upcoming",
  completed: "marked completed",
  cancelled: "cancelled",
  late_cancelled: "cancelled late",
  no_show: "marked as a no-show",
};

/**
 * The booker (or staff) cancels. The slot is freed at once. If it is later than the cutoff before the start, the
 * member's own cancellation is recorded as late. Staff cancelling for a member is never recorded against the member.
 */
export async function cancelBooking(
  store: ClubStore,
  book: RuleBook,
  ctx: Ctx,
  bookingId: string,
  options: { reason?: string } = {},
): Promise<{ booking: Booking; late: boolean }> {
  return store.transaction(async (s) => {
    const booking = s.bookings.find((b) => b.id === bookingId);
    if (!booking) throw new ClubError("not_found", "That booking no longer exists.");
    if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only the member who booked, or club staff, can cancel.");
    if (ctx.actor.kind === "member" && ctx.actor.memberId !== booking.bookerId) throw new ClubError("forbidden", "Only the member who made the booking can cancel it.");
    if (booking.status !== "upcoming") throw new ClubError("conflict", `That booking is already ${STATUS_WORDS[booking.status]}.`);
    const start = Date.parse(booking.startsAt);
    if (ctx.now.getTime() >= start) throw new ClubError("conflict", "That outing has already started, so it cannot be cancelled here. Ask club staff.");
    const { rules } = rulesFor(book, itemById(s, booking.itemId));
    const late = ctx.actor.kind === "member" && ctx.now.getTime() > start - ms(rules.cancelCutoffMinutes);
    booking.status = late ? "late_cancelled" : "cancelled";
    booking.statusChangedAt = ctx.now.toISOString();
    booking.cancelledBy = ctx.actor;
    booking.cancelReason = options.reason?.trim() || null;
    return { booking: structuredClone(booking), late };
  });
}

/* ---------- Out of service ---------- */

/** Someone staff need to tell when a boat they booked goes out of service. */
export interface AffectedBooking {
  bookingId: string;
  itemName: string;
  startsAt: string;
  endsAt: string;
  people: { memberId: string; name: string; email: string; phone: string; role: "booker" | "crew" }[];
}

/** Upcoming bookings on an item that overlap a stretch of time. Nothing is cancelled. */
export function affectedBookings(state: ClubState, itemId: string, from: Date, until: Date | null): AffectedBooking[] {
  const item = itemById(state, itemId);
  return state.bookings
    .filter((b) => b.itemId === itemId && b.status === "upcoming" && overlaps(Date.parse(b.startsAt), Date.parse(b.endsAt), from.getTime(), until ? until.getTime() : Infinity))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((b) => ({
      bookingId: b.id,
      itemName: item.name,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      people: [
        { id: b.bookerId, role: "booker" as const },
        ...b.crew.map((id) => ({ id, role: "crew" as const })),
      ].map(({ id, role }) => {
        const m = memberOrThrow(state, id);
        return { memberId: m.id, name: fullName(m), email: m.email, phone: m.phone, role };
      }),
    }));
}

/**
 * Staff take an item out of service. New bookings that overlap are refused from now on. Bookings already made
 * are kept, and the members affected are listed so staff can contact them.
 */
export async function takeOutOfService(
  store: ClubStore,
  ctx: Ctx,
  itemId: string,
  input: { from?: Date; until?: Date | null; reason: string; expectedReturn?: string | null },
): Promise<{ period: OutOfServicePeriod; affected: AffectedBooking[] }> {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can take something out of service.");
  const reason = input.reason.trim();
  if (!reason) throw new ClubError("invalid", "Say why it is out of service; members will see the reason.");
  if (reason.length > 200) throw new ClubError("invalid", "The reason must be 200 characters or fewer.");
  const from = input.from ?? ctx.now;
  const until = input.until ?? null;
  if (until && until.getTime() <= from.getTime()) throw new ClubError("invalid", "The return time must be after it goes out of service.");
  if (input.expectedReturn && !/^\d{4}-\d{2}-\d{2}$/.test(input.expectedReturn)) throw new ClubError("invalid", "The expected return date must look like 2026-11-05.");
  return store.transaction(async (s, newId) => {
    itemById(s, itemId);
    const period: OutOfServicePeriod = {
      id: newId(),
      itemId,
      from: from.toISOString(),
      until: until ? until.toISOString() : null,
      reason,
      expectedReturn: input.expectedReturn ?? null,
      createdBy: ctx.actor,
      createdAt: ctx.now.toISOString(),
    };
    s.outOfService.push(period);
    return { period: structuredClone(period), affected: affectedBookings(s, itemId, from, until) };
  });
}

/** The item is back. New bookings are allowed again from now. */
export async function returnToService(store: ClubStore, ctx: Ctx, periodId: string): Promise<OutOfServicePeriod> {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can return something to service.");
  return store.transaction(async (s) => {
    const period = s.outOfService.find((p) => p.id === periodId);
    if (!period) throw new ClubError("not_found", "That out-of-service entry no longer exists.");
    if (period.until !== null && Date.parse(period.until) <= ctx.now.getTime()) throw new ClubError("conflict", "That item is already back in service.");
    period.until = ctx.now.toISOString();
    return structuredClone(period);
  });
}

/** The out-of-service period an item is in at a moment, if any. */
export function outOfServiceAt(state: ClubState, itemId: string, at: Date): OutOfServicePeriod | undefined {
  return state.outOfService.find((p) => p.itemId === itemId && Date.parse(p.from) <= at.getTime() && (p.until === null || Date.parse(p.until) > at.getTime()));
}

/* ---------- When a member leaves ---------- */

/**
 * Cancels the future bookings of these members, inside the same all-or-nothing change that removes them from the
 * club. Bookings that have already started stay. Where they are only crew, they are taken off and the booking stays.
 * Returns the IDs of the bookings cancelled. Past bookings are history and are never touched.
 */
export const bookingLedger: BookingLedger = {
  async cancelFutureBookings({ state, memberIds, now, reason, actor }) {
    const leaving = new Set(memberIds);
    const cancelled: string[] = [];
    for (const b of state.bookings) {
      if (b.status !== "upcoming" || Date.parse(b.startsAt) <= now.getTime()) continue;
      if (leaving.has(b.bookerId)) {
        b.status = "cancelled";
        b.statusChangedAt = now.toISOString();
        b.cancelledBy = actor;
        b.cancelReason = reason;
        cancelled.push(b.id);
      } else if (b.crew.some((id) => leaving.has(id))) {
        for (const id of b.crew.filter((c) => leaving.has(c))) b.removedCrew.push({ memberId: id, at: now.toISOString(), reason });
        b.crew = b.crew.filter((id) => !leaving.has(id));
      }
    }
    return cancelled;
  },
};
