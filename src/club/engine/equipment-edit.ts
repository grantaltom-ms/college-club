import { ClubError } from "../errors";
import { nameMatches } from "../name-filter";
import { classOf, rulesFor } from "../settings/rulebook";
import type { ClubStore } from "../store/memory";
import { formatRange } from "../time";
import type { Actor, BookingType, ClubState, Item, ItemLogEntry, RuleBook } from "../types";
import { isPrivate, isRetired } from "./boat-access";
import { affectedBookings, outOfServiceAt, type AffectedBooking } from "./bookings";
import type { EquipmentSkill } from "./equipment-import";
import type { Ctx } from "./households";
import { occupancy, placesOf } from "./pools";

/**
 * Fixing and retiring equipment that is already in the club.
 *
 * The building comparison: the unit list. The office can correct a unit's bedroom count or its name on the list, and can take a
 * unit off the list for good when the building no longer has it. Nothing is ever erased: a retired unit stays in the files (old
 * bookings still name it), and the office can put it back. Every correction and every retirement is a line in the unit's own file
 * saying who did it, when, and what it said before.
 *
 * What can change: the name, the skill level needed, the number of seats (within the same kind of boat: a single can become a
 * double, never a kayak) and the number of places in a pool. Whether a boat is private, and which kind of thing it is, are fixed
 * when it is made: a boat loaded wrongly as private is retired and added again.
 *
 * Retiring never cancels anything. Bookings already made stay, and staff are told who to contact (the same as taking a boat out of
 * service). A retired item is shown to nobody and refused by the booking check; staff can bring it back.
 */

export const MAX_ITEM_NAME = 80;
export const MAX_RETIRE_REASON = 200;
export const MAX_POOL_PLACES = 500;
/** Soft bounds for a boat's max combined rower weight in pounds. */
export const MIN_MAX_WEIGHT_LBS = 50;
export const MAX_MAX_WEIGHT_LBS = 800;

