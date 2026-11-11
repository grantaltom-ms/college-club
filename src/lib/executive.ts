/**
 * The executive page (Nov 11, 2026, Grant): the three things club leadership should watch, each stated in a line with the data behind it.
 * Figures that the dashboard already holds (membership, member visits, shell outings) are worked out here from the same data, so the
 * page never goes stale; survey and House Committee figures come from dated documents and are written as text on the page.
 */
import { monthLabel, sortMonths } from "./membership";
import { changePct, yearToDate, type Outing } from "./shells";
import { headline } from "./stats";
import type { Member, MembershipMonth } from "./types";

const index = (m: MembershipMonth) => m.year * 12 + m.month;

export interface WaitlistPoint {
  label: string;
  waitlist: number;
}

export interface WaitlistOutlook {
  /** The newest month that has a waitlist count. */
  now: WaitlistPoint;
  /** The same calendar month one and two years earlier, when the data has them. */
  yearAgo: WaitlistPoint | null;
  twoYearsAgo: WaitlistPoint | null;
  /** Resignations in the 12 months ending with the newest month (fewer months when the data is shorter). */
  resignations12: number;
  monthsCounted: number;
  /** Resignations per month over that window, one decimal. */
  perMonth: number;
  /** How many months of resignations the current waitlist would replace, one decimal; null when nobody resigned. */
  monthsOfCover: number | null;
  /** The last full November-to-February before the newest month, or null when the data does not cover one. */
  lastWinter: { label: string; resignations: number } | null;
  /** Dues-paying members in the newest month. */
  members: number;
  membersLabel: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function waitlistOutlook(months: MembershipMonth[]): WaitlistOutlook | null {
  const sorted = sortMonths(months);
  const latest = sorted[sorted.length - 1];
  const withList = sorted.filter((m) => m.waitlist !== null);
  const nowMonth = withList[withList.length - 1];
  if (!latest || !nowMonth) return null;

  const at = (years: number): WaitlistPoint | null => {
    const m = withList.find((x) => x.year === nowMonth.year - years && x.month === nowMonth.month);
    return m ? { label: monthLabel(m), waitlist: m.waitlist! } : null;
  };

  const window = sorted.filter((m) => index(latest) - index(m) < 12);
  const resignations12 = window.reduce((t, m) => t + m.resignations, 0);
  const perMonth = round1(resignations12 / window.length);

  // The most recent Nov–Feb that ended on or before the newest month.
  const febYear = latest.month >= 2 ? latest.year : latest.year - 1;
  const winterKeys = [
    [febYear - 1, 11],
    [febYear - 1, 12],
    [febYear, 1],
    [febYear, 2],
  ];
  const winter = winterKeys.map(([y, mo]) => sorted.find((m) => m.year === y && m.month === mo));
  const lastWinter = winter.every(Boolean)
    ? { label: `Nov ${febYear - 1} – Feb ${febYear}`, resignations: winter.reduce((t, m) => t + m!.resignations, 0) }
    : null;

  return {
    now: { label: monthLabel(nowMonth), waitlist: nowMonth.waitlist! },
    yearAgo: at(1),
    twoYearsAgo: at(2),
    resignations12,
    monthsCounted: window.length,
    perMonth,
    monthsOfCover: resignations12 > 0 ? round1(nowMonth.waitlist! / (resignations12 / window.length)) : null,
    lastWinter,
    members: latest.withApprovals,
    membersLabel: monthLabel(latest),
  };
}

export interface RowingOutlook {
  year: number;
  /** Member (not team) outings in club boats, Jan 1 to the same day as the data's last day. */
  now: number;
  before: number;
  /** Percent change, rounded; null when last year had none. */
  change: number | null;
  /** The last day of shell data, YYYY-MM-DD. */
  through: string;
}

export function rowingOutlook(outings: Outing[], through: string): RowingOutlook | null {
  const ytd = yearToDate(outings, through);
  const year = Number(through.slice(0, 4));
  const now = ytd.find((y) => y.year === year);
  const before = ytd.find((y) => y.year === year - 1);
  if (!now || !before) return null;
  return { year, now: now.member, before: before.member, change: changePct(now.member, before.member), through };
}

export interface UsageOutlook {
  total: number;
  /** Less than once a month, or never. */
  rarely: number;
  rarelyShare: number;
  /** Weekly or more. */
  regulars: number;
  /** The weekly-or-more group's share of door entries. */
  regularEntryShare: number;
}

export function usageOutlook(members: Member[]): UsageOutlook {
  const h = headline(members);
  return { total: h.total, rarely: h.quiet, rarelyShare: h.quietShare, regulars: h.regulars, regularEntryShare: h.regularEntryShare };
}
