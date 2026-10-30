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
  "member_updated",
  "primary_changed",
  "type_changed",
  "qualification_granted",
  "bookings_cancelled",
  "signups_cancelled",
  "rsvps_cancelled",
  "quickbooks_linked",
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
/** The kinds of space a fitness class can hold. */
export const CLASS_ROOM_TYPES: readonly BookingType[] = ["Gym Space", "Room Space"];

/** The kinds of space that can be a pool: one item with a number of places, counted rather than numbered. */
export const POOLED_TYPES: readonly BookingType[] = ["Dock Space", "Gym Space", "Room Space"];

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
  /** How long the booking form starts with, between minMinutes and maxMinutes. */
  defaultMinutes: number;
  maxMinutes: number;
  /** Bookings one member can hold at once, per booking type. 0 means no limit. */
  maxFuturePerType: number;
  /** Bookings one member can have on one day, per booking type. 0 means no limit. */
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
  /**
   * A privately owned boat. Only its owners and the people they have invited can book it or sit in it, nobody else is shown it,
   * and its skill level is not checked (the owner vouches). Set when the item is made and never changed.
   */
  isPrivate?: boolean;
  /**
   * How many people can hold this item at the same moment. Undefined means one, like every boat. Only a dock, club room or gym
   * space (`POOLED_TYPES`) can have more: it is a pool, and the club only counts how many places are left. Set when the item is
   * made and never changed.
   */
  places?: number;
}

/** An owner is picked by staff; an invited person is named by an owner (or by staff). */
export type BoatAccessKind = "owner" | "invited";

/**
 * One line on a private boat's access list: this member may use this boat. Lines are only added and ended, never removed, so
 * the list doubles as the log of who was let on or taken off, when, and by whom. A line is active while `endedAt` is null.
 */
