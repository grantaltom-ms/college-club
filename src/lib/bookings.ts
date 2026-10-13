import file from "../data/icrew-bookings.json";
import { dayOffset } from "./dates";
import type { ClubTotal } from "./types";

/**
 * Daily iCrew bookings (all accounts, including staff and juniors), taken from the
 * "Daily Totals" row of the iCrew MemberParticipation exports. Kept as a file in the
 * app so refreshing it needs no database write.
 */
export function committedBookings(): ClubTotal[] {
  return file.counts.map((n, i) => ({
    measure: "icrew_bookings_by_day" as const,
    key: dayOffset(file.start, i),
    allEntries: n,
    memberEntries: null,
  }));
}
