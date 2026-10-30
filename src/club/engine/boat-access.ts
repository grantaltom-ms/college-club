import { ClubError } from "../errors";
import { nameMatches } from "../name-filter";
import { classOf } from "../settings/rulebook";
import type { Actor, BoatAccess, BoatAccessKind, ClubState, Item, Member, RuleBook } from "../types";
import { blockReasonFor } from "./eligibility";
import type { Ctx } from "./households";
import { fullName, householdOf, memberById } from "./queries";
import type { ClubStore } from "../store/memory";

/**
 * Private boats: a boat that belongs to members rather than to the club.
 *
 * The building comparison: a reserved parking spot. The office paints the owners' names on it, an owner can hand out a visitor
 * pass, and everyone else never sees the spot on the lot map. If the last owner moves out the spot is chained shut until the
 * office sorts it out, so nobody parks there by accident.
 *
 * Who may use a private boat: its owners (picked by staff) and the people an owner has invited. That goes for the person who books
 * it and for everyone in the other seats. Nobody else is shown the boat. Its skill level is not checked, because the owner vouches
 * for who uses it. The usual booking window and limits still apply. An owner who has left the club (or whose household ended) no
 * longer counts, and a boat with no owner left is locked: nobody can book it until staff add an owner.
 *
 * Every line on a boat's list is kept, with who added it and when it ended, so the list is also the record of who was let on.
 */

export type BoatViewer = { kind: "member"; memberId: string } | { kind: "staff" };

export const isPrivate = (item: Item): boolean => item.isPrivate === true;

/** The lines on a boat's list that are in force right now. */
export function activeAccess(state: ClubState, itemId: string): BoatAccess[] {
  return state.boatAccess.filter((a) => a.itemId === itemId && a.endedAt === null);
}

/** Whether this member is on the boat's list, and as what (null: not on it). A club boat has no list, so this is null for it. */
export function accessKind(state: ClubState, itemId: string, memberId: string): BoatAccessKind | null {
  return activeAccess(state, itemId).find((a) => a.memberId === memberId)?.kind ?? null;
}

/** The owners who can still use the boat: on its list as owners and still an active member of an active household. */
export function activeOwners(state: ClubState, itemId: string): Member[] {
  return activeAccess(state, itemId)
    .filter((a) => a.kind === "owner" && blockReasonFor(state, a.memberId) === null)
    .map((a) => memberById(state, a.memberId)!)
    .filter(Boolean);
}

/** A private boat with no owner left who can use it: nobody can book it until staff add an owner. */
export function boatLocked(state: ClubState, item: Item): boolean {
  return isPrivate(item) && activeOwners(state, item.id).length === 0;
}

/** Whether the viewer is shown this item at all. A club boat is shown to everyone; a private boat only to staff and its list. */
export function itemVisibleTo(state: ClubState, item: Item, viewer: BoatViewer): boolean {
  if (!isPrivate(item) || viewer.kind === "staff") return true;
  return accessKind(state, item.id, viewer.memberId) !== null;
}

/* ---------- Words ---------- */

export function lockedWords(item: Item): string {
  return `${item.name} is a private boat with no owner who can use it right now, so it cannot be booked until club staff add an owner.`;
}

export function notAllowedWords(item: Item, who: { name: string; you: boolean }): string {
  return `${item.name} is a private boat. ${who.you ? "You are" : `${who.name} is`} not one of its owners or someone an owner has invited.`;
}

export function crewNotAllowedWords(item: Item, name: string): string {
  return `${name} is not one of ${item.name}'s owners or someone an owner has invited, so cannot be in the boat.`;
}

/* ---------- Changing the list ---------- */

function privateItem(state: ClubState, itemId: string): Item {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) throw new ClubError("not_found", "That boat no longer exists.");
  if (!isPrivate(item)) throw new ClubError("invalid", `${item.name} is a club boat, not a private one, so it has no list of owners.`);
  return item;
}

