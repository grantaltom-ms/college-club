import { normalizeEmail } from "./email.ts";

/**
 * The real email sender's private settings. They are read from environment variables (Vercel's private settings or .env.local),
 * never from code. This file and `resend.ts` are also run straight from the command line by `npm run mail:test`, so they import
 * other files with their `.ts` ending and nothing that needs the website's build.
 */

export interface MailSettings {
  /** Resend's secret key. Never written into a message, a log line or an error. */
  apiKey: string;
  /** What appears in the From line, for example `College Club Seattle <no-reply@example.org>`. */
  from: string;
  /** Where a member's reply goes, or null when replies are not wanted. */
  replyTo: string | null;
}

/** A mistake in the mail settings, in plain words. The words never include the key. */
export class MailSettingsError extends Error {}

/**
 * Who replies go to when `CLUB_MAIL_REPLY_TO` is not set (Grant, Oct 27): the club's one public membership address, so a member
 * who did not get their link can write to a person. A test holds this to the address on the public Contact page.
 */
export const DEFAULT_REPLY_TO = "membership@collegeclubseattle.com";

const KEY_SHAPE = /^re_[A-Za-z0-9_-]{8,200}$/;
const LONGEST_NAME = 60;

type Env = Partial<Record<string, string | undefined>>;

/** `name@example.org` or `Display Name <name@example.org>`, checked the way the sign-in checks an address. Returned in the second form's shape. */
function readFrom(raw: string): string {
  const example = "for example no-reply@example.org or College Club Seattle <no-reply@example.org>";
  const named = /^([^<>]*)<([^<>]*)>$/.exec(raw);
  const name = named ? named[1].trim() : "";
  const address = normalizeEmail(named ? named[2] : raw);
  if (!address) throw new MailSettingsError(`CLUB_MAIL_FROM is not a usable email address (${example}).`);
  if (named && name === "") throw new MailSettingsError(`CLUB_MAIL_FROM has angle brackets but no name before them (${example}).`);
  if (name.length > LONGEST_NAME) throw new MailSettingsError(`CLUB_MAIL_FROM: the name is longer than ${LONGEST_NAME} characters.`);
  if (/["\\@\u0000-\u001f\u007f]/.test(name)) throw new MailSettingsError("CLUB_MAIL_FROM: the name cannot contain quotation marks, backslashes, @ signs or line breaks.");
  return name ? `${name} <${address}>` : address;
}

function readReplyTo(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  if (value === "") return DEFAULT_REPLY_TO;
  if (value.toLowerCase() === "none") return null;
  const address = normalizeEmail(value);
  if (!address) throw new MailSettingsError('CLUB_MAIL_REPLY_TO is not a usable email address. Use an address, or the word none to turn replies off.');
  return address;
}

/**
 * Reads the sender's settings: null when `RESEND_API_KEY` is not set (no real sender), the settings when they are complete, and a
 * `MailSettingsError` in plain words when they are set but wrong. A half-set sender is never quietly ignored.
 */
export function parseMailSettings(env: Env = process.env): MailSettings | null {
  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  if (apiKey === "") return null;
  if (!KEY_SHAPE.test(apiKey)) {
    throw new MailSettingsError("RESEND_API_KEY does not look like a Resend key (they start with re_). Check it was pasted whole, with no spaces or quotation marks.");
  }
  const from = env.CLUB_MAIL_FROM?.trim() ?? "";
  if (from === "") {
    throw new MailSettingsError("CLUB_MAIL_FROM is missing. Set it to the address the emails come from, for example no-reply@example.org or College Club Seattle <no-reply@example.org>.");
  }
  return { apiKey, from: readFrom(from), replyTo: readReplyTo(env.CLUB_MAIL_REPLY_TO) };
}
