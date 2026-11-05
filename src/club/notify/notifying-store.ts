import type { Mailer } from "../auth/mail";
import type { MailLinks } from "../engine/notice-mail";
import { basisOf, noticesFromChange, type Notice, type NoticeRules } from "../engine/notices";
import type { ClubStore } from "../store/memory";
import { sendNotices } from "./send";

/**
 * A club store that tells people what a change did to them, once the change is safely saved.
 *
 * The building comparison: the clerk at the wall chart. Before each change the clerk notes who was waiting and what the board said;
 * after the change is signed off, the clerk writes a short note to each tenant whose place moved. If the change is thrown out
 * (a mistake, a clash, a failed save) no note is written, because nothing happened.
 *
 * It wraps any `ClubStore` (the in-memory sample or Postgres), so the rules engine never knows it is there, and every way of
 * changing the club (a button, a link in an email, a file of resignations) is covered without anyone remembering to send an email.
 */
export interface NotifyDeps {
  now: () => Date;
  rules: NoticeRules;
  /** Who sends right now, or null when nobody does. Asked each time, so a changed setting takes effect. */
  mailer: () => Mailer | null;
  /** The links an email may carry. Asked each time. */
  links: () => MailLinks;
  /** Runs the sending: after the response when inside a request, at once otherwise. */
  run: (job: () => Promise<void>) => Promise<void>;
  log: (line: string) => void;
}

export function notifyingStore(inner: ClubStore, deps: NotifyDeps): ClubStore {
  return {
    read: () => inner.read(),
    async transaction(fn) {
      let notices: Notice[] = [];
      const result = await inner.transaction(async (state, newId) => {
        notices = [];
        const basis = basisOf(state);
        const out = await fn(state, newId);
        try {
          notices = noticesFromChange(basis, state, deps.now(), deps.rules);
        } catch (e) {
          // Working out who to tell must never be the reason a change fails.
          deps.log(`Could not work out who to email about a change: ${e instanceof Error ? e.message : String(e)}`);
        }
        return out;
      });
      if (notices.length > 0) {
        const mailer = deps.mailer();
        if (mailer) {
          const when = deps.now();
          const list = notices;
          await deps.run(async () => {
            try {
              await sendNotices(mailer, list, deps.links(), when, deps.log);
            } catch (e) {
              deps.log(`Could not send the emails about a change: ${e instanceof Error ? e.message : String(e)}`);
            }
          });
        }
      }
      return result;
    },
  };
}
