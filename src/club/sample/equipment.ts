import { createBooking, takeOutOfService } from "../engine/bookings";
import { fullName } from "../engine/queries";
import { RULE_BOOK } from "../settings/rulebook";
import type { MemoryClubStore } from "../store/memory";
import { addDays, pacificDate, pacificWall } from "../time";
import type { Item, RuleValues } from "../types";
import { SAMPLE_STAFF } from "./club";

/**
 * Invented boats and spaces. Shell names are the ones already used in the dashboard's sample data
 * (src/lib/shells.ts); the rest are made up. Nothing here is real club equipment.
 */
interface SampleItem {
  name: string;
  classCode: string;
  ruleOverrides?: Partial<RuleValues>;
}

export const SAMPLE_ITEMS: SampleItem[] = [
  { name: "Heron", classCode: "shell-single" },
  { name: "Osprey", classCode: "shell-single" },
  { name: "Kingfisher", classCode: "shell-single" },
  { name: "Cormorant", classCode: "shell-single" },
  { name: "Merganser", classCode: "shell-single" },
  { name: "Grebe", classCode: "shell-single" },
  { name: "Loon", classCode: "shell-double" },
  { name: "Pelican", classCode: "shell-double" },
  // One item with its own rule, to show an item can override its class: this double is limited to 90 minutes.
  { name: "Tern", classCode: "shell-double", ruleOverrides: { maxMinutes: 90 } },
  { name: "Albatross", classCode: "shell-quad" },
  { name: "Otter", classCode: "kayak" },
  { name: "Mink", classCode: "kayak" },
  { name: "Beaver", classCode: "kayak" },
  { name: "Skimmer", classCode: "paddle-board" },
  { name: "Drift", classCode: "paddle-board" },
  { name: "Dock slip A", classCode: "dock-space" },
  { name: "Dock slip B", classCode: "dock-space" },
  { name: "Dock slip C", classCode: "dock-space" },
];

/**
 * Adds the sample boats, a few bookings in the days ahead, and one boat out of service, through the same
 * engine real changes use. `now` is a parameter so tests are exact. The household sample must be seeded first.
 */
export async function seedSampleEquipment(store: MemoryClubStore, now: Date): Promise<void> {
  await store.transaction(async (s, newId) => {
    for (const i of SAMPLE_ITEMS) {
      const item: Item = { id: newId(), name: i.name, classCode: i.classCode, ruleOverrides: i.ruleOverrides ?? {} };
      s.items.push(item);
    }
  });

  const state = await store.read();
  const member = (name: string) => {
    const m = state.members.find((x) => fullName(x) === name);
    if (!m) throw new Error(`Sample member ${name} is missing.`);
    return m.id;
  };
  const item = (name: string) => state.items.find((i) => i.name === name)!.id;
  const today = pacificDate(now);
  const ctx = { actor: SAMPLE_STAFF, now };
  const at = (daysAhead: number, hour: number) => pacificWall(addDays(today, daysAhead), hour * 60);
  const book = (name: string, booker: string, daysAhead: number, hour: number, hours: number, crew: string[] = []) =>
    createBooking(store, RULE_BOOK, ctx, { itemId: item(name), bookerId: member(booker), startsAt: at(daysAhead, hour), endsAt: at(daysAhead, hour + hours), crewIds: crew.map(member) });

  await book("Heron", "Sasha Bellweather", 1, 7, 1);
  await book("Loon", "Erik Lindqvist", 1, 6, 1, ["Maren Lindqvist"]);
  await book("Osprey", "Tomas Vandermeer", 2, 8, 1);
  await book("Dock slip A", "Walter Pemberton", 1, 7, 2);

  // Merganser is being repaired, from now until staff return it.
  await takeOutOfService(store, ctx, item("Merganser"), { reason: "Rigger being repaired", expectedReturn: addDays(today, 5) });
}
