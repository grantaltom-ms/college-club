import { clubEnabled } from "../enabled";
import { normalizeEmail } from "./email";

/** A staff sign-in: the email address that proves it is them, and the name the record shows for what they do. */
export interface StaffLogin {
  email: string;
  name: string;
}

const MOST_STAFF = 50;
const LONGEST_NAME = 80;

/**
 * What was wrong with the staff list, as a fixed word. The message names the entry (and so a private email address) so that whoever
 * edits the setting can find it; anything that shows a mistake to other eyes, such as the switch-on checklist, uses this instead.
 */
export type StaffListProblem = "too_many" | "no_equals" | "bad_email" | "no_name" | "name_too_long" | "name_has_equals" | "duplicate";

/** A mistake in the staff list, worded so someone editing the setting can fix it. The message can hold a private address; `problem` never does. */
export class StaffListError extends Error {
  constructor(
    message: string,
    readonly problem: StaffListProblem,
  ) {
    super(message);
  }
}

/**
 * Reads the staff list from the CLUB_STAFF_LOGINS setting: entries separated by semicolons or new lines, each one an email
 * address, an equals sign and a name, for example
 *
 *   alex.staffer@example.org=Alex Staffer; sam.deskwell@example.org=Sam Deskwell
 *
 * The list lives in private settings, never in the code, because it holds real people's addresses. A mistake is refused in
 * words instead of being ignored, so nobody is quietly left unable to sign in (or let in by a typo).
 */
export function parseStaffLogins(raw: string | undefined): StaffLogin[] {
  const entries = (raw ?? "")
    .split(/[;\n]/)
    .map((e) => e.trim())
    .filter((e) => e !== "");
  if (entries.length > MOST_STAFF) throw new StaffListError(`CLUB_STAFF_LOGINS lists ${entries.length} people; the most it allows is ${MOST_STAFF}.`, "too_many");
  const seen = new Set<string>();
  return entries.map((entry) => {
    const at = entry.indexOf("=");
    if (at < 0) throw new StaffListError(`CLUB_STAFF_LOGINS: "${entry}" needs an equals sign between the email address and the name, like name@example.org=Their Name.`, "no_equals");
    const email = normalizeEmail(entry.slice(0, at));
    if (!email) throw new StaffListError(`CLUB_STAFF_LOGINS: "${entry.slice(0, at).trim()}" is not an email address.`, "bad_email");
    const name = entry.slice(at + 1).trim().replace(/\s+/g, " ");
    if (name === "") throw new StaffListError(`CLUB_STAFF_LOGINS: ${email} needs a name after the equals sign.`, "no_name");
    if (name.length > LONGEST_NAME) throw new StaffListError(`CLUB_STAFF_LOGINS: the name for ${email} is longer than ${LONGEST_NAME} characters.`, "name_too_long");
    if (name.includes("=")) throw new StaffListError(`CLUB_STAFF_LOGINS: the name for ${email} cannot contain an equals sign.`, "name_has_equals");
    if (seen.has(email)) throw new StaffListError(`CLUB_STAFF_LOGINS: ${email} is listed twice.`, "duplicate");
    seen.add(email);
    return { email, name };
  });
}

/** The staff who can sign in on this server: none at all where the member area is switched off. */
export function getStaffLogins(env: Partial<Record<string, string | undefined>> = process.env): StaffLogin[] {
  if (!clubEnabled(env)) return [];
  return parseStaffLogins(env.CLUB_STAFF_LOGINS);
}
