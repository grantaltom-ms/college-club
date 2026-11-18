import { dayOffset, formatDay, pacificCalendarDate } from "./dates";

/**
 * The email list builder (Nov 18, 2026, Grant). Someone describes a group of members in plain words ("joined in the last three
 * months and said they want to row"); Claude turns that into a rule made only of the filters below; the server applies the rule
 * to the member list and shows who matches. A saved rule becomes a Mailchimp tag that is refreshed every night, and a draft
 * campaign can be made for that tag. Nothing is ever sent from here: a person reviews and sends it in Mailchimp.
 *
 * This file is the plain logic: the person record, the rule, applying it and putting it into words. It never calls anyone.
 */

export const MEMBER_TYPES = ["Resident", "Intermediate", "Non-Resident"] as const;
export type ListMemberType = (typeof MEMBER_TYPES)[number];

/** QuickBooks stamped everyone who existed when it was first loaded with this day, so it means "on or before". */
export const QB_LOAD_DAY = "2019-10-18";

/** The window behind "emailed recently", in days (the retention plan's one-campaign-a-week cap). */
export const RECENT_DAYS = 7;

/** One household on the roster, with what the filters can look at. Only the server ever holds these. */
export interface ListPerson {
  /** Stable key: the QuickBooks member number when there is one, otherwise the QuickBooks name. */
  key: string;
  name: string;
  memberNumber: string | null;
  memberType: string;
  /** QuickBooks record date. QB_LOAD_DAY means joined on or before that day. */
  joined: string | null;
  visitsPerMonth: number;
  visitDays: number;
  lastVisit: string | null;
  /** Interests, from the application answers (member_interests) and the Mailchimp interest groups. Lower case. */
  interests: string[];
  /** Times out in a shell in the rowing period (member_rowing); 0 when the period is loaded and they are not in it. */
  shellOutings: number;
  /** Subscribed Mailchimp addresses linked to this household. */
  emails: string[];
}

export interface PoolInfo {
  source: "live" | "sample";
  /** Last day the visit figures cover. */
  visitsThrough: string;
  /** The rowing period loaded, or null when no rowing figures are loaded. */
  rowing: { from: string; to: string } | null;
  /** Every interest anyone has, lower case, sorted. */
  interests: string[];
  /** How many households have application answers loaded. */
  withApplicationAnswers: number;
}

export interface ListRule {
  /** Joined within this many months of today. */
  joinedWithinMonths: number | null;
  joinedOnOrAfter: string | null;
  joinedOnOrBefore: string | null;
  /** Empty means every type. */
  memberTypes: ListMemberType[];
  /** Has at least one of these interests. Empty means interests do not matter. */
  interestsAny: string[];
  minVisitsPerMonth: number | null;
  maxVisitsPerMonth: number | null;
  /** Has not visited in this many days (or never has). */
  noVisitInDays: number | null;
  minShellOutings: number | null;
  maxShellOutings: number | null;
  /** Leave out anyone who got a campaign in the last RECENT_DAYS days, worked out again at every refresh. */
  leaveOutRecentlyEmailed: boolean;
}

export const EMPTY_RULE: ListRule = {
  joinedWithinMonths: null,
  joinedOnOrAfter: null,
  joinedOnOrBefore: null,
  memberTypes: [],
  interestsAny: [],
  minVisitsPerMonth: null,
  maxVisitsPerMonth: null,
  noVisitInDays: null,
  minShellOutings: null,
  maxShellOutings: null,
  leaveOutRecentlyEmailed: false,
};

