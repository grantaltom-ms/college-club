import { cache } from "react";
import { getLoginDeps } from "./auth/deps";
import { resolveSession } from "./auth/login";
import { clubNow } from "./clock";
import { clubEnabled, pickerEnabled } from "./enabled";
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
 * getCurrentActor() and nothing else. Since step 6 the answer comes from a real sign-in (an email link, then a cookie that
 * names a session the club knows); only where invented data is allowed does the test picker's cookie also work, as a shortcut.
 */

/** The test picker's cookie. */
export const ACTOR_COOKIE = "ccs_test_actor";
/** The signed-in browser's cookie: a long random secret the club knows only as a fingerprint. */
export const SESSION_COOKIE = "ccs_session";
/** Which of several people sharing an email address this device said it was, so the next sign-in can ask less. */
export const REMEMBER_COOKIE = "ccs_signin_who";

/** `source` is "login" for someone who signed in with an email link; it is absent for the test picker. */
export type CurrentActor =
  | { kind: "member"; member: Member; household: Household; source?: "login" }
  | { kind: "staff"; label: string; source?: "login" };

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

/**
 * The person making this request, or null when nobody is signed in (or the member area is switched off). A real sign-in wins;
 * the test picker is only looked at where invented data is allowed. Asked many times in one request, answered once.
 */
export const getCurrentActor = cache(async (): Promise<CurrentActor | null> => {
  if (!clubEnabled()) return null;
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  if (session) {
    const who = await resolveSession(await getLoginDeps(), { secret: session, now: clubNow() });
    if (who) {
      return who.kind === "staff" ? { kind: "staff", label: who.identity.name, source: "login" } : { kind: "member", member: who.member, household: who.household, source: "login" };
    }
  }
  return pickerEnabled() ? resolveActor(await getClubStore(), jar.get(ACTOR_COOKIE)?.value) : null;
});

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
