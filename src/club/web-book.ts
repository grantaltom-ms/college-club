import { classOf } from "@/club/settings/rulebook";
import { pacificDate } from "@/club/time";
import type { BookingType, ClubState, Item, RuleBook } from "@/club/types";

/**
 * What the Book screen offers first. Order is by how often members use them (Grant, Nov 2): gym, shells, rooms, then
 * paddle craft together, then dock only in warm months. Work space stays at the end.
 */
export type BookBrowse =
  | { id: "gym"; label: "Gym"; types: readonly ["Gym Space"] }
  | { id: "shell"; label: "Shells"; types: readonly ["Shell"]; kinds: true }
  | { id: "room"; label: "Rooms"; types: readonly ["Room Space"] }
  | { id: "paddle"; label: "Kayaks & boards"; types: readonly ["Kayak", "Paddle Board"] }
  | { id: "dock"; label: "Dock"; types: readonly ["Dock Space"]; seasonal: true }
  | { id: "work"; label: "Work space"; types: readonly ["Work Space"] };

export const BOOK_BROWSE: readonly BookBrowse[] = [
  { id: "gym", label: "Gym", types: ["Gym Space"] },
  { id: "shell", label: "Shells", types: ["Shell"], kinds: true },
  { id: "room", label: "Rooms", types: ["Room Space"] },
  { id: "paddle", label: "Kayaks & boards", types: ["Kayak", "Paddle Board"] },
  { id: "dock", label: "Dock", types: ["Dock Space"], seasonal: true },
  { id: "work", label: "Work space", types: ["Work Space"] },
];

/** Shell seat choices after someone picks Shells. Labels are the usual rowing shorthand: "4x/+" covers quads and fours, "8+" is an eight with a cox (Grant, Nov 10). */
export const SHELL_KINDS = [
  { id: "single", label: "1x", seats: 1, hint: "Single" },
  { id: "double", label: "2x", seats: 2, hint: "Double" },
  { id: "quad", label: "4x/+", seats: 4, hint: "Quad or four" },
  { id: "eight", label: "8+", seats: 8, hint: "Eight" },
] as const;

export type ShellKindId = (typeof SHELL_KINDS)[number]["id"];

/** Dock slips are a warm-weather thing on Lake Union: May through September, Pacific calendar. */
export function dockSeasonOpen(now: Date): boolean {
  const month = Number(pacificDate(now).slice(5, 7));
  return month >= 5 && month <= 9;
}

export function browseById(id: string | null | undefined): BookBrowse | null {
  return BOOK_BROWSE.find((b) => b.id === id) ?? null;
}

export function shellKindById(id: string | null | undefined): (typeof SHELL_KINDS)[number] | null {
  return SHELL_KINDS.find((k) => k.id === id) ?? null;
}

/** Which browse tiles to show for the inventory this person can see, honouring dock season. */
export function visibleBrowse(state: ClubState, book: RuleBook, now: Date, visibleItem: (item: Item) => boolean): BookBrowse[] {
  const present = new Set(state.items.filter(visibleItem).map((i) => classOf(book, i).type));
  return BOOK_BROWSE.filter((b) => {
    if ("seasonal" in b && b.seasonal && !dockSeasonOpen(now)) return false;
    return b.types.some((t) => present.has(t));
  });
}

/** Map a legacy ?type= URL onto a browse id so old links and tests keep working. */
export function browseFromType(type: BookingType | null): BookBrowse | null {
  if (!type) return null;
  if (type === "Kayak" || type === "Paddle Board") return browseById("paddle");
  return BOOK_BROWSE.find((b) => (b.types as readonly string[]).includes(type)) ?? null;
}

export function itemMatchesBrowse(book: RuleBook, item: Item, browse: BookBrowse, kind: (typeof SHELL_KINDS)[number] | null): boolean {
  const cls = classOf(book, item);
  if (!(browse.types as readonly string[]).includes(cls.type)) return false;
  // Seat filter when the person picked 1x / 2x / 4x / 8x. Without a size, the Book page shows the size strip first.
  if ("kinds" in browse && browse.kinds && kind) return cls.seats === kind.seats;
  return true;
}
