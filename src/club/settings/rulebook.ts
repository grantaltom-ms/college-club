import { QUALIFICATIONS } from "../qualifications";
import { clockToMinutes } from "../time";
import { BOOKING_TYPES, type BookingType, type Item, type ItemClass, type Qualification, type RuleBook, type RuleValues } from "../types";
import raw from "./booking-rules.json";

/** A mistake in the rules file, worded so someone editing it can fix it. */
export class RuleBookError extends Error {}

type Kind = "count" | "minutes" | "clock" | "gap" | "limit";
/** What each rule is. Unknown names are refused, so a typo in the file is caught rather than ignored. */
const RULES: Record<keyof RuleValues, { kind: Kind; label: string }> = {
  windowDays: { kind: "count", label: "windowDays (how many days ahead)" },
  opensAt: { kind: "clock", label: "opensAt (when a new day opens)" },
  dayStart: { kind: "clock", label: "dayStart (first bookable time)" },
  dayEnd: { kind: "clock", label: "dayEnd (last bookable time)" },
  slotMinutes: { kind: "minutes", label: "slotMinutes (time slot size)" },
  minMinutes: { kind: "minutes", label: "minMinutes (shortest booking)" },
  defaultMinutes: { kind: "minutes", label: "defaultMinutes (length the booking form starts with)" },
  maxMinutes: { kind: "minutes", label: "maxMinutes (longest booking)" },
  maxFuturePerType: { kind: "limit", label: "maxFuturePerType (bookings held at once, 0 for no limit)" },
  maxPerDayPerType: { kind: "limit", label: "maxPerDayPerType (bookings per day, 0 for no limit)" },
  cancelCutoffMinutes: { kind: "gap", label: "cancelCutoffMinutes (latest cancel without penalty)" },
  gapMinutes: { kind: "gap", label: "gapMinutes (gap between bookings)" },
};

function checkOne(key: string, value: unknown, where: string): void {
  const rule = RULES[key as keyof RuleValues];
  if (!rule) throw new RuleBookError(`${where}: "${key}" is not a rule. The rules are: ${Object.keys(RULES).join(", ")}.`);
  const at = `${where}, ${rule.label}`;
  if (rule.kind === "clock") {
    if (typeof value !== "string") throw new RuleBookError(`${at} must be a time in quotes like "05:00".`);
    try {
      clockToMinutes(value);
    } catch (e) {
      throw new RuleBookError(`${at}: ${(e as Error).message}`);
    }
    return;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) throw new RuleBookError(`${at} must be a whole number.`);
  const zeroAllowed = rule.kind === "gap" || rule.kind === "limit";
  if (value < (zeroAllowed ? 0 : 1)) throw new RuleBookError(`${at} must be ${zeroAllowed ? "0 or more" : "1 or more"}.`);
}

/** Checks the rules that only make sense together. */
export function checkRuleValues(v: RuleValues, where: string): void {
  const start = clockToMinutes(v.dayStart);
  const end = clockToMinutes(v.dayEnd);
  if (end <= start) throw new RuleBookError(`${where}: dayEnd (${v.dayEnd}) must be later than dayStart (${v.dayStart}).`);
  if (clockToMinutes(v.opensAt) >= 1440) throw new RuleBookError(`${where}: opensAt must be before 24:00.`);
  if (v.maxMinutes < v.minMinutes) throw new RuleBookError(`${where}: maxMinutes (${v.maxMinutes}) cannot be shorter than minMinutes (${v.minMinutes}).`);
  if (v.defaultMinutes < v.minMinutes || v.defaultMinutes > v.maxMinutes) {
    throw new RuleBookError(`${where}: defaultMinutes (${v.defaultMinutes}) must be between minMinutes (${v.minMinutes}) and maxMinutes (${v.maxMinutes}).`);
  }
  for (const key of ["minMinutes", "defaultMinutes", "maxMinutes"] as const) {
    if (v[key] % v.slotMinutes !== 0) throw new RuleBookError(`${where}: ${key} (${v[key]}) must be a whole number of ${v.slotMinutes}-minute slots.`);
  }
  if ((end - start) % v.slotMinutes !== 0) throw new RuleBookError(`${where}: the bookable hours (${v.dayStart} to ${v.dayEnd}) must be a whole number of ${v.slotMinutes}-minute slots.`);
  if (v.maxPerDayPerType > v.maxFuturePerType && v.maxFuturePerType > 0) {
    // Allowed (a day limit above the holding limit is just never reached) but almost certainly a mistake worth saying.
    throw new RuleBookError(`${where}: maxPerDayPerType (${v.maxPerDayPerType}) is higher than maxFuturePerType (${v.maxFuturePerType}), so the day limit could never be reached.`);
  }
}

