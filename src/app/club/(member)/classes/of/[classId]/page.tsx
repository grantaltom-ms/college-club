import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { classCatalogEntry } from "@/club/engine/class-catalog";
import { chairsText, yoursText } from "@/club/engine/class-words";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { formatDayLong, formatRange, pacificDate } from "@/club/time";
import { viewerOf } from "@/club/web-actor";
import { ClassPlaceholderNote } from "../../../PlaceholderNote";
import { SignedOut } from "../../../SignedOut";
import { PageBand } from "../../../PageBand";

/**
 * One kind of class and its upcoming dated sessions, soonest first. Members pick a date here to sign up.
 */
export default async function ClassOfPage({ params }: { params: Promise<{ classId: string }> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;

  const { classId } = await params;
  const now = clubNow();
  const state = await (await getClubStore()).read();
  const template = state.classes.find((c) => c.id === classId);
  if (!template) notFound();

  const viewer = viewerOf(actor);
  const entry = classCatalogEntry(state, now, viewer, classId);
  const roomName = entry?.roomName ?? (template.roomItemId ? (state.items.find((i) => i.id === template.roomItemId)?.name ?? null) : null);
  const scheduleWords = entry?.scheduleWords ?? "No upcoming dates.";
  const upcoming = entry?.upcoming ?? [];

  return (
    <section className="club-class-of">
      <PageBand eyebrow="Fitness class" title={template.name} />
      <p>
        <Link href="/club/classes">All fitness classes</Link>
      </p>
      <p className="club-class-catalog-when" data-testid="class-schedule">
        {[scheduleWords, roomName].filter(Boolean).join(" · ")}
      </p>
      {template.instructor ? <p className="club-meta">with {template.instructor}</p> : null}
      <ClassPlaceholderNote />
      {template.description ? <p className="club-class-catalog-blurb">{template.description}</p> : null}

      {upcoming.length === 0 ? (
        <p className="club-empty-inline" data-testid="no-class-sessions">
          No upcoming sessions in the next six weeks.
        </p>
      ) : (
        <>
          <h2>Upcoming dates</h2>
          <ul className="club-class-of-dates" aria-label={`Upcoming ${template.name}`}>
            {upcoming.map((view) => {
              const yours = yoursText(view.yours);
              const day = formatDayLong(pacificDate(new Date(view.session.startsAt)));
              const when = formatRange(view.session.startsAt, view.session.endsAt);
              const open = view.session.status === "scheduled" && Date.parse(view.session.startsAt) > now.getTime();
              const action =
                yours != null
                  ? yours.startsWith("You have")
                    ? "Your place"
                    : "Your waitlist place"
                  : view.full
                    ? "Join waitlist"
                    : "Sign up";
              return (
                <li key={view.session.id} className="club-class-of-date" data-testid="class-session" data-session={view.session.id}>
                  <div>
                    <p className="club-class-of-when">
                      {day}, {when}
                      {view.roomName ? ` · ${view.roomName}` : ""}
                    </p>
                    <p className="club-meta">
                      <span data-testid="class-chairs">{chairsText(view)}</span>
                      {yours ? ` · ${yours}` : ""}
                    </p>
                  </div>
                  {open ? (
                    <Link href={`/club/classes/${view.session.id}`} className="club-button club-button-link" data-testid="session-signup">
                      {action}
                    </Link>
                  ) : (
                    <span className="club-meta">Closed</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
