/**
 * The executive page's items (Nov 11, 2026, Grant): the executive team can edit, reorder, remove and add priorities. Each item is
 * plain text the team writes; a "live figure" code such as {{waitlist_now}} inside the text is replaced on the page by the
 * dashboard's current number, so an edited item can still carry figures that update themselves.
 */
import { formatDay } from "./dates";
import type { RowingOutlook, UsageOutlook, WaitlistOutlook } from "./executive";
import { fmtInt } from "./stats";

export interface Priority {
  id: string;
  sortOrder: number;
  title: string;
  /** The one line shown in the list at the top of the page. */
  summary: string;
  /** "What the data says": one point per line. */
  facts: string[];
  meaning: string;
  question: string;
  careful: string;
  updatedAt: string;
}

export interface PrioritiesData {
  source: "live" | "sample";
  items: Priority[];
  /** True when this browser has typed the executive editing password. */
  canEdit: boolean;
  /** False when no editing password is set up on this server, so nobody can edit yet. */
  editingSetUp: boolean;
}

export type PriorityInput = Omit<Priority, "id" | "sortOrder" | "updatedAt">;

export const LIMITS = { title: 200, summary: 300, fact: 600, facts: 12, meaning: 2000, question: 500, careful: 1000 } as const;
export const MAX_ITEMS = 10;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : null);

/** Checks what the editing form sent, and says in plain words what is wrong. */
export function parsePriority(body: unknown): Parsed<PriorityInput> {
  if (!body || typeof body !== "object") return { ok: false, error: "That request could not be read. Reload the page and try again." };
  const b = body as Record<string, unknown>;
  const title = clean(b.title);
  const summary = clean(b.summary);
  const meaning = clean(b.meaning) ?? "";
  const question = clean(b.question) ?? "";
  const careful = clean(b.careful) ?? "";
  const rawFacts = Array.isArray(b.facts) ? b.facts : typeof b.facts === "string" ? b.facts.split("\n") : [];
  const facts = rawFacts.map(clean).filter((f): f is string => !!f);

  if (!title) return { ok: false, error: "Give the priority a heading." };
  if (title.length > LIMITS.title) return { ok: false, error: `Keep the heading under ${LIMITS.title} characters.` };
  if (!summary) return { ok: false, error: "Add the one-line summary that shows at the top of the page." };
  if (summary.length > LIMITS.summary) return { ok: false, error: `Keep the one-line summary under ${LIMITS.summary} characters.` };
  if (facts.length > LIMITS.facts) return { ok: false, error: `Keep "What the data says" to ${LIMITS.facts} points or fewer.` };
  if (facts.some((f) => f.length > LIMITS.fact)) return { ok: false, error: `Keep each point in "What the data says" under ${LIMITS.fact} characters.` };
  if (meaning.length > LIMITS.meaning) return { ok: false, error: `Keep "What it means" under ${LIMITS.meaning} characters.` };
  if (question.length > LIMITS.question) return { ok: false, error: `Keep the question for the board under ${LIMITS.question} characters.` };
  if (careful.length > LIMITS.careful) return { ok: false, error: `Keep "Read with care" under ${LIMITS.careful} characters.` };
  return { ok: true, value: { title, summary, facts, meaning, question, careful } };
}

/** The new order of every item, by id: each id exactly once. */
export function parseOrder(body: unknown, existing: string[]): Parsed<string[]> {
  const ids = (body as { ids?: unknown } | null)?.ids;
  const ok =
    Array.isArray(ids) &&
    ids.length === existing.length &&
    ids.every((id) => typeof id === "string") &&
    new Set(ids).size === ids.length &&
    existing.every((id) => ids.includes(id));
  return ok ? { ok: true, value: ids as string[] } : { ok: false, error: "The list changed while you were moving things. Reload the page and try again." };
}

/* ---------- Live figures ---------- */

export interface LiveSources {
  waitlist: WaitlistOutlook | null | undefined;
  usage: UsageOutlook | null | undefined;
  rowing: RowingOutlook | null | undefined;
  /** The last day of visit data, YYYY-MM-DD. */
  visitsThrough: string | null | undefined;
}