export interface BoatAccess {
  id: string;
  itemId: string;
  memberId: string;
  kind: BoatAccessKind;
  addedAt: string;
  addedBy: Actor;
  endedAt: string | null;
  endedBy: Actor | null;
  /** Why it ended, in words: "Taken off by Ada Quill", "Became an owner". Null while active. */
  endedReason: string | null;
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

/* ---------- Fitness classes (step 3) ---------- */

/** The house rules for class sign-ups. Every value lives in settings/class-rules.json, never in code. */
export interface ClassRuleValues {
  /** How many days ahead members can sign up. */
  signUpDaysAhead: number;
  /** When a new day opens for sign-up, Pacific "HH:MM". */
  opensAt: string;
  /** Sign-up closes this many minutes before the start. */
  closeMinutesBefore: number;
  /** Leaving later than this many minutes before the start is recorded as a late cancellation. */
  cancelCutoffMinutes: number;
  /** The waiting list moves up automatically until this many minutes before the start; after that, free chairs are first come. */
  promoteUntilMinutesBefore: number;
  /** The most people who can wait for one class. 0 means no waiting list. */
  waitlistMax: number;
  /** Upcoming sign-ups (chairs and waiting-list places) one member can hold at once. */
  maxUpcomingPerMember: number;
  /** Class sign-ups one member can have on one day. */
  maxPerDayPerMember: number;
}

export interface ClassRules {
  /** True while the numbers are placeholders. Shown on screen. */
  placeholder: boolean;
  defaults: ClassRuleValues;
}

/** A kind of class: "Morning Yoga". Staff schedule dated sessions of it. */
export interface ClassTemplate {
  id: string;
  name: string;
  description: string;
  instructor: string;
  /** Chairs a new session starts with. */
  defaultCapacity: number;
  /** How long a new session lasts. */
  defaultMinutes: number;
  /** The gym or room it usually uses, if any. */
  roomItemId: string | null;
  /** Overrides of the class rules for this class only. */
  rules: Partial<ClassRuleValues>;
}

export const SESSION_STATUSES = ["scheduled", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** One dated occurrence of a class, with a number of chairs. */
export interface ClassSession {
  id: string;
  classId: string;
  /** The gym or room it holds for its whole length, or null. While scheduled, nothing else can use that room then. */
  roomItemId: string | null;
  /** ISO moments. */
  startsAt: string;
  endsAt: string;
  /** Chairs. */
  capacity: number;
  status: SessionStatus;
  createdAt: string;
  createdBy: Actor;
  statusChangedAt: string;
  cancelledBy: Actor | null;
  cancelReason: string | null;
}

/**
 * Where a name stands on a session's sign-up sheet. "enrolled" has a chair; "waitlisted" waits in order.
 * The rest are how it ended: cancelled and late_cancelled free the chair; attended and no_show are the record.
 */
export const SIGNUP_STATUSES = ["enrolled", "waitlisted", "cancelled", "late_cancelled", "attended", "no_show"] as const;
export type SignUpStatus = (typeof SIGNUP_STATUSES)[number];

/** Sign-ups that still take up the member's time. */
export const LIVE_SIGNUP: readonly SignUpStatus[] = ["enrolled", "waitlisted"];

export interface SignUp {
  id: string;
  sessionId: string;
  memberId: string;
  status: SignUpStatus;
  /** When the name went on the sheet. Waiting-list order follows this. */
  createdAt: string;
  createdBy: Actor;
  statusChangedAt: string;
  /** Set when the waiting list moved this person up to a chair. */
  promotedAt: string | null;
  cancelledBy: Actor | null;
  cancelReason: string | null;
}

/* ---------- Events and RSVPs (step 4) ---------- */

/** The house rules for event RSVPs. Every value lives in settings/event-rules.json, never in code. */
export interface EventRuleValues {
  /** RSVP closes this many minutes before the start, unless staff set a reply-by moment for the event. */
  closeMinutesBefore: number;
  /** Cancelling an RSVP (with places) later than this many minutes before the start is recorded as a late cancellation. */
  cancelCutoffMinutes: number;
  /** The waiting list moves up automatically until this many minutes before the start; after that, free places are first come. */
  promoteUntilMinutesBefore: number;
  /** The most RSVPs that can wait for one event. 0 means no waiting list. */
  waitlistMax: number;
  /** A place on the waiting list is removed this many minutes after the member last pressed a button on it. 0 means it never runs out. */
  waitlistHoldMinutes: number;
  /** The most guests one member can bring on one RSVP. */
  maxGuests: number;
}

export interface EventRules {
  /** True while the numbers are placeholders. Shown on screen. */
  placeholder: boolean;
  defaults: EventRuleValues;
}

export const EVENT_STATUSES = ["scheduled", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** A gathering members RSVP to: a dinner, a work party. */
export interface ClubEvent {
  id: string;
  title: string;
  description: string;
  /** Where, in words. */
  location: string;
  /** ISO moments. */
  startsAt: string;
  endsAt: string;
  /** Places in total, adults and guests together. null means no limit. */
  capacity: number | null;
  /** Price of one place in cents, or null when free or not stated. Copied onto each RSVP for billing later; nothing is charged here. */
  priceCents: number | null;
  /** Staff-set last moment to RSVP, or null to use the rule. */
  replyBy: string | null;
  status: EventStatus;
  createdAt: string;
  createdBy: Actor;
  statusChangedAt: string;
  cancelledBy: Actor | null;
  cancelReason: string | null;
}

/**
 * Where a name stands on an event's list. "going" has places; "waitlisted" waits in order.
 * The rest are how it ended: cancelled and late_cancelled give the places back; attended and no_show are the record.
 */
export const RSVP_STATUSES = ["going", "waitlisted", "cancelled", "late_cancelled", "attended", "no_show"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

/** RSVPs that still hold the member's place on the list. */
export const LIVE_RSVP: readonly RsvpStatus[] = ["going", "waitlisted"];

export const RSVP_VIA = ["page", "email_link"] as const;
export type RsvpVia = (typeof RSVP_VIA)[number];

export interface Rsvp {
  id: string;
  eventId: string;
  memberId: string;
  /** Non-member guests this member brings. Each takes a place, like the member. */
  guests: number;
  status: RsvpStatus;
  /** Price of one place in cents when the RSVP was made, or null. */
  priceCents: number | null;
  /** How it was made: on the event page, or by a personal link in an email. */
  via: RsvpVia;
  /** When the name went on the list. Waiting-list order follows this. */
  createdAt: string;
  createdBy: Actor;
  statusChangedAt: string;
  /** Set when the waiting list moved this person up to places. */
  promotedAt: string | null;
  /** While waiting: the moment this place on the waiting list is removed unless the member keeps it. null otherwise, and when holds never run out. */
  holdUntil: string | null;
  cancelledBy: Actor | null;
  cancelReason: string | null;
}

/* ---------- Check-ins and attendance (step 5) ---------- */

/** The house rules for checking in. Every value lives in settings/attendance-rules.json, never in code. */
export interface AttendanceRuleValues {
  /** Someone can be checked in from this many minutes before the start. */
  checkInOpensMinutesBefore: number;
  /** A boat or space booking, or a class chair, that nobody checked in for becomes a no-show this many minutes after it ends. */
  noShowAfterEndMinutes: number;
  /** Kinds of booking that need no check-in at all (the club room, work-from-club): never a no-show, never on the check-in lists. */
  checkInNotNeededFor: BookingType[];
}

export interface AttendanceRules {
  /** True while the numbers are placeholders. Shown on screen. */
  placeholder: boolean;
  defaults: AttendanceRuleValues;
}

/** What an attendance line is about: a boat or space booking, a class sign-up, or an event RSVP. */
export const ATTENDANCE_KINDS = ["booking", "class", "event"] as const;
export type AttendanceKind = (typeof ATTENDANCE_KINDS)[number];

/** Came, or did not. (On a booking the stored status for "attended" is `completed`.) */
export const ATTENDANCE_OUTCOMES = ["attended", "no_show"] as const;
export type AttendanceOutcome = (typeof ATTENDANCE_OUTCOMES)[number];

/** How it was recorded: by staff at the front desk, by the system when the time ran out, or by the member themselves on the front-desk iPad or on their own phone. */
export const ATTENDANCE_VIA = ["staff", "automatic", "ipad", "phone"] as const;
export type AttendanceVia = (typeof ATTENDANCE_VIA)[number];

/** One line in the check-in record. Lines are only ever added, never changed or removed; a correction is a new line. */
export interface AttendanceEntry {
  id: string;
  kind: AttendanceKind;
  /** The booking, class sign-up or RSVP this is about. */
  recordId: string;
  /** Who was checked in, or missed. On a boat or space outing: the booker, unless staff named one of the crew. */
  memberId: string;
  /** ISO instant the line was written. */
  at: string;
  outcome: AttendanceOutcome;
  /** What it said before this line, or null the first time. */
  previous: AttendanceOutcome | null;
  by: Actor;
  via: AttendanceVia;
  /** Why, in staff's words. Optional. */
  note: string | null;
}

/* ---------- Billing (step 9) ---------- */

/** The kinds of line on a household's monthly invoice. Each one can go to its own income account in QuickBooks. */
export const BILLING_KINDS = ["dues", "event_tickets", "visitor_fees", "bar", "snack_bar"] as const;
export type BillingKind = (typeof BILLING_KINDS)[number];

/** The billing numbers and names. Every value lives in settings/billing-rules.json, never in code. */
export interface BillingRuleValues {
  /** Monthly dues in cents for each membership type. */
  duesCents: Record<MembershipType, number>;
  /** A member can bring this many visitors in one day without a fee. More than this and every visitor that day is charged. */
  visitorFreePerDay: number;
  /** The fee for each visitor, in cents, once a member is over the free number in a day. */
  visitorFeeCents: number;
  /** The most visitors one entry (one press of the button) can record. */
  visitorsPerEntryMax: number;
  /** The most visitors one member can have recorded in one day. */
  visitorsPerDayMax: number;
  /** Days from the invoice date to the due date. */
  invoiceDueDays: number;
  /** The product or service name each kind of line goes under in QuickBooks. Must match the names in QuickBooks exactly. */
  items: Record<BillingKind, string>;
  /** Kinds of line that carry sales tax (bar and snack bar). QuickBooks' own invoice import cannot take tax, so this is shown in the plain charges file. */
  taxable: BillingKind[];
}

export interface BillingRules {
  /** True while the numbers are placeholders. Shown on screen. */
  placeholder: boolean;
  defaults: BillingRuleValues;
}

export const CHARGE_STATUSES = ["open", "voided"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/**
 * One charge staff typed in: a bar or snack-bar sale, or an adjustment (a credit or an extra charge, often to put right a
 * month that was already exported). Charges are never deleted; a wrong one is voided with a reason.
 */
export interface Charge {
  id: string;
  householdId: string;
  /** Whose tab it was, when staff said. Always someone in the household. */
  memberId: string | null;
  /** The day it happened, Pacific, YYYY-MM-DD. It is billed in that day's month. */
  day: string;
  /** Which line of the invoice it goes under. */
  category: BillingKind;
  /** An adjustment may be negative (a credit). A bar or snack-bar charge never is. */
  adjustment: boolean;
  amountCents: number;
  description: string;
  createdAt: string;
  createdBy: Actor;
  status: ChargeStatus;
  voidedAt: string | null;
  voidedBy: Actor | null;
  voidReason: string | null;
}

export const VISIT_VIA = ["ipad", "staff"] as const;
export type VisitVia = (typeof VISIT_VIA)[number];

export const VISIT_STATUSES = ["recorded", "voided"] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** Visitors a member brought to the clubhouse, signed in on the front-desk iPad or entered by staff. Only a count: no visitor names are kept. */
export interface VisitorEntry {
  id: string;
  /** The member who brought them. */
  memberId: string;
  /** The day, Pacific, YYYY-MM-DD. */
  day: string;
  visitors: number;
  createdAt: string;
  createdBy: Actor;
  via: VisitVia;
  status: VisitStatus;
  voidedAt: string | null;
  voidedBy: Actor | null;
  voidReason: string | null;
}

/** A month that was exported and locked. Its lines are frozen: later corrections go in as adjustments in a later month. */
export interface BillingRun {
  id: string;
  /** YYYY-MM, Pacific. */
  month: string;
  createdAt: string;
  createdBy: Actor;
  invoiceCount: number;
  totalCents: number;
}

/** One line on one household's invoice for a locked month. quantity x unit = amount. Never changed once saved. */
export interface BillingLine {
  id: string;
  runId: string;
  householdId: string;
  /** Shared by every line of one household's invoice in one run. */
  invoiceNo: string;
  kind: BillingKind;
  description: string;
  quantity: number;
  unitCents: number;
  /** Negative for a credit. */
  amountCents: number;
  taxable: boolean;
  adjustment: boolean;
}

export interface ClubState {
  households: Household[];
  members: Member[];
  qualifications: Qualification[];
  memberQualifications: MemberQualification[];
  history: HistoryEntry[];
  items: Item[];
  outOfService: OutOfServicePeriod[];
  /** Who may use each private boat. Empty lines for a club boat: it has no list. */
  boatAccess: BoatAccess[];
  bookings: Booking[];
  classes: ClassTemplate[];
  sessions: ClassSession[];
  signups: SignUp[];
  events: ClubEvent[];
  rsvps: Rsvp[];
  attendance: AttendanceEntry[];
  charges: Charge[];
  visitors: VisitorEntry[];
  billingRuns: BillingRun[];
  billingLines: BillingLine[];
  /**
   * How far back events, charges and visitor entries were loaded, as an ISO instant, or null when everything is here (the
   * in-memory store). A month that begins before this cannot be billed from this copy, because records may be missing.
   */
  dataSince: string | null;
}
