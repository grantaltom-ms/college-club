import { ClubError } from "../errors";
import type { ClubStore } from "../store/memory";
import { formatClock, formatDayLong, formatMinutes, pacificDate } from "../time";
import type { Actor, ClubEvent, ClubState, EventRules, Rsvp, RsvpVia } from "../types";
import { blockReasonFor } from "./eligibility";
import type { BookingLedger, Ctx } from "./households";
import { fullName, memberById, ordinal } from "./queries";

/* ---------- Why an RSVP is refused ---------- */

export type RsvpReasonCode = "member_blocked" | "event_cancelled" | "event_started" | "closed" | "already_going" | "too_many_guests" | "waitlist_full";

/** One plain-language reason an RSVP cannot be made. Staff cannot set these aside: they raise the limit instead. */
export interface RsvpReason {
  code: RsvpReasonCode;
  message: string;
}

/** Thrown when an RSVP cannot be made. `message` is the first reason; `reasons` is all of them. */
export class RsvpRefused extends ClubError {
  constructor(public reasons: RsvpReason[]) {
    super("refused", reasons[0]?.message ?? "That RSVP cannot be made.");
  }
}

/** Thrown when staff ask for a limit below the people already going. */
export class LimitTooLow extends ClubError {
  constructor(message: string) {
    super("conflict", message);
  }
}

const ms = (minutes: number) => minutes * 60000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function eventOrThrow(state: ClubState, id: string): ClubEvent {
  const event = state.events.find((e) => e.id === id);
  if (!event) throw new ClubError("not_found", "That event no longer exists.");
  return event;
}

function memberOrThrow(state: ClubState, id: string) {
  const member = memberById(state, id);
  if (!member) throw new ClubError("not_found", "That member no longer exists.");
  return member;
}

/* ---------- Counting places ---------- */

/** People going to an event: each member and each guest takes one place. */
export const placesTaken = (state: ClubState, eventId: string) => state.rsvps.filter((r) => r.eventId === eventId && r.status === "going").reduce((n, r) => n + 1 + r.guests, 0);

/** Places still free, or null when the event has no limit. */
export function placesLeft(state: ClubState, event: ClubEvent): number | null {
  return event.capacity === null ? null : Math.max(0, event.capacity - placesTaken(state, event.id));
}

export const waitingCount = (state: ClubState, eventId: string) => state.rsvps.filter((r) => r.eventId === eventId && r.status === "waitlisted").length;

/** A name's place on an event's waiting list, counting from 1 (null if not waiting). The list moves up in the order names were written. */
export function waitPlace(state: ClubState, rsvpId: string): number | null {
  const mine = state.rsvps.find((r) => r.id === rsvpId);
  if (!mine || mine.status !== "waitlisted") return null;
  return state.rsvps.filter((r) => r.eventId === mine.eventId && r.status === "waitlisted").findIndex((r) => r.id === rsvpId) + 1;
}

/** The live (places or waiting) line a member has on an event, if any. */
function liveRsvp(state: ClubState, eventId: string, memberId: string): Rsvp | undefined {
  return state.rsvps.find((r) => r.eventId === eventId && r.memberId === memberId && (r.status === "going" || r.status === "waitlisted"));
}

/** The last moment to RSVP: the moment staff set, or the rule's number of minutes before the start. */
export const closesAt = (event: ClubEvent, rules: EventRules) => (event.replyBy ? Date.parse(event.replyBy) : Date.parse(event.startsAt) - ms(rules.defaults.closeMinutesBefore));

/** The last moment the waiting list moves up by itself. After it, free places go to whoever asks first. */
export const promoteCutoff = (event: ClubEvent, rules: EventRules) => Date.parse(event.startsAt) - ms(rules.defaults.promoteUntilMinutesBefore);

/** "Thursday, Nov 5, 6:00 pm" */
export const eventWhen = (event: Pick<ClubEvent, "startsAt">) => `${formatDayLong(pacificDate(new Date(event.startsAt)))}, ${formatClock(event.startsAt)}`;

