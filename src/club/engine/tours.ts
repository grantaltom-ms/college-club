import type { Mailer } from "../auth/mail";
import { normalizeEmail } from "../auth/email";
import { DEFAULT_REPLY_TO } from "../auth/mail-settings";
import { ClubError } from "../errors";
import type { TourRules } from "../settings/tour-rules";
import type { NewTourRequest, TourRequest, TourStore } from "../store/tours";
import type { Actor } from "../types";

/**
 * The public "Request a tour" form. The building comparison: the card a visitor leaves at the front desk. The desk keeps every
 * card, in order, and a staff member marks it "followed up" once someone has called back. It also taps the membership office
 * on the shoulder (an email) so a card is not left unseen, but the card is saved first: a failed email never loses a request.
 */

export const NAME_MAX = 120;
export const PHONE_MAX = 40;
export const NOTE_MAX = 500;

/** Words for what a visitor typed wrongly. Every one says what to do. */
export const TOUR_WORDS = {
  name: "Please tell us your name.",
  nameLong: `Please use ${NAME_MAX} characters or fewer for your name.`,
  email: "That email address does not look right. Please check it and try again.",
  phone: "That phone number does not look right. Leave it blank, or use digits like (206) 555-0100.",
  note: `Please keep your note to ${NOTE_MAX} characters or fewer.`,
} as const;

export interface TourInput {
  name: unknown;
  email: unknown;
  phone: unknown;
  note: unknown;
  /** A field people never see. Robots that fill in every field fill this one too. */
  website: unknown;
}

export type TourFieldErrors = Partial<Record<"name" | "email" | "phone" | "note", string>>;

/** What the person typed, cleaned, or what is wrong with it (every problem at once, never just the first). */
export function cleanTourRequest(input: TourInput): { ok: true; request: NewTourRequest } | { ok: false; errors: TourFieldErrors } {
  const errors: TourFieldErrors = {};
  // Control characters (a line break in a name, a bell) never belong in these fields; a note may have ordinary line breaks.
  const flat = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "");
  const multi = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "");

  const name = flat(input.name);
  if (name === "") errors.name = TOUR_WORDS.name;
  else if (name.length > NAME_MAX) errors.name = TOUR_WORDS.nameLong;

  const email = normalizeEmail(typeof input.email === "string" ? input.email : "");
  if (!email) errors.email = TOUR_WORDS.email;

  const phone = flat(input.phone);
  if (phone !== "") {
    const digits = phone.replace(/\D/g, "");
    if (phone.length > PHONE_MAX || !/^[\d\s().+-]+$/.test(phone) || digits.length < 7 || digits.length > 15) errors.phone = TOUR_WORDS.phone;
  }

  const note = multi(input.note);
  if (note.length > NOTE_MAX) errors.note = TOUR_WORDS.note;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, request: { name, email: email!, phone, note } };
}

export type TourResult =
  | { ok: false; errors: TourFieldErrors }
  /** Too many requests are arriving across the whole site this hour. The page asks the person to phone instead. */
  | { ok: false; busy: true }
  /** `stored` is false when nothing was saved (a robot, or the same address already used its daily requests): the person still sees "thanks". */
  | { ok: true; stored: boolean; request: TourRequest | null; firstName: string };

/** The first word of a name, for "Thanks, Ada." A name that starts oddly gets no first name rather than a wrong one. */
const firstNameOf = (name: string) => (/^\p{L}[\p{L}'’-]{0,40}$/u.test(name.split(" ")[0]) ? name.split(" ")[0] : "");

/**
 * Saves a visitor's request. A robot (the hidden field filled in) and a repeat from the same address (past its daily
 * requests) are both thanked and quietly not saved, so neither learns it was refused and nobody can fill the staff's list or
 * the club's inbox. When the whole site is receiving too many, the person is asked to phone.
 */
export async function submitTourRequest(store: TourStore, rules: TourRules, input: TourInput, now: Date): Promise<TourResult> {
  const cleaned = cleanTourRequest(input);
  if (!cleaned.ok) return cleaned;
  const firstName = firstNameOf(cleaned.request.name);
  if (typeof input.website === "string" && input.website.trim() !== "") return { ok: true, stored: false, request: null, firstName };
  const saved = await store.add(cleaned.request, now, rules.defaults);
  if (saved.saved) return { ok: true, stored: true, request: saved.request, firstName };
  if (saved.reason === "busy") return { ok: false, busy: true };
  return { ok: true, stored: false, request: null, firstName };
}

/**
 * Who is told about a new request: `CLUB_TOUR_NOTIFY_TO` when it holds a usable address, otherwise the club's public membership
 * address (the same one replies to sign-in emails go to). A badly typed setting is ignored rather than losing the notice.
 */
export function tourNotifyAddress(env: Partial<Record<string, string | undefined>> = process.env): string {
  return normalizeEmail(env.CLUB_TOUR_NOTIFY_TO ?? "") ?? DEFAULT_REPLY_TO;
}

/** The email the membership office gets for a new request. Plain text. */
export function tourNoticeMail(request: TourRequest, to: string): { to: string; subject: string; text: string } {
  return {
    to,
    subject: `New tour request: ${request.name}`,
    text: [
      "A new tour request came in on the club's website.",
      "",
      `Name: ${request.name}`,
      `Email: ${request.email}`,
      `Phone: ${request.phone === "" ? "(not given)" : request.phone}`,
      `Note: ${request.note === "" ? "(none)" : request.note}`,
      "",
      "It is also saved on the Tour requests screen in the staff office. Reply to this person at the email address above, then mark it followed up there.",
    ].join("\n"),
  };
}

/**
 * Tells the membership office about a new request, best effort. The request is already saved, so a failure (no sender
 * switched on, or the mail service refusing) is only logged, in words that hold neither the key nor the person's details.
 */
export async function notifyAboutTourRequest(mailer: Mailer | null, request: TourRequest, to: string, now: Date, log: (line: string) => void = console.error): Promise<boolean> {
  if (!mailer) return false;
  try {
    await mailer.send(tourNoticeMail(request, to), now);
    return true;
  } catch (e) {
    log(`Could not email a tour request notice: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

function requireStaff(actor: Actor) {
  if (actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can do that.");
}

/** Staff only: the requests, newest first, with how many nobody has followed up yet. */
export async function listTourRequests(store: TourStore, rules: TourRules, actor: Actor): Promise<{ items: TourRequest[]; total: number; newCount: number }> {
  requireStaff(actor);
  return store.list(rules.defaults.listLimit);
}

/** Staff only: marks a request followed up, once. The record keeps who and when. */
export async function markTourFollowedUp(store: TourStore, actor: Actor, id: unknown, now: Date): Promise<TourRequest> {
  requireStaff(actor);
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new ClubError("invalid", "That tour request could not be found.");
  return store.markFollowedUp(id, actor.label, now);
}