const CONTROL = /[\u0000-\u001f\u007f]/;
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listWords = (values: (string | number)[]) => (values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`);

/** Thrown when an edit cannot be made. `message` is the first problem; `problems` is all of them, so a form can show them together. */
export class ItemEditRefused extends ClubError {
  constructor(public problems: string[]) {
    super("refused", problems[0] ?? "That change cannot be made.");
  }
}

function requireStaff(actor: Actor, what: string): void {
  if (actor.kind !== "staff") throw new ClubError("forbidden", `Only club staff can ${what}.`);
}

function itemOrThrow(state: ClubState, id: string): Item {
  const item = state.items.find((i) => i.id === id);
  if (!item) throw new ClubError("not_found", "That item no longer exists.");
  return item;
}

/* ---------- Skill level, in words ---------- */

/** How an item's skill level is set now: the class's own, none at all, or one named qualification. */
export const skillKey = (item: Pick<Item, "requiredQualification">): string =>
  item.requiredQualification === undefined ? "class" : item.requiredQualification === null ? "none" : item.requiredQualification;

/** The skill level an item needs, in words, for the screens and the file. */
export function skillWords(state: ClubState, book: RuleBook, item: Item): string {
  const code = rulesFor(book, item).requiredQualification;
  const name = code === null ? "None needed" : (state.qualifications.find((q) => q.code === code)?.name ?? code);
  return item.requiredQualification === undefined ? `${name} (usual for this kind of boat)` : name;
}

const seatsWords = (book: RuleBook, classCode: string): string => {
  const cls = classOf(book, { classCode });
  return `${cls.name} (${plural(cls.seats, "seat")})`;
};

/* ---------- What an edit would do ---------- */

/** What staff typed. Anything left out, or equal to what is there now, is left alone. */
export interface ItemEdit {
  name?: string;
  /** The number of seats: 1, 2, 4 or 8 for a shell; 1 or 2 for a kayak. */
  seats?: number;
  skill?: EquipmentSkill;
  /** Pools only. */
  places?: number;
  /**
   * Max combined rower weight in pounds. Pass `null` to clear. Only meaningful for boats (shells first); other kinds refuse it.
   */
  maxWeightLbs?: number | null;
  /**
   * Min combined rower weight in pounds. Pass `null` to clear. A single value from the source is stored as min = max.
   */
  minWeightLbs?: number | null;
  /** Boat manufacturer. Pass `null` to clear (maker not listed). */
  manufacturer?: string | null;
}

export type ItemChangeField = "name" | "seats" | "skill" | "places" | "maxWeight" | "minWeight" | "manufacturer";

/** One end of a weight class, for staff forms that still edit max alone. */
export function weightWords(lbs: number | null | undefined): string {
  return lbs == null ? "not set" : `${lbs} lb`;
}

/**
 * Weight class as members see it: "110-143 lb", "220 lb" when min = max, or "weight not on file" when neither is set.
 * Never invents zero.
 */
export function weightRangeWords(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null && max == null) return "weight not on file";
  if (min != null && max != null && min === max) return `${min} lb`;
  if (min != null && max != null) return `${min}-${max} lb`;
  if (max != null) return `${max} lb`;
  return `${min} lb`;
}

export function manufacturerWords(value: string | null | undefined): string {
  return value == null || value === "" ? "Maker not listed" : value;
}

/** One thing that would change, in words. */
export interface ItemChange {
  field: ItemChangeField;
  label: string;
  from: string;
  to: string;
}

export interface ItemEditPlan {
  itemId: string;
  itemName: string;
  retired: boolean;
  changes: ItemChange[];
  /** Things worth knowing that do not stop the change. */
  notices: string[];
  /** Everything that stops it. Empty means it can be done. */
  problems: string[];
}

interface Computed extends ItemEditPlan {
  after: {
    name: string;
    classCode: string;
    requiredQualification: string | null | undefined;
    places: number;
    maxWeightLbs: number | null;
    minWeightLbs: number | null;
    manufacturer: string | null;
  };
  /** Old and new values for the database's "no change without a line" check. */
  details: Record<string, string | number | null>;
}

function compute(state: ClubState, book: RuleBook, now: Date, itemId: string, edit: ItemEdit): Computed {
  const item = itemOrThrow(state, itemId);
  const problems: string[] = [];
  const notices: string[] = [];
  const changes: ItemChange[] = [];
  const details: Record<string, string | number | null> = {};
  const after = {
    name: item.name,
    classCode: item.classCode,
    requiredQualification: item.requiredQualification,
    places: placesOf(item),
    maxWeightLbs: item.maxWeightLbs ?? null,
    minWeightLbs: item.minWeightLbs ?? null,
    manufacturer: item.manufacturer ?? null,
  };
  const retired = isRetired(item);
  const cls = classOf(book, item);
  let onlyNameWhileRetired = false;

  // The name.
  if (edit.name !== undefined) {
    const name = clean(edit.name);
    if (name === "") problems.push("The name cannot be empty.");
    else if (name.length > MAX_ITEM_NAME) problems.push(`The name must be ${MAX_ITEM_NAME} characters or fewer.`);
    else if (CONTROL.test(name)) problems.push("The name has a character that cannot be saved. Retype it.");
    else if (name !== item.name) {
      const clash = state.items.find((i) => i.id !== item.id && clean(i.name).toLowerCase() === name.toLowerCase());
      if (clash) problems.push(`There is already an item called "${clash.name}"${isRetired(clash) ? " (retired)" : ""}. Names have to be different, even for a retired item.`);
      else {
        changes.push({ field: "name", label: "Name", from: item.name, to: name });
        details.nameFrom = item.name;
        details.nameTo = name;
        after.name = name;
      }
    }
  }

  // The seats: another class of the same kind of boat.
  let target = cls;
  if (edit.seats !== undefined) {
    if (!Number.isInteger(edit.seats)) problems.push("Seats must be a whole number.");
    else if (edit.seats !== cls.seats) {
      onlyNameWhileRetired = true;
      const next = book.classes.find((c) => c.type === cls.type && c.seats === edit.seats);
      if (!next) {
        const sizes = [...new Set(book.classes.filter((c) => c.type === cls.type).map((c) => c.seats))].sort((a, b) => a - b);
        problems.push(
          sizes.length === 1
            ? `${item.name} is a ${cls.type.toLowerCase()}, which has ${plural(sizes[0], "seat")}, so its number of seats cannot change.`
            : `A ${cls.type.toLowerCase()} can have ${listWords(sizes)} seats, not ${edit.seats}.`,
        );
      } else {
        target = next;
        const upcoming = state.bookings.filter((b) => b.itemId === item.id && b.status === "upcoming" && Date.parse(b.endsAt) > now.getTime());
        const tooMany = upcoming.filter((b) => 1 + b.crew.length > next.seats);
        if (tooMany.length > 0) {
          problems.push(
            `${plural(tooMany.length, "upcoming booking")} of ${item.name} ${tooMany.length === 1 ? "has" : "have"} more people in ${tooMany.length === 1 ? "it" : "them"} than ${next.name} (${plural(next.seats, "seat")}) holds. Take the extra crew off, or cancel ${tooMany.length === 1 ? "that booking" : "those bookings"}, first.`,
          );
        }
        const seated = state.practiceSeats.filter((x) => {
          if (x.itemId !== item.id || x.endedAt !== null || x.seat <= next.seats) return false;
          const p = state.practices.find((q) => q.id === x.practiceId);
          return p !== undefined && p.status === "scheduled" && Date.parse(p.endsAt) > now.getTime();
        });
        if (seated.length > 0) {
          problems.push(
            `${plural(seated.length, "person", "people")} ${seated.length === 1 ? "is" : "are"} seated in a coach's lineup in ${seated.length === 1 ? "a seat" : "seats"} that ${next.name} (${plural(next.seats, "seat")}) does not have. Take them out of ${seated.length === 1 ? "that seat" : "those seats"} first.`,
          );
        }
        changes.push({ field: "seats", label: "Seats", from: seatsWords(book, item.classCode), to: seatsWords(book, next.code) });
        details.classFrom = item.classCode;
        details.classTo = next.code;
        after.classCode = next.code;
      }
    }
  }

  // The skill level needed. Compared with where the item will be after any seat change, so the words are about the final boat.
  if (edit.skill !== undefined) {
    const s = edit.skill;
    if (s.mode === "code" && !state.qualifications.some((q) => q.code === s.code)) {
      problems.push(`"${s.code}" is not a skill level the club uses.`);
    } else {
      const nextKey = s.mode === "class" ? "class" : s.mode === "none" ? "none" : s.code;
      if (nextKey !== skillKey(item)) {
        onlyNameWhileRetired = true;
        after.requiredQualification = s.mode === "class" ? undefined : s.mode === "none" ? null : s.code;
        details.skillFrom = skillKey(item);
        details.skillTo = nextKey;
      }
    }
  }
  if (details.skillTo !== undefined) {
    const finalItem: Item = { ...item, classCode: after.classCode, requiredQualification: after.requiredQualification };
    changes.push({ field: "skill", label: "Skill level needed", from: skillWords(state, book, item), to: skillWords(state, book, finalItem) });
    if (isPrivate(item)) notices.push(`${item.name} is a private boat, so its skill level is not checked when it is booked.`);
  } else if (details.classTo !== undefined && item.requiredQualification === undefined) {
    // Following the kind of boat: a new size can mean a new usual level.
    const before = rulesFor(book, item).requiredQualification;
    const nowNeeds = target.requiredQualification;
    if (before !== nowNeeds && !isPrivate(item)) {
      const word = (code: string | null) => (code === null ? "none" : (state.qualifications.find((q) => q.code === code)?.name ?? code));
      notices.push(`Its skill level follows the kind of boat, so it goes from ${word(before)} to ${word(nowNeeds)}. Choose a level yourself to keep the old one.`);
    }
  }

  // The number of places in a pool.
  if (edit.places !== undefined) {
    const current = placesOf(item);
    if (current <= 1) {
      problems.push(`${item.name} has a single place, so it is not a pool and has no number of places to change.`);
    } else if (!Number.isInteger(edit.places) || edit.places < 2 || edit.places > MAX_POOL_PLACES) {
      problems.push(`Places must be a whole number from 2 to ${MAX_POOL_PLACES}.`);
    } else if (edit.places !== current) {
      onlyNameWhileRetired = true;
      const busiest = occupancy(state, item.id, now.getTime(), Infinity).reduce((best, seg) => (seg.count > best.count ? seg : best), { from: 0, to: 0, count: 0 });
      if (busiest.count > edit.places) {
        const when = formatRange(new Date(busiest.from).toISOString(), new Date(busiest.to === Infinity ? busiest.from + 30 * 60000 : busiest.to).toISOString());
        problems.push(`${plural(busiest.count, "person", "people")} hold${busiest.count === 1 ? "s" : ""} ${item.name} at once from ${when}, so it cannot go below ${busiest.count} places until some of those bookings are cancelled.`);
      }
      changes.push({ field: "places", label: "Places", from: String(current), to: String(edit.places) });
      details.placesFrom = current;
      details.placesTo = edit.places;
      after.places = edit.places;
    }
  }

  // Weight class (pounds). Shells first; other on-water boats can hold one too. Min and max may be edited together.
  const weightEditable = cls.type === "Shell" || cls.type === "Kayak" || cls.type === "Paddle Board";
  if (edit.maxWeightLbs !== undefined || edit.minWeightLbs !== undefined) {
    const currentMax = item.maxWeightLbs ?? null;
    const currentMin = item.minWeightLbs ?? null;
    const nextMax = edit.maxWeightLbs !== undefined ? edit.maxWeightLbs : currentMax;
    const nextMin = edit.minWeightLbs !== undefined ? edit.minWeightLbs : currentMin;
    if (!weightEditable) {
      problems.push(`${item.name} is a ${cls.type.toLowerCase()}, so it has no rower weight limit to set.`);
    } else {
      const bad = (label: string, next: number | null) =>
        next !== null && (!Number.isInteger(next) || next < MIN_MAX_WEIGHT_LBS || next > MAX_MAX_WEIGHT_LBS)
          ? `${label} must be a whole number from ${MIN_MAX_WEIGHT_LBS} to ${MAX_MAX_WEIGHT_LBS} pounds, or left blank.`
          : null;
      const maxProblem = bad("Max weight", nextMax);
      const minProblem = bad("Min weight", nextMin);
      if (maxProblem) problems.push(maxProblem);
      if (minProblem) problems.push(minProblem);
      if (!maxProblem && !minProblem && nextMin != null && nextMax != null && nextMin > nextMax) {
        problems.push("Min weight cannot be higher than max weight.");
      } else if (!maxProblem && !minProblem) {
        if (nextMax !== currentMax) {
          onlyNameWhileRetired = true;
          changes.push({ field: "maxWeight", label: "Max weight", from: weightWords(currentMax), to: weightWords(nextMax) });
          details.maxWeightFrom = currentMax == null ? "" : String(currentMax);
          details.maxWeightTo = nextMax == null ? "" : String(nextMax);
          after.maxWeightLbs = nextMax;
        }
        if (nextMin !== currentMin) {
          onlyNameWhileRetired = true;
          changes.push({ field: "minWeight", label: "Min weight", from: weightWords(currentMin), to: weightWords(nextMin) });
          details.minWeightFrom = currentMin == null ? "" : String(currentMin);
          details.minWeightTo = nextMin == null ? "" : String(nextMin);
          after.minWeightLbs = nextMin;
        }
      }
    }
  }

  if (edit.manufacturer !== undefined) {
    const current = item.manufacturer ?? null;
    const typed = edit.manufacturer === null ? null : clean(edit.manufacturer);
    const next = typed === "" ? null : typed;
    if (!weightEditable) {
      problems.push(`${item.name} is a ${cls.type.toLowerCase()}, so it has no manufacturer to set.`);
    } else if (next !== null && (next.length > MAX_ITEM_NAME || CONTROL.test(next))) {
      problems.push(next.length > MAX_ITEM_NAME ? `Manufacturer must be ${MAX_ITEM_NAME} characters or fewer, or left blank.` : "The manufacturer has a character that cannot be saved. Retype it.");
    } else if (next !== current) {
      onlyNameWhileRetired = true;
      changes.push({ field: "manufacturer", label: "Manufacturer", from: manufacturerWords(current), to: manufacturerWords(next) });
      details.manufacturerFrom = current ?? "";
      details.manufacturerTo = next ?? "";
      after.manufacturer = next;
    }
  }

  if (retired && onlyNameWhileRetired) {
    problems.push(`${item.name} has been retired, so only its name can be changed. Bring it back to change anything else.`);
  }
  return { itemId: item.id, itemName: item.name, retired, changes, notices, problems, after, details };
}