/* ---------- Checking an RSVP ---------- */

export interface RsvpRequest {
  eventId: string;
  memberId: string;
  /** Guests the member brings (not members). Default 0. */
  guests?: number;
}

function guestsOrThrow(guests: number | undefined): number {
  const g = guests ?? 0;
  if (!Number.isInteger(g) || g < 0) throw new ClubError("invalid", "The number of guests must be a whole number, 0 or more.");
  return g;
}

/**
 * Every reason this RSVP cannot be made, in a fixed order, in plain language. Empty means it can be.
 * Reads only. Used by the event page (to explain) and by rsvp (to decide).
 */
export function checkRsvp(state: ClubState, eventRules: EventRules, ctx: Ctx, req: RsvpRequest): RsvpReason[] {
  const event = eventOrThrow(state, req.eventId);
  const member = memberOrThrow(state, req.memberId);
  const rules = eventRules.defaults;
  const guests = guestsOrThrow(req.guests);
  const now = ctx.now.getTime();
  const isYou = ctx.actor.kind === "member" && ctx.actor.memberId === member.id;
  const who = isYou ? "You" : fullName(member);
  const reasons: RsvpReason[] = [];
  const add = (code: RsvpReasonCode, message: string) => reasons.push({ code, message });

  const blocked = blockReasonFor(state, member.id, "RSVPs are closed");
  if (blocked) add("member_blocked", blocked);

  if (event.status === "cancelled") {
    add("event_cancelled", `${event.title} on ${formatDayLong(pacificDate(new Date(event.startsAt)))} was cancelled.`);
    return reasons;
  }
  if (now >= Date.parse(event.startsAt)) {
    add("event_started", `${event.title} has already started.`);
    return reasons;
  }

  // Already on the list. A waiting RSVP can turn into places once the automatic move-up has ended and its whole group fits.
  const existing = liveRsvp(state, event.id, member.id);
  let need = 1 + guests;
  if (existing) {
    need = 1 + existing.guests;
    const left = placesLeft(state, event);
    const claim = existing.status === "waitlisted" && (left === null || need <= left) && now >= promoteCutoff(event, eventRules);
    if (!claim) {
      const place = waitPlace(state, existing.id);
      const extra = existing.guests > 0 ? ` with ${plural(existing.guests, "guest")}` : "";
      add("already_going", existing.status === "going" ? `${who} ${isYou ? "are" : "is"} already going${extra}.` : `${who} ${isYou ? "are" : "is"} already on the waiting list${extra}, ${ordinal(place ?? 1)} in line.`);
      return reasons;
    }
  }

  if (now >= closesAt(event, eventRules)) {
    add("closed", event.replyBy ? `RSVPs for ${event.title} closed ${formatDayLong(pacificDate(new Date(event.replyBy)))} at ${formatClock(event.replyBy)}.` : `RSVPs for ${event.title} closed ${formatMinutes(rules.closeMinutesBefore)} before it starts.`);
  }
  if (!existing && guests > rules.maxGuests) {
    add("too_many_guests", rules.maxGuests === 0 ? "Guests cannot be added to an RSVP for this event." : `You can bring up to ${plural(rules.maxGuests, "guest")}.`);
  }
  if (existing) return reasons;

  // Not enough places, and the waiting list is full too.
  const left = placesLeft(state, event);
  if (left !== null && need > left && waitingCount(state, event.id) >= rules.waitlistMax) {
    const lack = left === 0 ? `${event.title} is full` : `${event.title} has only ${plural(left, "place")} left and this RSVP needs ${need}`;
    add("waitlist_full", rules.waitlistMax === 0 ? `${lack}, and it has no waiting list.` : `${lack}, and its waiting list is full too (${plural(rules.waitlistMax, "person").replace("persons", "people")}).`);
  }
  return reasons;
}

/* ---------- The waiting list ---------- */