function personWhoCanBeAdded(state: ClubState, memberId: string): Member {
  const member = memberById(state, memberId);
  if (!member) throw new ClubError("not_found", "That member no longer exists.");
  const blocked = blockReasonFor(state, memberId, "they cannot be added to a boat");
  if (blocked) throw new ClubError("invalid", `${fullName(member)} cannot be added: ${blocked}`);
  return member;
}

function newLine(newId: () => string, ctx: Ctx, itemId: string, memberId: string, kind: BoatAccessKind): BoatAccess {
  return { id: newId(), itemId, memberId, kind, addedAt: ctx.now.toISOString(), addedBy: ctx.actor, endedAt: null, endedBy: null, endedReason: null };
}

/** An owner (or staff) lets another member use the boat. It works at once. */
export async function inviteToBoat(store: ClubStore, ctx: Ctx, input: { itemId: string; memberId: string }): Promise<BoatAccess> {
  if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only a boat's owners or club staff can invite people to a boat.");
  return store.transaction(async (s, newId) => {
    const item = privateItem(s, input.itemId);
    if (ctx.actor.kind === "member") {
      const mine = ctx.actor.memberId;
      const owner = activeAccess(s, item.id).some((a) => a.kind === "owner" && a.memberId === mine) && blockReasonFor(s, mine) === null;
      if (!owner) throw new ClubError("forbidden", `Only an owner of ${item.name}, or club staff, can invite people to it.`);
    }
    const person = personWhoCanBeAdded(s, input.memberId);
    const held = accessKind(s, item.id, person.id);
    if (held === "owner") throw new ClubError("conflict", `${fullName(person)} is already an owner of ${item.name}.`);
    if (held === "invited") throw new ClubError("conflict", `${fullName(person)} is already invited to ${item.name}.`);
    const line = newLine(newId, ctx, item.id, person.id, "invited");
    s.boatAccess.push(line);
    return structuredClone(line);
  });
}

/** Staff name an owner. Someone already invited who becomes an owner has their invitation ended, so they hold one line. */
export async function addBoatOwner(store: ClubStore, ctx: Ctx, input: { itemId: string; memberId: string }): Promise<BoatAccess> {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can name the owners of a boat.");
  return store.transaction(async (s, newId) => {
    const item = privateItem(s, input.itemId);
    const person = personWhoCanBeAdded(s, input.memberId);
    const held = activeAccess(s, item.id).find((a) => a.memberId === person.id);
    if (held?.kind === "owner") throw new ClubError("conflict", `${fullName(person)} is already an owner of ${item.name}.`);
    if (held) {
      held.endedAt = ctx.now.toISOString();
      held.endedBy = ctx.actor;
      held.endedReason = "Became an owner";
    }
    const line = newLine(newId, ctx, item.id, person.id, "owner");
    s.boatAccess.push(line);
    return structuredClone(line);
  });
}

/** What taking someone off a boat does to bookings, so the screen can say so before the button is pressed. */
export function removalEffect(state: ClubState, accessId: string, now: Date): { bookings: number; crewSeats: number } {
  const line = state.boatAccess.find((a) => a.id === accessId);
  if (!line) return { bookings: 0, crewSeats: 0 };
  const future = state.bookings.filter((b) => b.itemId === line.itemId && b.status === "upcoming" && Date.parse(b.startsAt) > now.getTime());
  return { bookings: future.filter((b) => b.bookerId === line.memberId).length, crewSeats: future.filter((b) => b.bookerId !== line.memberId && b.crew.includes(line.memberId)).length };
}

export interface RemovalResult {
  access: BoatAccess;
  /** Upcoming bookings by that person on this boat, cancelled. */
  cancelled: number;
  /** Seats they held on other people's outings on this boat, taken away (the outing stays). */
  crewRemoved: number;
}

/**
 * Takes someone off a boat's list. Staff can take anyone off; an owner can take off the people they invited but not an owner
 * (owners are changed by staff). Their upcoming bookings on this boat are cancelled (never as a late cancellation), and any seat
 * they held on someone else's outing there is taken away. Outings under way and past ones stay.
 */
