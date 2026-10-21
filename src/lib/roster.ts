import { daysBetween } from "./dates";
import type { Band, Member } from "./types";

/** The three paying membership types in QuickBooks, in the order the charts list them. */
export const MEMBER_TYPES = ["Resident", "Intermediate", "Non-Resident"] as const;

export const ROSTER_SOURCE = "QuickBooks member list";

/** A row of `qb_members`, the paying members from QuickBooks. */
export interface QbRow {
  qb_name: string;
  qb_member_type: string;
  qb_member_number: string | null;
  qb_created_on: string;
  /** matched, household_partner, spelling, door_only_no_icrew or no_record. */
  link: string;
  /** The `members.member_name` this person's visits come from. */
  usage_member_name: string | null;
  /** Door entries Jan 1 to the data end, for members who have a door fob but no iCrew record. */
  door_entries_if_door_only: number | null;
  roster_as_of: string;
}

const DAYS_PER_MONTH = 30.4375;

/** Months from the later of Jan 1 and the day the member's QuickBooks record was created, to `through`. */
export function monthsObserved(createdOn: string | null, through: string): number {
  const year = through.slice(0, 4);
  const start = createdOn && createdOn.slice(0, 4) === year ? createdOn : `${year}-01-01`;
  const days = Math.max(1, daysBetween(start, through) + 1);
  return days / DAYS_PER_MONTH;
}

/** The usage group for a number of visits a month. */
export function bandFor(visitsPerMonth: number, visitDays: number): Band {
  if (visitDays <= 0) return "0 visits";
  if (visitsPerMonth < 1) return "Under 1/month";
  if (visitsPerMonth < 2) return "1-2/month";
  if (visitsPerMonth < 4) return "2-4/month";
  return "4+/month";
}

const squash = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const EMPTY_MONTHS = () => Array<number>(9).fill(0);

export interface Roster {
  members: Member[];
  asOf: string | null;
  /** QuickBooks people whose link names a usage record that is not in the database. They count with no visits. */
  missing: string[];
}

/**
 * The QuickBooks list is the roster: one record is one household. Each record takes its visits from the
 * usage record it links to, and no usage record is used twice. People on iCrew who are not on QuickBooks
 * are not members, so they never appear.
 */
export function buildRoster(qb: QbRow[], usage: Member[], through: string): Roster {
  const exact = new Map(usage.map((u) => [u.name, u]));
  const loose = new Map<string, Member>();
  for (const u of usage) if (!loose.has(squash(u.name))) loose.set(squash(u.name), u);
  const find = (name: string) => exact.get(name) ?? loose.get(squash(name));

  // Someone who matches by name outranks a household partner or a spelling fix that points at the same record.
  const rank = (r: QbRow) => (r.link === "matched" ? 0 : 1);
  const order = qb.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i);

  const used = new Set<Member>();
  const missing: string[] = [];
  const out = new Map<number, Member>();

  for (const { r, i } of order) {
    const base = {
      name: r.qb_name,
      joined: r.qb_created_on,
      memberType: r.qb_member_type,
      qbCreatedOn: r.qb_created_on,
    };
    let member: Member;
    const linked = r.link === "matched" || r.link === "household_partner" || r.link === "spelling";
    const record = linked && r.usage_member_name ? find(r.usage_member_name) : undefined;

    if (record && !used.has(record)) {
      used.add(record);
      member = { ...record, ...base, notStarted: false };
    } else if (r.link === "door_only_no_icrew" && (r.door_entries_if_door_only ?? 0) > 0) {
      // A door fob and no iCrew record: each entry stands in for one visit day, so this is approximate.
      const entries = r.door_entries_if_door_only as number;
      const perMonth = Math.round((entries / monthsObserved(r.qb_created_on, through)) * 100) / 100;
      member = {
        ...base,
        band: bandFor(perMonth, entries),
        visitsPerMonth: perMonth,
        visitDays: entries,
        doorEntries: entries,
        bookingDays: 0,
        bookings: 0,
        earlyShare: null,
        weekendShare: null,
        household: false,
        lastVisit: null,
        ownFob: true,
        monthly: EMPTY_MONTHS(),
        notStarted: false,
      };
    } else {
      if (linked && r.usage_member_name && !record) missing.push(r.qb_name);
      member = {
        ...base,
        band: "0 visits",
        visitsPerMonth: 0,
        visitDays: 0,
        doorEntries: 0,
        bookingDays: 0,
        bookings: 0,
        earlyShare: null,
        weekendShare: null,
        household: false,
        lastVisit: null,
        ownFob: false,
        monthly: EMPTY_MONTHS(),
        notStarted: false,
      };
    }
    member.notStarted = member.visitDays === 0 && r.qb_created_on.slice(0, 4) === through.slice(0, 4);
    out.set(i, member);
  }

  const asOf = qb.reduce<string | null>((max, r) => (max === null || r.roster_as_of > max ? r.roster_as_of : max), null);
  const members = qb.map((_, i) => out.get(i) as Member).sort((a, b) => a.name.localeCompare(b.name));
  return { members, asOf, missing };
}
