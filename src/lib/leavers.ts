import { daysBetween, dayOffset } from "./dates";
import { sampleData } from "./sample";
import { BAND_LABELS, QB_LOAD_DAY, percent, started } from "./stats";
import { BAND_ORDER, type Band, type Member, type MembershipMonth } from "./types";

/**
 * Who resigns, and how they used the club before they did.
 *
 * Built on the server from the named resignations (`resignations` table), the usage records (`members`) and the current
 * roster (`qb_members`). Only counts, averages and percentages leave the server: no name, no date of one person's
 * resignation and no one person's visits, so the page can stay public like the rest of the dashboard.
 *
 * The usage measure is **visit days**: a day counts once if the person came through the front door (Brivo) or had a
 * reservation (iCrew). Door entries alone miss partners whose fob is in the other person's name; reservations alone miss
 * everyone who walks in to use the gym or the club room.
 */

export const LEAVE_REASONS = ["moved", "not_using", "other"] as const;
export type LeaveReason = (typeof LEAVE_REASONS)[number];

/** One named resignation, as the server reads it. Never sent to the browser. */
export interface ResignationRecord {
  /** The `members.member_name` whose visits this household's usage comes from. */
  name: string;
  /** YYYY-MM-DD, the day the board accepted the resignation. */
  resignedOn: string;
  reason: LeaveReason;
}

