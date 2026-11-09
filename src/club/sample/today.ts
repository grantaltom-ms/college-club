import { recordAttendance } from "../engine/attendance";
import { createBooking } from "../engine/bookings";
import { createEvent, rsvp } from "../engine/events";
import { fullName } from "../engine/queries";
import { ATTENDANCE_RULES } from "../settings/attendance-rules";
import { EVENT_RULES } from "../settings/event-rules";
import { RULE_BOOK } from "../settings/rulebook";
import type { ClubStore } from "../store/memory";
import { addDays, pacificDate, pacificWall } from "../time";
import { SAMPLE_STAFF } from "./club";

/**
 * What the staff landing page, "Today at the Club", needs to show something real on the invented club: more people under way and
 * coming today, someone checked in, a new member, and enough visit history that most names carry no note and a couple do.
 * The other sample bookings (see equipment.ts and classes.ts) already give today a member under way, a few still to come and three
 * that are over. At 1 pm Pacific, on the frozen test clock, the page then reads:
 *
 * - Here now: Amara Okonkwo (kayak, never been in: "say hello"), Britta Eriksen (dock slip, and the Coffee Hour), Chidi Okonkwo
 *   (paddle board), Declan Halloran (weight room, checked in, and the Coffee Hour), Dev Rao (the Coffee Hour), Priya Rao (kayak)
 *   and Walter Pemberton (club room, one visit in the last 75 days: "say hello").
 * - Upcoming: Camille Moreau (class, then the Evening Talk), Julien Moreau (class and paddle board), Dev Rao (kayak, then the
 *   Evening Talk), Yuki Nakamura (dock slip), who joined this month: "new member, say hello", and Priya Rao (the Evening Talk).
 * - In neither list: Alex Brooks, Kenji Tanaka and Yuki Nakamura's morning booking, which are over.
 * - The Coffee Hour (12:30 to 2 pm, under way at 1 pm) and the Evening Talk (5:30 to 7 pm) are events: six RSVPs between them.
 *
 * Visit history is real bookings through the engine, made in advance and checked in by staff, the way a year of the club's own
 * records would be. Nothing here is a real person: every name is invented, like the rest of the sample club.
 */

/** Members given a short history, by name, and how many days ago each of their visits was. Everyone else on the page has none. */
const VISITS: [string, number[]][] = [
  ["Priya Rao", [4, 17, 41]],
  ["Chidi Okonkwo", [6, 20]],
  ["Dev Rao", [3, 12]],
  ["Camille Moreau", [5, 26]],
  ["Julien Moreau", [9, 31]],
  ["Declan Halloran", [8, 33]],
  ["Britta Eriksen", [10, 40]],
];

/**
 * Earlier visits are all on the Dock berths pool: it needs no qualification, so anyone can have had one, and no browser test looks up
 * a member's rows by that name (a visit on the boat a test searches for, such as Skimmer, would be a second row with the same words).
 */
const VISIT_ITEM = "Dock berths";

export async function seedSampleToday(store: ClubStore, now: Date): Promise<void> {
  const state = await store.read();
  const member = (name: string) => {
    const m = state.members.find((x) => fullName(x) === name);
    if (!m) throw new Error(`Sample member ${name} is missing.`);
    return m.id;
  };
  const item = (name: string) => {
    const i = state.items.find((x) => x.name === name);
    if (!i) throw new Error(`Sample item ${name} is missing.`);
    return i.id;
  };
  const today = pacificDate(now);
  const at = (daysAgo: number, minutes: number) => pacificWall(addDays(today, -daysAgo), minutes);

  // Earlier visits: a booking made the day before, then ticked off by staff ten minutes after it began. Each one has its own day
  // and hour, so none can clash with another or with a booking the browser tests make.
  let n = 0;
  for (const [who, days] of VISITS) {
    for (const daysAgo of days) {
      const hour = 6 + (n % 12);
      const start = at(daysAgo, hour * 60);
      const made = await createBooking(store, RULE_BOOK, { actor: SAMPLE_STAFF, now: at(daysAgo + 1, 12 * 60) }, {
        itemId: item(VISIT_ITEM),
        bookerId: member(who),
        startsAt: start,
        endsAt: at(daysAgo, hour * 60 + 60),
        crewIds: [],
      });
      await recordAttendance(store, { actor: SAMPLE_STAFF, now: new Date(start.getTime() + 10 * 60000) }, ATTENDANCE_RULES, { kind: "booking", id: made.booking.id, outcome: "attended" });
      n++;
    }
  }
  // Walter Pemberton has been in once in the last three months, 75 days ago.
  const walters = await createBooking(store, RULE_BOOK, { actor: SAMPLE_STAFF, now: at(76, 12 * 60) }, { itemId: item(VISIT_ITEM), bookerId: member("Walter Pemberton"), startsAt: at(75, 10 * 60), endsAt: at(75, 11 * 60), crewIds: [] });
  await recordAttendance(store, { actor: SAMPLE_STAFF, now: new Date(at(75, 10 * 60).getTime() + 10 * 60000) }, ATTENDANCE_RULES, { kind: "booking", id: walters.booking.id, outcome: "attended" });

  // Today. Booked yesterday, so the engine accepts them whatever time it is now.
  const yesterday = { actor: SAMPLE_STAFF, now: at(1, 12 * 60) };
  const bookToday = (name: string, who: string, from: number, to: number) =>
    createBooking(store, RULE_BOOK, yesterday, { itemId: item(name), bookerId: member(who), startsAt: at(0, from), endsAt: at(0, to), crewIds: [] });
  // Declan Halloran is in the weight room and has been checked in. Britta Eriksen is on a dock slip and has not. Staff do the check-in
  // (a correction works at any time of day, a member's own tap does not), so loading the sample never depends on what time it is now.
  const weights = await bookToday("Weight room", "Declan Halloran", 12 * 60, 13 * 60 + 30);
  await recordAttendance(store, { actor: SAMPLE_STAFF, now: at(0, 12 * 60 + 5) }, ATTENDANCE_RULES, { kind: "booking", id: weights.booking.id, outcome: "attended" });
  await bookToday("Dock slip B", "Britta Eriksen", 12 * 60, 13 * 60 + 30);
  // Yuki Nakamura joined this month and has a dock slip this afternoon.
  await bookToday("Dock slip C", "Yuki Nakamura", 15 * 60, 16 * 60);

  // Two events today. Made yesterday, since an event cannot be made after it has started. Guests are not members and are not listed.
  const makeEvent = (title: string, location: string, from: number, to: number) =>
    createEvent(store, { actor: SAMPLE_STAFF, now: yesterday.now }, { title, description: "", location, startsAt: at(0, from), endsAt: at(0, to), capacity: 30, priceCents: 0 });
  const coffee = await makeEvent("Coffee Hour", "The clubhouse deck", 12 * 60 + 30, 14 * 60);
  const talk = await makeEvent("Evening Talk", "The boathouse", 17 * 60 + 30, 19 * 60);
  const go = (eventId: string, who: string) => rsvp(store, EVENT_RULES, yesterday, { eventId, memberId: member(who), guests: who === "Declan Halloran" ? 1 : 0 });
  for (const who of ["Declan Halloran", "Britta Eriksen", "Dev Rao"]) await go(coffee.id, who);
  for (const who of ["Camille Moreau", "Dev Rao", "Priya Rao"]) await go(talk.id, who);
}
