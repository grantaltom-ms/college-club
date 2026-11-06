import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capacityFilledPct, isUpcoming, sampleEvents, sortEvents } from "./events";
import { parseSeedCsv, seedEventsData, seedRows, SEED_CSV_PATH, SEED_SQL_PATH } from "./events-seed.testkit";
import type { PromotedEvent } from "./types";

function event(over: Partial<PromotedEvent> = {}): PromotedEvent {
  return {
    name: "Test event",
    date: "2026-01-01",
    priceLabel: null,
    capacity: null,
    timesPromoted: null,
    rsvpMembers: null,
    rsvpPersons: null,
    doorEntriesWindow: null,
    doorComparison: null,
    status: "held",
    note: null,
    ...over,
  };
}

describe("capacity filled", () => {
  it("is persons over capacity as a whole percentage", () => {
    expect(capacityFilledPct(event({ capacity: 55, rsvpPersons: 43 }))).toBe(78); // 78.18
    expect(capacityFilledPct(event({ capacity: 55, rsvpPersons: 34 }))).toBe(62); // 61.8 rounds up
    expect(capacityFilledPct(event({ capacity: 30, rsvpPersons: 16 }))).toBe(53); // 53.3 rounds down
    expect(capacityFilledPct(event({ capacity: 10, rsvpPersons: 5 }))).toBe(50); // exact
    expect(capacityFilledPct(event({ capacity: 4, rsvpPersons: 0 }))).toBe(0);
  });

  it("rounds a half up, and shows an event that took more than its capacity as it is", () => {
    expect(capacityFilledPct(event({ capacity: 8, rsvpPersons: 1 }))).toBe(13); // 12.5
    expect(capacityFilledPct(event({ capacity: 20, rsvpPersons: 25 }))).toBe(125);
  });

  it("is not shown when there is no capacity, a capacity of nothing, or no persons count", () => {
    expect(capacityFilledPct(event({ capacity: null, rsvpPersons: 23 }))).toBeNull();
    expect(capacityFilledPct(event({ capacity: 0, rsvpPersons: 23 }))).toBeNull();
    expect(capacityFilledPct(event({ capacity: 55, rsvpPersons: null }))).toBeNull();
  });
});

describe("ordering and status", () => {
  it("sorts by date, oldest first, and does not change the list it was given", () => {
    const input = [event({ name: "C", date: "2026-11-12" }), event({ name: "A", date: "2026-09-10" }), event({ name: "B", date: "2026-10-24" })];
    const sorted = sortEvents(input);
    expect(sorted.map((e) => e.name)).toEqual(["A", "B", "C"]);
    expect(input.map((e) => e.name)).toEqual(["C", "A", "B"]);
  });

  it("puts two events on one day in name order, so the page never reshuffles", () => {
    const sorted = sortEvents([event({ name: "Zebra", date: "2026-10-10" }), event({ name: "Apple", date: "2026-10-10" })]);
    expect(sorted.map((e) => e.name)).toEqual(["Apple", "Zebra"]);
  });

  it("calls only an upcoming event upcoming", () => {
    expect(isUpcoming(event({ status: "upcoming" }))).toBe(true);
    expect(isUpcoming(event({ status: "held" }))).toBe(false);
  });
});

describe("sample events", () => {
  it("are clearly labelled sample, invented, and free of anything personal", () => {
    const sample = sampleEvents();
    expect(sample.source).toBe("sample");
    expect(sample.events.every((e) => e.name.startsWith("Sample "))).toBe(true);
    expect(JSON.stringify(sample)).not.toMatch(/@/);
  });

  it("cover a paid event with a door comparison, a free one with no capacity, and an upcoming one", () => {
    const { events } = sampleEvents();
    expect(events.some((e) => e.capacity !== null && e.doorEntriesWindow !== null && e.doorComparison !== null)).toBe(true);
    expect(events.some((e) => e.capacity === null)).toBe(true);
    expect(events.some((e) => e.status === "upcoming")).toBe(true);
    // No real pilot event leaks into the invented sample.
    const real = seedRows().map((r) => r.event_name);
    expect(events.some((e) => real.includes(e.name))).toBe(false);
  });
});

