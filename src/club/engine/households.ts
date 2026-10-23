import { ClubError } from "../errors";
import type { ClubStore } from "../store/memory";
import { formatDay, pacificDate } from "../time";
import {
  MEMBERSHIP_TYPES,
  type Actor,
  type ClubState,
  type HistoryKind,
  type Household,
  type Member,
  type MembershipType,
} from "../types";
import { fullName, householdOf, memberById } from "./queries";

/** Who is doing this, and when. Tests and sample data pass any moment they like. */
export interface Ctx {
  actor: Actor;
  now: Date;
}

/**
 * Where future bookings live. Ending a household or removing a member cancels theirs through this, inside the
 * same all-or-nothing change (`state` is that change's working copy), so a household is never half ended.
 * Returns the IDs of the bookings it cancelled. The real one is `bookingLedger` in bookings.ts.
 */
export interface BookingLedger {
  cancelFutureBookings(input: { state: ClubState; memberIds: string[]; now: Date; reason: string; actor: Actor }): Promise<string[]>;
  /**
   * Takes these members off the sign-up sheets of classes still to come and moves the waiting lists up behind them.
   * Returns the IDs of the sign-ups cancelled. Optional, so a ledger that knows nothing of classes still works.
   */
  cancelFutureSignUps?(input: { state: ClubState; memberIds: string[]; now: Date; reason: string; actor: Actor }): Promise<string[]>;
  /**
   * Takes these members off the lists of events still to come and moves the waiting lists up behind them.
   * Returns the IDs of the RSVPs cancelled. Optional, so a ledger that knows nothing of events still works.
   */
  cancelFutureRsvps?(input: { state: ClubState; memberIds: string[]; now: Date; reason: string; actor: Actor }): Promise<string[]>;
}

