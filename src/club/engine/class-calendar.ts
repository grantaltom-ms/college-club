import { addDays, pacificDate } from "../time";
import type { ClassSession, ClassTemplate, ClubState } from "../types";
import { CLASS_CATALOG_DAYS_AHEAD } from "./class-catalog";

/** How far ahead the subscribe feed looks (same window as the bulletin's usual-days read). */
export const CLASS_CALENDAR_DAYS_AHEAD = CLASS_CATALOG_DAYS_AHEAD;

/** One dated class session as a calendar entry. Never carries member names or waitlist places. */
export interface ClassCalendarEvent {
  sessionId: string;
  classId: string;
  title: string;
  description: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  /** ISO instant when this session last changed (cancel, capacity, …). */
  updatedAt: string;
}

export interface ClassCalendarBuild {
  /** Calendar display name in Google / Apple / Outlook. */
  calendarName: string;
  /** Site origin for absolute sign-up links, or null when unknown. */
  siteOrigin: string | null;
  now: Date;
}

/**
 * Upcoming scheduled class sessions for the subscribe feed. Cancelled sessions are left out.
 * Sorted soonest first. Read only; no member names.
 */
export function classCalendarEvents(state: ClubState, now: Date, daysAhead: number = CLASS_CALENDAR_DAYS_AHEAD): ClassCalendarEvent[] {
  const today = pacificDate(now);
  const lastDay = addDays(today, daysAhead);
  const nowMs = now.getTime();
  const byId = new Map(state.classes.map((c) => [c.id, c]));
  const events: ClassCalendarEvent[] = [];

  for (const session of state.sessions) {
    if (session.status !== "scheduled") continue;
    if (Date.parse(session.startsAt) <= nowMs) continue;
    const day = pacificDate(new Date(session.startsAt));
    if (day < today || day > lastDay) continue;
    const template = byId.get(session.classId);
    if (!template) continue;
    events.push(eventOf(state, template, session));
  }

  return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
}

function eventOf(state: ClubState, template: ClassTemplate, session: ClassSession): ClassCalendarEvent {
  const roomId = session.roomItemId ?? template.roomItemId;
  const location = roomId ? (state.items.find((i) => i.id === roomId)?.name ?? null) : null;
  const bits = [template.description.trim(), template.instructor ? `With ${template.instructor}.` : ""].filter(Boolean);
  return {
    sessionId: session.id,
    classId: session.classId,
    title: template.name,
    description: bits.join("\n\n"),
    location,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    updatedAt: session.statusChangedAt || session.createdAt,
  };
}

/**
 * An iCalendar (ICS) document for the class schedule. One-way: calendars read it; nothing written back.
 * Safe to show publicly when the member area is on: titles, times and rooms only.
 */
export function buildClassCalendarIcs(events: ClassCalendarEvent[], build: ClassCalendarBuild): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//College Club Seattle//Fitness Classes//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(build.calendarName)}`,
    "X-WR-TIMEZONE:America/Los_Angeles",
  ];

  const stamp = formatUtcStamp(build.now);
  for (const event of events) {
    const path = `/club/classes/${event.sessionId}`;
    const url = build.siteOrigin ? `${build.siteOrigin}${path}` : null;
    const description = [event.description, url ? `Sign up: ${url}` : "Sign up in the College Club member area."].filter(Boolean).join("\n\n");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:ccs-class-${event.sessionId}@collegeclubseattle.org`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${formatUtcStamp(new Date(event.startsAt))}`);
    lines.push(`DTEND:${formatUtcStamp(new Date(event.endsAt))}`);
    lines.push(`LAST-MODIFIED:${formatUtcStamp(new Date(event.updatedAt))}`);
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    lines.push(`DESCRIPTION:${escapeText(description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (url) lines.push(`URL:${escapeText(url)}`);
    lines.push("STATUS:CONFIRMED");
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return foldIcs(lines).join("\r\n") + "\r\n";
}

/** UTC stamp `YYYYMMDDTHHMMSSZ` for ICS. */
export function formatUtcStamp(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/** Escape text for an ICS VALUE=TEXT field. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\n|\r/g, "\\n");
}

/**
 * Fold lines to at most 75 octets (RFC 5545). Continuations start with a single space.
 * ASCII-only content in this feed, so one char = one octet.
 */
export function foldIcs(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= 75) {
      out.push(line);
      continue;
    }
    out.push(line.slice(0, 75));
    let rest = line.slice(75);
    while (rest.length > 74) {
      out.push(` ${rest.slice(0, 74)}`);
      rest = rest.slice(74);
    }
    if (rest.length > 0) out.push(` ${rest}`);
  }
  return out;
}

/** Absolute https and webcal addresses for the feed, when the site origin is known. */
export function classCalendarSubscribeUrls(siteOrigin: string): { https: string; webcal: string } {
  const path = "/api/club/classes/calendar";
  const https = `${siteOrigin.replace(/\/$/, "")}${path}`;
  const webcal = https.replace(/^https:/i, "webcal:").replace(/^http:/i, "webcal:");
  return { https, webcal };
}