export async function removeFromBoat(store: ClubStore, ctx: Ctx, input: { accessId: string }): Promise<RemovalResult> {
  if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only a boat's owners or club staff can take someone off a boat.");
  return store.transaction(async (s) => {
    const line = s.boatAccess.find((a) => a.id === input.accessId);
    if (!line) throw new ClubError("not_found", "That entry is no longer on the list.");
    if (line.endedAt !== null) throw new ClubError("conflict", "That person is already off the boat's list.");
    const item = privateItem(s, line.itemId);
    const person = memberById(s, line.memberId);
    const name = person ? fullName(person) : "That person";
    if (ctx.actor.kind === "member") {
      const mine = ctx.actor.memberId;
      const owner = activeAccess(s, item.id).some((a) => a.kind === "owner" && a.memberId === mine) && blockReasonFor(s, mine) === null;
      if (!owner) throw new ClubError("forbidden", `Only an owner of ${item.name}, or club staff, can take people off it.`);
      if (line.kind === "owner") throw new ClubError("forbidden", `${name} is an owner of ${item.name}. Only club staff can change the owners.`);
    }
    const by = ctx.actor.kind === "member" ? (memberById(s, ctx.actor.memberId) ? fullName(memberById(s, ctx.actor.memberId)!) : ctx.actor.label) : "club staff";
    line.endedAt = ctx.now.toISOString();
    line.endedBy = ctx.actor;
    line.endedReason = `Taken off by ${by}`;

    const at = ctx.now.toISOString();
    let cancelled = 0;
    let crewRemoved = 0;
    const reason = `${name} is no longer allowed on ${item.name}.`;
    for (const b of s.bookings) {
      if (b.itemId !== item.id || b.status !== "upcoming" || Date.parse(b.startsAt) <= ctx.now.getTime()) continue;
      if (b.bookerId === line.memberId) {
        b.status = "cancelled";
        b.statusChangedAt = at;
        b.cancelledBy = ctx.actor;
        b.cancelReason = reason;
        cancelled += 1;
      } else if (b.crew.includes(line.memberId)) {
        b.removedCrew.push({ memberId: line.memberId, at, reason });
        b.crew = b.crew.filter((id) => id !== line.memberId);
        crewRemoved += 1;
      }
    }
    return { access: structuredClone(line), cancelled, crewRemoved };
  });
}

/* ---------- Finding people to add ---------- */

export const PEOPLE_SEARCH_MIN_LETTERS = 3;
export const PEOPLE_SEARCH_MOST = 6;

export interface BoatPersonChoice {
  memberId: string;
  name: string;
  /** Only when two listed names are the same: the household, so they can be told apart. */
  household: string | null;
}

export interface BoatPeopleSearch {
  tooShort: boolean;
  people: BoatPersonChoice[];
  more: boolean;
}

/**
 * Finding someone to add to a boat's list. Like the iPad's search it shows nothing until three letters are typed and never more
 * than six names, only active members, and never anyone already on the list, so the screen cannot be used to browse the
 * membership. Names only: no email or phone.
 */
export function findBoatPeople(state: ClubState, itemId: string, typed: string): BoatPeopleSearch {
  const wanted = typed.trim();
  const letters = wanted.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "");
  if (letters.length < PEOPLE_SEARCH_MIN_LETTERS) return { tooShort: true, people: [], more: false };
  const on = new Set(activeAccess(state, itemId).map((a) => a.memberId));
  const found = state.members
    .filter((m) => !on.has(m.id) && blockReasonFor(state, m.id) === null && nameMatches(fullName(m), wanted))
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

/* ---------- Views ---------- */

export interface BoatPersonLine {
  accessId: string;
  memberId: string;
  name: string;
  kind: BoatAccessKind;
  addedAt: string;
  addedBy: string;
  /** True when this person can still book (an active member of an active household). */
  active: boolean;
  /** What taking them off would cancel, for the button's words. */
  removal: { bookings: number; crewSeats: number };
}

