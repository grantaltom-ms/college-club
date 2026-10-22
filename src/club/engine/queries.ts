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

/* ---------- Classes ---------- */

/** A name's place on a session's waiting list, counting from 1 (null if not waiting). The list moves up in the order names were written. */
export function waitlistPlace(state: ClubState, signUpId: string): number | null {
  const mine = state.signups.find((g) => g.id === signUpId);
  if (!mine || mine.status !== "waitlisted") return null;
  return state.signups.filter((g) => g.sessionId === mine.sessionId && g.status === "waitlisted").findIndex((g) => g.id === signUpId) + 1;
}

export const enrolledCount = (state: ClubState, sessionId: string) => state.signups.filter((g) => g.sessionId === sessionId && g.status === "enrolled").length;
export const waitingCount = (state: ClubState, sessionId: string) => state.signups.filter((g) => g.sessionId === sessionId && g.status === "waitlisted").length;

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export interface ClassClash {
  className: string;
  startsAt: string;
  endsAt: string;
  /** True if the person is only on the waiting list. */
  waiting: boolean;
}

/** The class (in a chair or waiting) that fills this person's time between two moments, if any. A cancelled class fills nothing. */
export function classClash(state: ClubState, memberId: string, startMs: number, endMs: number, exceptSessionId?: string): ClassClash | undefined {
  for (const g of state.signups) {
    if (g.memberId !== memberId || (g.status !== "enrolled" && g.status !== "waitlisted") || g.sessionId === exceptSessionId) continue;
    const session = state.sessions.find((x) => x.id === g.sessionId);
    if (!session || session.status !== "scheduled") continue;
    if (Date.parse(session.startsAt) < endMs && startMs < Date.parse(session.endsAt)) {
      return { className: state.classes.find((k) => k.id === session.classId)?.name ?? "a class", startsAt: session.startsAt, endsAt: session.endsAt, waiting: g.status === "waitlisted" };
    }
  }
  return undefined;
}
