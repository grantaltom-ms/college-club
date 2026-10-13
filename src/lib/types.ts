export const BAND_ORDER = [
  "0 visits",
  "Under 1/month",
  "1-2/month",
  "2-4/month",
  "4+/month",
] as const;

export type Band = (typeof BAND_ORDER)[number];

export interface Member {
  name: string;
  band: Band;
  visitsPerMonth: number;
  /** Days with a door entry or a boat/class booking, Jan 1 to data end. */
  visitDays: number;
  doorEntries: number;
  /** Days with a boat/class booking, Jul 1 to Sep 30. */
  bookingDays: number;
  lastVisit: string | null;
  /** True when the member has their own Brivo door fob. */
  ownFob: boolean;
  joined: string | null;
  memberType: string | null;
  /** Visit days for Jan..Sep (9 values). */
  monthly: number[];
}

export type Measure =
  | "door_by_month"
  | "door_by_hour"
  | "door_by_weekday"
  | "icrew_bookings_by_day";

/** The dates one year of door data covers. */
export interface DoorPeriod {
  year: number;
  firstDay: string;
  lastDay: string;
}

/** Entries for one weekday (0 = Monday) and clock hour, summed over a year. */
export interface DoorCell {
  year: number;
  weekday: number;
  hour: number;
  allEntries: number;
  memberEntries: number;
}

export interface DoorMonth {
  year: number;
  /** 1 to 12. */
  month: number;
  allEntries: number;
  memberEntries: number;
  /** Different people who came in that month. */
  people: number;
}

export interface DoorPattern {
  periods: DoorPeriod[];
  cells: DoorCell[];
  months: DoorMonth[];
}

export interface ClubTotal {
  measure: Measure;
  key: string;
  allEntries: number;
  memberEntries: number | null;
}

export interface DashboardData {
  /** "live" comes from Supabase; "sample" is made-up data for development and tests. */
  source: "live" | "sample";
  /** Last day of door data, YYYY-MM-DD. */
  dataThrough: string;
  members: Member[];
  /** iCrew bookings per day (all accounts), from src/data/icrew-bookings.json. */
  totals: ClubTotal[];
  door: DoorPattern;
}
