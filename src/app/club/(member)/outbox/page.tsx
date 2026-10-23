import { notFound } from "next/navigation";
import { outboxMessages } from "@/club/auth/mail";
import { outboxEnabled } from "@/club/enabled";
import { requireClub } from "@/club/guard";
import { formatClock, formatDayLong, pacificDate } from "@/club/time";

/**
 * TEST BUILDS ONLY. Nothing leaves the server in a test build; the sign-in "emails" are kept here so the whole sign-in can be
 * tried with invented people. Anyone who can see this page can sign in as anyone, so it does not exist anywhere real members
 * could be signing in (it follows the sample-data switch, not the member area's switch).
 */
export default async function Outbox() {
  await requireClub();
  if (!outboxEnabled()) notFound();
  const messages = outboxMessages();
  return (
    <section>
      <h1>Test outbox</h1>
      <p className="club-placeholder" data-testid="outbox-warning">
        <strong>Test build.</strong> No real email is sent. Emails the club would send appear here instead, newest first. This page does not exist on the live site.
      </p>
      {messages.length === 0 ? (
        <p data-testid="outbox-empty">Nothing has been sent yet.</p>
      ) : (
        <ul className="club-cards" aria-label="Test emails">
          {messages.map((m, i) => {
            const link = /\/club\/sign-in\/[A-Za-z0-9_-]{43}/.exec(m.text)?.[0];
            return (
              <li key={`${m.at}-${i}`} className="club-card" data-testid="outbox-message">
                <h3>{m.subject}</h3>
                <p className="club-meta">
                  To {m.to} · {formatDayLong(pacificDate(new Date(m.at)))}, {formatClock(m.at)}
                </p>
                <pre className="club-pre">{m.text}</pre>
                {link && (
                  <p>
                    <a href={link} className="club-button" data-testid="outbox-link">
                      Open the sign-in link
                    </a>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
