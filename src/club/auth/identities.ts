import type { ClubState } from "../types";
import { fullName, householdOf } from "../engine/queries";
import { normalizeEmail } from "./email";
import type { StaffLogin } from "./staff-list";

/**
 * Who an email address can sign in as. The building comparison: the key to the mailbox opens the mailbox, and the mailbox may
 * hold mail for more than one person (partners on one address), so after the key turns the person says which of them they are.
 */
export type SignInIdentity =
  | { kind: "member"; memberId: string; name: string; household: string }
  | { kind: "staff"; email: string; name: string };

/** The part of an identity a signed-in browser is remembered by. */
export type SessionSubject = { kind: "member"; memberId: string } | { kind: "staff"; email: string };

/**
 * Every identity this address opens: each active adult in an active household who has the address, and each staff entry with
 * it. Members first, by name, then staff. Nobody whose membership has ended or who has left the household is ever included.
 */
export function identitiesForEmail(state: ClubState, staff: StaffLogin[], email: string): SignInIdentity[] {
  const wanted = normalizeEmail(email);
  if (!wanted) return [];
  const members: SignInIdentity[] = state.members
    .filter((m) => m.status === "active" && normalizeEmail(m.email) === wanted && householdOf(state, m.householdId)?.status === "active")
    .map((m) => ({ kind: "member" as const, memberId: m.id, name: fullName(m), household: householdOf(state, m.householdId)!.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId));
  const people: SignInIdentity[] = staff.filter((s) => s.email === wanted).map((s) => ({ kind: "staff" as const, email: s.email, name: s.name }));
  return [...members, ...people];
}

/** The identity as a form value: `member:<id>` or `staff:<email>`. */
export const identityKey = (i: SignInIdentity | SessionSubject): string => (i.kind === "member" ? `member:${i.memberId}` : `staff:${i.email}`);

/** Reads a form value back into a subject, or null when it is not one of the two shapes. */
export function parseIdentityKey(value: unknown): SessionSubject | null {
  if (typeof value !== "string") return null;
  const member = /^member:([0-9a-f-]{36})$/.exec(value);
  if (member) return { kind: "member", memberId: member[1] };
  const staff = /^staff:(.+)$/.exec(value);
  const email = staff ? normalizeEmail(staff[1]) : null;
  return email ? { kind: "staff", email } : null;
}

/** The person a browser is signed in as, or null when that person can no longer sign in (left, membership ended, off the staff list). */
export function identityOf(state: ClubState, staff: StaffLogin[], subject: SessionSubject): SignInIdentity | null {
  if (subject.kind === "staff") {
    const found = staff.find((s) => s.email === subject.email);
    return found ? { kind: "staff", email: found.email, name: found.name } : null;
  }
  const member = state.members.find((m) => m.id === subject.memberId);
  const household = member && householdOf(state, member.householdId);
  if (!member || member.status !== "active" || !household || household.status !== "active") return null;
  return { kind: "member", memberId: member.id, name: fullName(member), household: household.displayName };
}
