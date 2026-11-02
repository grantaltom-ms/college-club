import type { ClubState, Member } from "./types";

/**
 * The invented member the test landing page's "test member view" signs in as.
 *
 * The building comparison: the model apartment's sample tenant. Nora Abernathy owns a private boat, so signing in as her shows
 * most of what a member can reach (booking, classes, events, My boats). If the sample club ever changes and she is gone, the
 * first active member of an active household stands in. A club with nobody active gives null and the page says so.
 */
export function demoMember(state: ClubState): Member | null {
  const active = state.members.filter(
    (m) => m.status === "active" && state.households.some((h) => h.id === m.householdId && h.status === "active"),
  );
  return active.find((m) => m.firstName === "Nora" && m.lastName === "Abernathy") ?? active[0] ?? null;
}
