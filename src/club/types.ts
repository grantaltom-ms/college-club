/** Shapes for the member system: households, the adults in them, their qualifications and the household history. */

export const MEMBERSHIP_TYPES = ["Resident", "Intermediate", "Non-Resident"] as const;
export type MembershipType = (typeof MEMBERSHIP_TYPES)[number];

export type HouseholdStatus = "active" | "ended";
export type MemberRole = "primary" | "additional";
/** "removed" left the household while it carried on; "household_ended" lost access when the whole membership ended. */
export type MemberStatus = "active" | "removed" | "household_ended";

/** The lease: what the club bills and counts. Has its own permanent ID. */
export interface Household {
  id: string;
  displayName: string;
  membershipType: MembershipType;
  status: HouseholdStatus;
  /** YYYY-MM-DD, Pacific. */
  joinedOn: string;
  /** YYYY-MM-DD, Pacific. Set exactly when the status is "ended". */
  endedOn: string | null;
  /** Empty until the QuickBooks link is made (step 9). */
  quickbooksId: string | null;
  notes: string;
}

/** One adult on the lease. Has its own permanent ID. */
export interface Member {
  id: string;
  householdId: string;
  firstName: string;
  lastName: string;
  /** Two partners may share one address, so this is not unique. */
  email: string;
  phone: string;
  role: MemberRole;
  status: MemberStatus;
  /** Empty slots for the systems that get linked later. */
  brivoCredentialId: string | null;
  mailchimpContactId: string | null;
  loginId: string | null;
}

/** A level on a track, for example sculling level 2. Higher rank in the same track includes the lower ones. */
export interface Qualification {
  code: string;
  name: string;
  track: string;
  rank: number;
}

export interface MemberQualification {
  memberId: string;
  code: string;
  grantedBy: Actor;
  /** ISO instant. */
  grantedAt: string;
}

/** Who did something. Staff and the system can change records; a member can only act for themselves. */
export type Actor =
  | { kind: "member"; memberId: string; label: string }
  | { kind: "staff"; label: string }
  | { kind: "system"; label: string };

export const HISTORY_KINDS = [
  "joined",
  "member_added",
  "member_removed",
  "primary_changed",
  "type_changed",
  "qualification_granted",
  "bookings_cancelled",
  "membership_ended",
] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** One line in a household's file. Entries are only ever added, never changed or removed. */
export interface HistoryEntry {
  id: string;
  householdId: string;
  /** ISO instant. */
  at: string;
  kind: HistoryKind;
  /** A plain sentence a staff member can read. */
  summary: string;
  actor: Actor;
  details: Record<string, string | number | null>;
}

/* ---------- Bookable equipment and spaces (step 2) ---------- */

/** Everything the club lets members book. One booking engine handles all of them. */
export const BOOKING_TYPES = ["Shell", "Kayak", "Paddle Board", "Dock Space", "Gym Space", "Room Space", "Work Space"] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

/** On-the-water types put a person in one place at a time: nobody can be in two boats at once. */
export const BOOKING_TYPE_INFO: Record<BookingType, { onWater: boolean }> = {
  Shell: { onWater: true },
  Kayak: { onWater: true },
  "Paddle Board": { onWater: true },
  "Dock Space": { onWater: false },
  "Gym Space": { onWater: false },
  "Room Space": { onWater: false },
  "Work Space": { onWater: false },
};

/** The house rules for something bookable. Every value lives in settings/booking-rules.json, never in code. */
export interface RuleValues {
  /** How many days ahead a member can book. */
  windowDays: number;
  /** When a new day opens for booking, Pacific "HH:MM". Day D opens windowDays before D, at this time. */
  opensAt: string;
  /** Bookable hours, Pacific "HH:MM" ("24:00" allowed for dayEnd). */
  dayStart: string;
  dayEnd: string;
  slotMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  /** Bookings one member can hold at once, per booking type. */
  maxFuturePerType: number;
  /** Bookings one member can have on one day, per booking type. */
  maxPerDayPerType: number;
  /** Cancelling later than this many minutes before the start counts as a late cancellation. */
  cancelCutoffMinutes: number;
  /** Minutes that must stay free between two bookings of the same item. 0 means the setting is off. */
  gapMinutes: number;
}

/** A kind of item the rules attach to: "all singles". */
export interface ItemClass {
  code: string;
  type: BookingType;
  name: string;
  /** 1 single, 2 double, 4 quad or four. */
  seats: number;
  /** Qualification code needed to use items of this class, or null for none. */
  requiredQualification: string | null;
  rules: Partial<RuleValues>;
}

export interface RuleBook {
  /** True while the numbers are placeholders. Shown on screen. */
  placeholder: boolean;
  defaults: RuleValues;
  classes: ItemClass[];
}

/** One boat, board, dock space and so on. */
export interface Item {
  id: string;
  name: string;
  classCode: string;
  /** Overrides on top of the class rules, for this one item. */
  ruleOverrides: Partial<RuleValues>;
  /** undefined: use the class's. null: none needed. A code: that qualification. */
  requiredQualification?: string | null;
}

/** A stretch of time when an item cannot be booked. */
export interface OutOfServicePeriod {
  id: string;
  itemId: string;
  /** ISO moments. `until` null means until staff return it to service. */
  from: string;
  until: string | null;
  reason: string;
  /** YYYY-MM-DD, what staff expect, shown to members. */
  expectedReturn: string | null;
  createdBy: Actor;
  createdAt: string;
}

/**
 * Every booking ends in one of these. "upcoming" is the only one that can still change by the member's own hand.
 * cancelled and late_cancelled free the slot; completed and no_show are the record of what happened.
 */
export const BOOKING_STATUSES = ["upcoming", "completed", "cancelled", "late_cancelled", "no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses that hold the slot (nobody else can book it). */
export const HOLDING_STATUSES: readonly BookingStatus[] = ["upcoming", "completed", "no_show"];

export interface Booking {
  id: string;
  itemId: string;
  /** The booker owns the booking and is in the boat. */
  bookerId: string;
  /** Other members in a multi-seat boat. Never includes the booker. */
  crew: string[];
  /** ISO moments. */
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  createdAt: string;
  createdBy: Actor;
  statusChangedAt: string;
  cancelledBy: Actor | null;
  cancelReason: string | null;
  /** Set when staff booked past the rules: why, who, and exactly which rules were set aside. */
  override: { reason: string; actor: Actor; waived: string[] } | null;
  /** Crew taken off this booking because they left the club. */
  removedCrew: { memberId: string; at: string; reason: string }[];
}

export interface ClubState {
  households: Household[];
  members: Member[];
  qualifications: Qualification[];
  memberQualifications: MemberQualification[];
  history: HistoryEntry[];
  items: Item[];
  outOfService: OutOfServicePeriod[];
  bookings: Booking[];
}