/** Checks a partial set of rules (a class's or one item's) and that it still works on top of the defaults. */
export function checkOverrides(defaults: RuleValues, overrides: Partial<RuleValues>, where: string): void {
  for (const [key, value] of Object.entries(overrides)) checkOne(key, value, where);
  checkRuleValues({ ...defaults, ...overrides }, where);
}

/** Reads and checks the rules file. `qualifications` is the list of qualification codes that exist. */
export function parseRuleBook(input: unknown, qualifications: Pick<Qualification, "code">[]): RuleBook {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown>; classes?: unknown[] };
  if (!data || typeof data !== "object") throw new RuleBookError("The rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new RuleBookError('The rules file needs a "defaults" section.');
  for (const key of Object.keys(RULES)) {
    if (!(key in data.defaults)) throw new RuleBookError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) checkOne(key, value, "defaults");
  const defaults = data.defaults as unknown as RuleValues;
  checkRuleValues(defaults, "defaults");

  if (!Array.isArray(data.classes) || data.classes.length === 0) throw new RuleBookError('The rules file needs a "classes" list.');
  const seen = new Set<string>();
  const classes = data.classes.map((c, i): ItemClass => {
    const cls = c as Partial<ItemClass>;
    const where = `classes[${i}] (${cls.code ?? "no code"})`;
    if (!cls.code || typeof cls.code !== "string") throw new RuleBookError(`${where} needs a code.`);
    if (seen.has(cls.code)) throw new RuleBookError(`${where}: the code "${cls.code}" is used twice.`);
    seen.add(cls.code);
    if (!BOOKING_TYPES.includes(cls.type as BookingType)) throw new RuleBookError(`${where}: type "${cls.type}" is not one of ${BOOKING_TYPES.join(", ")}.`);
    if (!cls.name) throw new RuleBookError(`${where} needs a name.`);
    if (!Number.isInteger(cls.seats) || cls.seats! < 1 || cls.seats! > 12) throw new RuleBookError(`${where}: seats must be a whole number from 1 to 12.`);
    const need = cls.requiredQualification ?? null;
    if (need !== null && !qualifications.some((q) => q.code === need)) throw new RuleBookError(`${where}: the qualification "${need}" does not exist.`);
    checkOverrides(defaults, cls.rules ?? {}, `${where} rules`);
    return { code: cls.code, type: cls.type as BookingType, name: cls.name, seats: cls.seats!, requiredQualification: need, rules: cls.rules ?? {} };
  });
  return { placeholder: data.placeholder !== false, defaults, classes };
}

export function classOf(book: RuleBook, item: Pick<Item, "classCode">): ItemClass {
  const cls = book.classes.find((c) => c.code === item.classCode);
  if (!cls) throw new RuleBookError(`There is no class "${item.classCode}" in the rules file.`);
  return cls;
}

/** The rules that apply to one item: the defaults, then its class, then the item itself. */
export function rulesFor(book: RuleBook, item: Item): { cls: ItemClass; rules: RuleValues; requiredQualification: string | null } {
  const cls = classOf(book, item);
  return {
    cls,
    rules: { ...book.defaults, ...cls.rules, ...item.ruleOverrides },
    requiredQualification: item.requiredQualification === undefined ? cls.requiredQualification : item.requiredQualification,
  };
}


/** The rules the app runs on, read and checked once. A mistake in the file stops the app with a plain message. */
export const RULE_BOOK: RuleBook = parseRuleBook(raw, QUALIFICATIONS);
