import { pacificMinutes } from "./time";
import { BOOKING_TYPES, type BookingType, type RuleValues } from "./types";

/** Helpers for reading the address and form fields of the member pages. Anything unexpected falls back to a safe default. */

type Param = string | string[] | undefined;
const first = (p: Param) => (Array.isArray(p) ? p[0] : p);

/** A day from the address, if it is one of the days on offer. */
export function dayParam(value: Param, allowed: string[], fallback: string): string {
  const v = first(value);
  return v && allowed.includes(v) ? v : fallback;
}

export function typeParam(value: Param): BookingType | null {
  const v = first(value);
  return BOOKING_TYPES.find((t) => t === v) ?? null;
}

/** An exact moment like 2026-10-29T14:00:00.000Z, or null. */
export function momentParam(value: Param): Date | null {
  const v = first(value);
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v)) return null;
  const at = new Date(v);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** A date like 2026-10-29, or null. */
export function dateParam(value: Param): string | null {
  const v = first(value);
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  const real = new Date(Date.UTC(y, m - 1, d));
  return real.getUTCFullYear() === y && real.getUTCMonth() === m - 1 && real.getUTCDate() === d ? v : null;
}

/** A clock time like 07:30, as minutes after midnight, or null. */
export function timeParam(value: Param): number | null {
  const v = first(value);
  const m = v ? /^(\d{2}):(\d{2})$/.exec(v) : null;
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? minutes : null;
}

/** Dollars typed into a form ("25", "12.50", "") as cents. Empty means no price (null); anything else that is not money is undefined. */
export function centsFromForm(value: string): number | null | undefined {
  const v = value.trim().replace(/^\$/, "");
  if (v === "") return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(v)) return undefined;
  return Math.round(Number(v) * 100);
}

/** A moment's Pacific clock time as a form value: "18:30". */
export function clockValue(at: Date | string): string {
  const minutes = pacificMinutes(typeof at === "string" ? new Date(at) : at);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A whole number from the address within a range, or the fallback. */
export function intParam(value: Param, min: number, max: number, fallback: number): number {
  const v = first(value);
  if (!v || !/^\d{1,5}$/.test(v)) return fallback;
  const n = Number(v);
  return n >= min && n <= max ? n : fallback;
}

/** IDs from the address: only things that look like an ID, at most `limit` of them, no repeats. */
export function idsParam(value: Param, limit = 12): string[] {
  const list = (Array.isArray(value) ? value : value ? [value] : []).filter((v) => /^[0-9a-f-]{36}$/.test(v));
  return [...new Set(list)].slice(0, limit);
}

export function idParam(value: Param): string | null {
  const v = first(value);
  return v && /^[0-9a-f-]{36}$/.test(v) ? v : null;
}

/** The lengths a booking can be, in minutes, for these rules. */
export function lengthChoices(rules: Pick<RuleValues, "slotMinutes" | "minMinutes" | "maxMinutes">): number[] {
  const out: number[] = [];
  for (let m = rules.minMinutes; m <= rules.maxMinutes; m += rules.slotMinutes) out.push(m);
  return out;
}

/** The address of the booking form for a chosen item and start. */
export function bookingFormHref(input: { itemId: string; start: string; minutes?: number; crew?: string[]; forId?: string | null; override?: boolean; reason?: string }): string {
  const q = new URLSearchParams({ item: input.itemId, start: input.start });
  if (input.minutes) q.set("minutes", String(input.minutes));
  for (const c of input.crew ?? []) q.append("crew", c);
  if (input.forId) q.set("for", input.forId);
  if (input.override) q.set("override", "1");
  if (input.reason) q.set("reason", input.reason);
  return `/club/book/new?${q.toString()}`;
}

/**
 * Where a form should send the browser afterwards. Only a path inside the member area is believed, so a crafted form can
 * never bounce staff to another site. Anything else becomes the fallback.
 */
export function backPath(value: string, fallback: string): string {
  return /^\/club(\/[A-Za-z0-9._~\-\/]*)?(\?[A-Za-z0-9._~\-=&%]*)?$/.test(value) && !value.includes("//") ? value : fallback;
}

/** What a staff change to a household says when it worked, from `?changed=` on the household page. */
export const HOUSEHOLD_CHANGES: Record<string, string> = {
  created: "Household added.",
  added: "Adult added.",
  removed: "Adult removed from the household. Their future bookings, class places and event RSVPs were cancelled.",
  type: "Membership type changed.",
  granted: "Qualification granted.",
  ended: "Membership ended. Every adult in the household can no longer book, and their future bookings, class places and event RSVPs were cancelled.",
};

/** Plain-language messages for the few things a form post can come back with. Never echoes anything from the address. */
export const NOTICES: Record<string, string> = {
  forbidden: "You are not allowed to do that.",
  not_found: "That no longer exists. Pick again.",
  invalid: "Something was missing or not valid. Check your choices and try again.",
  conflict: "That has already changed. Reload and try again.",
  signed_out: "Choose a test member first.",
  duplicate_class: "There is already a class with that name. Pick another name.",
  link: "That link does not work. Ask club staff for a new one.",
  not_open: "Check-in is not open yet for that. The page shows when it opens.",
  already_recorded: "That is already checked in.",
  too_late: "The time for that has passed, so it counts as a no-show. Ask club staff to put it right.",
  limit: "The limit cannot go below the number of people already going. Cancel some RSVPs first, or choose a bigger number.",
};
