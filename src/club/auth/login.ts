import { householdOf, memberById } from "../engine/queries";
import type { LoginRules } from "../settings/login-rules";
import type { ClubStore } from "../store/memory";
import type { Household, Member } from "../types";
import { normalizeEmail } from "./email";
import { identityKey, identityOf, identitiesForEmail, parseIdentityKey, type SessionSubject, type SignInIdentity } from "./identities";
import type { Mailer } from "./mail";
import type { StaffLogin } from "./staff-list";
import type { AuthStore } from "./store";
import { hashSecret, isSecretShape, newSecret } from "./tokens";

/**
 * Signing in by email link. The building comparison: a one-time key left in the mailbox for whoever holds the mailbox.
 *
 * - Asking for a link never says whether the address belongs to anyone, so the form cannot be used to find out who is a member.
 * - Opening a link records nothing (email programs open links to check them); only pressing the button on the page it
 *   opens signs anyone in.
 * - A link works once, for a short time. Signed in, the browser holds a different secret that the database knows only as a
 *   fingerprint.
 * - Whether someone is still signed in is decided every time they come back: the moment a household ends, an adult leaves, or a
 *   staff address comes off the list, their browsers stop working. Nothing has to remember to sign them out.
 */

export interface LoginDeps {
  club: ClubStore;
  auth: AuthStore;
  /** Who sends the email, or null when nobody does (email sign-in is then not switched on). */
  mailer: Mailer | null;
  staff: StaffLogin[];
  rules: LoginRules;
}

const HOUR = 3600000;

/** What asking for a link did. The page says the same thing for "sent" and "ignored" so nobody learns who is a member. */
export type LinkRequest = "sent" | "ignored" | "invalid" | "off";

export function signInMail(link: string, minutes: number): { subject: string; text: string } {
  return {
    subject: "Your College Club Seattle sign-in link",
    text: [
      "Hello,",
      "",
      "Here is your sign-in link for College Club Seattle:",
      "",
      link,
      "",
      `It works once, and it stops working in ${minutes} minutes. If you did not ask for it, ignore this email: nobody can sign in without it.`,
      "",
      "College Club Seattle",
      "",
    ].join("\n"),
  };
}

/**
 * Makes and emails a sign-in link, if the address belongs to someone who can sign in and has not asked too often. `origin` is
 * the site's own address (for example https://example.org), never taken from a visitor's request on a real site.
 */
export async function requestSignInLink(deps: LoginDeps, input: { email: unknown; origin: string; now: Date }): Promise<LinkRequest> {
  const email = normalizeEmail(input.email);
  if (!email) return "invalid";
  if (!deps.mailer) return "off";

  const identities = identitiesForEmail(await deps.club.read(), deps.staff, email);
  if (identities.length === 0) return "ignored";
  const recent = await deps.auth.countTokensSince(email, new Date(input.now.getTime() - HOUR));
  if (recent >= deps.rules.defaults.linksPerHourPerEmail) return "ignored";

  const secret = newSecret();
  await deps.auth.addToken({ hash: hashSecret(secret), email, now: input.now, expiresAt: new Date(input.now.getTime() + deps.rules.defaults.linkMinutes * 60000) });
  try {
    await deps.mailer.send({ to: email, ...signInMail(`${input.origin}/club/sign-in/${secret}`, deps.rules.defaults.linkMinutes) }, input.now);
  } catch (e) {
    // A failure to send must look the same as everything else from outside, or it would tell a stranger the address is known.
    console.error("Could not send a sign-in email:", e instanceof Error ? e.message : e);
    return "ignored";
  }
  return "sent";
}

/**
 * What the page behind a link shows: the address the link was made for and who it can sign in as. Null for a link that is
 * unknown, used, out of date, or whose address no longer belongs to anyone who can sign in. Looking changes nothing.
 */
export async function previewSignIn(deps: LoginDeps, input: { secret: unknown; now: Date }): Promise<{ email: string; identities: SignInIdentity[] } | null> {
  if (!isSecretShape(input.secret)) return null;
  const found = await deps.auth.findToken(hashSecret(input.secret), input.now);
  if (!found) return null;
  const identities = identitiesForEmail(await deps.club.read(), deps.staff, found.email);
  return identities.length > 0 ? { email: found.email, identities } : null;
}

