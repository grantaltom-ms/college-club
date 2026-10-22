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

export interface ClubState {
  households: Household[];
  members: Member[];
  qualifications: Qualification[];
  memberQualifications: MemberQualification[];
  history: HistoryEntry[];
}