const RULE_KEYS = Object.keys(EMPTY_RULE) as (keyof ListRule)[];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function realDay(v: string): boolean {
  if (!DAY_RE.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Checks a rule that came from Claude or from the page. Unknown fields, wrong types and silly numbers are refused in words. */
export function parseRule(input: unknown): { rule: ListRule } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "The filters could not be read." };
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!RULE_KEYS.includes(k as keyof ListRule)) return { error: `Unknown filter "${k}".` };
  const rule: ListRule = { ...EMPTY_RULE, memberTypes: [], interestsAny: [] };
  const num = (k: keyof ListRule, max: number, whole = false): string | null => {
    const v = raw[k];
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max || (whole && !Number.isInteger(v))) {
      return `"${k}" must be ${whole ? "a whole number" : "a number"} from 0 to ${max}.`;
    }
    (rule as unknown as Record<string, unknown>)[k] = v;
    return null;
  };
  const problems = [
    num("joinedWithinMonths", 600, true),
    num("minVisitsPerMonth", 31),
    num("maxVisitsPerMonth", 31),
    num("noVisitInDays", 3650, true),
    num("minShellOutings", 1000, true),
    num("maxShellOutings", 1000, true),
  ].filter(Boolean);
  if (problems.length) return { error: problems[0]! };
  for (const k of ["joinedOnOrAfter", "joinedOnOrBefore"] as const) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string" || !realDay(v)) return { error: `"${k}" must be a date written YYYY-MM-DD.` };
    rule[k] = v;
  }
  if (raw.memberTypes !== undefined && raw.memberTypes !== null) {
    if (!Array.isArray(raw.memberTypes) || raw.memberTypes.some((t) => !(MEMBER_TYPES as readonly unknown[]).includes(t))) {
      return { error: `Member types must be from: ${MEMBER_TYPES.join(", ")}.` };
    }
    rule.memberTypes = [...new Set(raw.memberTypes as ListMemberType[])];
  }
  if (raw.interestsAny !== undefined && raw.interestsAny !== null) {
    if (!Array.isArray(raw.interestsAny) || raw.interestsAny.some((t) => typeof t !== "string" || t.trim() === "" || t.length > 80)) {
      return { error: "Interests must be a list of short words." };
    }
    rule.interestsAny = [...new Set((raw.interestsAny as string[]).map(normalizeInterest))].slice(0, 20);
  }
  if (raw.leaveOutRecentlyEmailed !== undefined && raw.leaveOutRecentlyEmailed !== null) {
    if (typeof raw.leaveOutRecentlyEmailed !== "boolean") return { error: '"leaveOutRecentlyEmailed" must be true or false.' };
    rule.leaveOutRecentlyEmailed = raw.leaveOutRecentlyEmailed;
  }
  if (rule.minVisitsPerMonth !== null && rule.maxVisitsPerMonth !== null && rule.minVisitsPerMonth > rule.maxVisitsPerMonth) {
    return { error: "The fewest visits a month is more than the most." };
  }
  if (rule.minShellOutings !== null && rule.maxShellOutings !== null && rule.minShellOutings > rule.maxShellOutings) {
    return { error: "The fewest times rowed is more than the most." };
  }
  if (rule.joinedOnOrAfter && rule.joinedOnOrBefore && rule.joinedOnOrAfter > rule.joinedOnOrBefore) {
    return { error: "The joined-from date is after the joined-to date." };
  }
  return { rule };
}

export function normalizeInterest(v: string): string {
  return v.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Today's date less a number of whole months (the same day of the month, or the month's last day). */
