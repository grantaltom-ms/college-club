import { describe, expect, it } from "vitest";
import { CLASS_RULES } from "../settings/class-rules";
import { addDays, pacificDate, pacificWall } from "../time";
import { classCatalog, schedulePatternWords } from "./class-catalog";
import { createClass, scheduleSessions, signUp } from "./classes";
import { NOW, TODAY, addMembers, fixture, memberCtx, staffCtx } from "./testkit";

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

describe("schedulePatternWords", () => {
  it("names the calendar day for a one-off session", () => {
    const start = at(2, 12).toISOString();
    const end = at(2, 12, 30).toISOString();
    expect(schedulePatternWords([{ startsAt: start, endsAt: end }])).toBe("Friday, Oct 30 · 12:00 to 12:30 pm");
  });

  it("says the weekday in the plural for a weekly run at the same clock time", () => {
    const a = { startsAt: at(1, 17).toISOString(), endsAt: at(1, 17, 45).toISOString() };
    const b = { startsAt: at(8, 17).toISOString(), endsAt: at(8, 17, 45).toISOString() };
    expect(schedulePatternWords([a, b])).toBe("Thursdays · 5:00 to 5:45 pm");
  });

  it("joins two different usual slots with a semicolon", () => {
    const thu = { startsAt: at(1, 17).toISOString(), endsAt: at(1, 17, 45).toISOString() };
    const fri = { startsAt: at(2, 7).toISOString(), endsAt: at(2, 8).toISOString() };
    expect(schedulePatternWords([thu, fri])).toBe("Thursdays · 5:00 to 5:45 pm; Fridays · 7:00 to 8:00 am");
  });
});

describe("classCatalog", () => {
  it("lists each class once with its usual days, upcoming dates, and the member's own place — never other names", async () => {
    const f = await withRooms();
    const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), {
      name: "Morning Yoga",
      description: "Gentle.",
      instructor: "Mira Sandoval",
      defaultCapacity: 12,
      defaultMinutes: 60,
      roomItemId: f.i["Clubhouse room"],
    });
    const erg = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), {
      name: "Erg Conditioning",
      description: "Intervals.",
      instructor: "Theo Brandvold",
      defaultCapacity: 4,
      defaultMinutes: 45,
      roomItemId: f.i["Boathouse gym"],
    });
    await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(2, 7), weeks: 2 });
    const [full] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: erg.id, startsAt: at(1, 17), weeks: 2 });
    for (const who of ["Ada", "Ben", "Cy", "Dee"] as const) {
      await signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m[who], who), { sessionId: full.id, memberId: f.m[who] });
    }
    await signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m.Eli, "Eli"), { sessionId: full.id, memberId: f.m.Eli });

    const state = await f.store.read();
    const catalog = classCatalog(state, NOW, { kind: "member", memberId: f.m.Eli });
    expect(catalog.map((c) => c.template.name)).toEqual(["Erg Conditioning", "Morning Yoga"]);
    expect(catalog[0].scheduleWords).toBe("Thursdays · 5:00 to 5:45 pm");
    expect(catalog[0].roomName).toBe("Boathouse gym");
    expect(catalog[0].upcoming[0].full).toBe(true);
    expect(catalog[0].upcoming[0].yours).toMatchObject({ status: "waitlisted", place: 1 });
    expect(catalog[0].upcoming[0].sheet).toEqual([]);
    expect(JSON.stringify(catalog[0])).not.toContain("Quill");
    expect(catalog[1].scheduleWords).toBe("Fridays · 7:00 to 8:00 am");
    expect(catalog[1].upcoming).toHaveLength(2);

    const asStaff = classCatalog(state, NOW, { kind: "staff" });
    expect(asStaff[0].upcoming[0].sheet.map((l) => l.name)).toEqual(["Ada Quill", "Ben Quill", "Cy Quill", "Dee Reed", "Eli Reed"]);
  });

  it("hides classes with no upcoming session left in the sign-up window", async () => {
    const f = await withRooms();
    const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), {
      name: "Past Only",
      description: "",
      instructor: "Mira",
      defaultCapacity: 8,
      defaultMinutes: 60,
      roomItemId: null,
    });
    // Scheduled at 11 am for a noon start; by the frozen 1 pm clock it has already begun.
    await scheduleSessions(f.store, f.book, staffCtx(pacificWall(TODAY, 11 * 60)), {
      classId: yoga.id,
      startsAt: pacificWall(TODAY, 12 * 60),
    });
    expect(classCatalog(await f.store.read(), NOW, { kind: "staff" })).toEqual([]);
    expect(pacificDate(NOW)).toBe(TODAY);
  });

  it("still lists a class whose only date is a one-off later this week", async () => {
    const f = await withRooms();
    const [extra] = await addMembers(f, 1);
    const drill = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), {
      name: "One Off Drill",
      description: "",
      instructor: "Coach",
      defaultCapacity: 1,
      defaultMinutes: 45,
      roomItemId: null,
    });
    await scheduleSessions(f.store, f.book, staffCtx(), { classId: drill.id, startsAt: at(6, 10) });
    const catalog = classCatalog(await f.store.read(), NOW, { kind: "member", memberId: extra });
    expect(catalog).toHaveLength(1);
    expect(catalog[0].scheduleWords).toBe("Tuesday, Nov 3 · 10:00 to 10:45 am");
  });
});
