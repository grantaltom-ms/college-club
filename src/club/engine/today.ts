import { daysBetween, formatClock, formatDayHeading, pacificDate } from "../time";
import type { AttendanceRules, Booking, BookingType, ClubState, Member, SignUp, TodayRules } from "../types";
import { bookingTypeOf, checkInNeeded } from "./attendance";
import { fullName, householdOf } from "./queries";

/**
 * "Today at the Club": what the front desk sees first. Who is here now, who is still to come, and a warm nudge to say hello to
 * people who have not been in much. The building comparison: the lobby whiteboard. It says how many units have people in them
 * today, who is in the building this minute, and who is expected, with a small note by the names of tenants the desk has not seen
 * in a while or has never met. It is worked out from the club's own records each time; nothing is stored for it.
 *
 * Staff pages only. The hello notes are never shown to a member, on this page or any other; nothing outside the staff landing
 * page asks for them. Reservations are boat and space bookings and class places (the categories My bookings already uses). Events
 * and practices are not reservations here: events have their own RSVP list and practices their own lineup.
 *
 * No clock time of any reservation is part of what this returns, on purpose: the page is for knowing who to greet, not for
 * reading out a schedule. The one time on the page is when the figures were worked out (`asOf`).
 */

/* ---------- The categories ---------- */

/** What a reservation is, in the club's own words. The booking types are the ones the app already has; a class place is a class. */
export type TodayCategoryKey = "boat" | "gym" | "dock" | "class" | "room" | "work";

interface TodayCategory {
  key: TodayCategoryKey;
  /** The booking types it covers (a class place has none: it is not a booking). */
  types: readonly BookingType[];
  /** The small word beside a name, singular: "Boat", "Gym". */
  tag: string;
  /** How a count reads in the summary line. Boats are the three on-the-water types, as in "6 boats". */
  one: string;
  many: string;
}

/** Biggest-first ties keep this order: boats, gym, dock, classes, room, work space. */
export const TODAY_CATEGORIES: readonly TodayCategory[] = [
  { key: "boat", types: ["Shell", "Kayak", "Paddle Board"], tag: "Boat", one: "boat", many: "boats" },
  { key: "gym", types: ["Gym Space"], tag: "Gym", one: "gym", many: "gym" },
  { key: "dock", types: ["Dock Space"], tag: "Dock", one: "dock", many: "dock" },
  { key: "class", types: [], tag: "Class", one: "class place", many: "class places" },
  { key: "room", types: ["Room Space"], tag: "Room", one: "room", many: "room" },
  { key: "work", types: ["Work Space"], tag: "Work space", one: "work space", many: "work spaces" },
];

const categoryOfType = (type: BookingType): TodayCategory | undefined => TODAY_CATEGORIES.find((c) => c.types.includes(type));
const CLASS_CATEGORY = TODAY_CATEGORIES.find((c) => c.key === "class")!;

/* ---------- What the page shows ---------- */

/** A warm note by a name. Two kinds, never a count or a score, never a word like "at risk". */
export interface HelloFlag {
  kind: "new" | "rare";
  words: string;
}

export const HELLO_WORDS: Record<HelloFlag["kind"], string> = {
  rare: "Say hello — first visit in a while",
  new: "New member — say hello",
};

export interface TodayWhat {
  /** The boat, space or class, as members know it: "Dear Prudence", "Weight room", "Morning Yoga". */
  title: string;
  /** "Boat", "Gym", "Dock", "Class", "Room", "Work space". */
  category: string;
}

export interface TodayRow {
  memberId: string;
  name: string;
  /** Everything of theirs in this section, soonest first. Usually one thing. */
  what: TodayWhat[];
  hello: HelloFlag | null;
}

export interface TodaySummaryPart {
  key: TodayCategoryKey;
  count: number;
  /** "6 boats", "1 boat", "3 gym". */
  words: string;
}

export interface TodayView {
  /** The Pacific date, YYYY-MM-DD. */
  day: string;
  /** "Sunday, November 8". */
  heading: string;
  /** When these figures were worked out (an ISO moment) and the same as the clock reads, "1:00 pm". */
  asOf: string;
  asOfClock: string;
  summary: {
    total: number;
    parts: TodaySummaryPart[];
    /** "14 reservations today — 6 boats, 3 gym, 2 dock, 2 class places, 1 room", or "No reservations today." */
    words: string;
  };
  /** Members whose reservation is under way, or who have checked in for one that has not ended. */
  here: TodayRow[];
  /** Members with a reservation still to start today. */
  upcoming: TodayRow[];
}

export function summaryWords(total: number, parts: { count: number; one: string; many: string }[]): string {
  if (total === 0) return "No reservations today.";
  const bits = parts.map((p) => `${p.count} ${p.count === 1 ? p.one : p.many}`).join(", ");
  return `${total} ${total === 1 ? "reservation" : "reservations"} today — ${bits}`;
}

export { memberCount, refreshWords } from "../today-words";

