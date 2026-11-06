import type { EventsData, PromotedEvent } from "./types";

/** Events in date order, oldest first. Two on one day keep a steady order by name. */
export function sortEvents(events: PromotedEvent[]): PromotedEvent[] {
  return [...events].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** True for an event that has not happened yet, whose registrations are still "so far". */
export function isUpcoming(event: PromotedEvent): boolean {
  return event.status === "upcoming";
}

/**
 * How full the event is: persons (members plus guests) as a whole percentage of the capacity.
 * Null when there is no capacity (a percentage of nothing is not shown) or no persons count.
 * It can pass 100 when an event took more people than its capacity; that is shown as it is.
 */
export function capacityFilledPct(event: PromotedEvent): number | null {
  if (event.capacity === null || event.capacity <= 0 || event.rsvpPersons === null) return null;
  return Math.round((event.rsvpPersons / event.capacity) * 100);
}

/**
 * Made-up events for development and tests, clearly labelled sample.
 * These are invented figures, not the real club's: the real pilot rows are loaded from db/event_scoreboard.csv.
 * The three cover a paid event with a door comparison, a free event with no capacity set, and one still upcoming.
 */
export function sampleEvents(): EventsData {
  return {
    source: "sample",
    events: [
      {
        name: "Sample Trivia Night",
        date: "2024-03-07",
        priceLabel: "$10",
        capacity: 40,
        timesPromoted: 2,
        rsvpMembers: 12,
        rsvpPersons: 30,
        doorEntriesWindow: 28,
        doorComparison: "Sample baseline: two ordinary Thursdays had 20 and 22 entries in the same window",
        status: "held",
        note: "Sample note: invented numbers for testing",
      },
      {
        name: "Sample Open House",
        date: "2024-03-16",
        priceLabel: "Free",
        capacity: null,
        timesPromoted: 1,
        rsvpMembers: 9,
        rsvpPersons: 14,
        doorEntriesWindow: null,
        doorComparison: null,
        status: "held",
        note: null,
      },
      {
        name: "Sample Winter Tasting",
        date: "2024-03-28",
        priceLabel: "$15",
        capacity: 30,
        timesPromoted: 3,
        rsvpMembers: 11,
        rsvpPersons: 21,
        doorEntriesWindow: null,
        doorComparison: null,
        status: "upcoming",
        note: "Sample registrations so far",
      },
    ],
  };
}