export interface PrivateBoatView {
  itemId: string;
  name: string;
  className: string;
  type: string;
  owners: BoatPersonLine[];
  invited: BoatPersonLine[];
  locked: boolean;
  /** Upcoming bookings on the boat. */
  upcoming: number;
}

function boatView(state: ClubState, book: RuleBook, item: Item, now: Date): PrivateBoatView {
  const cls = classOf(book, item);
  const line = (a: BoatAccess): BoatPersonLine => {
    const m = memberById(state, a.memberId);
    return {
      accessId: a.id,
      memberId: a.memberId,
      name: m ? fullName(m) : "Unknown member",
      kind: a.kind,
      addedAt: a.addedAt,
      addedBy: a.addedBy.label,
      active: blockReasonFor(state, a.memberId) === null,
      removal: removalEffect(state, a.id, now),
    };
  };
  const lines = activeAccess(state, item.id).map(line).sort((a, b) => a.name.localeCompare(b.name));
  return {
    itemId: item.id,
    name: item.name,
    className: cls.name,
    type: cls.type,
    owners: lines.filter((l) => l.kind === "owner"),
    invited: lines.filter((l) => l.kind === "invited"),
    locked: boatLocked(state, item),
    upcoming: state.bookings.filter((b) => b.itemId === item.id && b.status === "upcoming" && Date.parse(b.endsAt) > now.getTime()).length,
  };
}

/** Every private boat, for staff: locked ones first, then by name. */
export function privateBoats(state: ClubState, book: RuleBook, now: Date): PrivateBoatView[] {
  return state.items
    .filter(isPrivate)
    .map((i) => boatView(state, book, i, now))
    .sort((a, b) => Number(b.locked) - Number(a.locked) || a.name.localeCompare(b.name));
}

/** The private boats this member is an active owner of, for the My boats page. */
export function myOwnedBoats(state: ClubState, book: RuleBook, memberId: string, now: Date): PrivateBoatView[] {
  return state.items
    .filter((i) => isPrivate(i) && accessKind(state, i.id, memberId) === "owner")
    .map((i) => boatView(state, book, i, now))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The private boats this member was invited to (and does not own). */
export function myInvitedBoats(state: ClubState, book: RuleBook, memberId: string): { itemId: string; name: string; className: string; locked: boolean }[] {
  return state.items
    .filter((i) => isPrivate(i) && accessKind(state, i.id, memberId) === "invited")
    .map((i) => ({ itemId: i.id, name: i.name, className: classOf(book, i).name, locked: boatLocked(state, i) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Private boats with nobody who can use them as an owner: the staff to-do list. */
export function lockedBoats(state: ClubState, now: Date): { itemId: string; name: string; upcoming: number }[] {
  return state.items
    .filter((i) => boatLocked(state, i))
    .map((i) => ({
      itemId: i.id,
      name: i.name,
      upcoming: state.bookings.filter((b) => b.itemId === i.id && b.status === "upcoming" && Date.parse(b.endsAt) > now.getTime()).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface BoatLogLine {
  at: string;
  text: string;
}

/** The record of who was let on or taken off a boat, newest first, in words. */
export function boatAccessLog(state: ClubState, itemId: string): BoatLogLine[] {
  const word = (a: BoatAccess) => (a.kind === "owner" ? "an owner" : "invited");
  const by = (actor: Actor) => actor.label;
  const lines: (BoatLogLine & { order: number })[] = [];
  state.boatAccess
    .filter((a) => a.itemId === itemId)
    .forEach((a, index) => {
      const m = memberById(state, a.memberId);
      const name = m ? fullName(m) : "Unknown member";
      lines.push({ at: a.addedAt, order: index * 2, text: `${name} was made ${word(a)} by ${by(a.addedBy)}.` });
      if (a.endedAt && a.endedBy) lines.push({ at: a.endedAt, order: index * 2 + 1, text: `${name} is no longer ${word(a)}. ${a.endedReason ?? `Ended by ${by(a.endedBy)}`}.` });
    });
  return lines.sort((a, b) => b.at.localeCompare(a.at) || b.order - a.order).map(({ at, text }) => ({ at, text }));
}

