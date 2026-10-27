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
  /** Boat/class bookings (not days), Jul 1 to Sep 30. More than bookingDays means some day had 2+. */
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
  note: string | null;
}

export interface MembershipData {
  /** "live" comes from Supabase; "sample" is made-up data for development and tests. */
  source: "live" | "sample";
  months: MembershipMonth[];
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
