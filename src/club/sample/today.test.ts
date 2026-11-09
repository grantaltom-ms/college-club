import { describe, expect, it } from "vitest";
import { attendanceSettler } from "../engine/attendance";
import { todayAtTheClub, type TodayRow } from "../engine/today";
import { ATTENDANCE_RULES } from "../settings/attendance-rules";
import { TODAY_RULES } from "../settings/today-rules";
import { MemoryClubStore, sequentialIds } from "../store/memory";
import { addDays, pacificWall } from "../time";
import { seedSample } from "./club";

/** The sample club's day, as the staff landing page shows it. Today is Wed Oct 28, 2026, and the test clock is 1 pm Pacific. */
const TODAY = "2026-10-28";
const at = (hour: number, minute = 0, daysAhead = 0) => pacificWall(addDays(TODAY, daysAhead), hour * 60 + minute);
const NOW = at(13);

/** A sample club whose automatic no-show runs on a clock the test can move. */
async function sampleAt(clockNow: () => Date) {
  const store = new MemoryClubStore(sequentialIds(), { settle: attendanceSettler(ATTENDANCE_RULES, clockNow) });
  await seedSample(store, TODAY, NOW);
  return store;
}

const shape = (rows: TodayRow[]) => rows.map((r) => [r.name, r.what.map((w) => `${w.title} (${w.category})`).join("; "), r.hello?.kind ?? "none"]);

describe("the sample club on Today at the Club", () => {
  it("tells the whole story at 1 pm: people under way, someone checked in, an event under way, people still to come, a rare visitor and a new member", async () => {
    const store = await sampleAt(() => NOW);
    const v = todayAtTheClub(await store.read(), NOW, TODAY_RULES, ATTENDANCE_RULES);
    expect(v.heading).toBe("Wednesday, October 28");
    expect(v.summary.words).toBe("20 reservations today — 7 boats, 6 event RSVPs, 2 dock, 2 class places, 2 room, 1 gym");
    expect(shape(v.here)).toEqual([
      ["Britta Eriksen", "Dock slip B (Dock); Coffee Hour (Event)", "none"], // under way, not checked in
      ["Declan Halloran", "Weight room (Gym); Coffee Hour (Event)", "none"], // checked in
      ["Amara Okonkwo", "Otter (Boat)", "rare"], // has never been in
      ["Chidi Okonkwo", "Skimmer (Boat)", "none"],
      ["Walter Pemberton", "Clubhouse room (Room)", "rare"], // one visit in the last 75 days
      ["Dev Rao", "Coffee Hour (Event)", "none"], // at the coffee hour now, a boat and the talk to come
      ["Priya Rao", "Mink (Boat)", "none"],
    ]);
    expect(shape(v.upcoming)).toEqual([
      ["Camille Moreau", "Lunchtime Mobility (Class); Evening Talk (Event)", "none"],
      ["Julien Moreau", "Lunchtime Mobility (Class); Drift (Boat)", "none"],
      ["Dev Rao", "Beaver (Boat); Evening Talk (Event)", "none"],
      ["Yuki Nakamura", "Dock slip C (Dock)", "new"], // joined this month
      ["Priya Rao", "Evening Talk (Event)", "none"], // under way on a boat now, and in both lists
    ]);
  });

  it("leaves out everyone whose reservation is over: Alex Brooks, Kenji Tanaka and Yuki Nakamura's morning room are in neither list", async () => {
    const store = await sampleAt(() => NOW);
    const v = todayAtTheClub(await store.read(), NOW, TODAY_RULES, ATTENDANCE_RULES);
    const listed = [...v.here, ...v.upcoming].map((r) => r.name);
    expect(listed).not.toContain("Alex Brooks");
    expect(listed).not.toContain("Kenji Tanaka");
    // Yuki is listed once, for the afternoon, and not for the morning room that is over.
    expect(v.upcoming.find((r) => r.name === "Yuki Nakamura")!.what).toEqual([{ title: "Dock slip C", category: "Dock" }]);
    expect(v.here.map((r) => r.name)).not.toContain("Yuki Nakamura");
  });

  it("has an empty 'here now' while people are still to come, and nobody in either list once the day is over", async () => {
    let clock = NOW;
    const store = await sampleAt(() => clock);
    const lists = async (t: Date) => {
      clock = t;
      const v = todayAtTheClub(await store.read(), t, TODAY_RULES, ATTENDANCE_RULES);
      return [v.here.map((r) => r.name), v.upcoming.map((r) => r.name)];
    };
    expect(await lists(at(14, 30))).toEqual([[], ["Julien Moreau", "Yuki Nakamura", "Camille Moreau", "Dev Rao", "Priya Rao"]]);
    expect(await lists(at(15, 30))).toEqual([["Julien Moreau", "Yuki Nakamura"], ["Camille Moreau", "Dev Rao", "Priya Rao"]]);
    expect(await lists(at(18))).toEqual([["Camille Moreau", "Dev Rao", "Priya Rao"], []]);
    expect(await lists(at(21))).toEqual([[], []]);
  });

  it("flags only a couple of the people on the page, so a note still means something", async () => {
    const store = await sampleAt(() => NOW);
    const v = todayAtTheClub(await store.read(), NOW, TODAY_RULES, ATTENDANCE_RULES);
    const flagged = [...v.here, ...v.upcoming].filter((r) => r.hello);
    expect(flagged.map((r) => [r.name, r.hello!.words])).toEqual([
      ["Amara Okonkwo", "Say hello — first visit in a while"],
      ["Walter Pemberton", "Say hello — first visit in a while"],
      ["Yuki Nakamura", "New member — say hello"],
    ]);
  });

  it("loads at any time of day: the people checked in and the visit history do not depend on what time it is now", async () => {
    for (const clock of [at(3), at(13), at(23, 30)]) {
      const store = await sampleAt(() => clock);
      const v = todayAtTheClub(await store.read(), NOW, TODAY_RULES, ATTENDANCE_RULES);
      expect(v.summary.total, clock.toISOString()).toBe(20);
    }
  });
});