export interface LiveFigure {
  code: string;
  what: string;
  value: (s: LiveSources) => string | null | undefined;
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? null : fmtInt(v));
const change = (v: number | null | undefined) => (v === null || v === undefined ? null : `${v > 0 ? "up" : "down"} ${Math.abs(v)}%`);

/** Every code the team can put in the text, with what it shows. undefined = still loading; null = not available. */
export const LIVE_FIGURES: LiveFigure[] = [
  { code: "waitlist_now", what: "Waitlist in the newest month", value: (s) => s.waitlist && n(s.waitlist.now.waitlist) },
  { code: "waitlist_month", what: "That month's name", value: (s) => s.waitlist && s.waitlist.now.label },
  { code: "waitlist_year_ago", what: "Waitlist a year earlier", value: (s) => s.waitlist && n(s.waitlist.yearAgo?.waitlist) },
  { code: "waitlist_two_years_ago", what: "Waitlist two years earlier", value: (s) => s.waitlist && n(s.waitlist.twoYearsAgo?.waitlist) },
  { code: "resignations_12", what: "Resignations in the last 12 months", value: (s) => s.waitlist && n(s.waitlist.resignations12) },
  { code: "resignations_per_month", what: "Resignations a month, on average", value: (s) => s.waitlist && String(s.waitlist.perMonth) },
  { code: "months_of_cover", what: "Months of resignations the waitlist would replace", value: (s) => s.waitlist && (s.waitlist.monthsOfCover === null ? null : String(s.waitlist.monthsOfCover)) },
  { code: "last_winter", what: "Last winter's months", value: (s) => s.waitlist && (s.waitlist.lastWinter?.label ?? null) },
  { code: "last_winter_resignations", what: "Resignations last winter", value: (s) => s.waitlist && n(s.waitlist.lastWinter?.resignations) },
  { code: "members_now", what: "Dues-paying members in the newest month", value: (s) => s.waitlist && n(s.waitlist.members) },
  { code: "member_households", what: "Member households on the roster", value: (s) => s.usage && n(s.usage.total) },
  { code: "rarely", what: "Households in less than once a month", value: (s) => s.usage && n(s.usage.rarely) },
  { code: "rarely_share", what: "That as a percent", value: (s) => s.usage && `${s.usage.rarelyShare}%` },
  { code: "regulars", what: "Members in weekly or more", value: (s) => s.usage && n(s.usage.regulars) },
  { code: "regulars_entry_share", what: "Their share of door entries", value: (s) => s.usage && `${s.usage.regularEntryShare}%` },
  { code: "visits_through", what: "Last day of visit data", value: (s) => (s.visitsThrough === undefined ? undefined : s.visitsThrough ? formatDay(s.visitsThrough, true) : null) },
  { code: "rowing_now", what: "Member outings in club boats this year so far", value: (s) => s.rowing && n(s.rowing.now) },
  { code: "rowing_before", what: "The same, last year to the same day", value: (s) => s.rowing && n(s.rowing.before) },
  { code: "rowing_change", what: "The change, as up or down a percent", value: (s) => s.rowing && change(s.rowing.change) },
  { code: "rowing_through", what: "Last day of boat data", value: (s) => s.rowing && formatDay(s.rowing.through, true) },
];

export type TextPart = { text: string } | { figure: string; value: string | null | undefined; known: boolean };

