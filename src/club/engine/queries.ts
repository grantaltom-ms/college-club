import type { ClubState, HistoryEntry, Household, Member, Qualification } from "../types";

export const fullName = (m: Pick<Member, "firstName" | "lastName">) => `${m.firstName} ${m.lastName}`;

export function householdOf(state: ClubState, id: string): Household | undefined {
  return state.households.find((h) => h.id === id);
}

export function memberById(state: ClubState, id: string): Member | undefined {
  return state.members.find((m) => m.id === id);
}

/** Everyone who ever belonged to the household, active ones first. */
export function membersOf(state: ClubState, householdId: string): Member[] {
  const order = { active: 0, household_ended: 1, removed: 2 } as const;
  return state.members
    .filter((m) => m.householdId === householdId)
    .sort((a, b) => order[a.status] - order[b.status] || (a.role === b.role ? 0 : a.role === "primary" ? -1 : 1) || a.firstName.localeCompare(b.firstName));
}

/** The qualifications a member holds, highest first. */
export function qualificationsOf(state: ClubState, memberId: string): { qualification: Qualification; grantedAt: string; grantedBy: string }[] {
  return state.memberQualifications
    .filter((q) => q.memberId === memberId)
    .map((q) => ({ qualification: state.qualifications.find((c) => c.code === q.code)!, grantedAt: q.grantedAt, grantedBy: q.grantedBy.label }))
    .filter((q) => q.qualification)
    .sort((a, b) => b.qualification.rank - a.qualification.rank || a.qualification.track.localeCompare(b.qualification.track));
}

/** A household's file, newest first. Lines written in the same moment keep the order they were written in. */
export function historyOf(state: ClubState, householdId: string): HistoryEntry[] {
  return state.history
    .map((entry, written) => ({ entry, written }))
    .filter(({ entry }) => entry.householdId === householdId)
    .sort((a, b) => b.entry.at.localeCompare(a.entry.at) || b.written - a.written)
    .map(({ entry }) => entry);
}
