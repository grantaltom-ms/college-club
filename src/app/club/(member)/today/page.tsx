import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { refreshWords, todayAtTheClub } from "@/club/engine/today";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { TODAY_RULES } from "@/club/settings/today-rules";
import { readClubOnce } from "@/club/store/read-once";
import { PageBand } from "../PageBand";
import { SignedOut } from "../SignedOut";
import { TodaySections } from "./TodaySections";

/**
 * Staff only: Today at the Club, where every member of staff lands after signing in. The same page for everyone, whatever their
 * job: nothing on it depends on who is looking. Who is here now, who is still to come, and a warm note by the names of people the
 * desk has not seen in a while (staff pages only; a member never sees one). No reservation times are shown, only the day, and the
 * time the figures were worked out, because a front-desk screen must never go quietly stale.
 * The Staff office keeps its own board of things that need a decision (damage, incidents, waitlists, out of service).
 */
export default async function TodayAtTheClub() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const view = todayAtTheClub(await readClubOnce(), clubNow(), TODAY_RULES, ATTENDANCE_RULES);
  const every = refreshWords(TODAY_RULES.defaults.refreshSeconds);

  return (
    <section data-testid="today-page">
      <PageBand eyebrow="Front desk" title="Today at the Club" />
      <p className="club-now-date" data-testid="today-date">
        {view.heading}
      </p>
      <p className="club-now-summary" data-testid="today-summary">
        {view.summary.words}
      </p>
      <p className="club-meta club-now-asof">
        As of{" "}
        <time dateTime={view.asOf} data-testid="today-asof">
          {view.asOfClock}
        </time>
        . This page updates itself every {every}.
      </p>
      {TODAY_RULES.placeholder && (
        <p className="club-placeholder" data-testid="today-placeholder">
          The numbers behind the &ldquo;say hello&rdquo; notes are placeholders until club staff confirm them.
        </p>
      )}
      <TodaySections here={view.here} upcoming={view.upcoming} refreshSeconds={TODAY_RULES.defaults.refreshSeconds} />
    </section>
  );
}
