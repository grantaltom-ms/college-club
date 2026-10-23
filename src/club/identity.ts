import { clubEnabled } from "./enabled";
import { fullName, householdOf, memberById } from "./engine/queries";
import { verifyIpadCode } from "./engine/ipad-address";
import { verifyRsvpLinkToken } from "./engine/rsvp-links";
import { getIpadSecret } from "./ipad-secret";
import { getLinkSecret } from "./link-secret";
import type { ClubStore } from "./store/memory";
import { getClubStore } from "./store/instance";
import { SAMPLE_STAFF } from "./sample/club";
import type { Actor, Household, Member } from "./types";

/**
 * THE ONE PLACE that answers "who is the current member?". Every booking and permission check calls
 * getCurrentActor() and nothing else. In Phase 1 the answer comes from the test picker's cookie; step 6
 * swaps in real logins by changing this file only.
 */

export const ACTOR_COOKIE = "ccs_test_actor";

export type CurrentActor =
  | { kind: "member"; member: Member; household: Household }
  | { kind: "staff"; label: string };

/** "staff" or "member:<id>" is what the picker stores. Anything else means nobody. */
export function parseActorCookie(value: string | undefined): { kind: "staff" } | { kind: "member"; memberId: string } | null {
  if (value === "staff") return { kind: "staff" };
  const match = /^member:([0-9a-f-]{36})$/.exec(value ?? "");
  return match ? { kind: "member", memberId: match[1] } : null;
}

export async function resolveActor(store: ClubStore, cookieValue: string | undefined): Promise<CurrentActor | null> {
  const parsed = parseActorCookie(cookieValue);
  if (!parsed) return null;
  if (parsed.kind === "staff") return { kind: "staff", label: SAMPLE_STAFF.label };
  const state = await store.read();
  const member = memberById(state, parsed.memberId);
  const household = member && householdOf(state, member.householdId);
  return member && household ? { kind: "member", member, household } : null;
}

/** The person making this request, or null when nobody is signed in (or the member area is switched off). */
export async function getCurrentActor(): Promise<CurrentActor | null> {
  if (!clubEnabled()) return null;
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  return resolveActor(await getClubStore(), jar.get(ACTOR_COOKIE)?.value);
}

/** The shape the engine records in a household's file. */
export function toEngineActor(current: CurrentActor): Actor {
  return current.kind === "staff"
    ? { kind: "staff", label: current.label }
    : { kind: "member", memberId: current.member.id, label: fullName(current.member) };
}

/** Staff can see every household; a member can see only their own. */
export function canViewHousehold(current: CurrentActor | null, householdId: string): boolean {
  if (!current) return false;
  return current.kind === "staff" || current.household.id === householdId;
}

/**
 * The adult an emailed RSVP link belongs to, if the link is genuine: this event, this member, and the secret code made for
 * exactly that pair. Opening a link signs nobody in and sets no cookie; it only lets that one adult answer for that one event.
 * (Step 6 may replace this with real logins; the link then just opens the event page.)
 */
export async function resolveRsvpLink(
  store: ClubStore,
  secret: string,
  link: { eventId: string; memberId: string; token: string },
): Promise<{ member: Member; household: Household } | null> {
  if (!verifyRsvpLinkToken(secret, link.eventId, link.memberId, link.token)) return null;
  const state = await store.read();
  const member = memberById(state, link.memberId);
  const household = member && householdOf(state, member.householdId);
  return member && household ? { member, household } : null;
}

/** The request's RSVP link owner, or null when the link is not genuine (or the member area is switched off). */
export async function getRsvpLinkActor(link: { eventId: string; memberId: string; token: string }) {
  const secret = clubEnabled() ? getLinkSecret() : null;
  if (!secret) return null;
  return resolveRsvpLink(await getClubStore(), secret, link);
}

/**
 * Whether the code in a front-desk iPad address is genuine. Opening the iPad signs nobody in and sets no cookie: the iPad
 * screens are open to whoever holds the private address, and they show only the names of people with something to check in
 * for right now. (Step 6 may replace this when members have real logins; the iPad then keeps its own address.)
 */
export function ipadCodeIsGenuine(code: string): boolean {
  const secret = clubEnabled() ? getIpadSecret() : null;
  return secret !== null && verifyIpadCode(secret, code);
}
