import { addDays, formatDayLong, formatRange, pacificDate, pacificMinutes, weekdayName } from "../time";
import type { ClassSession, ClassTemplate, ClubState } from "../types";
import { sessionView, type SessionView } from "./classes";

/** How far ahead the bulletin looks when deriving usual days (about six weeks). Sign-up rules still apply per session. */
export const CLASS_CATALOG_DAYS_AHEAD = 42;

/**
 * One kind of class on the Fitness classes bulletin: usual days and times, drawn from the
 * upcoming dated sessions staff have already scheduled (not from Google Calendar).
 */
export interface ClassCatalogEntry {
  template: ClassTemplate;
  roomName: string | null;
  /** "Thursdays · 5:00 to 5:45 pm", or a one-off "Friday, Oct 30 · 12:00 to 12:30 pm". */
  scheduleWords: string;
  /**
   * One bulletin line: schedule · room · places on the next session
   * (e.g. "Thursdays · 5:00 to 5:45 pm · Boathouse gym · 4 places").
   */
  summaryWords: string;
  /** Upcoming dated sessions in the catalog window, soonest first. */
  upcoming: SessionView[];
}

export type ClassCatalogViewer = { kind: "member"; memberId: string } | { kind: "staff" };

/**
 * Classes that still have a dated session coming up in the next ~6 weeks, with the usual
 * days/times read off those sessions. Sorted by the next session's start.
 */
export function classCatalog(state: ClubState, now: Date, viewer: ClassCatalogViewer, daysAhead: number = CLASS_CATALOG_DAYS_AHEAD): ClassCatalogEntry[] {
  const today = pacificDate(now);
  const lastDay = addDays(today, daysAhead);
  const nowMs = now.getTime();
  const byClass = new Map<string, ClassSession[]>();

  for (const session of state.sessions) {
    if (session.status !== "scheduled") continue;
    if (Date.parse(session.startsAt) <= nowMs) continue;
    const day = pacificDate(new Date(session.startsAt));
    if (day < today || day > lastDay) continue;
    const list = byClass.get(session.classId) ?? [];
    list.push(session);
    byClass.set(session.classId, list);
  }

  const entries: ClassCatalogEntry[] = [];
  for (const template of state.classes) {
    const sessions = (byClass.get(template.id) ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    if (sessions.length === 0) continue;
    const views = sessions.map((s) => sessionView(state, s, viewer));
    const roomId = sessions[0].roomItemId ?? template.roomItemId;
    const roomName = roomId ? (state.items.find((i) => i.id === roomId)?.name ?? null) : null;
    const scheduleWords = schedulePatternWords(sessions);
    const next = views[0];
    const placesWords = `${next.session.capacity} place${next.session.capacity === 1 ? "" : "s"}`;
    const summaryWords = [scheduleWords, roomName, placesWords].filter(Boolean).join(" · ");
    entries.push({ template, roomName, scheduleWords, summaryWords, upcoming: views });
  }

  return entries.sort((a, b) => a.upcoming[0].session.startsAt.localeCompare(b.upcoming[0].session.startsAt) || a.template.name.localeCompare(b.template.name));
}

/** One class's bulletin entry, or null if it has no upcoming session in the window. */
export function classCatalogEntry(state: ClubState, now: Date, viewer: ClassCatalogViewer, classId: string): ClassCatalogEntry | null {
  return classCatalog(state, now, viewer).find((e) => e.template.id === classId) ?? null;
}

/**
 * Turn a list of dated sessions into the usual-days line members read on the bulletin.
 * One session → the calendar date. A weekly run → "Thursdays · 5:00 to 5:45 pm".
 * Mixed patterns are joined with "; ". Never claims a pattern the pinned sessions don't support.
 */
export function schedulePatternWords(sessions: Pick<ClassSession, "startsAt" | "endsAt">[]): string {
  if (sessions.length === 0) return "No upcoming dates.";

  type Bucket = {
    weekday: number;
    dayName: string;
    startMin: number;
    endMin: number;
    firstDay: string;
    sampleStart: string;
    sampleEnd: string;
    count: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const session of sessions) {
    const day = pacificDate(new Date(session.startsAt));
    const startMin = pacificMinutes(new Date(session.startsAt));
    const endMin = pacificMinutes(new Date(session.endsAt));
    const weekday = weekdayIndex(day);
    const key = `${weekday}|${startMin}|${endMin}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, {
        weekday,
        dayName: weekdayName(day),
        startMin,
        endMin,
        firstDay: day,
        sampleStart: session.startsAt,
        sampleEnd: session.endsAt,
        count: 1,
      });
    }
  }

  const ordered = [...buckets.values()].sort((a, b) => a.firstDay.localeCompare(b.firstDay) || a.startMin - b.startMin);
  return ordered
    .map((b) => {
      const when = formatRange(b.sampleStart, b.sampleEnd);
      if (b.count === 1 && sessions.length === 1) {
        return `${formatDayLong(b.firstDay)} · ${when}`;
      }
      // Two or more pinned sessions at this weekday/time → say the weekday in the plural.
      if (b.count >= 2) return `${pluralWeekday(b.dayName)} · ${when}`;
      // One pinned session at this slot among a mixed list: still the weekday plural only when
      // another week already proved the pattern; a lone slot among mixed days stays a weekday plural
      // of the day it falls on without claiming "every" — same wording members already expect.
      return `${pluralWeekday(b.dayName)} · ${when}`;
    })
    .join("; ");
}

/** "Thursday" → "Thursdays". */
function pluralWeekday(name: string): string {
  return name.endsWith("s") ? name : `${name}s`;
}

function weekdayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