/** Every change an edit would make and every reason it cannot be made, without changing anything. Staff only. */
export function planItemEdit(state: ClubState, book: RuleBook, ctx: Ctx, itemId: string, edit: ItemEdit): ItemEditPlan {
  requireStaff(ctx.actor, "change an item");
  const c = compute(state, book, ctx.now, itemId, edit);
  return { itemId: c.itemId, itemName: c.itemName, retired: c.retired, changes: c.changes, notices: c.notices, problems: c.problems };
}

function logLine(newId: () => string, ctx: Ctx, itemId: string, kind: ItemLogEntry["kind"], text: string, details: ItemLogEntry["details"] = {}): ItemLogEntry {
  return { id: newId(), itemId, at: ctx.now.toISOString(), kind, by: ctx.actor, text, details };
}

const quoted = (value: string) => `"${value}"`;

/** Fixes what staff typed on one item, in one all-or-nothing change, and writes the line in the item's file. Staff only. */
export async function updateItem(store: ClubStore, book: RuleBook, ctx: Ctx, itemId: string, edit: ItemEdit): Promise<{ item: Item; changes: ItemChange[]; notices: string[] }> {
  requireStaff(ctx.actor, "change an item");
  return store.transaction(async (s, newId) => {
    const plan = compute(s, book, ctx.now, itemId, edit);
    if (plan.problems.length > 0) throw new ItemEditRefused(plan.problems);
    if (plan.changes.length === 0) throw new ClubError("unchanged", `Nothing was changed: what you entered is what ${plan.itemName} already has.`);
    const item = itemOrThrow(s, itemId);
    item.name = plan.after.name;
    item.classCode = plan.after.classCode;
    if (plan.after.requiredQualification === undefined) delete item.requiredQualification;
    else item.requiredQualification = plan.after.requiredQualification;
    if (placesOf(item) > 1) item.places = plan.after.places;
    if (plan.after.maxWeightLbs == null) delete item.maxWeightLbs;
    else item.maxWeightLbs = plan.after.maxWeightLbs;
    if (plan.after.minWeightLbs == null) delete item.minWeightLbs;
    else item.minWeightLbs = plan.after.minWeightLbs;
    if (plan.after.manufacturer == null) delete item.manufacturer;
    else item.manufacturer = plan.after.manufacturer;
    const said = plan.changes.map((c) => `${c.label.toLowerCase()} from ${c.field === "name" ? quoted(c.from) : c.from} to ${c.field === "name" ? quoted(c.to) : c.to}`);
    s.itemLog.push(logLine(newId, ctx, item.id, "changed", `Changed by ${ctx.actor.label}: ${said.join("; ")}.`, plan.details));
    return { item: structuredClone(item), changes: plan.changes, notices: plan.notices };
  });
}

