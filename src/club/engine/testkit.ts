import { QUALIFICATIONS } from "../qualifications";
import { RULE_BOOK, parseRuleBook } from "../settings/rulebook";
import raw from "../settings/booking-rules.json";
import { MemoryClubStore, sequentialIds } from "../store/memory";
import { addDays, pacificWall } from "../time";
import type { Actor, Item, RuleBook, RuleValues } from "../types";
import { BookingRefused, createBooking, type BookingOptions, type BookingRequest, type ReasonCode } from "./bookings";
import { createHousehold, grantQualification, type Ctx } from "./households";

/** Shared setup for the booking tests: a small invented club and a frozen clock. */

/** Wednesday Oct 28, 2026, 1 pm Pacific. */
export const NOW = new Date("2026-10-28T20:00:00Z");
export const TODAY = "2026-10-28";

export const staff: Actor = { kind: "staff", label: "Test staff" };
export const staffCtx = (now: Date = NOW): Ctx => ({ actor: staff, now });
export const memberCtx = (memberId: string, label = "A Member", now: Date = NOW): Ctx => ({ actor: { kind: "member", memberId, label }, now });

/** A moment on the Pacific clock: `at(1, 7)` is 7 am tomorrow; `at(1, 7, 30)` is 7:30 am. */
export const at = (daysAhead: number, hour: number, minute = 0, today = TODAY) => pacificWall(addDays(today, daysAhead), hour * 60 + minute);

export function ruleBookWith(defaults: Partial<RuleValues>, classes?: (cls: Record<string, unknown>[]) => void): RuleBook {
  const copy = structuredClone(raw) as { defaults: Record<string, unknown>; classes: Record<string, unknown>[] };
  Object.assign(copy.defaults, defaults);
  classes?.(copy.classes);
  return parseRuleBook(copy, QUALIFICATIONS);
}

export interface Fixture {
  store: MemoryClubStore;
  book: RuleBook;
  /** Members by first name. */
  m: Record<string, string>;
  /** Households by surname. */
  h: Record<string, string>;
  /** Items by name. */
  i: Record<string, string>;
}

const ITEMS: [string, string, Partial<RuleValues>?][] = [
  ["Heron", "shell-single"],
  ["Osprey", "shell-single"],
  ["Kingfisher", "shell-single"],
  ["Loon", "shell-double"],
  ["Pelican", "shell-double"],
  ["Albatross", "shell-quad"],
  ["Otter", "kayak"],
  ["Skimmer", "paddle-board"],
  ["Dock slip A", "dock-space"],
];

/**
 * Two households. Quill: Ada (sculling 3), Ben (sculling 2), Cy (no qualification). Reed: Dee (sculling 1),
 * Eli (sculling 3). Singles need level 1, the double level 2, the quad level 3.
 */
export async function fixture(book: RuleBook = RULE_BOOK): Promise<Fixture> {
  const store = new MemoryClubStore(sequentialIds());
  const ctx = staffCtx();
  const person = (first: string, last: string) => ({ firstName: first, lastName: last, email: `${first}@example.com`.toLowerCase() });
  const quill = await createHousehold(store, ctx, { displayName: "The Quill household", membershipType: "Resident", joinedOn: "2020-01-01", primary: person("Ada", "Quill"), additional: [person("Ben", "Quill"), person("Cy", "Quill")] });
  const reed = await createHousehold(store, ctx, { displayName: "The Reed household", membershipType: "Resident", joinedOn: "2020-01-01", primary: person("Dee", "Reed"), additional: [person("Eli", "Reed")] });
  const m = Object.fromEntries([...quill.members, ...reed.members].map((x) => [x.firstName, x.id]));
  for (const [name, code] of [["Ada", "scull-3"], ["Ben", "scull-2"], ["Dee", "scull-1"], ["Eli", "scull-3"]]) await grantQualification(store, ctx, m[name], code);
  await store.transaction(async (s, newId) => {
    for (const [name, classCode, ruleOverrides] of ITEMS) s.items.push({ id: newId(), name, classCode, ruleOverrides: ruleOverrides ?? {} } satisfies Item);
  });
  const state = await store.read();
  return { store, book, m, h: { Quill: quill.household.id, Reed: reed.household.id }, i: Object.fromEntries(state.items.map((x) => [x.name, x.id])) };
}

/** Adds `count` extra one-adult households, each qualified for singles, and returns their member IDs. */
export async function addMembers(f: Fixture, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 0; n < count; n++) {
    const { members } = await createHousehold(f.store, staffCtx(), {
      displayName: `The Extra${n} household`,
      membershipType: "Resident",
      joinedOn: "2020-01-01",
      primary: { firstName: `Extra${n}`, lastName: "Member", email: `extra${n}@example.com` },
    });
    await grantQualification(f.store, staffCtx(), members[0].id, "scull-1");
    ids.push(members[0].id);
  }
  return ids;
}

/** A booking request for a member on an item, with times counted from the fixture's "today". */
export const request = (f: Fixture, who: string, item: string, start: Date, end: Date, crew: string[] = []): BookingRequest => ({
  itemId: f.i[item],
  bookerId: f.m[who] ?? who,
  startsAt: start,
  endsAt: end,
  crewIds: crew.map((c) => f.m[c] ?? c),
});

/** The member books for themselves. */
export const bookAs = (f: Fixture, who: string, item: string, start: Date, end: Date, crew: string[] = [], options?: BookingOptions, now: Date = NOW) =>
  createBooking(f.store, f.book, memberCtx(f.m[who] ?? who, who, now), request(f, who, item, start, end, crew), options);

/** The reason codes a booking was refused for, or [] if it went through. */
export async function refusedFor(attempt: Promise<unknown>): Promise<ReasonCode[]> {
  try {
    await attempt;
    return [];
  } catch (e) {
    if (e instanceof BookingRefused) return e.reasons.map((r) => r.code);
    throw e;
  }
}

/** The plain-language messages a booking was refused with. */
export async function refusalMessages(attempt: Promise<unknown>): Promise<string[]> {
  try {
    await attempt;
    return [];
  } catch (e) {
    if (e instanceof BookingRefused) return e.reasons.map((r) => r.message);
    throw e;
  }
}