/**
 * Moves the waiting list up into free places, first in line first. A group that does not fit yet keeps its place in line
 * and the next group that fits goes ahead. Only until `promoteUntilMinutesBefore` before the start: after that a free
 * place goes to whoever asks first. Works on the all-or-nothing change's copy of the data. Returns the RSVPs that got places.
 */
export function promoteWaitlist(state: ClubState, eventRules: EventRules, eventId: string, now: Date): Rsvp[] {
  const event = eventOrThrow(state, eventId);
  if (event.status !== "scheduled" || now.getTime() >= promoteCutoff(event, eventRules)) return [];
  let left = placesLeft(state, event);
  const promoted: Rsvp[] = [];
  for (const line of state.rsvps) {
    if (line.eventId !== event.id || line.status !== "waitlisted") continue;
    const need = 1 + line.guests;
    if (left !== null && need > left) continue;
    line.status = "going";
    line.promotedAt = now.toISOString();
    line.statusChangedAt = now.toISOString();
    promoted.push(line);
    if (left !== null) left -= need;
  }
  return promoted;
}

/* ---------- RSVPing and leaving ---------- */

export interface RsvpResult {
  rsvp: Rsvp;
  outcome: "going" | "waitlisted";
  /** Counting from 1, when waiting. */
  place: number | null;
}

/**
 * Claims places: the member and their guests all go, or the whole group waits. A member RSVPs for themself; staff can
 * RSVP anyone, under the same rules. Everything is checked and written as one all-or-nothing change.
 */
export async function rsvp(store: ClubStore, eventRules: EventRules, ctx: Ctx, req: RsvpRequest, options: { via?: RsvpVia } = {}): Promise<RsvpResult> {
  if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only a member or club staff can RSVP.");
  if (ctx.actor.kind === "member" && ctx.actor.memberId !== req.memberId) throw new ClubError("forbidden", "You can only RSVP for yourself.");
  return store.transaction(async (s, newId) => {
    const reasons = checkRsvp(s, eventRules, ctx, req);
    if (reasons.length > 0) throw new RsvpRefused(reasons);
    const event = eventOrThrow(s, req.eventId);
    const at = ctx.now.toISOString();

    // Someone waiting whose whole group fits after the automatic move-up ended: the waiting place becomes places.
    const waiting = liveRsvp(s, event.id, req.memberId);
    if (waiting) {
      waiting.status = "going";
      waiting.promotedAt = at;
      waiting.statusChangedAt = at;
      return { rsvp: structuredClone(waiting), outcome: "going" as const, place: null };
    }

    // The line moves first; a newcomer only takes places that nobody waiting could use.
    promoteWaitlist(s, eventRules, event.id, ctx.now);
    const guests = guestsOrThrow(req.guests);
    const left = placesLeft(s, event);
    const fits = left === null || 1 + guests <= left;
    const line: Rsvp = {
      id: newId(),
      eventId: event.id,
      memberId: req.memberId,
      guests,
      status: fits ? "going" : "waitlisted",
      priceCents: event.priceCents,
      via: options.via ?? "page",
      createdAt: at,
      createdBy: ctx.actor,
      statusChangedAt: at,
      promotedAt: null,
      cancelledBy: null,
      cancelReason: null,
    };
    s.rsvps.push(line);
    return { rsvp: structuredClone(line), outcome: line.status as "going" | "waitlisted", place: fits ? null : waitPlace(s, line.id) };
  });
}

