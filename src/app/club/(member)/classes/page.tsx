import Link from "next/link";
import { clubNow } from "@/club/clock";
import { sessionView } from "@/club/engine/classes";
import { chairsText, yoursText } from "@/club/engine/class-words";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { CLASS_RULES } from "@/club/settings/class-rules";
import { getClubStore } from "@/club/store/instance";
import { addDays, formatDay, formatDayLong, formatRange, pacificDate, weekdayName } from "@/club/time";
import { pickDay } from "@/club/web";
import { viewerOf } from "@/club/web-actor";
import { ClassPlaceholderNote } from "../PlaceholderNote";
import { SignedOut } from "../SignedOut";

const shortDay = (day: string) => `${weekdayName(day).slice(0, 3)} ${formatDay(day).replace(/, \d{4}$/, "")}`;

export default async function ClassesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const params = await searchParams;
  const today = pacificDate(now);
  const days = Array.from({ length: CLASS_RULES.defaults.signUpDaysAhead + 1 }, (_, n) => addDays(today, n));
  const { day, note: dayNote } = pickDay(params.day, days);
  const viewer = viewerOf(actor);
  const sessions = state.sessions.filter((x) => pacificDate(new Date(x.startsAt)) === day).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const busyDays = new Set(state.sessions.filter((x) => x.status === "scheduled").map((x) => pacificDate(new Date(x.startsAt))));

  return (
    <section>
      <h1>Fitness classes</h1>
      <ClassPlaceholderNote />
      {dayNote && (
        <p className="club-alert" role="status" data-testid="day-note">
          {dayNote}
        </p>
      )}
      {actor.kind === "staff" && (
        <p>
          <Link href="/club/classes/manage">Set up classes and sessions</Link>
        </p>
      )}

      <nav aria-label="Pick a day" className="club-chips">
        {days.map((d) => (
          <Link key={d} href={`/club/classes?day=${d}`} aria-current={d === day ? "page" : undefined}>
            {d === today ? "Today" : shortDay(d)}
            {busyDays.has(d) ? "" : " ·"}
          </Link>
        ))}
      </nav>

      <h2 data-testid="day-heading">{formatDayLong(day)}</h2>
      {sessions.length === 0 && <p data-testid="no-classes">No classes this day.</p>}
      <ul className="club-cards" aria-label="Classes">
        {sessions.map((session) => {
          const view = sessionView(state, session, viewer);
          const yours = yoursText(view.yours);
          return (
            <li key={session.id} className="club-card" data-testid="class-card" data-class={view.template.name} data-session={session.id}>
              <h3>
                <Link href={`/club/classes/${session.id}`}>{view.template.name}</Link>
              </h3>
              <p>
                {formatRange(session.startsAt, session.endsAt)}
                {view.roomName ? ` · ${view.roomName}` : ""}
                {view.template.instructor ? ` · ${view.template.instructor}` : ""}
              </p>
              <p className="club-meta">
                <span data-testid="class-chairs">{chairsText(view)}</span>
                {session.status === "cancelled" && session.cancelReason ? `: ${session.cancelReason}` : ""}
                {yours ? ` · ${yours}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