/* ---------- Retiring and bringing back ---------- */

/** What staff should know when they retire something: nothing is cancelled, but these still reach it. */
export interface RetireEffects {
  /** Upcoming bookings (including one under way), with the people to contact. */
  bookings: AffectedBooking[];
  /** Scheduled classes that hold this room and have not finished. */
  sessions: { id: string; title: string; startsAt: string; endsAt: string }[];
  /** Scheduled practices that reserve this boat and have not finished. */
  practices: { id: string; name: string; startsAt: string; endsAt: string }[];
}

export function retireEffects(state: ClubState, now: Date, itemId: string): RetireEffects {
  const t = now.getTime();
  const sessions = state.sessions
    .filter((x) => x.roomItemId === itemId && x.status === "scheduled" && Date.parse(x.endsAt) > t)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((x) => ({ id: x.id, title: state.classes.find((c) => c.id === x.classId)?.name ?? "A class", startsAt: x.startsAt, endsAt: x.endsAt }));
  const practices = state.practiceBoats
    .filter((l) => l.itemId === itemId && l.endedAt === null)
    .map((l) => state.practices.find((p) => p.id === l.practiceId))
    .filter((p): p is NonNullable<typeof p> => p !== undefined && p.status === "scheduled" && Date.parse(p.endsAt) > t)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((p) => ({ id: p.id, name: p.name, startsAt: p.startsAt, endsAt: p.endsAt }));
  return { bookings: affectedBookings(state, itemId, now, null), sessions, practices };
}