/** Splits text into plain words and live figures: "Waitlist {{waitlist_now}}." → ["Waitlist ", 16, "."]. */
export function splitFigures(text: string, sources: LiveSources): TextPart[] {
  const parts: TextPart[] = [];
  const re = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const fig = LIVE_FIGURES.find((f) => f.code === m![1]);
    parts.push(fig ? { figure: fig.code, value: fig.value(sources), known: true } : { figure: m[1], value: null, known: false });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/* ---------- The starting three ---------- */

export const SEED_PRIORITIES: PriorityInput[] = [
  {
    title: "The waitlist that refills the club is almost gone.",
    summary: "The waitlist that refills the club is almost gone, so keeping members is now the membership plan.",
    facts: [
      "The waitlist was {{waitlist_now}} in {{waitlist_month}}, down from {{waitlist_year_ago}} a year earlier and {{waitlist_two_years_ago}} two years earlier.",
      "{{resignations_12}} households resigned in the last 12 months, about {{resignations_per_month}} a month. Today's waitlist would replace about {{months_of_cover}} months of that. Last winter ({{last_winter}}) {{last_winter_resignations}} resigned.",
      "{{rarely}} of {{member_households}} member households ({{rarely_share}}) came in less than once a month this year (visits through {{visits_through}}). They are the likeliest to leave.",
      "Dues-paying members were {{members_now}} in {{waitlist_month}}. The total has held steady for two years because applicants from the waitlist replaced the people who left.",
    ],
    meaning:
      "Until now a resignation cost the club little, because someone on the waitlist took the place. With the waitlist this short, each resignation this winter is very likely a lost household and lost dues. Keeping the members the club has is worth more than recruiting this season.",
    question: "What winter resignation number would the board call a success, and who owns reaching it?",
    careful: "A few older monthly waitlist counts are estimates (they are flagged on the Membership page). A visit is a day with a door entry or a booking.",
  },
  {
    title: "Rowers and non-rowers each need a strategy: rowing use is falling, and non-rowers are the least satisfied.",
    summary: "Rowers and non-rowers each need their own strategy: rowing use is falling, and non-rowers are the least satisfied.",
    facts: [
      "Member outings in club boats from Jan 1 to {{rowing_through}}: {{rowing_now}} this year against {{rowing_before}} last year, {{rowing_change}}, with a similar number of boats in use. Team practices are not counted.",
      "In the 2026 member survey, gym and fitness (94%) and social events (93%) were rated very or somewhat important. Rowing split members: 42% very important, 30% not important.",
      "Households that say they never row rose from 34% (2025 survey) to 45% (2026 survey).",
      "The recommend score fell from 78 to 70. It is lowest among members who never row and members aged 33 to 50 (+59 each) and highest among regular rowers (+85).",
      "The {{regulars}} members who come weekly or more make {{regulars_entry_share}} of door entries. Most of them are early-morning rowers and gym users.",
    ],
    meaning:
      "These are two separate jobs, not a choice between them. Regular rowers are the club's most loyal members and their use is falling, so the rowing strategy is about what stands between them (and the members who say they want to row) and the water. Non-rowers are now close to half of households, value the gym and social life most, and are the least enthusiastic, so their strategy is about making the club better for how they use it.",
    question: "Who will map out each of the two strategies, what does each aim for, and when will the board see them?",
    careful:
      "Each survey is about 120 self-selected responses, two-thirds from members over 50, so year-to-year changes are signals rather than proof. Outings are reservations, not confirmed trips.",
  },
  {
    title: "The building plan has large bills coming and almost none of them has a price.",
    summary: "The building plan has large bills coming and almost none of them has a price.",
    facts: [
      "Exterior painting of both vessels, $60,156, is approved and scheduled for spring or summer 2027.",
      "The locker room remodel is the plan's number one priority and has no price. About 25 projects planned for FY27 to FY32 have no price either, including the FY30 dry-dock group: both roofs, siding, the boathouse floor and water damage.",
      "In 2023 the club spent $64,800 on house projects against a $30,000 budget.",
      "Members' top repair requests in the 2026 survey: the dock (about 25 comments, 12 “needs improvement” votes) and the gym (about 19 comments, 14 votes).",
    ],
    meaning:
      "Without prices the board cannot tell whether dues and savings will cover the next five years, or whether the dry-dock year will force a special assessment. The longer pricing waits, the fewer choices the club has.",
    question: "What will the next five years of building work cost, and how will the club pay for it?",
    careful:
      "Building figures are from the House Committee's capital planner and capital requests (reviewed Sep 2026); its actual-cost columns are empty, and its files are kept in one member's personal Google account.",
  },
];

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** "Three things to watch." */
export function pageHeading(count: number): string {
  const word = WORDS[count] ?? String(count);
  return `${word} ${count === 1 ? "thing" : "things"} to watch.`;
}
