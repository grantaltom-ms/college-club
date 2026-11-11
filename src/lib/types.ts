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
  /** Days with at least one iCrew reservation, Jul 1 to Sep 30. Every item type counts, including the gym. */
  bookingDays: number;
  /**
   * iCrew reservation rows, Jul 1 to Sep 30, one per reservation ID, every item type, including the gym.
   * More than bookingDays means some day had two or more rows (a second booking, or two amenities).
   */
  bookings: number;
  /** Share of door entries between 4 and 8am, 0 to 1. Null when the member has no door data. */
  earlyShare: number | null;
  /** Share of door entries on weekends, 0 to 1. Null when the member has no door data. */
  weekendShare: number | null;
  /** Shared account for two or more people (name like "A & B"), so double bookings are expected. */
  household: boolean;
  lastVisit: string | null;
  /** True when the member has their own Brivo door fob. */
  ownFob: boolean;
  joined: string | null;
  /** Membership type from the QuickBooks member list: Resident, Intermediate or Non-Resident. */
  memberType: string | null;
  /** The date the member's QuickBooks record was created, YYYY-MM-DD. */
  qbCreatedOn: string | null;
  /** Joined this year and has no visit yet: a waitlist member who has not started. Left out of the usage groups. */
  notStarted: boolean;
  /** Visit days for Jan..Nov (11 values; a month after the data ends is 0). */
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

/**
 * One month of membership counts, from the Membership Committee's
 * "Membership Count" workbooks (Total Dues Paying row). Counts only:
 * no member names are ever stored in this table.
 */
export interface MembershipMonth {
  year: number;
  /** 1 to 12. */
  month: number;
  previousTotal: number;
  resignations: number;
  applicants: number;
  /** Null when the workbook's transferred total cell was blank. */
  transferred: number | null;
  /** The workbook's own total after that month's approvals. */
  withApprovals: number;
  /** Null when the workbook sheet shows no waitlist count. */
  waitlist: number | null;
  /**
   * Why the members who left, left, from the Membership Committee's trend workbook. All three are null together for a
   * month the workbook does not cover: that is a gap, never zero. They can add up to one more or one less than
   * `resignations`; render them as stored.
   */
  resignationsMoved: number | null;
  resignationsNotUsing: number | null;
  resignationsOther: number | null;
  /** Members in each category that month, null together for a month with no split. */
  catResident: number | null;
  catIntermediate: number | null;
  catNonResident: number | null;
  catSuburban: number | null;
  catHonorary: number | null;
  /**
   * The five categories added together. This is NOT `withApprovals` (the dues-paying total): it includes the Suburban and
   * Honorary members. The two are never one series.
   */
  totalAllCategories: number | null;
  note: string | null;
}

export interface MembershipData {
  /** "live" comes from Supabase; "sample" is made-up data for development and tests. */
  source: "live" | "sample";
  months: MembershipMonth[];
}

/**
 * One promoted club event, from the event_scoreboard table. Counts and short labels only:
 * no member names, emails or per-person rows are ever stored in this table or sent to the browser.
 */
export interface PromotedEvent {
  name: string;
  /** The day of the event, YYYY-MM-DD. */
  date: string;
  /** How the price was shown to members ("$26", "Free", "Price TBA"). */
  priceLabel: string | null;
  /** Null when the event had no capacity set: the "filled" percentage cannot be shown. */
  capacity: number | null;
  /** How many times the event was promoted (for example, in how many Watercoolers). */
  timesPromoted: number | null;
  /** Members registered. */
  rsvpMembers: number | null;
  /** Members plus their guests: iCrew's header figure. */
  rsvpPersons: number | null;
  /** Front-door entries in the event's evening window. Null when no door comparison was run. */
  doorEntriesWindow: number | null;
  /** The baseline the door window was compared to, in words. */
  doorComparison: string | null;
  /** "held" has happened; "upcoming" has not, so its registrations are "so far". */
  status: "held" | "upcoming";
  note: string | null;
}

export interface EventsData {
  /** "live" comes from Supabase; "sample" is made-up data for development and tests. */
  source: "live" | "sample";
  events: PromotedEvent[];
}

/**
 * One month of profit-and-loss figures, from the Finance Committee's
 * "CCS Board Reporting Package" workbooks. Organizational aggregates only:
 * no member names are ever stored in this table.
 */
export interface FinanceMonth {
  year: number;
  /** 1 to 12. */
  month: number;
  /** Total Income for the month, as shown on the package's month P&L sheet. */
  income: number;
  /** Total Cost of Goods Sold. */
  cogs: number;
  grossProfit: number;
  /** Total Expenses. */
  expenses: number;
  netOperatingIncome: number;
  /** Total Other Income. */
  otherIncome: number;
  /** Total Other Expenses. */
  otherExpenses: number;
  netOtherIncome: number;
  netIncome: number;
  /** Total Depreciation Expense. */
  depreciation: number;
  /** The package's own fiscal year-to-date income through this month. */
  labeledYtdIncome: number;
  /** The package's own fiscal year-to-date net income through this month. */
  labeledYtdNetIncome: number;
  /** The Board Reporting Package filename this row came from. */
  sourceFile: string;
  note: string | null;
}

export interface FinanceData {
  /** "live" comes from Supabase; "sample" is made-up data for development and tests. */
  source: "live" | "sample";
  months: FinanceMonth[];
}

export interface DashboardData {
  /** "live" comes from Supabase; "sample" is made-up data for development and tests. */
  source: "live" | "sample";
  /** Last day of door data, YYYY-MM-DD. */
  dataThrough: string;
  members: Member[];
  /** Where the member list comes from, and the day it was taken. */
  roster: { source: string; asOf: string | null };
  /** iCrew bookings per day, all accounts (from `club_totals`). */
  totals: ClubTotal[];
  door: DoorPattern;
}