/** The words in an item's file for a retirement. */
function retiredWords(ctx: Ctx, reason: string, effects: RetireEffects): string {
  const left = effects.bookings.length + effects.sessions.length + effects.practices.length;
  const parts = [
    effects.bookings.length > 0 ? plural(effects.bookings.length, "upcoming booking") : null,
    effects.sessions.length > 0 ? plural(effects.sessions.length, "scheduled class") : null,
    effects.practices.length > 0 ? plural(effects.practices.length, "scheduled practice") : null,
  ].filter((p): p is string => p !== null);
  return `Retired by ${ctx.actor.label}. Reason: ${reason}. ${left === 0 ? "Nothing was booked on it." : `${parts.join(", ")} ${left === 1 ? "was" : "were"} left in place; staff have the list to contact the people.`}`;
}

/**
 * Staff retire an item. It is shown to nobody and refused by the booking check from now on. Nothing is cancelled: bookings already
 * made stay, and the people to contact are returned. Staff only.
 */
export async function retireItem(store: ClubStore, ctx: Ctx, itemId: string, input: { reason: string }): Promise<{ item: Item; effects: RetireEffects }> {
  requireStaff(ctx.actor, "retire an item");
  const reason = clean(input.reason);
  if (reason === "") throw new ClubError("invalid", "Say why it is being retired, for the record.");
  if (reason.length > MAX_RETIRE_REASON) throw new ClubError("invalid", `The reason must be ${MAX_RETIRE_REASON} characters or fewer.`);
  if (CONTROL.test(reason)) throw new ClubError("invalid", "The reason has a character that cannot be saved. Retype it.");
  return store.transaction(async (s, newId) => {
    const item = itemOrThrow(s, itemId);
    if (isRetired(item)) throw new ClubError("conflict", `${item.name} has already been retired.`);
    const effects = retireEffects(s, ctx.now, item.id);
    item.retired = { at: ctx.now.toISOString(), by: ctx.actor, reason };
    s.itemLog.push(logLine(newId, ctx, item.id, "retired", retiredWords(ctx, reason, effects), { reason }));
    return { item: structuredClone(item), effects };
  });
}

