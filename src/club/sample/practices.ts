import { createBooking } from "../engine/bookings";
import { addPracticeBoat, createPractice, seatMember, setCoach } from "../engine/practices";
import { fullName } from "../engine/queries";
import { PRACTICE_RULES } from "../settings/practice-rules";
import { RULE_BOOK } from "../settings/rulebook";
import type { ClubStore } from "../store/memory";
import { addDays, pacificDate, pacificWall } from "../time";
import type { SeatSide } from "../types";
import { SAMPLE_STAFF } from "./club";

/**
 * One invented coach, and one invented practice eleven days from now (a Sunday, so it stays clear of the days the older booking tests use): a quad and a double with people seated, and a single left with
 * its seat empty. Sasha Bellweather had booked that single for the same hour before the practice was set up, so the sample shows how
 * an earlier booking is flagged (and not cancelled). Everyone is made up. Nothing here is real.
 */
export async function seedSamplePractices(store: ClubStore, now: Date): Promise<void> {
  const state = await store.read();
  const member = (name: string) => {
    const m = state.members.find((x) => fullName(x) === name);
    if (!m) throw new Error(`Sample member ${name} is missing.`);
    return m;
  };
  const item = (name: string) => {
    const i = state.items.find((x) => x.name === name);
    if (!i) throw new Error(`Sample item ${name} is missing.`);
    return i.id;
  };
  const staff = { actor: SAMPLE_STAFF, now };
  const today = pacificDate(now);
  const at = (daysAhead: number, hour: number) => pacificWall(addDays(today, daysAhead), hour * 60);

  // A booking made before the practice, on a boat the practice will then reserve.
  await createBooking(store, RULE_BOOK, { actor: { kind: "member", memberId: member("Sasha Bellweather").id, label: "Sasha Bellweather" }, now }, {
    itemId: item("Kingfisher"),
    bookerId: member("Sasha Bellweather").id,
    startsAt: at(11, 8),
    endsAt: at(11, 9),
  });

  const coach = member("Kenji Tanaka");
  await setCoach(store, staff, coach.id, true);
  const coachCtx = { actor: { kind: "member" as const, memberId: coach.id, label: fullName(coach) }, now };
  const { practice } = await createPractice(store, RULE_BOOK, PRACTICE_RULES, coachCtx, {
    name: "Morning technique session",
    notes: "Drills first, then two pieces. Bring a water bottle.",
    startsAt: at(11, 7),
    endsAt: at(11, 9),
    itemIds: [item("Albatross"), item("Pelican")],
  });
  await addPracticeBoat(store, RULE_BOOK, PRACTICE_RULES, coachCtx, practice.id, item("Kingfisher"));

  const seat = (boat: string, n: number, name: string, side: SeatSide | null) =>
    seatMember(store, RULE_BOOK, coachCtx, { practiceId: practice.id, itemId: item(boat), seat: n, side, memberId: member(name).id });
  await seat("Albatross", 1, "Erik Lindqvist", "port");
  await seat("Albatross", 2, "Maren Lindqvist", "starboard");
  await seat("Albatross", 3, "Hollis Whitcombe", "port");
  await seat("Albatross", 4, "Nora Abernathy", "starboard");
  await seat("Pelican", 1, "Tomas Vandermeer", null);
  await seat("Pelican", 2, "Alex Brooks", null);
}
