import { clubEnabled, outboxEnabled } from "../enabled";
import { MailSettingsError, parseMailSettings } from "./mail-settings.ts";
import { createResendMailer } from "./resend.ts";

/** An email the club wants to send. Plain text only: it is a one-click sign-in link. */
export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: OutgoingMail, now: Date): Promise<void>;
}

/** An email as the test outbox keeps it. */
export interface OutboxEntry extends OutgoingMail {
  /** ISO moment it was "sent". */
  at: string;
}

const MOST = 50;
/** Shared by every part of the server (pages and handlers are bundled separately, so a module variable would not be shared). */
const SHARED = Symbol.for("ccs.club.testOutbox");
const box = () => {
  const shared = globalThis as unknown as Record<symbol, OutboxEntry[] | undefined>;
  return (shared[SHARED] ??= []);
};

/** The newest test emails first. Only meaningful in a test build. */
export function outboxMessages(): OutboxEntry[] {
  return box().map((m) => ({ ...m }));
}

export function clearOutbox(): void {
  box().length = 0;
}

/**
 * The test build's "mail": nothing leaves the server. The email is kept in memory and shown on the test outbox page, so the
 * whole sign-in can be tried with invented people. A real sender (chosen when the pilot starts) is another `Mailer`.
 */
export const outboxMailer: Mailer = {
  async send(mail, now) {
    box().unshift({ ...mail, at: now.toISOString() });
    box().length = Math.min(box().length, MOST);
  },
};

/** Mistakes in the mail settings already reported on this server, so a bad setting is logged once and not on every page view. */
const reported = new Set<string>();

/** The real sender (Resend), or null when its settings are not there or are wrong (a wrong one is logged once, in words). */
function realMailer(env: Partial<Record<string, string | undefined>>): Mailer | null {
  try {
    const settings = parseMailSettings(env);
    return settings ? createResendMailer(settings) : null;
  } catch (e) {
    if (!(e instanceof MailSettingsError)) throw e;
    if (!reported.has(e.message)) {
      reported.add(e.message);
      console.error(`Real email is not switched on: ${e.message}`);
    }
    return null;
  }
}

/**
 * Who sends sign-in emails on this server, or null when nobody does.
 *
 * - Where invented data is allowed (development, previews, automated tests) it is always the test outbox, even when Resend's
 *   settings are present, so a test build can never email anyone.
 * - Otherwise, where the member area is switched on for real members, it is Resend, when its settings are complete.
 * - Anywhere else, nobody: the sign-in page says email sign-in is not switched on, and no sign-in link is made.
 *
 * `on` exists so the tests can try the "area on, invented data off" case, which no setting reaches until switch-on.
 */
export function getMailer(
  env: Partial<Record<string, string | undefined>> = process.env,
  on: { outbox: boolean; club: boolean } = { outbox: outboxEnabled(env), club: clubEnabled(env) },
): Mailer | null {
  if (on.outbox) return outboxMailer;
  if (!on.club) return null;
  return realMailer(env);
}