export const GROUP_KEYS = ["notUsing", "otherReasons", "lowStayed", "allStayed"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const GROUP_LABELS: Record<GroupKey, string> = {
  notUsing: "Resigned: not using it",
  otherReasons: "Resigned: moved or other",
  lowStayed: "Low-use, still members",
  allStayed: "Everyone still a member",
};

/** Months before resigning shown in the drop-off chart, most distant first. */
export const MONTHS_BEFORE = 6;

/** Fewer people than this in the "not using" group and the comparisons are labelled early hints, not patterns. */
export const ENOUGH_TO_COMPARE = 15;

/** A gap this many percentage points or more between resigners and low-use members who stayed is worth a sentence. */
export const NOTABLE_GAP = 20;

export interface LeaverGroup {
  key: GroupKey;
  label: string;
  people: number;
  /**
   * Average visit days a person, month by month, for the months before resigning: index 0 is `MONTHS_BEFORE` months
   * before, the last is the month before. For people who stayed, the months before the data ends. Null when nobody in
   * the group has data for that month (the data starts in January).
   */
  monthsBefore: (number | null)[];
}

export interface Trait {
  key: string;
  label: string;
  /** Percent of each group, or null for an empty group. */
  values: Record<GroupKey, number | null>;
}

export interface BandRate {
  band: Band;
  label: string;
  /** Everyone in this usage group: members who stayed plus those who resigned. */
  people: number;
  resignedNotUsing: number;
  resignedOther: number;
  /** Percent of the group who resigned, any reason. */
  rate: number;
}

export interface LeaverAnalysis {
  source: "live" | "sample";
  /** Last day of the visit data. */
  dataThrough: string;
  /** Named resignations loaded. */
  resignations: number;
  /** Of those, how many have a usage record to compare. */
  matched: number;
  /** Earliest and latest resignation date, for the page's wording. */
  from: string | null;
  to: string | null;
  enough: boolean;
  groups: LeaverGroup[];
  traits: Trait[];
  bands: BandRate[];
  insights: string[];
}

/* ---------- small helpers ---------- */

const LOW_BANDS: readonly Band[] = ["0 visits", "Under 1/month"];
export const isLowUse = (m: Member) => LOW_BANDS.includes(m.band);

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The 0-based month of the data year a day falls in, or null when it is in another year. */
function monthIndex(day: string, dataYear: string): number | null {
  return day.slice(0, 4) === dataYear ? Number(day.slice(5, 7)) - 1 : null;
}

interface Person {
  member: Member;
  /** The day this person's "before" is counted back from: the resignation, or the data end for someone who stayed. */
  anchor: string;
}

function averagesBefore(people: Person[], dataThrough: string): (number | null)[] {
  const year = dataThrough.slice(0, 4);
  const out: (number | null)[] = [];
  for (let k = MONTHS_BEFORE; k >= 1; k--) {
    let sum = 0;
    let n = 0;
    for (const p of people) {
      // A resignation after the data ends is counted from the data end's month, so a month with no data is never read as zero.
      const anchorMonth = monthIndex(p.anchor > dataThrough ? dataThrough : p.anchor, year);
      if (anchorMonth === null) continue;
      const i = anchorMonth - k;
      if (i < 0 || i >= p.member.monthly.length) continue;
      sum += p.member.monthly[i];
      n++;
    }
    out.push(n === 0 ? null : round1(sum / n));
  }
  return out;
}

/** Months with a visit fall only in June, July and August. */
function summerOnly(m: Member): boolean {
  if (m.visitDays <= 0) return false;
  const total = m.monthly.reduce((a, b) => a + b, 0);
  if (total === 0) return false;
  return m.monthly.every((v, i) => v === 0 || (i >= 5 && i <= 7));
}

function quietFor90Days(p: Person, dataThrough: string): boolean {
  const end = p.anchor > dataThrough ? dataThrough : p.anchor;
  return p.member.lastVisit === null || daysBetween(p.member.lastVisit, end) > 90;
}

function joinedRecently(p: Person): boolean {
  const j = p.member.joined;
  if (!j || j === QB_LOAD_DAY) return false;
  return daysBetween(j, p.anchor) <= 730;
}

/** A test answers true or false, or null where it cannot be told (no door data for a door-only question), which leaves the person out of that share. */
const TRAIT_TESTS: { key: string; label: string; test: (p: Person, dataThrough: string) => boolean | null }[] = [
  { key: "none", label: "No visits at all this year", test: (p) => p.member.visitDays === 0 },
  { key: "quiet", label: "No visit in the 3 months before (or never)", test: quietFor90Days },
  { key: "summer", label: "Came only in summer (June to August)", test: (p) => summerOnly(p.member) },
  {
    key: "weekend",
    label: "Half or more of door entries on weekends (of those with door entries)",
    test: (p) => (p.member.weekendShare === null ? null : p.member.weekendShare >= 0.5),
  },
  { key: "recent", label: "Joined in the 2 years before", test: joinedRecently },
  { key: "nonresident", label: "Non-Resident membership", test: (p) => p.member.memberType === "Non-Resident" },
  { key: "intermediate", label: "Intermediate membership (under 33)", test: (p) => p.member.memberType === "Intermediate" },
];

/* ---------- the analysis ---------- */

/**
 * @param resignations named resignations
 * @param usage every usage record (`members`), including people who have since resigned
 * @param roster the current roster, built from `qb_members`
 */
export function analyzeLeavers(
  resignations: ResignationRecord[],
  usage: Member[],
  roster: Member[],
  dataThrough: string,
  source: "live" | "sample",
): LeaverAnalysis {
  const byName = new Map(usage.map((m) => [m.name, m]));
  const resigned: (Person & { reason: LeaveReason })[] = [];
  const resignedNames = new Set<string>();
  for (const r of resignations) {
    resignedNames.add(r.name);
    const member = byName.get(r.name);
    if (member) resigned.push({ member, anchor: r.resignedOn, reason: r.reason });
  }

  // Someone still on the roster under a resigned name is a leaver whose roster row has not been taken off yet: not a stayer.
  const stayed: Person[] = started(roster)
    .filter((m) => !resignedNames.has(m.name))
    .map((member) => ({ member, anchor: dataThrough }));

  const people: Record<GroupKey, Person[]> = {
    notUsing: resigned.filter((p) => p.reason === "not_using"),
    otherReasons: resigned.filter((p) => p.reason !== "not_using"),
    lowStayed: stayed.filter((p) => isLowUse(p.member)),
    allStayed: stayed,
  };

  const groups: LeaverGroup[] = GROUP_KEYS.map((key) => ({
    key,
    label: GROUP_LABELS[key],
    people: people[key].length,
    monthsBefore: averagesBefore(people[key], dataThrough),
  }));

  const traits: Trait[] = TRAIT_TESTS.map(({ key, label, test }) => ({
    key,
    label,
    values: Object.fromEntries(
      GROUP_KEYS.map((g) => {
        const answers = people[g].map((p) => test(p, dataThrough)).filter((v): v is boolean => v !== null);
        return [g, answers.length === 0 ? null : percent(answers.filter(Boolean).length, answers.length)];
      }),
    ) as Record<GroupKey, number | null>,
  }));

  const bands: BandRate[] = BAND_ORDER.map((band) => {
    const stayedHere = stayed.filter((p) => p.member.band === band).length;
    const notUsing = resigned.filter((p) => p.member.band === band && p.reason === "not_using").length;
    const other = resigned.filter((p) => p.member.band === band && p.reason !== "not_using").length;
    const total = stayedHere + notUsing + other;
    return { band, label: BAND_LABELS[band], people: total, resignedNotUsing: notUsing, resignedOther: other, rate: percent(notUsing + other, total) };
  });

  const dates = resignations.map((r) => r.resignedOn).sort();
  const enough = people.notUsing.length >= ENOUGH_TO_COMPARE;
  const analysis: LeaverAnalysis = {
    source,
    dataThrough,
    resignations: resignations.length,
    matched: resigned.length,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    enough,
    groups,
    traits,
    bands,
    insights: [],
  };
  analysis.insights = insightsFor(analysis, people);
  return analysis;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Plain sentences drawn from the numbers. Each is only said when the data behind it exists. */
function insightsFor(a: LeaverAnalysis, people: Record<GroupKey, Person[]>): string[] {
  const out: string[] = [];
  const resigned = people.notUsing.length + people.otherReasons.length;
  if (resigned === 0) return out;

  // 1. Where resignations come from, against how big that group is.
  const lowResigned = [...people.notUsing, ...people.otherReasons].filter((p) => isLowUse(p.member)).length;
  const everyone = people.allStayed.length + resigned;
  const lowEveryone = people.lowStayed.length + lowResigned;
  out.push(
    `${lowResigned} of ${resigned} resignations came from members who visited less than once a month, a group that is ${percent(lowEveryone, everyone)}% of members.`,
  );

  // 2. How likely each side is to leave.
  const lowRate = percent(lowResigned, lowEveryone);
  const restRate = percent(resigned - lowResigned, everyone - lowEveryone);
  if (lowEveryone > 0 && everyone - lowEveryone > 0) {
    out.push(`Of low-use members, ${lowRate}% resigned in this period; of everyone else, ${restRate}%.`);
  }

  // 3. "Moved" that looks like "not using".
  const movedButAbsent = people.otherReasons.filter((p) => p.member.visitDays === 0 || quietFor90Days(p, a.dataThrough)).length;
  if (movedButAbsent > 0) {
    out.push(
      `${plural(movedButAbsent, "member")} who gave another reason (usually moving) had also not visited in the 3 months before resigning, so "not using it" may be undercounted.`,
    );
  }

  // 4. Drop-off: were the "not using" resigners already gone?
  const n = people.notUsing.length;
  if (n > 0) {
    const quiet = people.notUsing.filter((p) => quietFor90Days(p, a.dataThrough)).length;
    out.push(
      quiet === n
        ? `None of the ${plural(n, "member")} who resigned for not using it had visited in the 3 months before: by the time they resigned, they had already stopped coming.`
        : `${quiet} of ${plural(n, "member")} who resigned for not using it had not visited in the 3 months before resigning.`,
    );
  }

  // 5. Traits that set "not using" resigners apart from low-use members who stayed.
  const lead = a.enough ? "" : `Early hint (only ${plural(n, "person", "people")}): `;
  for (const t of a.traits) {
    const r = t.values.notUsing;
    const s = t.values.lowStayed;
    if (r === null || s === null || Math.abs(r - s) < NOTABLE_GAP) continue;
    out.push(`${lead}${t.label}: ${r}% of those who resigned for not using it, against ${s}% of low-use members who stayed.`);
  }
  return out;
}

/* ---------- season, from the monthly counts ---------- */

export interface SeasonSplit {
  /** Oct to Mar. */
  darkMonths: number;
  /** Apr to Sep. */
  lightMonths: number;
  /** Months with a reason split counted on each side. */
  darkCount: number;
  lightCount: number;
}

/** "Not using it" resignations in the dark half of the year (Oct to Mar) against the light half (Apr to Sep), from the monthly sheets. */
export function seasonSplit(months: MembershipMonth[]): SeasonSplit | null {
  let dark = 0;
  let light = 0;
  let darkCount = 0;
  let lightCount = 0;
  for (const m of months) {
    if (m.resignationsNotUsing === null) continue;
    if (m.month >= 4 && m.month <= 9) {
      light += m.resignationsNotUsing;
      lightCount++;
    } else {
      dark += m.resignationsNotUsing;
      darkCount++;
    }
  }
  if (darkCount === 0 && lightCount === 0) return null;
  return { darkMonths: dark, lightMonths: light, darkCount, lightCount };
}

/* ---------- sample ---------- */

/** Invented resignations over the invented members, for developing and tests. */
export function sampleLeavers(): LeaverAnalysis {
  const data = sampleData();
  const members = data.members;
  const low = members.filter((m) => !m.notStarted && isLowUse(m));
  const rest = members.filter((m) => !m.notStarted && !isLowUse(m));
  const day = dayOffset(data.dataThrough, -3);
  const records: ResignationRecord[] = [
    ...low.filter((_, i) => i % 7 === 0).map((m) => ({ name: m.name, resignedOn: day, reason: "not_using" as const })),
    ...low.filter((_, i) => i % 23 === 5).map((m) => ({ name: m.name, resignedOn: day, reason: "moved" as const })),
    ...rest.filter((_, i) => i % 60 === 3).map((m) => ({ name: m.name, resignedOn: day, reason: "moved" as const })),
  ];
  const resignedNames = new Set(records.map((r) => r.name));
  return analyzeLeavers(records, members, members.filter((m) => !resignedNames.has(m.name)), data.dataThrough, "sample");
}