export function monthsBefore(today: string, months: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Is this rule asking for anything at all? An empty rule would be the whole club. */
export function ruleIsEmpty(rule: ListRule): boolean {
  return RULE_KEYS.every((k) => k === "leaveOutRecentlyEmailed" || JSON.stringify(rule[k]) === JSON.stringify(EMPTY_RULE[k]));
}

export function matchesRule(p: ListPerson, rule: ListRule, today: string): boolean {
  const joinedKnown = p.joined && p.joined !== QB_LOAD_DAY ? p.joined : null;
  if (rule.joinedWithinMonths !== null) {
    if (!joinedKnown || joinedKnown < monthsBefore(today, rule.joinedWithinMonths)) return false;
  }
  if (rule.joinedOnOrAfter !== null && (!joinedKnown || joinedKnown < rule.joinedOnOrAfter)) return false;
  // "On or before" a day: the QuickBooks load day counts as on or before it when that day is later.
  if (rule.joinedOnOrBefore !== null && (!p.joined || p.joined > rule.joinedOnOrBefore)) return false;
  if (rule.memberTypes.length && !rule.memberTypes.includes(p.memberType as ListMemberType)) return false;
  if (rule.interestsAny.length && !rule.interestsAny.some((i) => p.interests.includes(i))) return false;
  if (rule.minVisitsPerMonth !== null && p.visitsPerMonth < rule.minVisitsPerMonth) return false;
  if (rule.maxVisitsPerMonth !== null && p.visitsPerMonth > rule.maxVisitsPerMonth) return false;
  if (rule.noVisitInDays !== null && p.lastVisit && p.lastVisit >= dayOffset(today, -rule.noVisitInDays)) return false;
  if (rule.minShellOutings !== null && p.shellOutings < rule.minShellOutings) return false;
  if (rule.maxShellOutings !== null && p.shellOutings > rule.maxShellOutings) return false;
  return true;
}

/** Who is emailed recently, by address (lower case), with the campaigns they got. */
export type RecentMail = Map<string, { title: string; sentOn: string }[]>;

export interface ListResult {
  /** Everyone the rule matches, before leaving anyone out. */
  matched: number;
  /** Who will get the email: matched, with a subscribed address, minus the recently emailed when the rule says so. */
  people: ResultPerson[];
  noEmail: ResultPerson[];
  leftOutRecent: ResultPerson[];
  /** Of the people who will get it, how many got a campaign in the last RECENT_DAYS days. */
  recentAmongIncluded: number;
  /** The addresses that go on the tag. */
  emails: string[];
}

/** What the page may show about one household. */
export interface ResultPerson {
  name: string;
  memberType: string;
  joined: string | null;
  visitsPerMonth: number;
  lastVisit: string | null;
  shellOutings: number;
  interests: string[];
  emails: string[];
  /** The campaigns this household got in the last RECENT_DAYS days. */
  recent: { title: string; sentOn: string }[];
}

export function applyRule(pool: ListPerson[], rule: ListRule, today: string, recent: RecentMail): ListResult {
  const matched = pool.filter((p) => matchesRule(p, rule, today)).sort((a, b) => a.name.localeCompare(b.name));
  const view = (p: ListPerson): ResultPerson => {
    const seen = new Map<string, { title: string; sentOn: string }>();
    for (const e of p.emails) for (const c of recent.get(e.toLowerCase()) ?? []) seen.set(`${c.sentOn}|${c.title}`, c);
    return {
      name: p.name,
      memberType: p.memberType,
      joined: p.joined,
      visitsPerMonth: p.visitsPerMonth,
      lastVisit: p.lastVisit,
      shellOutings: p.shellOutings,
      interests: p.interests,
      emails: p.emails,
      recent: [...seen.values()].sort((a, b) => b.sentOn.localeCompare(a.sentOn)),
    };
  };
  const people: ResultPerson[] = [];
  const noEmail: ResultPerson[] = [];
  const leftOutRecent: ResultPerson[] = [];
  for (const p of matched) {
    const v = view(p);
    if (v.emails.length === 0) noEmail.push(v);
    else if (rule.leaveOutRecentlyEmailed && v.recent.length > 0) leftOutRecent.push(v);
    else people.push(v);
  }
  const emails = [...new Set(people.flatMap((p) => p.emails.map((e) => e.toLowerCase())))].sort();
  return { matched: matched.length, people, noEmail, leftOutRecent, recentAmongIncluded: people.filter((p) => p.recent.length > 0).length, emails };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const visits = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? "visit" : "visits"} a month`;

/** The rule in plain words, one line per filter, so the person can check Claude read them right. */
export function describeRule(rule: ListRule, today: string, info: Pick<PoolInfo, "visitsThrough" | "rowing">): string[] {
  const out: string[] = [];
  if (rule.joinedWithinMonths !== null) {
    out.push(`Joined in the last ${plural(rule.joinedWithinMonths, "month")} (on or after ${formatDay(monthsBefore(today, rule.joinedWithinMonths), true)})`);
  }
  if (rule.joinedOnOrAfter) out.push(`Joined on or after ${formatDay(rule.joinedOnOrAfter, true)}`);
  if (rule.joinedOnOrBefore) out.push(`Joined on or before ${formatDay(rule.joinedOnOrBefore, true)}`);
  if (rule.memberTypes.length) out.push(`Membership type: ${rule.memberTypes.join(" or ")}`);
  if (rule.interestsAny.length) out.push(`Said they are interested in ${rule.interestsAny.join(" or ")}`);
  const through = `visits counted through ${formatDay(info.visitsThrough, true)}`;
  if (rule.minVisitsPerMonth !== null && rule.maxVisitsPerMonth !== null) {
    out.push(`Comes in ${rule.minVisitsPerMonth} to ${visits(rule.maxVisitsPerMonth)} (${through})`);
  } else if (rule.minVisitsPerMonth !== null) out.push(`Comes in at least ${visits(rule.minVisitsPerMonth)} (${through})`);
  else if (rule.maxVisitsPerMonth !== null) out.push(`Comes in at most ${visits(rule.maxVisitsPerMonth)} (${through})`);
  if (rule.noVisitInDays !== null) out.push(`Has not come in for ${plural(rule.noVisitInDays, "day")} or more (${through})`);
  const rowing = info.rowing ? `rowing counted ${formatDay(info.rowing.from, true)} to ${formatDay(info.rowing.to, true)}` : "no rowing figures loaded yet";
  if (rule.minShellOutings !== null && rule.maxShellOutings !== null) {
    out.push(rule.maxShellOutings === 0 ? `Has not rowed (${rowing})` : `Rowed ${rule.minShellOutings} to ${plural(rule.maxShellOutings, "time")} (${rowing})`);
  } else if (rule.minShellOutings !== null) out.push(`Rowed at least ${plural(rule.minShellOutings, "time")} (${rowing})`);
  else if (rule.maxShellOutings !== null) out.push(rule.maxShellOutings === 0 ? `Has not rowed (${rowing})` : `Rowed at most ${plural(rule.maxShellOutings, "time")} (${rowing})`);
  if (rule.leaveOutRecentlyEmailed) out.push(`Leaves out anyone who got a campaign in the last ${RECENT_DAYS} days`);
  return out;
}

/* ---------- What Claude is asked to fill in ---------- */

/** The JSON shape Claude must answer with when reading a description. Every key is required; null means "not asked for". */
export function ruleSchema(interests: string[]): Record<string, unknown> {
  const nullableInt = { anyOf: [{ type: "integer" }, { type: "null" }] };
  const nullableNum = { anyOf: [{ type: "number" }, { type: "null" }] };
  const nullableDay = { anyOf: [{ type: "string", description: "YYYY-MM-DD" }, { type: "null" }] };
  const interestItem = interests.length ? { type: "string", enum: interests } : { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["rule", "listName", "notUnderstood"],
    properties: {
      listName: { type: "string", description: "A short name for this group, 2 to 6 words, e.g. 'New members interested in rowing'." },
      notUnderstood: {
        type: "array",
        items: { type: "string" },
        description: "Parts of the description that none of the filters can express, in the person's words. Empty when everything fit.",
      },
      rule: {
        type: "object",
        additionalProperties: false,
        required: RULE_KEYS,
        properties: {
          joinedWithinMonths: nullableInt,
          joinedOnOrAfter: nullableDay,
          joinedOnOrBefore: nullableDay,
          memberTypes: { type: "array", items: { type: "string", enum: [...MEMBER_TYPES] } },
          interestsAny: { type: "array", items: interestItem },
          minVisitsPerMonth: nullableNum,
          maxVisitsPerMonth: nullableNum,
          noVisitInDays: nullableInt,
          minShellOutings: nullableInt,
          maxShellOutings: nullableInt,
          leaveOutRecentlyEmailed: { type: "boolean" },
        },
      },
    },
  };
}

export function ruleInstructions(today: string, info: PoolInfo): string {
  return [
    "You turn a College Club Seattle board member's description of a group of club members into filters for an email list.",
    "College Club Seattle is a member-owned rowing, fitness and social club on Lake Union. Each record is one household.",
    `Today is ${today} (Pacific time).`,
    "Fill in only the filters the description asks for; leave every other number or date null and every list empty.",
    "Filters:",
    "- joinedWithinMonths: joined within this many months of today ('joined in the last three months' = 3; 'this year' is better as joinedOnOrAfter).",
    "- joinedOnOrAfter / joinedOnOrBefore: join date limits, YYYY-MM-DD.",
    `- memberTypes: any of ${MEMBER_TYPES.join(", ")} (Intermediate means under 33; Non-Resident lives farther away).`,
    `- interestsAny: interests the member said they have on their application or email sign-up. Use only these exact values: ${info.interests.length ? info.interests.join("; ") : "(none loaded yet)"}. 'Rowing' and 'learning to row' both mean the rowing interest.`,
    `- minVisitsPerMonth / maxVisitsPerMonth: average days a month they come to the club (door entries or reservations), counted through ${info.visitsThrough}. 'Rarely' or 'hardly ever' is at most 1; 'regulars' is at least 4.`,
    "- noVisitInDays: has not come in for at least this many days.",
    `- minShellOutings / maxShellOutings: times out in a rowing shell ${info.rowing ? `from ${info.rowing.from} to ${info.rowing.to}` : "(no rowing figures are loaded yet, but still fill these in when asked)"}. 'Hasn't rowed' is maxShellOutings 0; 'has rowed' is minShellOutings 1.`,
    "- leaveOutRecentlyEmailed: true only when the description asks to skip people who were emailed recently.",
    "Anything the filters cannot express (for example age, gender, who they row with, an event they went to) goes in notUnderstood. Never guess a filter for it.",
  ].join("\n");
}