/** Changes how many guests an RSVP brings. More guests must fit; fewer give places back to the waiting list at once. */
export async function changeGuests(store: ClubStore, eventRules: EventRules, ctx: Ctx, rsvpId: string, guests: number): Promise<{ rsvp: Rsvp; promoted: Rsvp[] }> {
  const wanted = guestsOrThrow(guests);
  return store.transaction(async (s) => {
    const line = s.rsvps.find((r) => r.id === rsvpId);
    if (!line) throw new ClubError("not_found", "That RSVP no longer exists.");
    if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only the member, or club staff, can change an RSVP.");
    if (ctx.actor.kind === "member" && ctx.actor.memberId !== line.memberId) throw new ClubError("forbidden", "You can only change your own RSVP.");
    if (line.status !== "going" && line.status !== "waitlisted") throw new ClubError("conflict", `That RSVP is already ${line.status.replace("_", " ")}.`);
    const event = eventOrThrow(s, line.eventId);
    if (event.status !== "scheduled") throw new ClubError("conflict", "That event was cancelled.");
    if (ctx.now.getTime() >= Date.parse(event.startsAt)) throw new ClubError("conflict", "That event has already started, so this can no longer be changed here. Ask club staff.");
    const rules = eventRules.defaults;
    if (wanted > rules.maxGuests) throw new ClubError("conflict", rules.maxGuests === 0 ? "Guests cannot be added to an RSVP for this event." : `You can bring up to ${plural(rules.maxGuests, "guest")}.`);
    if (wanted === line.guests) return { rsvp: structuredClone(line), promoted: [] };
    if (wanted > line.guests) {
      if (ctx.now.getTime() >= closesAt(event, eventRules)) throw new ClubError("conflict", "RSVPs have closed, so guests can no longer be added.");
      const left = placesLeft(s, event);
      const extra = wanted - line.guests;
      if (line.status === "going" && left !== null && extra > left) {
        throw new ClubError("conflict", left === 0 ? `${event.title} is full, so no more guests can be added.` : `Only ${plural(left, "place")} ${left === 1 ? "is" : "are"} left, so you can add up to ${plural(left, "more guest")}.`);
      }
    }
    line.guests = wanted;
    const promoted = line.status === "going" ? promoteWaitlist(s, eventRules, event.id, ctx.now) : [];
    return { rsvp: structuredClone(line), promoted: structuredClone(promoted) };
  });
}

export interface LeaveResult {
  rsvp: Rsvp;
  /** True if a member with places cancelled later than the cutoff. Leaving a waiting list is never late. */
  late: boolean;
  /** The RSVPs the waiting list moved up into the places that were freed. */
  promoted: Rsvp[];
}

/**
 * The member (or staff) cancels an RSVP. Places are freed and the waiting list moves up at once. A member with places who
 * cancels after the cutoff is recorded as a late cancellation; staff cancelling are never recorded against the member.
 */
export async function cancelRsvp(store: ClubStore, eventRules: EventRules, ctx: Ctx, rsvpId: string, options: { reason?: string } = {}): Promise<LeaveResult> {
  return store.transaction(async (s) => {
    const line = s.rsvps.find((r) => r.id === rsvpId);
    if (!line) throw new ClubError("not_found", "That RSVP no longer exists.");
    if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only the member, or club staff, can cancel an RSVP.");
    if (ctx.actor.kind === "member" && ctx.actor.memberId !== line.memberId) throw new ClubError("forbidden", "You can only cancel your own RSVP.");
    if (line.status !== "going" && line.status !== "waitlisted") throw new ClubError("conflict", `That RSVP is already ${line.status.replace("_", " ")}.`);
    const event = eventOrThrow(s, line.eventId);
    if (ctx.now.getTime() >= Date.parse(event.startsAt)) throw new ClubError("conflict", "That event has already started, so the RSVP cannot be cancelled here. Ask club staff.");
    const hadPlaces = line.status === "going";
    const late = ctx.actor.kind === "member" && hadPlaces && ctx.now.getTime() > Date.parse(event.startsAt) - ms(eventRules.defaults.cancelCutoffMinutes);
    line.status = late ? "late_cancelled" : "cancelled";
    line.statusChangedAt = ctx.now.toISOString();
    line.cancelledBy = ctx.actor;
    line.cancelReason = options.reason?.trim() || null;
    const promoted = hadPlaces ? promoteWaitlist(s, eventRules, event.id, ctx.now) : [];
    return { rsvp: structuredClone(line), late, promoted: structuredClone(promoted) };
  });
}

