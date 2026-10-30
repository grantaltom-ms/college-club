import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullName } from "@/club/engine/queries";
import { buildSampleStore } from "@/club/sample/club";
import type { ClubStore } from "@/club/store/memory";
import type { ClubState } from "@/club/types";

/**
 * The practice buttons, called directly with who is signed in, whether the member area is on, and the club's records replaced by
 * the invented sample (a coach, Kenji Tanaka, who runs "Sunday technique session" eleven days from today (Sunday Nov 8), 7 to 9 am, with
 * Albatross, Pelican and Kingfisher reserved, six people seated, and Sasha Bellweather's earlier booking on Kingfisher flagged).
 * Anybody signed in may press them; the engine decides who may change what, and answers in its own words.
 */
const NOW = new Date("2026-10-28T20:00:00Z");
const h = vi.hoisted(() => ({ enabled: true, actor: null as unknown, store: null as unknown, now: null as unknown }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("@/club/enabled", () => ({ clubEnabled: () => h.enabled }));
vi.mock("@/club/clock", () => ({ clubNow: () => h.now }));
vi.mock("@/club/identity", () => ({
  getCurrentActor: async () => h.actor,
  toEngineActor: (a: { kind: string; label: string; member?: { id: string } }) => (a.kind === "member" ? { kind: "member", memberId: a.member!.id, label: a.label } : { kind: a.kind, label: a.label }),
}));
vi.mock("@/club/store/instance", () => ({ getClubStore: async () => h.store }));

import { addBoatToPractice, cancelThePractice, seatPerson, setUpPractice, takeBoatOffPractice, takeOutOfSeat } from "./actions";

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) data.append(k, x);
  return data;
};
const state = (): Promise<ClubState> => (h.store as ClubStore).read();
const staff = () => {
  h.actor = { kind: "staff", label: "Alex Staffer", source: "login" };
};
const memberNamed = async (name: string) => (await state()).members.find((m) => fullName(m) === name)!;
const signInAs = async (name: string) => {
  const m = await memberNamed(name);
  h.actor = { kind: "member", label: name, member: m, source: "login" };
};
const sampleItem = async (name: string) => (await state()).items.find((i) => i.name === name)!.id;
const samplePractice = async () => (await state()).practices.find((p) => p.name === "Sunday technique session")!;
const records = async () => {
  const s = await state();
  return JSON.stringify([s.practices, s.practiceBoats, s.practiceSeats, s.members.filter((m) => m.isCoach), s.history]);
};
/** What a redirect thrown by the action says. */
const redirectedTo = async (attempt: Promise<unknown>) => {
  try {
    await attempt;
    return null;
  } catch (e) {
    const m = /^NEXT_REDIRECT (.*)$/.exec((e as Error).message);
    if (!m) throw e;
    return m[1];
  }
};

beforeEach(async () => {
  h.enabled = true;
  h.actor = null;
  h.now = NOW;
  h.store = await buildSampleStore("2026-10-28", NOW);
});