/* ---------- The draft email ---------- */

export interface DraftCopy {
  subject: string;
  previewText: string;
  /** Plain paragraphs, no greeting (the greeting uses the member's first name in Mailchimp). */
  paragraphs: string[];
  signOff: string;
}

export const DRAFT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "previewText", "paragraphs", "signOff"],
  properties: {
    subject: { type: "string", description: "Under 60 characters, plain, no emoji, no all caps." },
    previewText: { type: "string", description: "The short line email programs show after the subject, under 100 characters." },
    paragraphs: { type: "array", items: { type: "string" }, description: "2 to 5 short paragraphs of plain text. No greeting line. No links unless the request gives one." },
    signOff: { type: "string", description: "One line, e.g. 'See you at the boathouse,' followed by nothing else." },
  },
};

export function draftInstructions(listName: string, rule: string[], count: number): string {
  return [
    "You write a short, warm email from College Club Seattle (a member-owned rowing, fitness and social club on Lake Union) to a group of its members.",
    `The group is "${listName}" (${count} households). They were picked by: ${rule.join("; ") || "a hand-picked list"}.`,
    "Write in plain, friendly English, the way a fellow member on the board would write. Short sentences. No marketing language, no exclamation marks in every line, no emoji.",
    "Do not mention how they were picked (never say 'because you rarely visit' or 'our records show'). Do not invent dates, prices, names, times or links: where one is needed and not given, write it in square brackets, like [day and time], so staff fill it in before sending.",
    "Do not write a greeting line; it is added with the member's first name. End with the sign-off line only; the club's name is added under it.",
  ].join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The draft as Mailchimp HTML. Every word from Claude is escaped; the greeting and the footer are Mailchimp merge tags. */
export function draftHtml(copy: DraftCopy): string {
  const p = (inner: string) => `<p style="margin:0 0 16px;font-family:Georgia,serif;font-size:17px;line-height:1.5;color:#222">${inner}</p>`;
  return [
    "<!doctype html><html><body style=\"margin:0;padding:24px;background:#ffffff\">",
    `<div style="max-width:600px;margin:0 auto">`,
    p("*|IF:FNAME|*Hi *|FNAME|*,*|ELSE:|*Hello,*|END:IF|*"),
    ...copy.paragraphs.map((t) => p(esc(t))),
    p(`${esc(copy.signOff)}<br>College Club Seattle`),
    `<p style="margin:32px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#666">You are getting this because you are a member of College Club Seattle. <a href="*|UNSUB|*">Unsubscribe</a><br>*|LIST:ADDRESSLINE|*</p>`,
    "</div></body></html>",
  ].join("\n");
}

/** Checks Claude's draft before it goes anywhere. */
export function parseDraft(input: unknown): DraftCopy | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const str = (v: unknown, max: number) => typeof v === "string" && v.trim() !== "" && v.length <= max;
  if (!str(r.subject, 150) || !str(r.previewText, 200) || !str(r.signOff, 200)) return null;
  if (!Array.isArray(r.paragraphs) || r.paragraphs.length < 1 || r.paragraphs.length > 8 || !r.paragraphs.every((x) => str(x, 2000))) return null;
  return {
    subject: (r.subject as string).trim(),
    previewText: (r.previewText as string).trim(),
    paragraphs: (r.paragraphs as string[]).map((x) => x.trim()),
    signOff: (r.signOff as string).trim(),
  };
}

