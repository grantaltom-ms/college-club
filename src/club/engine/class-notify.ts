import type { Mailer, OutgoingMail } from "../auth/mail";
import type { ClassSession } from "../types";
import { formatDayLong, formatRange, pacificDate } from "../time";
import type { AffectedSignUp } from "./classes";

/** One person's place on a cancelled class, for the email. */
export interface ClassCancelNotice {
  className: string;
  /** "Saturday, Oct 31, 7:30 to 8:30 am" */
  when: string;
  roomName: string | null;
  reason: string;
  person: Pick<AffectedSignUp, "name" | "email" | "status">;
}

/** Pacific day and clock range for a session, matching the class page. */
export function classWhenWords(session: Pick<ClassSession, "startsAt" | "endsAt">): string {
  return `${formatDayLong(pacificDate(new Date(session.startsAt)))}, ${formatRange(session.startsAt, session.endsAt)}`;
}

/** The email one signed-up or waiting member gets when staff cancel their class. Plain text. */
export function classCancelMail(notice: ClassCancelNotice): OutgoingMail {
  const first = notice.person.name.trim().split(/\s+/)[0] || "there";
  const place =
    notice.person.status === "waitlisted"
      ? "You were on the waiting list for this class."
      : "You had a place in this class.";
  const where = notice.roomName ? ` at ${notice.roomName}` : "";
  return {
    to: notice.person.email,
    subject: `Class cancelled: ${notice.className}`,
    text: [
      `Hello ${first},`,
      "",
      `${notice.className} on ${notice.when}${where} has been cancelled.`,
      "",
      `Reason: ${notice.reason}`,
      "",
      place,
      "You do not need to do anything. Your place is released.",
      "",
      "If you have questions, reply to this email or ask club staff.",
      "",
      "College Club Seattle",
    ].join("\n"),
  };
}

export interface ClassCancelNotifyResult {
  /** How many emails left the mailer successfully. */
  sent: number;
  /** How many people we tried to email but the send failed. */
  failed: number;
  /** How many people had no usable email address. */
  skipped: number;
}

/**
 * Emails everyone who was on the sheet when the class was cancelled. Best effort: a failed send never
 * undoes the cancellation. With no mailer switched on, nothing is sent and the counts stay at zero.
 */
export async function notifyClassCancelled(
  mailer: Mailer | null,
  notice: Omit<ClassCancelNotice, "person">,
  affected: AffectedSignUp[],
  now: Date,
  log: (line: string) => void = console.error,
): Promise<ClassCancelNotifyResult> {
  const result: ClassCancelNotifyResult = { sent: 0, failed: 0, skipped: 0 };
  if (!mailer || affected.length === 0) return result;
  for (const person of affected) {
    const email = person.email.trim();
    if (!email) {
      result.skipped += 1;
      continue;
    }
    try {
      await mailer.send(classCancelMail({ ...notice, person: { name: person.name, email, status: person.status } }), now);
      result.sent += 1;
    } catch (e) {
      result.failed += 1;
      log(`Could not email a class cancellation notice: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}