/** Staff record who came (attended) and who did not (no_show), once the event has started. */
export async function markRsvpAttendance(store: ClubStore, ctx: Ctx, rsvpId: string, outcome: "attended" | "no_show"): Promise<Rsvp> {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can record attendance.");
  return store.transaction(async (s) => {
    const line = s.rsvps.find((r) => r.id === rsvpId);
    if (!line) throw new ClubError("not_found", "That RSVP no longer exists.");
    if (line.status !== "going") throw new ClubError("conflict", `Attendance can only be recorded for someone with places, and this RSVP is ${line.status.replace("_", " ")}.`);
    const event = eventOrThrow(s, line.eventId);
    if (ctx.now.getTime() < Date.parse(event.startsAt)) throw new ClubError("conflict", "That event has not started yet.");
    line.status = outcome;
    line.statusChangedAt = ctx.now.toISOString();
    return structuredClone(line);
  });
}

/* ---------- Staff: events ---------- */

function requireStaff(actor: Actor) {
  if (actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can do that.");
}

export interface EventFields {
  title: string;
  description: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
  /** Places in total, adults and guests together. null means no limit. */
  capacity: number | null;
  /** Price of one place in cents. null means free or not stated. */
  priceCents: number | null;
  /** Last moment to RSVP. null uses the rule. */
  replyBy: Date | null;
}

/** Checks the fields of an event and returns them cleaned. Plain words for anything wrong. */
function checkedFields(f: EventFields): EventFields {
  const title = f.title.trim();
  if (!title) throw new ClubError("invalid", "Give the event a title.");
  if (title.length > 120) throw new ClubError("invalid", "The title must be 120 characters or fewer.");
  const description = f.description.trim();
  if (description.length > 1000) throw new ClubError("invalid", "The description must be 1000 characters or fewer.");
  const location = f.location.trim();
  if (location.length > 200) throw new ClubError("invalid", "The place must be 200 characters or fewer.");
  if (Number.isNaN(f.startsAt.getTime()) || Number.isNaN(f.endsAt.getTime())) throw new ClubError("invalid", "Choose a start and an end time.");
  if (f.endsAt.getTime() <= f.startsAt.getTime()) throw new ClubError("invalid", "The event must end after it starts.");
  if (f.capacity !== null && (!Number.isInteger(f.capacity) || f.capacity < 1 || f.capacity > 2000)) throw new ClubError("invalid", "The limit must be a whole number from 1 to 2000, or empty for no limit.");
  if (f.priceCents !== null && (!Number.isInteger(f.priceCents) || f.priceCents < 0 || f.priceCents > 1000000)) throw new ClubError("invalid", "The price must be between $0 and $10,000.");
  if (f.replyBy !== null && (Number.isNaN(f.replyBy.getTime()) || f.replyBy.getTime() > f.startsAt.getTime())) throw new ClubError("invalid", "The reply-by time must be before the event starts.");
  return { title, description, location, startsAt: f.startsAt, endsAt: f.endsAt, capacity: f.capacity, priceCents: f.priceCents, replyBy: f.replyBy };
}

export type NewEvent = Pick<EventFields, "title" | "startsAt" | "endsAt"> & Partial<Omit<EventFields, "title" | "startsAt" | "endsAt">>;

/** Staff add an event. */
export async function createEvent(store: ClubStore, ctx: Ctx, input: NewEvent): Promise<ClubEvent> {
  requireStaff(ctx.actor);
  const f = checkedFields({ description: "", location: "", capacity: null, priceCents: null, replyBy: null, ...input });
  if (f.startsAt.getTime() <= ctx.now.getTime()) throw new ClubError("invalid", "The event must start in the future.");
  return store.transaction(async (s, newId) => {
    const event: ClubEvent = {
      id: newId(),
      title: f.title,
      description: f.description,
      location: f.location,
      startsAt: f.startsAt.toISOString(),
      endsAt: f.endsAt.toISOString(),
      capacity: f.capacity,
      priceCents: f.priceCents,
      replyBy: f.replyBy ? f.replyBy.toISOString() : null,
      status: "scheduled",
      createdAt: ctx.now.toISOString(),
      createdBy: ctx.actor,
      statusChangedAt: ctx.now.toISOString(),
      cancelledBy: null,
      cancelReason: null,
    };
    s.events.push(event);
    return structuredClone(event);
  });
}

/**
 * Staff change an event. Raising or removing the limit moves the waiting list up at once; the limit cannot go below the
 * people already going. A new price only applies to RSVPs made after the change. Nobody is emailed about a change.
 */
export async function updateEvent(store: ClubStore, eventRules: EventRules, ctx: Ctx, eventId: string, patch: Partial<EventFields>): Promise<{ event: ClubEvent; promoted: Rsvp[] }> {
  requireStaff(ctx.actor);
  return store.transaction(async (s) => {
    const event = eventOrThrow(s, eventId);
    if (event.status !== "scheduled") throw new ClubError("conflict", "That event was cancelled, so it cannot be changed.");
    if (ctx.now.getTime() >= Date.parse(event.startsAt)) throw new ClubError("conflict", "That event has already started, so it cannot be changed.");
    const f = checkedFields({
      title: patch.title ?? event.title,
      description: patch.description ?? event.description,
      location: patch.location ?? event.location,
      startsAt: patch.startsAt ?? new Date(event.startsAt),
      endsAt: patch.endsAt ?? new Date(event.endsAt),
      capacity: patch.capacity === undefined ? event.capacity : patch.capacity,
      priceCents: patch.priceCents === undefined ? event.priceCents : patch.priceCents,
      replyBy: patch.replyBy === undefined ? (event.replyBy ? new Date(event.replyBy) : null) : patch.replyBy,
    });
    if (f.startsAt.getTime() <= ctx.now.getTime()) throw new ClubError("invalid", "The event must start in the future.");
    const taken = placesTaken(s, event.id);
    if (f.capacity !== null && f.capacity < taken) throw new LimitTooLow(`${plural(taken, "person").replace("persons", "people")} ${taken === 1 ? "is" : "are"} already going, so the limit cannot go below ${taken}. Cancel some RSVPs first.`);
    event.title = f.title;
    event.description = f.description;
    event.location = f.location;
    event.startsAt = f.startsAt.toISOString();
    event.endsAt = f.endsAt.toISOString();
    event.capacity = f.capacity;
    event.priceCents = f.priceCents;
    event.replyBy = f.replyBy ? f.replyBy.toISOString() : null;
    const promoted = promoteWaitlist(s, eventRules, event.id, ctx.now);
    return { event: structuredClone(event), promoted: structuredClone(promoted) };
  });
}

/** A person staff need to tell when an event is cancelled. */
export interface AffectedRsvp {
  rsvpId: string;
  memberId: string;
  name: string;
  email: string;
  phone: string;
  guests: number;
  status: "going" | "waitlisted";
}

/** Staff cancel an event. Everyone on its list is taken off (not as a late cancellation) and listed so staff can contact them. */
export async function cancelEvent(store: ClubStore, ctx: Ctx, eventId: string, input: { reason: string }): Promise<{ event: ClubEvent; affected: AffectedRsvp[] }> {
  requireStaff(ctx.actor);
  const reason = input.reason.trim();
  if (!reason) throw new ClubError("invalid", "Say why the event is cancelled; members will see the reason.");
  if (reason.length > 300) throw new ClubError("invalid", "The reason must be 300 characters or fewer.");
  return store.transaction(async (s) => {
    const event = eventOrThrow(s, eventId);
    if (event.status === "cancelled") throw new ClubError("conflict", "That event is already cancelled.");
    if (ctx.now.getTime() >= Date.parse(event.startsAt)) throw new ClubError("conflict", "That event has already started, so it cannot be cancelled.");
    const at = ctx.now.toISOString();
    event.status = "cancelled";
    event.statusChangedAt = at;
    event.cancelledBy = ctx.actor;
    event.cancelReason = reason;
    const affected: AffectedRsvp[] = [];
    for (const line of s.rsvps) {
      if (line.eventId !== event.id || (line.status !== "going" && line.status !== "waitlisted")) continue;
      const member = memberOrThrow(s, line.memberId);
      affected.push({ rsvpId: line.id, memberId: member.id, name: fullName(member), email: member.email, phone: member.phone, guests: line.guests, status: line.status });
      line.status = "cancelled";
      line.statusChangedAt = at;
      line.cancelledBy = ctx.actor;
      line.cancelReason = `The event was cancelled: ${reason}`.slice(0, 300);
    }
    return { event: structuredClone(event), affected };
  });
}

/* ---------- Reading the list ---------- */

export interface RsvpLine {
  rsvpId: string;
  memberId: string;
  /** Staff only; null for members. */
  name: string | null;
  guests: number;
  status: Rsvp["status"];
  /** Counting from 1, when waiting. */
  place: number | null;
  via: RsvpVia;
  mine: boolean;
}

export interface EventView {
  event: ClubEvent;
  /** People going, members and guests together. */
  going: number;
  /** RSVPs waiting. */
  waiting: number;
  /** Places free, or null for no limit. */
  left: number | null;
  full: boolean;
  /** The viewing member's own line, if any. */
  yours: RsvpLine | null;
  /** Everyone, for staff. Empty for members: they see only counts and their own place. */
  sheet: RsvpLine[];
}

/** An event as a viewer may see it. Members see counts and their own RSVP, never others' names. */
export function eventView(state: ClubState, event: ClubEvent, viewer: { kind: "member"; memberId: string } | { kind: "staff" }): EventView {
  const lines = state.rsvps
    .filter((r) => r.eventId === event.id)
    .map((r): RsvpLine => {
      const member = memberById(state, r.memberId);
      return {
        rsvpId: r.id,
        memberId: r.memberId,
        name: viewer.kind === "staff" && member ? fullName(member) : null,
        guests: r.guests,
        status: r.status,
        place: waitPlace(state, r.id),
        via: r.via,
        mine: viewer.kind === "member" && viewer.memberId === r.memberId,
      };
    });
  const left = placesLeft(state, event);
  return {
    event,
    going: placesTaken(state, event.id),
    waiting: waitingCount(state, event.id),
    left,
    full: left === 0,
    yours: lines.find((l) => l.mine && (l.status === "going" || l.status === "waitlisted")) ?? null,
    sheet: viewer.kind === "staff" ? lines : [],
  };
}

/* ---------- When a member leaves ---------- */

/**
 * Takes these members off the lists of events still to come, in the same all-or-nothing change that removes them from the
 * club, then moves the waiting lists up behind them. Not recorded as late: it was not their choice. Events already under
 * way, and past ones, are history and stay. Returns the IDs of the RSVPs cancelled.
 */
export function eventLedger(eventRules: EventRules): Required<Pick<BookingLedger, "cancelFutureRsvps">> {
  return {
    async cancelFutureRsvps({ state, memberIds, now, reason, actor }) {
      const leaving = new Set(memberIds);
      const cancelled: string[] = [];
      const touched = new Set<string>();
      for (const line of state.rsvps) {
        if (!leaving.has(line.memberId) || (line.status !== "going" && line.status !== "waitlisted")) continue;
        const event = state.events.find((e) => e.id === line.eventId);
        if (!event || event.status !== "scheduled" || Date.parse(event.startsAt) <= now.getTime()) continue;
        if (line.status === "going") touched.add(event.id);
        line.status = "cancelled";
        line.statusChangedAt = now.toISOString();
        line.cancelledBy = actor;
        line.cancelReason = reason;
        cancelled.push(line.id);
      }
      for (const eventId of touched) promoteWaitlist(state, eventRules, eventId, now);
      return cancelled;
    },
  };
}