describe("the practice buttons: who may press them", () => {
  it("answer 'not found' when the member area is off or nobody is signed in, and change nothing", async () => {
    const p = await samplePractice();
    const fields = form({ practice: p.id, boat: await sampleItem("Heron"), member: (await memberNamed("Priya Rao")).id, place: `${await sampleItem("Albatross")}:1`, seat: "1", day: "2026-11-05", start: "07:00", end: "09:00", name: "X" });
    const actions = [setUpPractice, addBoatToPractice, takeBoatOffPractice, seatPerson, takeOutOfSeat, cancelThePractice];
    const before = await records();
    for (const [label, setup] of [
      ["area off", () => { staff(); h.enabled = false; }],
      ["nobody", () => { h.enabled = true; h.actor = null; }],
    ] as [string, () => void][]) {
      setup();
      for (const action of actions) await expect(action(fields), `${label} ${action.name}`).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(await records()).toBe(before);
  });

  it("refuse an ordinary member in the engine's words, and a coach who does not run the practice, and change nothing", async () => {
    const p = await samplePractice();
    const priya = await memberNamed("Priya Rao");
    const fields = form({ practice: p.id, boat: await sampleItem("Heron"), member: priya.id, place: `${await sampleItem("Albatross")}:1`, seat: "1", day: "2026-11-05", start: "07:00", end: "09:00", name: "X" });
    const before = await records();
    await signInAs("Hollis Whitcombe");
    expect(await setUpPractice(fields)).toEqual({ kind: "error", message: "Only a coach or club staff can set up a practice." });
    for (const action of [addBoatToPractice, takeBoatOffPractice, seatPerson, takeOutOfSeat, cancelThePractice]) {
      expect(await action(fields), action.name).toEqual({ kind: "error", message: "Only a coach or club staff can change a practice." });
    }
    expect(await records()).toBe(before);
  });
});

describe("setting a practice up", () => {
  it("staff set one up, and the page goes to it", async () => {
    staff();
    const heron = await sampleItem("Heron");
    const osprey = await sampleItem("Osprey");
    const to = await redirectedTo(setUpPractice(form({ name: "  Friday   row ", notes: "Bring water.", day: "2026-11-06", start: "06:30", end: "08:00", coach: "", boat: [heron, osprey] })));
    const s = await state();
    const made = s.practices.find((p) => p.name === "Friday row")!;
    expect(to).toBe(`/club/practices/${made.id}?made=1`);
    expect(made).toMatchObject({ notes: "Bring water.", coachId: null, startsAt: new Date("2026-11-06T14:30:00Z").toISOString(), endsAt: new Date("2026-11-06T16:00:00Z").toISOString() });
    expect(s.practiceBoats.filter((b) => b.practiceId === made.id).map((b) => b.itemId).sort()).toEqual([heron, osprey].sort());
  });

  it("staff can name a coach, and a coach sets one up and runs it", async () => {
    staff();
    const kenji = await memberNamed("Kenji Tanaka");
    await redirectedTo(setUpPractice(form({ name: "Named", day: "2026-11-06", start: "06:30", end: "08:00", coach: kenji.id, boat: await sampleItem("Heron") })));
    expect((await state()).practices.find((p) => p.name === "Named")!.coachId).toBe(kenji.id);
    await signInAs("Kenji Tanaka");
    await redirectedTo(setUpPractice(form({ name: "Mine", day: "2026-11-07", start: "06:30", end: "08:00", boat: await sampleItem("Osprey") })));
    expect((await state()).practices.find((p) => p.name === "Mine")!).toMatchObject({ coachId: kenji.id, createdBy: { kind: "member", memberId: kenji.id } });
  });

  it("asks for the day and the times before anything else, and saves nothing", async () => {
    staff();
    const before = await records();
    for (const day of ["", "2026-13-01", "2026-02-30", "tomorrow", "11/06/2026"]) {
      expect(await setUpPractice(form({ name: "X", day, start: "06:30", end: "08:00" })), day).toEqual({ kind: "error", message: "Choose the date of the practice." });
    }
    for (const [start, end] of [["", "08:00"], ["06:30", ""], ["6.30", "08:00"], ["06:70", "08:00"], ["25:00", "26:00"]]) {
      expect(await setUpPractice(form({ name: "X", day: "2026-11-06", start, end })), `${start}-${end}`).toEqual({ kind: "error", message: "Choose a start time and an end time." });
    }
    expect(await records()).toBe(before);
  });

  it("reports every reason the engine gives, in one message, and saves nothing", async () => {
    staff();
    const before = await records();
    const result = await setUpPractice(form({ name: " ", day: "2026-10-01", start: "06:30", end: "08:00", boat: [await sampleItem("Dock slip A"), await sampleItem("Wren")] }));
    expect(result).toEqual({
      kind: "error",
      message: "Give the practice a name. That practice starts in the past. Choose a later time. Dock slip A is not a boat, so it cannot go on a practice. Wren is a private boat. Its owners decide who uses it, so it cannot go on a practice.",
    });
    expect(await records()).toBe(before);
  });

  it("says when a boat is already reserved by another practice", async () => {
    staff();
    const result = await setUpPractice(form({ name: "Clash", day: "2026-11-08", start: "07:00", end: "09:00", boat: await sampleItem("Albatross") }));
    expect(result).toEqual({ kind: "error", message: "Albatross is already reserved for Sunday technique session from 7:00 to 9:00 am." });
  });
});

describe("changing a practice", () => {
  it("adds a boat, and reminds staff of the booking the sample practice already overlaps", async () => {
    staff();
    const p = await samplePractice();
    expect(await addBoatToPractice(form({ practice: p.id, boat: await sampleItem("Heron") }))).toEqual({
      kind: "ok",
      message: "The boat is on the practice. 1 booking already made on the practice's boats overlaps it; nothing was cancelled, and the practice page lists who to talk to.",
    });
    expect((await state()).practiceBoats.filter((b) => b.practiceId === p.id && b.endedAt === null)).toHaveLength(4);
  });

  it("says how many bookings already made on a boat it adds overlap the practice, without cancelling them", async () => {
    staff();
    // Sasha Bellweather has Heron booked tomorrow 7 to 8 am in the sample club.
    await redirectedTo(setUpPractice(form({ name: "Early", day: "2026-10-29", start: "07:00", end: "08:00", boat: await sampleItem("Osprey") })));
    const early = (await state()).practices.find((p) => p.name === "Early")!;
    const result = await addBoatToPractice(form({ practice: early.id, boat: await sampleItem("Heron") }));
    expect(result).toEqual({ kind: "ok", message: "The boat is on the practice. 1 booking already made on the practice's boats overlaps it; nothing was cancelled, and the practice page lists who to talk to." });
    expect((await state()).bookings.find((b) => b.bookerId === (h.actor as { member?: { id: string } }).member?.id) ?? null).toBeNull();
    expect((await state()).bookings.filter((b) => b.status === "cancelled")).toEqual([]);
  });

  it("asks which boat, refuses a boat already on it, and says why in words", async () => {
    staff();
    const p = await samplePractice();
    expect(await addBoatToPractice(form({ practice: p.id, boat: "" }))).toEqual({ kind: "error", message: "Choose a boat to add." });
    expect(await addBoatToPractice(form({ practice: "", boat: await sampleItem("Heron") }))).toEqual({ kind: "error", message: "Choose the practice." });
    expect(await addBoatToPractice(form({ practice: p.id, boat: await sampleItem("Albatross") }))).toEqual({ kind: "error", message: "Albatross is already on this practice." });
  });

  it("takes a boat off and says how many people were taken out of their seat", async () => {
    staff();
    const p = await samplePractice();
    expect(await takeBoatOffPractice(form({ practice: p.id, boat: await sampleItem("Albatross") }))).toEqual({ kind: "ok", message: "The boat is off the practice, and 4 people were taken out of their seat." });
    expect(await takeBoatOffPractice(form({ practice: p.id, boat: await sampleItem("Kingfisher") }))).toEqual({ kind: "ok", message: "The boat is off the practice." });
    expect(await takeBoatOffPractice(form({ practice: p.id, boat: await sampleItem("Kingfisher") }))).toEqual({ kind: "error", message: "That boat is not on this practice." });
    expect(await takeBoatOffPractice(form({ practice: p.id }))).toEqual({ kind: "error", message: "Choose the practice and the boat." });
  });

  it("the coach who runs it seats and unseats people", async () => {
    await signInAs("Kenji Tanaka");
    const p = await samplePractice();
    const kingfisher = await sampleItem("Kingfisher");
    const dee = await memberNamed("Priya Rao");
    expect(await seatPerson(form({ practice: p.id, member: dee.id, place: `${kingfisher}:1`, side: "port" }))).toEqual({ kind: "ok", message: "They are in the seat." });
    const seat = (await state()).practiceSeats.find((x) => x.memberId === dee.id)!;
    expect(seat).toMatchObject({ itemId: kingfisher, seat: 1, side: "port", addedBy: { kind: "member", label: "Kenji Tanaka" } });
    expect(await takeOutOfSeat(form({ practice: p.id, boat: kingfisher, seat: "1", reason: "Sick" }))).toEqual({ kind: "ok", message: "The seat is empty." });
    expect((await state()).practiceSeats.find((x) => x.id === seat.id)!.endedReason).toBe("Taken out by Kenji Tanaka: Sick");
    expect(await takeOutOfSeat(form({ practice: p.id, boat: kingfisher, seat: "1" }))).toEqual({ kind: "error", message: "Nobody is in that seat." });
  });

  it("refuses a seat in words: taken, not a real seat, someone in two places, a side that is not a side", async () => {
    staff();
    const p = await samplePractice();
    const albatross = await sampleItem("Albatross");
    const kingfisher = await sampleItem("Kingfisher");
    const priya = await memberNamed("Priya Rao");
    expect(await seatPerson(form({ practice: p.id, member: priya.id, place: `${albatross}:1` }))).toEqual({ kind: "error", message: "Seat 1 in Albatross is already taken by Erik Lindqvist." });
    expect(await seatPerson(form({ practice: p.id, member: priya.id, place: `${kingfisher}:2` }))).toEqual({ kind: "error", message: "Kingfisher has 1 seat, so there is no seat 2." });
    const erik = await memberNamed("Erik Lindqvist");
    expect(await seatPerson(form({ practice: p.id, member: erik.id, place: `${kingfisher}:1` }))).toEqual({ kind: "error", message: "Erik Lindqvist is already in this practice: Albatross, seat 1. Take them out of that seat first." });
    expect(await seatPerson(form({ practice: p.id, member: priya.id, place: `${kingfisher}:1`, side: "left" }))).toEqual({ kind: "error", message: "Choose port, starboard or no side." });
    expect(await seatPerson(form({ practice: p.id, member: priya.id, place: "nonsense" }))).toEqual({ kind: "error", message: "Choose a seat." });
    expect(await seatPerson(form({ practice: p.id, member: priya.id, place: `${kingfisher}:x` }))).toEqual({ kind: "error", message: "Choose a seat." });
    expect(await seatPerson(form({ practice: p.id, member: "", place: `${kingfisher}:1` }))).toEqual({ kind: "error", message: "Choose the practice and the person." });
    expect(await takeOutOfSeat(form({ practice: p.id, boat: albatross, seat: "one" }))).toEqual({ kind: "error", message: "Choose the practice and the seat." });
  });

  it("cancels a practice, says its boats can be booked again, and refuses a second time", async () => {
    staff();
    const p = await samplePractice();
    expect(await cancelThePractice(form({ practice: p.id, reason: " Too   windy " }))).toEqual({ kind: "ok", message: "The practice is cancelled. Its boats can be booked again." });
    expect((await samplePractice()).cancelReason).toBe("Too windy");
    expect(await cancelThePractice(form({ practice: p.id }))).toEqual({ kind: "error", message: "That practice is already cancelled." });
    expect(await cancelThePractice(form({ practice: "" }))).toEqual({ kind: "error", message: "Choose the practice." });
  });

  it("passes on a failure that is not a refusal instead of hiding it", async () => {
    staff();
    h.store = {
      read: async () => {
        throw new Error("The database is down.");
      },
      transaction: async () => {
        throw new Error("The database is down.");
      },
    };
    await expect(cancelThePractice(form({ practice: "x" }))).rejects.toThrow("The database is down.");
  });
});
