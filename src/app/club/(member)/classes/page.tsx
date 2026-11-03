import Link from "next/link";
import { clubNow } from "@/club/clock";
import { classCatalog } from "@/club/engine/class-catalog";
import { chairsText, yoursText } from "@/club/engine/class-words";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { formatDayLong, formatRange, pacificDate } from "@/club/time";
import { viewerOf } from "@/club/web-actor";
import { ClassPlaceholderNote } from "../PlaceholderNote";
import { SignedOut } from "../SignedOut";

/**
 * Fitness classes bulletin: every kind of class with its usual days and times, read from the
 * dated sessions staff have scheduled. Tap a date to sign up. (Google Calendar connect is later.)
 */
export default async function ClassesPage() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const viewer = viewerOf(actor);
  const catalog = classCatalog(state, now, viewer);

  return (
    <section className="club-classes-catalog">
      <header className="club-page-head">
        <div>
          <h1>Fitness classes</h1>
          <p className="club-meta">Every class with its usual days. Tap a date to take a place.</p>
        </div>
        {actor.kind === "staff" && (
          <p className="club-page-actions">
            <Link href="/club/classes/manage" className="club-button club-button-link">
              Set up classes and sessions
            </Link>
          </p>
        )}
      </header>
      <ClassPlaceholderNote />

      {catalog.length === 0 && (
        <p className="club-empty-inline" data-testid="no-classes">
          No classes are scheduled in the next two weeks.
        </p>
      )}

      <ul className="club-class-catalog" aria-label="Fitness classes">
        {catalog.map((entry) => {
          const next = entry.upcoming[0];
          return (
            <li key={entry.template.id} className="club-class-catalog-card" data-testid="class-card" data-class={entry.template.name}>
              <header className="club-class-catalog-head">
                <h2>
                  <Link href={`/club/classes/${next.session.id}`}>{entry.template.name}</Link>
                </h2>
                <p className="club-class-catalog-when" data-testid="class-schedule">
                  {entry.scheduleWords}
                </p>
                <p className="club-meta">
                  {[entry.roomName, entry.template.instructor].filter(Boolean).join(" · ")}
                </p>
                {entry.template.description ? <p className="club-class-catalog-blurb">{entry.template.description}</p> : null}
              </header>

              <ul className="club-class-catalog-dates" aria-label={`Upcoming ${entry.template.name}`}>
                {entry.upcoming.map((view) => {
                  const yours = yoursText(view.yours);
                  const label = `${formatDayLong(pacificDate(new Date(view.session.startsAt)))}, ${formatRange(view.session.startsAt, view.session.endsAt)}`;
                  return (
                    <li key={view.session.id} className="club-class-catalog-date" data-testid="class-session" data-session={view.session.id}>
                      <Link href={`/club/classes/${view.session.id}`} className="club-class-catalog-date-link">
                        {label}
                      </Link>
                      <p className="club-meta">
                        <span data-testid="class-chairs">{chairsText(view)}</span>
                        {yours ? ` · ${yours}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