/* ---------- Linking Mailchimp contacts to households ---------- */

/** One Mailchimp contact, read on the server only. */
export interface AudienceContact {
  email: string;
  status: string;
  memberNumber: string | null;
  memberName: string | null;
  firstName: string;
  lastName: string;
  interests: string[];
}

const squash = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9& ]/g, "").replace(/\s+/g, " ").trim();
const number = (s: string | null) => (s ? s.trim().replace(/^0+(?=\d)/, "") : "");

/**
 * Gives each household its subscribed addresses and adds the contacts' interest groups to its interests.
 * A contact is linked by the Mailchimp "Member #" field (the QuickBooks member number), or else by its "Member Name"
 * or its first and last name being the household's QuickBooks name.
 */
export function linkContacts(pool: ListPerson[], contacts: AudienceContact[]): ListPerson[] {
  const byNumber = new Map<string, ListPerson>();
  const byName = new Map<string, ListPerson>();
  for (const p of pool) {
    if (p.memberNumber) byNumber.set(number(p.memberNumber), p);
    byName.set(squash(p.name), p);
  }
  const extra = new Map<ListPerson, { emails: Set<string>; interests: Set<string> }>();
  for (const c of contacts) {
    const p =
      (c.memberNumber && byNumber.get(number(c.memberNumber))) ||
      (c.memberName && byName.get(squash(c.memberName))) ||
      byName.get(squash(`${c.firstName} ${c.lastName}`));
    if (!p) continue;
    const slot = extra.get(p) ?? { emails: new Set<string>(), interests: new Set<string>() };
    if (c.status === "subscribed") slot.emails.add(c.email.toLowerCase());
    for (const i of c.interests) slot.interests.add(normalizeInterest(i));
    extra.set(p, slot);
  }
  return pool.map((p) => {
    const slot = extra.get(p);
    if (!slot) return p;
    return {
      ...p,
      emails: [...new Set([...p.emails, ...slot.emails])].sort(),
      interests: [...new Set([...p.interests, ...slot.interests])].sort(),
    };
  });
}

