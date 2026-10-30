import { HOLDING_STATUSES, type Booking, type ClubState, type Item } from "../types";

/**
 * Pools. A dock, the club room or the gym is one item with a number of places. The club counts how many are taken; it never says
 * which place a member has. A boat is a pool of one, and keeps being checked the old way (one booking at a time).
 *
 * The building comparison: a parking lot with 60 spaces. All that matters is that the lot is never over-full at any moment.
 */

/** How many people can hold this item at once. One for every boat. */
export const placesOf = (item: Item): number => item.places ?? 1;

/** More than one place: the club counts places instead of checking one booking at a time. */
export const isPool = (item: Item): boolean => placesOf(item) > 1;

/** The bookings that take a place of this item at some moment inside [start, end). */
export function holdingIn(state: ClubState, itemId: string, start: number, end: number): Booking[] {
  return state.bookings.filter(
    (b) => b.itemId === itemId && HOLDING_STATUSES.includes(b.status) && Date.parse(b.startsAt) < end && start < Date.parse(b.endsAt),
  );
}

/** One stretch of time in which the same number of places is taken. */
export interface UseSegment {
  from: number;
  to: number;
  count: number;
}

/** How many places are taken, stretch by stretch, from `start` to `end`. Back to back bookings never count together. */
export function occupancy(state: ClubState, itemId: string, start: number, end: number): UseSegment[] {
  const holding = holdingIn(state, itemId, start, end).map((b) => ({ s: Date.parse(b.startsAt), e: Date.parse(b.endsAt) }));
  const cuts = new Set<number>([start, end]);
  for (const { s, e } of holding) {
    if (s > start && s < end) cuts.add(s);
    if (e > start && e < end) cuts.add(e);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: UseSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const at = points[i]!;
    segments.push({ from: at, to: points[i + 1]!, count: holding.filter(({ s, e }) => s <= at && at < e).length });
  }
  return segments;
}

/** The most places taken at any one moment between `start` and `end`. */
export function busiest(state: ClubState, itemId: string, start: number, end: number): number {
  return Math.max(0, ...occupancy(state, itemId, start, end).map((x) => x.count));
}

/** The first stretch between `start` and `end` in which every place is taken, or null when there is always room. */
export function firstFullStretch(state: ClubState, itemId: string, start: number, end: number, places: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  for (const seg of occupancy(state, itemId, start, end)) {
    if (seg.count < places) {
      if (found) break;
      continue;
    }
    found = found ? { from: found.from, to: seg.to } : { from: seg.from, to: seg.to };
  }
  return found;
}