describe("the seed file Grant loads (db/event_scoreboard.csv)", () => {
  it("has exactly the columns of the table and no column that could hold a person", () => {
    const [header] = parseSeedCsv(readFileSync(SEED_CSV_PATH, "utf8"));
    expect(header).toEqual([
      "event_name",
      "event_date",
      "price_label",
      "capacity",
      "times_promoted",
      "rsvp_members",
      "rsvp_persons",
      "door_entries_window",
      "door_comparison",
      "status",
      "note",
    ]);
  });

  it("holds the eight pilot events of the handoff, with every figure as given", () => {
    const rows = seedRows();
    expect(
      rows.map((r) => [r.event_name, r.event_date, r.price_label, r.capacity, r.times_promoted, r.rsvp_members, r.rsvp_persons, r.door_entries_window, r.status]),
    ).toEqual([
      ["BINGO Night", "2026-09-10", "$20 buy-in", 55, 2, 16, 43, 36, "held"],
      ["Wine Tasting", "2026-09-24", "$26", 55, 4, 14, 34, 25, "held"],
      ["Boathouse Work Party", "2026-10-10", "Free", null, 1, 19, 23, null, "held"],
      ["Pumpkin Carving", "2026-10-24", "$12", 30, 2, 7, 16, null, "held"],
      ["Seahawks Watch Party (Oct 25 game)", "2026-10-25", "Free", 55, 1, 3, 7, null, "held"],
      ["Seahawks vs Cardinals Watch Party", "2026-11-08", "Free", 36, 1, 1, 2, null, "upcoming"],
      ["Whiskey Tasting", "2026-11-12", "$26", 55, 4, 18, 48, null, "upcoming"],
      ["International Comedy Competition (at WAC)", "2026-11-24", "Price TBA", 20, 1, 5, 13, null, "upcoming"],
    ]);
  });

  it("keeps the door comparison and the notes word for word (including the cells that hold commas)", () => {
    const byName = Object.fromEntries(seedRows().map((r) => [r.event_name, r]));
    const comparison = "Baseline Thursdays Sep 3 and Sep 17: 27 and 24 entries in the same 4-9 PM window";
    expect(byName["BINGO Night"].door_comparison).toBe(comparison);
    expect(byName["Wine Tasting"].door_comparison).toBe(comparison);
    expect(byName["BINGO Night"].note).toBe("Door entries agree with iCrew: busiest Thursday evening of the four checked");
    expect(byName["Wine Tasting"].note).toBe("No door lift despite 34 registered persons - attendees may already be inside, or one swipe admits a group");
    expect(byName["Boathouse Work Party"].note).toBe("The Oct 28 Watercooler reported 24 members attended - registrations ran at about 80% of turnout");
    expect(byName["Pumpkin Carving"].note).toBeNull();
    expect(byName["Seahawks Watch Party (Oct 25 game)"].note).toBe(
      "The Oct 28 Watercooler reused this event's RSVP link for the Nov 2 Bears game, whose iCrew page does not exist - that game had no working RSVP path",
    );
    expect(byName["Seahawks vs Cardinals Watch Party"].note).toBe("Registrations as of Nov 5, 2026");
    expect(byName["Whiskey Tasting"].note).toBe("Registrations as of Nov 5, 2026 - nearly full a week out");
    expect(byName["International Comedy Competition (at WAC)"].note).toBe(
      "Registrations as of Nov 5, 2026. Also save-the-dated in two earlier issues without a link; the Oct 28 issue printed the wrong date (November 4th)",
    );
    // Only the two September events have a door comparison.
    expect(seedRows().filter((r) => r.door_comparison !== null).map((r) => r.event_name)).toEqual(["BINGO Night", "Wine Tasting"]);
  });

  it("is loaded as a table row each, none repeated, so the (name, date) rule of the table will accept it", () => {
    const keys = seedRows().map((r) => `${r.event_name}|${r.event_date}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives the percentages the Board targets row quotes: 53 to 78 across the ticketed events held in September and October", () => {
    const { events } = seedEventsData();
    const paidHeld = events.filter((e) => e.status === "held" && e.priceLabel !== "Free" && e.capacity !== null);
    expect(paidHeld.map((e) => [e.name, capacityFilledPct(e)])).toEqual([
      ["BINGO Night", 78],
      ["Wine Tasting", 62],
      ["Pumpkin Carving", 53],
    ]);
    const pcts = paidHeld.map((e) => capacityFilledPct(e) as number);
    expect([Math.min(...pcts), Math.max(...pcts)]).toEqual([53, 78]);
  });

  it("supports the one-line summary under the table: paid tastings fill best, watch parties barely register", () => {
    const pct = (name: string) => capacityFilledPct(seedEventsData().events.find((e) => e.name === name) as PromotedEvent);
    const tastings = [pct("Wine Tasting"), pct("Whiskey Tasting")] as number[];
    const watchParties = [pct("Seahawks Watch Party (Oct 25 game)"), pct("Seahawks vs Cardinals Watch Party")] as number[];
    expect(Math.min(...tastings)).toBeGreaterThan(Math.max(...watchParties));
    expect(Math.max(...watchParties)).toBeLessThan(20);
  });

  it("has no capacity for the one event that set none, so its percentage is not shown", () => {
    const work = seedEventsData().events.find((e) => e.name === "Boathouse Work Party") as PromotedEvent;
    expect(work.capacity).toBeNull();
    expect(capacityFilledPct(work)).toBeNull();
  });
});

describe("the table definition (db/event_scoreboard.sql)", () => {
  const sql = readFileSync(SEED_SQL_PATH, "utf8");
  const code = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("turns row level security on and makes no policies, so only the server's service key can read it", () => {
    expect(code).toMatch(/alter table public\.event_scoreboard enable row level security;/);
    expect(code).not.toMatch(/create policy/i);
  });

  it("has the columns, the held-or-upcoming rule and the one-row-per-event rule", () => {
    expect(code).toMatch(/create table if not exists public\.event_scoreboard/);
    expect(code).toMatch(/id bigint generated always as identity primary key/);
    expect(code).toMatch(/event_name text not null/);
    expect(code).toMatch(/event_date date not null/);
    expect(code).toMatch(/status text not null default 'held' check \(status in \('held', 'upcoming'\)\)/);
    expect(code).toMatch(/unique \(event_name, event_date\)/);
    for (const column of ["price_label text", "capacity int", "times_promoted int", "rsvp_members int", "rsvp_persons int", "door_entries_window int", "door_comparison text", "note text"]) {
      expect(code).toContain(column);
    }
  });

  it("stores counts only: no column for a name, email, phone or person", () => {
    expect(code).not.toMatch(/\b(member_name|email|phone|first_name|last_name|person_name|attendee)\b/i);
  });
});
