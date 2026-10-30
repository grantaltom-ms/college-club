import { createBooking, takeOutOfService } from "../engine/bookings";
import { fullName } from "../engine/queries";
import { RULE_BOOK } from "../settings/rulebook";
import type { ClubStore } from "../store/memory";
import { addDays, pacificDate, pacificWall } from "../time";
import type { BoatAccess, Item, RuleValues } from "../types";
import { SAMPLE_STAFF } from "./club";

/**
 * Invented boats and spaces. Shell names are the ones already used in the dashboard's sample data
 * (src/lib/shells.ts); the rest are made up. Nothing here is real club equipment.
 */
interface SampleItem {
  name: string;
  classCode: string;
  ruleOverrides?: Partial<RuleValues>;
  /** A privately owned boat, with the members who own it and the members an owner has invited (by full name). No owners: locked. */
  private?: { owners: string[]; invited: string[] };
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
  // The two spaces fitness classes use. Members can book them too, when no class is in them.
  { name: "Boathouse gym", classCode: "gym-space" },
  { name: "Clubhouse room", classCode: "room-space" },
  // Private boats. Only their owners and the people an owner has invited can see or book them, and their skill level is not checked
  // (Ines Castellanos holds no qualification and can still use Starling). Wren has no owner, so it is locked until staff add one.
  { name: "Kestrel", classCode: "shell-single", private: { owners: ["Nora Abernathy"], invited: ["Tomas Vandermeer"] } },
  { name: "Starling", classCode: "shell-double", private: { owners: ["Erik Lindqvist"], invited: ["Ines Castellanos"] } },
  { name: "Wren", classCode: "shell-single", private: { owners: [], invited: [] } },
];

/**
 * Adds the sample boats, a few bookings in the days ahead, and one boat out of service, through the same
 * engine real changes use. `now` is a parameter so tests are exact. The household sample must be seeded first.
 */
export async function seedSampleEquipment(store: ClubStore, now: Date): Promise<void> {
  await store.transaction(async (s, newId) => {
    const memberId = (name: string) => {
      const m = s.members.find((x) => fullName(x) === name);
      if (!m) throw new Error(`Sample member ${name} is missing.`);
      return m.id;
    };
    for (const i of SAMPLE_ITEMS) {
      const item: Item = { id: newId(), name: i.name, classCode: i.classCode, ruleOverrides: i.ruleOverrides ?? {} };
      if (i.private) item.isPrivate = true;
      s.items.push(item);
      const line = (name: string, kind: BoatAccess["kind"]): BoatAccess => ({ id: newId(), itemId: item.id, memberId: memberId(name), kind, addedAt: now.toISOString(), addedBy: SAMPLE_STAFF, endedAt: null, endedBy: null, endedReason: null });
      for (const name of i.private?.owners ?? []) s.boatAccess.push(line(name, "owner"));
      for (const name of i.private?.invited ?? []) s.boatAccess.push(line(name, "invited"));
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

  // Today, for the staff check-in screens. They were booked yesterday so that the engine accepts them, whatever "now" is.
  // Alex Brooks's and Kenji Tanaka's singles ended this morning with nobody checked in, so they show up as automatic no-shows to look at.
  // Priya Rao's kayak is under way, Dev Rao's opens for check-in before it starts, and Julien Moreau's is not open yet.
  // They use members and boats the other sample bookings and the browser tests do not.
  const yesterday = { actor: SAMPLE_STAFF, now: pacificWall(addDays(today, -1), 12 * 60) };
  const bookToday = (name: string, booker: string, hour: number, minute: number, minutes: number) =>
    createBooking(store, RULE_BOOK, yesterday, {
      itemId: item(name),
      bookerId: member(booker),
      startsAt: pacificWall(today, hour * 60 + minute),
      endsAt: pacificWall(today, hour * 60 + minute + minutes),
      crewIds: [],
    });
  await bookToday("Cormorant", "Alex Brooks", 7, 0, 60);
  await bookToday("Grebe", "Kenji Tanaka", 8, 0, 60);
  await bookToday("Mink", "Priya Rao", 12, 0, 120);
  await bookToday("Beaver", "Dev Rao", 13, 30, 60);
  await bookToday("Drift", "Julien Moreau", 15, 0, 60);
  // The club room needs no check-in, so this one that is over this morning is simply finished, never a no-show.
  await bookToday("Clubhouse room", "Yuki Nakamura", 9, 0, 60);

  // For members checking themselves in (the front-desk iPad and their own phone), all open for check-in at 1 pm. Amara Okonkwo
  // is the iPad's single-boat example and Chidi Okonkwo the phone's. Walter Pemberton's club room is under way but needs no
  // check-in, so he must never appear on the iPad or be offered a button. They use people and boats the other tests do not.
  await bookToday("Otter", "Amara Okonkwo", 12, 30, 60);
  await bookToday("Skimmer", "Chidi Okonkwo", 12, 0, 90);
  await bookToday("Clubhouse room", "Walter Pemberton", 12, 30, 60);

  // Merganser is being repaired, from now until staff return it.
  await takeOutOfService(store, ctx, item("Merganser"), { reason: "Rigger being repaired", expectedReturn: addDays(today, 5) });
}