/** Staff bring a retired item back: it is offered and bookable again. Staff only. */
export async function restoreItem(store: ClubStore, ctx: Ctx, itemId: string): Promise<Item> {
  requireStaff(ctx.actor, "bring an item back");
  return store.transaction(async (s, newId) => {
    const item = itemOrThrow(s, itemId);
    if (!isRetired(item)) throw new ClubError("conflict", `${item.name} has not been retired.`);
    delete item.retired;
    s.itemLog.push(logLine(newId, ctx, item.id, "restored", `Brought back by ${ctx.actor.label}. It can be booked again.`));
    return structuredClone(item);
  });
}

/* ---------- What staff see ---------- */

export interface EquipmentLine {
  itemId: string;
  name: string;
  className: string;
  type: BookingType;
  seats: number;
  /** More than one for a pool. */
  places: number;
  pool: boolean;
  isPrivate: boolean;
  skill: string;
  /** Max combined rower weight in pounds, when set. */
  maxWeightLbs: number | null;
  /** Min combined rower weight in pounds, when set. */
  minWeightLbs: number | null;
  /** Maker, when listed. */
  manufacturer: string | null;
  status: "in_service" | "out_of_service" | "retired";
  /** The out-of-service period now in force. */
  out: { periodId: string; reason: string; expectedReturn: string | null } | null;
  retired: { at: string; by: string; reason: string } | null;
  /** Upcoming bookings on it, so staff see what retiring it would leave. */
  upcoming: number;
}

