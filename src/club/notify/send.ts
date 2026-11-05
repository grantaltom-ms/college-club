import type { Mailer } from "../auth/mail";
import { noticeMail, type MailLinks } from "../engine/notice-mail";
import type { Notice } from "../engine/notices";

export interface SendResult {
  sent: number;
  failed: number;
}

/** How many emails are handed to the sender at once: enough that forty people are not forty round trips, few enough to be polite. */
const AT_ONCE = 4;

/**
 * Hands each notice to the mailer. Best effort, like every email the club sends: a failure is logged in the sender's own
 * (already scrubbed) words and never stops the others, and never undoes the change that caused the notice.
 */
export async function sendNotices(
  mailer: Mailer,
  notices: Notice[],
  links: MailLinks,
  now: Date,
  log: (line: string) => void = console.error,
): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0 };
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= notices.length) return;
      const notice = notices[i];
      try {
        await mailer.send(noticeMail(notice, links), now);
        result.sent += 1;
      } catch (e) {
        result.failed += 1;
        log(`Could not email a "${notice.kind}" notice: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, notices.length) }, worker));
  return result;
}