export function poolInterests(pool: ListPerson[]): string[] {
  return [...new Set(pool.flatMap((p) => p.interests))].sort();
}

/** Today on the Pacific clock. */
export function pacificToday(now: Date = new Date()): string {
  return pacificCalendarDate(now.toISOString());
}

/* ---------- Invented members, for development and tests ---------- */

export function samplePool(today: string): { pool: ListPerson[]; info: Omit<PoolInfo, "interests"> } {
  const ago = (days: number) => dayOffset(today, -days);
  const person = (n: number, name: string, type: string, joined: string, vpm: number, last: string | null, interests: string[], rowed: number): ListPerson => ({
    key: `S${n}`,
    name,
    memberNumber: `S${n}`,
    memberType: type,
    joined,
    visitsPerMonth: vpm,
    visitDays: Math.round(vpm * 9),
    lastVisit: last,
    interests,
    shellOutings: rowed,
    emails: [],
  });
  const pool = [
    person(101, "Sample Avery Lindqvist", "Resident", ago(20), 0.5, ago(15), ["rowing"], 0),
    person(102, "Sample Brooke Okafor", "Intermediate", ago(45), 1.2, ago(9), ["rowing", "happy hours & socials"], 1),
    person(103, "Sample Casey Moreau", "Resident", ago(70), 6, ago(1), ["rowing"], 12),
    person(104, "Sample Devon Achebe", "Non-Resident", ago(30), 0, null, ["kayaking or paddle boarding"], 0),
    person(105, "Sample Emery Tanaka", "Resident", ago(400), 0.3, ago(120), ["rowing"], 0),
    person(106, "Sample Finley Brooks", "Intermediate", ago(60), 2.5, ago(4), ["bridge"], 0),
    person(107, "Sample Gray Pemberton", "Resident", QB_LOAD_DAY, 8, ago(2), [], 20),
    person(108, "Sample Harper Quill", "Resident", ago(10), 0.8, ago(8), ["rowing"], 0),
  ];
  return { pool, info: { source: "sample", visitsThrough: ago(1), rowing: { from: ago(52), to: ago(7) }, withApplicationAnswers: 6 } };
}

/** Invented Mailchimp contacts that belong with the sample pool (example.org addresses only). */
export function sampleContacts(): AudienceContact[] {
  const c = (n: number, first: string, last: string, status = "subscribed", interests: string[] = []): AudienceContact => ({
    email: `${first.toLowerCase()}.${last.toLowerCase()}@example.org`,
    status,
    memberNumber: `S${n}`,
    memberName: null,
    firstName: first,
    lastName: last,
    interests,
  });
  return [
    c(101, "Avery", "Lindqvist"),
    c(102, "Brooke", "Okafor"),
    c(102, "Sam", "Okafor"),
    c(103, "Casey", "Moreau"),
    c(104, "Devon", "Achebe", "unsubscribed"),
    c(105, "Emery", "Tanaka"),
    c(106, "Finley", "Brooks", "subscribed", ["Rowing"]),
    c(107, "Gray", "Pemberton"),
    // Harper Quill (108) has no Mailchimp contact, so the page shows a household with no email on file.
  ];
}
