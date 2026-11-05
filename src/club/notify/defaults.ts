import { getMailer } from "../auth/mail";
import { clubNow } from "../clock";
import { rsvpLinkPath, rsvpLinkToken } from "../engine/rsvp-links";
import { getLinkSecret } from "../link-secret";
import { CLASS_RULES } from "../settings/class-rules";
import { EVENT_RULES } from "../settings/event-rules";
import { configuredSiteOrigin } from "../site-url";
import { afterResponse } from "./after";
import type { NotifyDeps } from "./notifying-store";

/** The links an email may carry on this server: only with the site's address set (there is no request to take it from), and a personal RSVP link only with the link secret too. */
function links(env: Partial<Record<string, string | undefined>> = process.env): ReturnType<NotifyDeps["links"]> {
  const site = configuredSiteOrigin(env) ?? null;
  const secret = getLinkSecret(env);
  return {
    site,
    rsvp: (eventId, memberId) => (site && secret ? `${site}${rsvpLinkPath(eventId, memberId, rsvpLinkToken(secret, eventId, memberId))}` : null),
  };
}

/** What the running server uses: the club's clock and rules, whoever `getMailer()` says sends, and the response-first delivery. */
export function defaultNotifyDeps(): NotifyDeps {
  return {
    now: clubNow,
    rules: { events: EVENT_RULES, classes: CLASS_RULES },
    mailer: () => getMailer(),
    links: () => links(),
    run: afterResponse,
    log: (line) => console.error(line),
  };
}