export interface SignedIn {
  /** The secret for the browser's cookie. Shown once and never stored. */
  sessionSecret: string;
  expiresAt: Date;
  identity: SignInIdentity;
}

/**
 * The button on the link's page: signs in as the chosen person. The choice must be someone this link's address opens. A wrong
 * choice changes nothing and leaves the link usable; a right one uses the link up, so of any number of simultaneous presses
 * exactly one signs in. Returns null when the link is no good or the choice is not allowed.
 */
export async function confirmSignIn(deps: LoginDeps, input: { secret: unknown; identity: unknown; now: Date }): Promise<SignedIn | null> {
  if (!isSecretShape(input.secret)) return null;
  const subject = parseIdentityKey(input.identity);
  if (!subject) return null;
  const hash = hashSecret(input.secret);

  const found = await deps.auth.findToken(hash, input.now);
  if (!found) return null;
  const chosen = identitiesForEmail(await deps.club.read(), deps.staff, found.email).find((i) => identityKey(i) === identityKey(subject));
  if (!chosen) return null;
  if (!(await deps.auth.consumeToken(hash, input.now))) return null;

  const sessionSecret = newSecret();
  const expiresAt = new Date(input.now.getTime() + deps.rules.defaults.sessionDays * 24 * HOUR);
  await deps.auth.addSession({ hash: hashSecret(sessionSecret), subject, now: input.now, expiresAt });
  if (chosen.kind === "member") await markFirstSignIn(deps.club, chosen.memberId);
  return { sessionSecret, expiresAt, identity: chosen };
}

/** Fills the member's empty "login" slot the first time they sign in, so staff can see who has. A failure here never stops a sign-in. */
async function markFirstSignIn(club: ClubStore, memberId: string): Promise<void> {
  try {
    await club.transaction(async (s, newId) => {
      const member = memberById(s, memberId);
      if (member && member.loginId === null) member.loginId = newId();
    });
  } catch (e) {
    console.error("Could not record a first sign-in:", e instanceof Error ? e.message : e);
  }
}

/** Who a signed-in browser is, with the records the pages need. */
export type SessionActor =
  | { kind: "member"; identity: Extract<SignInIdentity, { kind: "member" }>; member: Member; household: Household }
  | { kind: "staff"; identity: Extract<SignInIdentity, { kind: "staff" }> };

/**
 * Who a browser is signed in as right now, or null. Checked on every visit: someone whose household has ended, who has left
 * the household, or whose staff address is off the list is not signed in any more, whatever their cookie says.
 */
export async function resolveSession(deps: LoginDeps, input: { secret: unknown; now: Date }): Promise<SessionActor | null> {
  if (!isSecretShape(input.secret)) return null;
  const hash = hashSecret(input.secret);
  const subject: SessionSubject | null = await deps.auth.findSession(hash, input.now);
  if (!subject) return null;
  const state = await deps.club.read();
  const identity = identityOf(state, deps.staff, subject);
  if (!identity) {
    // They can no longer sign in, so this browser is signed out for good rather than rechecked forever.
    await deps.auth.revokeSession(hash, input.now);
    return null;
  }
  if (identity.kind === "staff") return { kind: "staff", identity };
  const member = memberById(state, identity.memberId)!;
  return { kind: "member", identity, member, household: householdOf(state, member.householdId)! };
}

/** Signs a browser out. Fine to call for a browser that is not signed in. */
export async function signOut(deps: Pick<LoginDeps, "auth">, input: { secret: unknown; now: Date }): Promise<void> {
  if (isSecretShape(input.secret)) await deps.auth.revokeSession(hashSecret(input.secret), input.now);
}

/**
 * The person this device said it was last time, if they are among the people the link opens. Remembering is a convenience for
 * partners sharing an address, not a security step: the link already proved the mailbox, and either partner could be chosen anyway.
 */
export function rememberedIdentity(identities: SignInIdentity[], remembered: unknown): SignInIdentity | null {
  const subject = parseIdentityKey(remembered);
  return subject ? (identities.find((i) => identityKey(i) === identityKey(subject)) ?? null) : null;
}

/** What the sign-in page says for a link that does not work, whatever the reason (unknown, used, out of date), so it tells a stranger nothing. */
export const LINK_PROBLEM_WORDS = "That sign-in link has expired or was already used. Ask for a new one.";
