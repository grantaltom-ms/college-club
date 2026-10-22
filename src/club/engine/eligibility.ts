import { formatDay } from "../time";
import type { ClubState, Household, Member } from "../types";
import { householdOf, memberById } from "./queries";

/**
 * Why this member cannot make a new booking right now, in plain words, or null if nothing stands in the way.
 * Every booking goes through this first (step 2), so ending a household blocks everyone in it at once.
 */
export function bookingBlockReason(member: Member | undefined, household: Household | undefined, closed = "new bookings are closed"): string | null {
  if (!member || !household) return "We could not find that member.";
  if (household.status === "ended" || member.status === "household_ended") {
    const when = household.endedOn ? ` on ${formatDay(household.endedOn)}` : "";
    return `This household's membership ended${when}, so ${closed}.`;
  }
  if (member.status === "removed") return `${member.firstName} is no longer listed on this household's membership, so ${closed}.`;
  return null;
}

export function blockReasonFor(state: ClubState, memberId: string, closed?: string): string | null {
  const member = memberById(state, memberId);
  return bookingBlockReason(member, member ? householdOf(state, member.householdId) : undefined, closed);
}

/**
 * Whether the member holds the required qualification, or a higher level on the same track.
 * No requirement always passes.
 */
export function meetsQualification(state: ClubState, memberId: string, requiredCode: string | null): boolean {
  if (!requiredCode) return true;
  const required = state.qualifications.find((q) => q.code === requiredCode);
  if (!required) return false;
  return state.memberQualifications
    .filter((q) => q.memberId === memberId)
    .some((q) => {
      const held = state.qualifications.find((c) => c.code === q.code);
      return !!held && held.track === required.track && held.rank >= required.rank;
    });
}
