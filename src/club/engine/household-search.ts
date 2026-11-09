import { nameMatches } from "../name-filter";
import type { ClubState, Household } from "../types";
import { fullName } from "./queries";

/**
 * Finding a household at the front desk. The building comparison: the tenant index card box. Nobody reads the whole box to find
 * one card; you say a surname, an email address or a phone number and the card comes out.
 *
 * What is typed is matched against four things, any one of which finds the household:
 * - the household's display name and the name of any adult who ever belonged to it (the start of any word, so "lind", "erik l" and
 *   "household" work; capitals, accents and extra spaces do not matter),
 * - any adult's email address (any part of it, so "moreau.family" or "@example.com" work),
 * - any adult's phone number (digits only, written any way: "555-0142", "(206) 555 0142"; at least three digits).
 * Adults who left, or whose household ended, still count, so a staff member can find a household by someone who used to be on it.
 */

export const SEARCH_MAX_CHARS = 100;
/** The most cards shown for one search. A search that finds more says so, and asks for more of the name. */
export const SEARCH_SHOW_MAX = 50;

export interface HouseholdMatch {
  household: Household;
  /** Active adults, as the card says. */
  activeAdults: number;
}

export interface HouseholdSearch {
  /** What was typed, tidied: spaces squeezed, trimmed, cut to `SEARCH_MAX_CHARS`. Empty when nothing was typed: no search was run. */
  query: string;
  /** How many households matched in all. */
  total: number;
  /** The first `SEARCH_SHOW_MAX`, by name. */
  shown: HouseholdMatch[];
}

const digitsOf = (text: string) => text.replace(/\D/g, "");

/** The digits of a phone number, without a leading country code 1 (so "1 206 555 0142" finds "206-555-0142"). */
function phoneDigits(text: string): string {
  const d = digitsOf(text);
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

export function tidyQuery(typed: string | undefined): string {
  return (typed ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_CHARS).trim();
}

/** Runs a search over every household. An empty query runs no search and returns nothing. */
export function searchHouseholds(state: ClubState, typed: string | undefined): HouseholdSearch {
  const query = tidyQuery(typed);
  if (query === "") return { query, total: 0, shown: [] };

  // A query with no letter or digit in it ("@", "...") would match every name, so it matches nothing instead.
  const hasWords = /[\p{L}\p{N}]/u.test(query);
  const lower = query.toLowerCase();
  const phoneLike = /^[\d\s().+-]+$/.test(query) && digitsOf(query).length >= 3;
  const wanted = phoneLike ? phoneDigits(query) : "";

  const found: Household[] = [];
  for (const household of state.households) {
    const adults = state.members.filter((m) => m.householdId === household.id);
    const hit =
      hasWords &&
      (nameMatches(household.displayName, query) ||
        adults.some((m) => nameMatches(fullName(m), query) || m.email.toLowerCase().includes(lower) || (phoneLike && phoneDigits(m.phone).includes(wanted))));
    if (hit) found.push(household);
  }
  found.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  return {
    query,
    total: found.length,
    shown: found.slice(0, SEARCH_SHOW_MAX).map((household) => ({
      household,
      activeAdults: state.members.filter((m) => m.householdId === household.id && m.status === "active").length,
    })),
  };
}