/* ---------- Reservations, one line for each person on each ---------- */

type Stage = "here" | "coming" | "over";

interface Line {
  memberId: string;
  what: TodayWhat;
  startMs: number;
  stage: Stage;
}

/** Where a booking stands now, for the people on it: here (under way, or checked in and not over), coming (not started) or over/out. */
function bookingStage(b: Booking, nowMs: number): Stage | null {
  // Cancelled bookings hold nothing; a no-show was recorded by someone, so that person is not here.
  if (b.status !== "upcoming" && b.status !== "completed") return null;
  if (nowMs >= Date.parse(b.endsAt)) return "over";
  if (b.status === "completed" || nowMs >= Date.parse(b.startsAt)) return "here";
  return "coming";
}

function signUpStage(g: SignUp, startsAt: string, endsAt: string, nowMs: number): Stage | null {
  if (g.status !== "enrolled" && g.status !== "attended") return null;
  if (nowMs >= Date.parse(endsAt)) return "over";
  if (g.status === "attended" || nowMs >= Date.parse(startsAt)) return "here";
  return "coming";
}

/** The per-person lines for today's lists, and the count of reservations that start today, by category. */
function reservationsToday(state: ClubState, now: Date): { lines: Line[]; counts: Map<TodayCategoryKey, number> } {
  const today = pacificDate(now);
  const nowMs = now.getTime();
  const lines: Line[] = [];
  const counts = new Map<TodayCategoryKey, number>();
  const count = (key: TodayCategoryKey) => counts.set(key, (counts.get(key) ?? 0) + 1);

  for (const b of state.bookings) {
    // An item whose class the rules no longer know has no category: it is left out rather than guessed at.
    const type = bookingTypeOf(state, b.itemId);
    const category = type && categoryOfType(type);
    if (!category) continue;
    const startsToday = pacificDate(new Date(b.startsAt)) === today;
    if (startsToday && (b.status === "upcoming" || b.status === "completed" || b.status === "no_show")) count(category.key);
    const stage = bookingStage(b, nowMs);
    if (stage === null || stage === "over") continue;
    // Something not yet started counts only when it starts today. A reservation under way counts whenever it started.
    if (stage === "coming" && !startsToday) continue;
    const what = { title: state.items.find((i) => i.id === b.itemId)?.name ?? "A booking", category: category.tag };
    for (const memberId of [b.bookerId, ...b.crew]) lines.push({ memberId, what, startMs: Date.parse(b.startsAt), stage });
  }

  for (const g of state.signups) {
    const session = state.sessions.find((x) => x.id === g.sessionId);
    if (!session || session.status !== "scheduled") continue;
    const startsToday = pacificDate(new Date(session.startsAt)) === today;
    if (startsToday && (g.status === "enrolled" || g.status === "attended" || g.status === "no_show")) count("class");
    const stage = signUpStage(g, session.startsAt, session.endsAt, nowMs);
    if (stage === null || stage === "over") continue;
    if (stage === "coming" && !startsToday) continue;
    const what = { title: state.classes.find((c) => c.id === session.classId)?.name ?? "A class", category: CLASS_CATEGORY.tag };
    lines.push({ memberId: g.memberId, what, startMs: Date.parse(session.startsAt), stage });
  }
  return { lines, counts };
}

/* ---------- The hello flag ---------- */

export interface TodayHistory {
  /** Pacific days of completed visits before today. */
  visitDays: string[];
  /** True when the member has any reservation of any kind that started before today, whatever became of it. */
  hasEarlierRecord: boolean;
}

/**
 * What the club's own records say about each of these members before today: the days they completed a visit, and whether they
 * have booked anything at all. A completed visit is a boat or space booking that was checked in, a class place that was marked
 * attended, or an event RSVP staff marked attended. A club room or work space booking needs no check-in, so it stays "upcoming"
 * for ever (nothing ever says anyone did or did not come): once it is over and was not cancelled it counts as a visit.
 * Today's own reservations are left out, so a rare visitor who has just checked in is still known to be one.
 */
function historyOf(state: ClubState, members: Set<string>, now: Date, attendance: AttendanceRules): Map<string, TodayHistory> {
  const today = pacificDate(now);
  const nowMs = now.getTime();
  const out = new Map<string, TodayHistory>([...members].map((id) => [id, { visitDays: [], hasEarlierRecord: false }]));
  const earlier = (iso: string) => pacificDate(new Date(iso)) < today;

  for (const b of state.bookings) {
    if (!earlier(b.startsAt)) continue;
    const completed = b.status === "completed" || (b.status === "upcoming" && Date.parse(b.endsAt) <= nowMs && !checkInNeeded(state, b, attendance));
    for (const id of [b.bookerId, ...b.crew]) {
      const h = out.get(id);
      if (!h) continue;
      h.hasEarlierRecord = true;
      if (completed) h.visitDays.push(pacificDate(new Date(b.startsAt)));
    }
  }
  for (const g of state.signups) {
    const h = out.get(g.memberId);
    const session = h && state.sessions.find((x) => x.id === g.sessionId);
    if (!h || !session || !earlier(session.startsAt)) continue;
    h.hasEarlierRecord = true;
    if (g.status === "attended") h.visitDays.push(pacificDate(new Date(session.startsAt)));
  }
  for (const r of state.rsvps) {
    const h = out.get(r.memberId);
    const event = h && state.events.find((x) => x.id === r.eventId);
    if (!h || !event || !earlier(event.startsAt)) continue;
    h.hasEarlierRecord = true;
    if (r.status === "attended") h.visitDays.push(pacificDate(new Date(event.startsAt)));
  }
  return out;
}

