import { describe, expect, it } from "vitest";
import { CLASS_RULES } from "../settings/class-rules";
import { addDays, pacificWall } from "../time";
import {
  buildClassCalendarIcs,
  classCalendarEvents,
  classCalendarSubscribeUrls,
  escapeText,
  foldIcs,
  formatUtcStamp,
} from "./class-calendar";
import { createClass, scheduleSessions, signUp } from "./classes";
import { NOW, TODAY, fixture, memberCtx, staffCtx } from "./testkit";

const at = (daysAhead: number, hour: number, minute = 0) => pacificWall(addDays(TODAY, daysAhead), hour * 60 + minute);

async function withRooms() {
  const f = await fixture();
  await f.store.transaction(async (s, newId) => {
    for (const [name, classCode] of [
      ["Boathouse gym", "gym-space"],
      ["Clubhouse room", "room-space"],
    ] as const) {
      const id = newId();
      s.items.push({ id, name, classCode, ruleOverrides: {} });
      f.i[name] = id;
    }
  });
  return f;
}

describe("escapeText and foldIcs", () => {
  it("escapes commas, semicolons, backslashes and newlines", () => {
    expect(escapeText("A; B, C\\D\nE")).toBe("A\\; B\\, C\\\\D\\nE");
  });

  it("folds long lines with a leading space on continuations", () => {
    const long = `SUMMARY:${"x".repeat(100)}`;
    const folded = foldIcs([long]);
    expect(folded[0]).toHaveLength(75);
    expect(folded[1].startsWith(" ")).toBe(true);
    expect(folded.join("").replace(/ /g, "")).toBe(long);
  });

  it("formats UTC stamps without separators", () => {
    expect(formatUtcStamp(new Date("2026-10-29T00:00:00.000Z"))).toBe("20261029T000000Z");
  });
});

describe("classCalendarEvents", () => {
  it("lists upcoming scheduled sessions with room and title, never member names", async () => {
    const f = await withRooms();
    const erg = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), {
      name: "Erg Conditioning",
      description: "Indoor intervals.",
      instructor: "Theo Brandvold",
      defaultCapacity: 4,
      defaultMinutes: 45,
      roomItemId: f.i["Boathouse gym"],
    });
    const [full] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: erg.id, startsAt: at(1, 17), weeks: 2 });
    for (const who of ["Ada", "Ben", "Cy", "Dee"] as const) {
      await signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m[who], who), { sessionId: full.id, memberId: f.m[who] });
    }

    const events = classCalendarEvents(await f.store.read(), NOW);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: "Erg Conditioning",
      location: "Boathouse gym",
      description: "Indoor intervals.\n\nWith Theo Brandvold.",
    });
    expect(JSON.stringify(events)).not.toContain("Quill");
    expect(JSON.stringify(events)).not.toContain("Ada");
  });

  it("omits cancelled sessions and anything that has already started", async () => {
    const f = await withRooms();
    const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), {
      name: "Morning Yoga",
      description: "",
      instructor: "Mira",
      defaultCapacity: 8,
      defaultMinutes: 60,
      roomItemId: null,
    });
    // Under way at the frozen 1 pm clock.
    await scheduleSessions(f.store, f.book, staffCtx(pacificWall(TODAY, 11 * 60)), {
      classId: yoga.id,
      startsAt: pacificWall(TODAY, 12 * 60),
    });
    const [later] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(2, 7) });
    await f.store.transaction(async (s) => {
      const session = s.sessions.find((x) => x.id === later.id)!;
      session.status = "cancelled";
      session.cancelReason = "Instructor is ill";
      session.statusChangedAt = NOW.toISOString();
    });
    expect(classCalendarEvents(await f.store.read(), NOW)).toEqual([]);
  });
});

describe("buildClassCalendarIcs", () => {
  it("builds a subscribeable calendar with a sign-up URL and CRLF lines", async () => {
    const f = await withRooms();
    const stretch = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), {
      name: "Stretch & Mobility",
      description: "Slow stretching.",
      instructor: "Mira Sandoval",
      defaultCapacity: 10,
      defaultMinutes: 30,
      roomItemId: f.i["Clubhouse room"],
    });
    const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: stretch.id, startsAt: at(2, 12) });
    const events = classCalendarEvents(await f.store.read(), NOW);
    const ics = buildClassCalendarIcs(events, {
      calendarName: "CCS Fitness Classes",
      siteOrigin: "https://club.example.org",
      now: NOW,
    });

    // Unfold CRLF + space continuations so long URL lines can be asserted as one string.
    const flat = ics.replace(/\r\n /g, "");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(flat).toContain("X-WR-CALNAME:CCS Fitness Classes");
    expect(flat).toContain(`UID:ccs-class-${session.id}@collegeclubseattle.org`);
    expect(flat).toContain("SUMMARY:Stretch & Mobility");
    expect(flat).toContain("LOCATION:Clubhouse room");
    expect(flat).toContain(`URL:https://club.example.org/club/classes/${session.id}`);
    expect(flat).toContain(`Sign up: https://club.example.org/club/classes/${session.id}`);
    expect(flat).not.toContain("Quill");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("classCalendarSubscribeUrls", () => {
  it("turns the site origin into https and webcal feed addresses", () => {
    expect(classCalendarSubscribeUrls("https://club.example.org")).toEqual({
      https: "https://club.example.org/api/club/classes/calendar",
      webcal: "webcal://club.example.org/api/club/classes/calendar",
    });
  });
});
