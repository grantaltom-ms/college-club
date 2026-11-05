import Link from "next/link";
import { headers } from "next/headers";
import { clubNow } from "@/club/clock";
import { classCalendarSubscribeUrls } from "@/club/engine/class-calendar";
import { classCatalog } from "@/club/engine/class-catalog";
import { sessionView } from "@/club/engine/classes";
import { chairsText, yoursText } from "@/club/engine/class-words";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { CLASS_RULES } from "@/club/settings/class-rules";
import { getClubStore } from "@/club/store/instance";
import { addDays, formatDay, formatDayLong, formatRange, pacificDate, weekdayName } from "@/club/time";
import type { ClubState } from "@/club/types";
import { pickDay } from "@/club/web";
import { viewerOf } from "@/club/web-actor";
import { ClassPlaceholderNote } from "../PlaceholderNote";
import { SignedOut } from "../SignedOut";
import { PageBand } from "../PageBand";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

const shortDay = (day: string) => `${weekdayName(day).slice(0, 3)} ${formatDay(day).replace(/, \d{4}$/, "")}`;

/**
 * Fitness classes: a bulletin of every class with its usual days (primary), or the day-by-day board
 * (secondary). Usual days come from dated sessions staff have already scheduled — not from Google Calendar.
 */
export default async function ClassesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const params = await searchParams;
  const viewer = viewerOf(actor);
  // ?view=day (or a leftover ?day= bookmark) opens the day board; otherwise the bulletin.
  const byDay = one(params.view) === "day" || one(params.day) != null;
  const calendar = await calendarLinks();

  return (
    <section className={byDay ? "club-classes-day" : "club-classes-catalog"}>
      <PageBand eyebrow="Classes" title="Fitness classes">
        {actor.kind === "staff" && (
          <Link href="/club/classes/manage" className="club-button club-button-link">
            Set up classes and sessions
          </Link>
        )}
      </PageBand>
      <p className="club-meta club-band-facts">
        {byDay ? "Pick a day, see places left, and take a place." : "Every class with its usual days. Tap a class to see dates and sign up."}
      </p>
      <ClassPlaceholderNote />

      <nav aria-label="How to browse classes" className="club-chips" data-testid="classes-view-toggle">
        <Link href="/club/classes" aria-current={byDay ? undefined : "page"}>
          Classes
        </Link>
        <Link href="/club/classes?view=day" aria-current={byDay ? "page" : undefined}>
          By day
        </Link>
      </nav>

      {!byDay && <CalendarSubscribe calendar={calendar} />}

      {byDay ? <DayBoard state={state} now={now} viewer={viewer} params={params} /> : <ClassBulletin state={state} now={now} viewer={viewer} />}
    </section>
  );
}

/** Absolute feed addresses when we know this site's origin; otherwise a same-site path. */
async function calendarLinks(): Promise<{ https: string; webcal: string | null }> {
  const configured = process.env.CLUB_SITE_URL?.trim();
  if (configured) {
    try {
      const origin = new URL(configured).origin;
      if (origin.startsWith("http")) {
        const urls = classCalendarSubscribeUrls(origin);
        return { https: urls.https, webcal: urls.webcal };
      }
    } catch {
      // fall through
    }
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (host) {
    const urls = classCalendarSubscribeUrls(`${proto}://${host}`);
    return { https: urls.https, webcal: urls.webcal };
  }
  return { https: "/api/club/classes/calendar", webcal: null };
}

function CalendarSubscribe({ calendar }: { calendar: { https: string; webcal: string | null } }) {
  return (
    <aside className="club-class-calendar" data-testid="class-calendar-subscribe">
      <h2 className="club-class-calendar-title">Add to your calendar</h2>
      <p className="club-meta">
        Subscribe once in Google Calendar, Apple Calendar or Outlook. Class dates update when the club changes the schedule. Signing up for a place still happens here.
      </p>
      <p className="club-quiet-links">
        {calendar.webcal ? (
          <a href={calendar.webcal} data-testid="calendar-webcal">
            Subscribe on this device
          </a>
        ) : null}
        {calendar.webcal ? " · " : null}
        <a href={calendar.https} data-testid="calendar-ics">
          Calendar feed (.ics)
        </a>
      </p>
    </aside>
  );
}

function ClassBulletin({ state, now, viewer }: { state: ClubState; now: Date; viewer: ReturnType<typeof viewerOf> }) {
  const catalog = classCatalog(state, now, viewer);

  return (
    <>
      {catalog.length === 0 && (
        <p className="club-empty-inline" data-testid="no-classes">
          No classes are scheduled in the next six weeks.
        </p>
      )}

      <ul className="club-class-catalog" aria-label="Fitness classes">
        {catalog.map((entry) => (
          <li key={entry.template.id} className="club-class-catalog-card" data-testid="class-card" data-class={entry.template.name}>
            <h2>
              <Link href={`/club/classes/of/${entry.template.id}`}>{entry.template.name}</Link>
            </h2>
            <p className="club-class-catalog-when" data-testid="class-schedule">
              {entry.summaryWords}
            </p>
            {entry.template.instructor ? <p className="club-meta">with {entry.template.instructor}</p> : null}
            {entry.template.description ? <p className="club-class-catalog-blurb">{entry.template.description}</p> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function DayBoard({ state, now, viewer, params }: { state: ClubState; now: Date; viewer: ReturnType<typeof viewerOf>; params: Search }) {
  const today = pacificDate(now);
  const days = Array.from({ length: CLASS_RULES.defaults.signUpDaysAhead + 1 }, (_, n) => addDays(today, n));
  const { day, note: dayNote } = pickDay(params.day, days);
  const sessions = state.sessions.filter((x) => pacificDate(new Date(x.startsAt)) === day).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const busyDays = new Set(state.sessions.filter((x) => x.status === "scheduled").map((x) => pacificDate(new Date(x.startsAt))));

  return (
    <>
      {dayNote && (
        <p className="club-alert" role="status" data-testid="day-note">
          {dayNote}
        </p>
      )}

      <nav aria-label="Pick a day" className="club-chips">
        {days.map((d) => (
          <Link key={d} href={`/club/classes?view=day&day=${d}`} aria-current={d === day ? "page" : undefined}>
            {d === today ? "Today" : shortDay(d)}
            {busyDays.has(d) ? "" : " ·"}
          </Link>
        ))}
      </nav>

      <h2 data-testid="day-heading">{formatDayLong(day)}</h2>
      {sessions.length === 0 && (
        <p className="club-empty-inline" data-testid="no-classes">
          No classes this day.
        </p>
      )}
      <ul className="club-cards" aria-label="Classes this day">
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
    </>
  );
}