export interface NewMember {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

export interface NewHousehold {
  displayName: string;
  membershipType: MembershipType;
  /** YYYY-MM-DD. */
  joinedOn: string;
  primary: NewMember;
  additional?: NewMember[];
  notes?: string;
}

const FORBIDDEN = "Only club staff can do that.";

function requireStaff(actor: Actor) {
  if (actor.kind === "member") throw new ClubError("forbidden", FORBIDDEN);
}

function text(value: string | undefined, label: string, max: number): string {
  const v = (value ?? "").trim();
  if (!v) throw new ClubError("invalid", `${label} is required.`);
  if (v.length > max) throw new ClubError("invalid", `${label} must be ${max} characters or fewer.`);
  return v;
}

function cleanMember(input: NewMember): Pick<Member, "firstName" | "lastName" | "email" | "phone"> {
  const email = text(input.email, "Email", 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ClubError("invalid", `"${email}" does not look like an email address.`);
  return {
    firstName: text(input.firstName, "First name", 80),
    lastName: text(input.lastName, "Last name", 80),
    email,
    phone: (input.phone ?? "").trim().slice(0, 40),
  };
}

function log(
  s: ClubState,
  newId: () => string,
  ctx: Ctx,
  householdId: string,
  kind: HistoryKind,
  summary: string,
  details: Record<string, string | number | null> = {},
) {
  s.history.push({ id: newId(), householdId, at: ctx.now.toISOString(), kind, summary, actor: ctx.actor, details });
}

function addAdult(s: ClubState, newId: () => string, ctx: Ctx, household: Household, input: NewMember, role: Member["role"]): Member {
  const member: Member = {
    id: newId(),
    householdId: household.id,
    ...cleanMember(input),
    role,
    status: "active",
    brivoCredentialId: null,
    mailchimpContactId: null,
    loginId: null,
  };
  s.members.push(member);
  log(s, newId, ctx, household.id, "member_added", `${fullName(member)} was added to the household as ${role === "primary" ? "the primary adult" : "an additional adult"}.`, {
    memberId: member.id,
    role,
  });
  return member;
}

function activeHousehold(s: ClubState, id: string): Household {
  const household = householdOf(s, id);
  if (!household) throw new ClubError("not_found", "That household no longer exists.");
  if (household.status === "ended") throw new ClubError("conflict", `That household's membership ended on ${formatDay(household.endedOn!)}. Nothing in it can be changed.`);
  return household;
}

/** A household joins: one record for the household and one for each adult, with a "joined" line in its file. */
export async function createHousehold(store: ClubStore, ctx: Ctx, input: NewHousehold): Promise<{ household: Household; members: Member[] }> {
  requireStaff(ctx.actor);
  if (!(MEMBERSHIP_TYPES as readonly string[]).includes(input.membershipType)) throw new ClubError("invalid", "Choose Resident, Intermediate or Non-Resident.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.joinedOn)) throw new ClubError("invalid", "The join date must look like 2026-10-22.");
  return store.transaction(async (s, newId) => {
    const household: Household = {
      id: newId(),
      displayName: text(input.displayName, "The household name", 120),
      membershipType: input.membershipType,
      status: "active",
      joinedOn: input.joinedOn,
      endedOn: null,
      quickbooksId: null,
      notes: (input.notes ?? "").trim(),
    };
    s.households.push(household);
    log(s, newId, ctx, household.id, "joined", `${household.displayName} joined as ${household.membershipType}.`, { joinedOn: household.joinedOn, membershipType: household.membershipType });
    const members = [addAdult(s, newId, ctx, household, input.primary, "primary"), ...(input.additional ?? []).map((m) => addAdult(s, newId, ctx, household, m, "additional"))];
    return { household, members };
  });
}

export async function addMember(store: ClubStore, ctx: Ctx, householdId: string, input: NewMember): Promise<Member> {
  requireStaff(ctx.actor);
  return store.transaction(async (s, newId) => addAdult(s, newId, ctx, activeHousehold(s, householdId), input, "additional"));
}

/**
 * An adult leaves the household while it carries on. They are blocked at once and their future bookings are cancelled.
 * The primary adult can only leave after someone else is named primary, and the last adult cannot leave (end the membership instead).
 */
export async function removeMember(
  store: ClubStore,
  ledger: BookingLedger,
  ctx: Ctx,
  memberId: string,
  options: { newPrimaryId?: string } = {},
): Promise<void> {
  requireStaff(ctx.actor);
  await store.transaction(async (s, newId) => {
    const member = memberById(s, memberId);
    if (!member) throw new ClubError("not_found", "That member no longer exists.");
    const household = activeHousehold(s, member.householdId);
    if (member.status !== "active") throw new ClubError("conflict", `${fullName(member)} is already off this household's membership.`);
    const others = s.members.filter((m) => m.householdId === household.id && m.status === "active" && m.id !== member.id);
    if (others.length === 0) throw new ClubError("conflict", `${fullName(member)} is the last adult in the household. End the membership instead.`);
    if (member.role === "primary") {
      const next = others.find((m) => m.id === options.newPrimaryId);
      if (!next) throw new ClubError("conflict", `${fullName(member)} is the primary adult. Choose who becomes primary first.`);
      next.role = "primary";
      log(s, newId, ctx, household.id, "primary_changed", `${fullName(next)} is now the primary adult, replacing ${fullName(member)}.`, { memberId: next.id, previousMemberId: member.id });
    }
    member.status = "removed";
    log(s, newId, ctx, household.id, "member_removed", `${fullName(member)} was removed from the household.`, { memberId: member.id });
    const cancelled = await ledger.cancelFutureBookings({ state: s, memberIds: [member.id], now: ctx.now, reason: `${fullName(member)} was removed from the household`, actor: ctx.actor });
    if (cancelled.length > 0) {
      log(s, newId, ctx, household.id, "bookings_cancelled", `${cancelled.length} future booking${cancelled.length === 1 ? "" : "s"} cancelled for ${fullName(member)}.`, { count: cancelled.length });
    }
    const dropped = (await ledger.cancelFutureSignUps?.({ state: s, memberIds: [member.id], now: ctx.now, reason: `${fullName(member)} was removed from the household`, actor: ctx.actor })) ?? [];
    if (dropped.length > 0) {
      log(s, newId, ctx, household.id, "signups_cancelled", `${dropped.length} future class sign-up${dropped.length === 1 ? "" : "s"} cancelled for ${fullName(member)}.`, { count: dropped.length });
    }
    const replies = (await ledger.cancelFutureRsvps?.({ state: s, memberIds: [member.id], now: ctx.now, reason: `${fullName(member)} was removed from the household`, actor: ctx.actor })) ?? [];
    if (replies.length > 0) {
      log(s, newId, ctx, household.id, "rsvps_cancelled", `${replies.length} future event RSVP${replies.length === 1 ? "" : "s"} cancelled for ${fullName(member)}.`, { count: replies.length });
    }
  });
}

export async function changeMembershipType(store: ClubStore, ctx: Ctx, householdId: string, type: MembershipType): Promise<Household> {
  requireStaff(ctx.actor);
  if (!(MEMBERSHIP_TYPES as readonly string[]).includes(type)) throw new ClubError("invalid", "Choose Resident, Intermediate or Non-Resident.");
  return store.transaction(async (s, newId) => {
    const household = activeHousehold(s, householdId);
    if (household.membershipType === type) throw new ClubError("conflict", `${household.displayName} is already ${type}.`);
    const before = household.membershipType;
    household.membershipType = type;
    log(s, newId, ctx, household.id, "type_changed", `Membership type changed from ${before} to ${type}.`, { from: before, to: type });
    return { ...household };
  });
}

/** Staff only: a member can never give themselves a qualification. */
export async function grantQualification(store: ClubStore, ctx: Ctx, memberId: string, code: string): Promise<void> {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can grant a qualification.");
  await store.transaction(async (s, newId) => {
    const member = memberById(s, memberId);
    if (!member) throw new ClubError("not_found", "That member no longer exists.");
    const qualification = s.qualifications.find((q) => q.code === code);
    if (!qualification) throw new ClubError("invalid", "That qualification does not exist.");
    if (member.status !== "active") throw new ClubError("conflict", `${fullName(member)} is not an active member, so a qualification cannot be granted.`);
    if (s.memberQualifications.some((q) => q.memberId === memberId && q.code === code)) {
      throw new ClubError("conflict", `${fullName(member)} already holds ${qualification.name}.`);
    }
    s.memberQualifications.push({ memberId, code, grantedBy: ctx.actor, grantedAt: ctx.now.toISOString() });
    log(s, newId, ctx, member.householdId, "qualification_granted", `${fullName(member)} was granted ${qualification.name} by ${ctx.actor.label}.`, { memberId, code });
  });
}

/**
 * The membership ends. In one all-or-nothing step: the household is marked ended, every adult in it is blocked from
 * new bookings, their future bookings are cancelled, and each of those changes is written to the household's file.
 * Past bookings are left alone as history.
 */
export async function endHousehold(
  store: ClubStore,
  ledger: BookingLedger,
  ctx: Ctx,
  householdId: string,
): Promise<{ endedOn: string; blocked: string[]; cancelledBookings: string[] }> {
  requireStaff(ctx.actor);
  return store.transaction(async (s, newId) => {
    const household = activeHousehold(s, householdId);
    const endedOn = pacificDate(ctx.now);
    if (endedOn < household.joinedOn) throw new ClubError("invalid", "A membership cannot end before it began.");
    const adults = s.members.filter((m) => m.householdId === household.id && m.status === "active");
    household.status = "ended";
    household.endedOn = endedOn;
    for (const m of adults) m.status = "household_ended";
    log(s, newId, ctx, household.id, "membership_ended", `Membership ended on ${formatDay(endedOn)}. ${adults.length} adult${adults.length === 1 ? "" : "s"} can no longer book.`, {
      endedOn,
      adults: adults.length,
    });
    const memberIds = adults.map((m) => m.id);
    const cancelled = await ledger.cancelFutureBookings({ state: s, memberIds, now: ctx.now, reason: "The household's membership ended", actor: ctx.actor });
    if (cancelled.length > 0) {
      log(s, newId, ctx, household.id, "bookings_cancelled", `${cancelled.length} future booking${cancelled.length === 1 ? "" : "s"} cancelled because the membership ended.`, { count: cancelled.length });
    }
    const dropped = (await ledger.cancelFutureSignUps?.({ state: s, memberIds, now: ctx.now, reason: "The household's membership ended", actor: ctx.actor })) ?? [];
    if (dropped.length > 0) {
      log(s, newId, ctx, household.id, "signups_cancelled", `${dropped.length} future class sign-up${dropped.length === 1 ? "" : "s"} cancelled because the membership ended.`, { count: dropped.length });
    }
    const replies = (await ledger.cancelFutureRsvps?.({ state: s, memberIds, now: ctx.now, reason: "The household's membership ended", actor: ctx.actor })) ?? [];
    if (replies.length > 0) {
      log(s, newId, ctx, household.id, "rsvps_cancelled", `${replies.length} future event RSVP${replies.length === 1 ? "" : "s"} cancelled because the membership ended.`, { count: replies.length });
    }
    return { endedOn, blocked: memberIds, cancelledBookings: cancelled };
  });
}