export interface EquipmentList {
  /** In use (in service or out of service), by name. */
  active: EquipmentLine[];
  /** Retired, by name. */
  retired: EquipmentLine[];
  /** How many items the club has in all, whatever was typed to narrow the list. */
  total: number;
}

function lineOf(state: ClubState, book: RuleBook, now: Date, item: Item): EquipmentLine {
  const cls = classOf(book, item);
  const out = outOfServiceAt(state, item.id, now);
  const places = placesOf(item);
  return {
    itemId: item.id,
    name: item.name,
    className: cls.name,
    type: cls.type,
    seats: cls.seats,
    places,
    pool: places > 1,
    isPrivate: isPrivate(item),
    skill: skillWords(state, book, item),
    maxWeightLbs: item.maxWeightLbs ?? null,
    minWeightLbs: item.minWeightLbs ?? null,
    manufacturer: item.manufacturer ?? null,
    status: isRetired(item) ? "retired" : out ? "out_of_service" : "in_service",
    out: out ? { periodId: out.id, reason: out.reason, expectedReturn: out.expectedReturn } : null,
    retired: item.retired ? { at: item.retired.at, by: item.retired.by.label, reason: item.retired.reason } : null,
    upcoming: state.bookings.filter((b) => b.itemId === item.id && b.status === "upcoming" && Date.parse(b.endsAt) > now.getTime()).length,
  };
}

/** Every item, split into in use and retired, narrowed by the first letters of any word of its name. Staff only (the caller checks). */
export function equipmentList(state: ClubState, book: RuleBook, now: Date, find = ""): EquipmentList {
  const byName = (a: EquipmentLine, b: EquipmentLine) => a.name.localeCompare(b.name) || a.itemId.localeCompare(b.itemId);
  const lines = state.items.filter((i) => nameMatches(i.name, find)).map((i) => lineOf(state, book, now, i));
  return {
    active: lines.filter((l) => l.status !== "retired").sort(byName),
    retired: lines.filter((l) => l.status === "retired").sort(byName),
    total: state.items.length,
  };
}

export interface ItemFileLine {
  id: string;
  at: string;
  kind: ItemLogEntry["kind"];
  by: string;
  text: string;
}

/** One item's file, newest first. */
export function itemFile(state: ClubState, itemId: string): ItemFileLine[] {
  return state.itemLog
    .filter((l) => l.itemId === itemId)
    .map((l, i) => ({ l, i }))
    .sort((a, b) => b.l.at.localeCompare(a.l.at) || b.i - a.i)
    .map(({ l }) => ({ id: l.id, at: l.at, kind: l.kind, by: l.by.label, text: l.text }));
}

/** The look at one item that the edit and retire pages share. */
export interface ItemPage {
  line: EquipmentLine;
  /**
   * What reaches the item and has not finished: what retiring it would leave in place, or for a retired item what is still left in
   * place, so staff can contact the people.
   */
  effects: RetireEffects;
  file: ItemFileLine[];
}

export function itemPage(state: ClubState, book: RuleBook, now: Date, itemId: string): ItemPage {
  const item = itemOrThrow(state, itemId);
  return { line: lineOf(state, book, now, item), effects: retireEffects(state, now, item.id), file: itemFile(state, item.id) };
}