/**
 * The warm note for one member, if any. NEW wins over the other: their household joined within `newMemberDays` days, or this is
 * their first booking ever (nothing of theirs before today, and they joined within the days the club's records reach back, so the
 * records really do cover their whole membership). Otherwise RARE: no completed visit for `noVisitDays` days or more (or ever),
 * or fewer than `fewVisitsBelow` in the last `fewVisitsDays` days. "In the last N days" counts today as day zero, so the 60th day
 * back is not in the last 60 days. Never a number, never a score.
 */
export function helloFor(joinedOn: string, history: TodayHistory, today: string, rules: TodayRules): HelloFlag | null {
  const { noVisitDays, fewVisitsDays, fewVisitsBelow, newMemberDays } = rules.defaults;
  const sinceJoined = daysBetween(joinedOn, today);
  const brandNew = sinceJoined < newMemberDays;
  const firstEver = !history.hasEarlierRecord && sinceJoined < fewVisitsDays;
  if (brandNew || firstEver) return { kind: "new", words: HELLO_WORDS.new };

  const ago = history.visitDays.map((d) => daysBetween(d, today));
  const latest = ago.length === 0 ? null : Math.min(...ago);
  const inWindow = ago.filter((n) => n < fewVisitsDays).length;
  if (latest === null || latest >= noVisitDays || inWindow < fewVisitsBelow) return { kind: "rare", words: HELLO_WORDS.rare };
  return null;
}

/* ---------- Putting it together ---------- */

const byName = (a: Member, b: Member) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id);

/** Today at the club, as of `now`. Identical for every member of staff: nothing here depends on who is asking. */
export function todayAtTheClub(state: ClubState, now: Date, rules: TodayRules, attendance: AttendanceRules): TodayView {
  const day = pacificDate(now);
  const { lines, counts } = reservationsToday(state, now);

  // Only active adults of active households are listed: someone who has left cannot hold a live reservation anyway.
  const members = new Map(state.members.filter((m) => m.status === "active" && householdOf(state, m.householdId)?.status === "active").map((m) => [m.id, m]));
  const listed = lines.filter((l) => members.has(l.memberId));
  const history = historyOf(state, new Set(listed.map((l) => l.memberId)), now, attendance);
  const hello = new Map<string, HelloFlag | null>();
  const helloOf = (m: Member) => {
    if (!hello.has(m.id)) hello.set(m.id, helloFor(householdOf(state, m.householdId)!.joinedOn, history.get(m.id)!, day, rules));
    return hello.get(m.id)!;
  };

  const rows = (stage: Stage, order: (a: { member: Member; first: number }, b: { member: Member; first: number }) => number): TodayRow[] => {
    const byMember = new Map<string, Line[]>();
    for (const l of listed.filter((x) => x.stage === stage)) byMember.set(l.memberId, [...(byMember.get(l.memberId) ?? []), l]);
    return [...byMember.entries()]
      .map(([id, mine]) => {
        const sorted = [...mine].sort((a, b) => a.startMs - b.startMs || a.what.title.localeCompare(b.what.title));
        return { member: members.get(id)!, first: sorted[0].startMs, what: sorted.map((l) => l.what) };
      })
      .sort(order)
      .map(({ member, what }) => ({ memberId: member.id, name: fullName(member), what, hello: helloOf(member) }));
  };

  const parts: TodaySummaryPart[] = TODAY_CATEGORIES.map((c, index) => ({ c, index, count: counts.get(c.key) ?? 0 }))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map(({ c, count }) => ({ key: c.key, count, words: `${count} ${count === 1 ? c.one : c.many}` }));
  const total = parts.reduce((sum, p) => sum + p.count, 0);
  const wordParts = parts.map((p) => {
    const c = TODAY_CATEGORIES.find((x) => x.key === p.key)!;
    return { count: p.count, one: c.one, many: c.many };
  });

  return {
    day,
    heading: formatDayHeading(day),
    asOf: now.toISOString(),
    asOfClock: formatClock(now),
    summary: { total, parts, words: summaryWords(total, wordParts) },
    // Here now: by name, so the desk can find someone. Still to come: whoever is next first, then by name.
    here: rows("here", (a, b) => byName(a.member, b.member)),
    upcoming: rows("coming", (a, b) => a.first - b.first || byName(a.member, b.member)),
  };
}
