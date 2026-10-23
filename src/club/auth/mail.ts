import { outboxEnabled } from "../enabled";

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

/**
 * Who sends sign-in emails on this server, or null when nobody does. Today that is the test outbox, and only where invented
 * data is allowed; with no sender the sign-in page says email sign-in is not switched on, and no sign-in link is made.
 */
export function getMailer(env: Partial<Record<string, string | undefined>> = process.env): Mailer | null {
  return outboxEnabled(env) ? outboxMailer : null;
}
