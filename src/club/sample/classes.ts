import { createClass, scheduleSessions, signUp } from "../engine/classes";
import { fullName } from "../engine/queries";
import { CLASS_RULES } from "../settings/class-rules";
import { RULE_BOOK } from "../settings/rulebook";
import type { ClubStore } from "../store/memory";
import { addDays, pacificDate, pacificWall } from "../time";
import { SAMPLE_STAFF } from "./club";

/**
 * Invented fitness classes: three kinds, a fortnight of sessions, and one Erg session that is full with a waiting list.
 * Instructors are made up. Nothing here is a real class or a real person.
 */
export async function seedSampleClasses(store: ClubStore, now: Date): Promise<void> {
  const staff = { actor: SAMPLE_STAFF, now };
  const state = await store.read();
  const room = (name: string) => state.items.find((i) => i.name === name)!.id;
  const member = (name: string) => {
    const m = state.members.find((x) => fullName(x) === name);
    if (!m) throw new Error(`Sample member ${name} is missing.`);
    return m.id;
  };
  const today = pacificDate(now);
  const at = (daysAhead: number, hour: number, minute = 0) => pacificWall(addDays(today, daysAhead), hour * 60 + minute);

  const yoga = await createClass(store, RULE_BOOK, CLASS_RULES, staff, {
    name: "Morning Yoga",
    description: "A gentle start to the day. Mats are provided.",
    instructor: "Mira Sandoval",
    defaultCapacity: 12,
    defaultMinutes: 60,
    roomItemId: room("Clubhouse room"),
  });
  const erg = await createClass(store, RULE_BOOK, CLASS_RULES, staff, {
    name: "Erg Conditioning",
    description: "Indoor rowing machine intervals for all levels.",
    instructor: "Theo Brandvold",
    defaultCapacity: 4,
    defaultMinutes: 45,
    roomItemId: room("Boathouse gym"),
  });
  const stretch = await createClass(store, RULE_BOOK, CLASS_RULES, staff, {
    name: "Stretch & Mobility",
    description: "Slow stretching for tired rowers.",
    instructor: "Mira Sandoval",
    defaultCapacity: 10,
    defaultMinutes: 30,
    roomItemId: room("Clubhouse room"),
  });

  await scheduleSessions(store, RULE_BOOK, staff, { classId: yoga.id, startsAt: at(2, 7), weeks: 2 });
  await scheduleSessions(store, RULE_BOOK, staff, { classId: stretch.id, startsAt: at(2, 12), weeks: 2 });
  const [full] = await scheduleSessions(store, RULE_BOOK, staff, { classId: erg.id, startsAt: at(1, 17), weeks: 2 });

  // Tomorrow's Erg Conditioning is full (4 chairs) with two people waiting, in this order.
  const join = (name: string, sessionId: string) => signUp(store, RULE_BOOK, CLASS_RULES, { actor: { kind: "staff", label: SAMPLE_STAFF.label }, now }, { sessionId, memberId: member(name) });
  for (const name of ["Erik Lindqvist", "Maren Lindqvist", "Jordan Bellweather", "Sasha Bellweather", "Tomas Vandermeer", "Nora Abernathy"]) await join(name, full.id);

  // A couple of people in the Yoga class too.
  const yogaSessions = (await store.read()).sessions.filter((x) => x.classId === yoga.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const name of ["Ines Castellanos", "Britta Eriksen"]) await join(name, yogaSessions[0].id);
}
