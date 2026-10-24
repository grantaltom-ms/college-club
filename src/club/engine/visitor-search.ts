import { nameMatches } from "../name-filter";
import type { ClubState } from "../types";
import { fullName, householdOf } from "./queries";

/**
 * Finding yourself on the front-desk iPad to sign visitors in. Unlike the check-in list, the person is not on any list yet,
 * so the whole membership is searched, which a shared screen must not hand out: nothing is shown until at least three letters
 * are typed, and never more than five names, so the screen cannot be used to browse the membership.
 */
export const HOST_SEARCH_MIN_LETTERS = 3;
export const HOST_SEARCH_MOST = 5;

export interface HostChoice {
  memberId: string;
  name: string;
  /** Only when two names listed are the same: the household, so they can be told apart. */
  household: string | null;
}

export interface HostSearch {
  /** True while fewer than the minimum number of letters were typed. */
  tooShort: boolean;
  hosts: HostChoice[];
  /** True when more people matched than are shown: type more of the name. */
  more: boolean;
}

export function findHosts(state: ClubState, typed: string): HostSearch {
  const wanted = typed.trim();
  // Letters and digits only: punctuation alone would read as "nothing typed", which the name matcher answers with everyone.
  const letters = wanted.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "");
  if (letters.length < HOST_SEARCH_MIN_LETTERS) return { tooShort: true, hosts: [], more: false };
  const active = state.members
    .filter((m) => m.status === "active" && householdOf(state, m.householdId)?.status === "active" && nameMatches(fullName(m), wanted))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id));
  const shown = active.slice(0, HOST_SEARCH_MOST);
  const counts = new Map<string, number>();
  for (const m of shown) counts.set(fullName(m), (counts.get(fullName(m)) ?? 0) + 1);
  return {
    tooShort: false,
    hosts: shown.map((m) => ({ memberId: m.id, name: fullName(m), household: (counts.get(fullName(m)) ?? 0) > 1 ? householdOf(state, m.householdId)!.displayName : null })),
    more: active.length > shown.length,
  };
}
