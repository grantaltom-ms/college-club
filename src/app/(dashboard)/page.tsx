"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { WithData } from "@/components/DataProvider";
import { useJson, type JsonState } from "@/components/useJson";
import { formatDay } from "@/lib/dates";
import { listJump, listSize, quarterVsYearAgo, weeklyByQuarter, fmtPct, type EmailData } from "@/lib/mailchimp";
import { latestMonth, monthLabel, reconciliationFlags } from "@/lib/membership";
import { changePct, yearToDate, type ShellData } from "@/lib/shells";
import { bookingYearOverYear, fmtInt, headline, multiBooking, yearOverYear } from "@/lib/stats";
import { fmtChange, storyLines } from "@/lib/summary";
import type { DashboardData, MembershipData } from "@/lib/types";

/** The iCrew-based "rarely visit" count the board saw before Oct 22, 2026, when the roster switched to QuickBooks. */
const ICREW_QUIET_BEFORE = 185;

export default function SummaryPage() {
  const shells = useJson<ShellData>("/api/shells", "The shell figures could not be loaded.");
  const email = useJson<EmailData>("/api/email", "The email figures could not be loaded.");
  const membership = useJson<MembershipData>("/api/membership", "The membership figures could not be loaded.");
  return (
    <>
      <h1 className="page-title">How the club is doing.</h1>
      <WithData>{(data) => <Summary data={data} shells={shells.state} email={email.state} membership={membership.state} />}</WithData>
    </>
  );
}

interface CardProps {
  area: string;
  value: string;
  lead: string;
  detail?: ReactNode;
  /** A second small line under the detail. */
  note?: string;
  /** Why the number moved after the roster switch, under the note. */
  rosterChange?: string;
  href: string;
  linkText: string;
  testId: string;
}

/** One headline number: what it is, how it compares with last year, and where to read more. */
function StatCard({ area, value, lead, detail, note, rosterChange, href, linkText, testId }: CardProps) {
  return (
    <section className="stat-card" aria-label={area} data-testid={testId}>
      <h2 className="stat-area">{area}</h2>
      <p className="stat-value num">{value}</p>
      <p className="stat-lead">{lead}</p>
      {detail && <p className="stat-detail">{detail}</p>}
      {note && (
        <p className="stat-detail" data-testid={`${testId}-note`}>
          {note}
        </p>
      )}
      {rosterChange && (
        <p className="stat-detail" data-testid={`${testId}-roster-change`}>
          {rosterChange}
        </p>
      )}
      <p className="stat-target">Board target: not set yet</p>
      <Link className="stat-link" href={href}>
        {linkText} <span aria-hidden="true">&rarr;</span>
      </Link>
    </section>
  );
}

function Pending({ area, state }: { area: string; state: JsonState<unknown> }) {
  return (
    <section className="stat-card" aria-label={area}>
      <h2 className="stat-area">{area}</h2>
      <p className="stat-detail" role={state.status === "loading" ? "status" : undefined}>
        {state.status === "error" ? state.message : "Loading"}
      </p>
    </section>
  );
}

function Summary({ data, shells, email, membership }: { data: DashboardData; shells: JsonState<ShellData>; email: JsonState<EmailData>; membership: JsonState<MembershipData> }) {
  const h = headline(data.members);
  const mb = multiBooking(data.members);
  const door = yearOverYear(data.door);
  const bookings = bookingYearOverYear(data.totals);

  let shellNow: { year: number; outings: number } | null = null;
  let shellBefore: { year: number; outings: number } | null = null;
  let shellChange: number | null = null;
  let rowersNow: number | null = null;
  let rowersBefore: number | null = null;
  if (shells.status === "ready") {
    const ytd = yearToDate(shells.data.outings, shells.data.through);
    shellNow = ytd[ytd.length - 1] ?? null;
    shellBefore = ytd.length > 1 ? ytd[ytd.length - 2] : null;
    shellChange = shellNow && shellBefore ? changePct(shellNow.outings, shellBefore.outings) : null;
    rowersNow = shells.data.rowers.find((r) => r.year === shellNow?.year)?.sameDates ?? null;
    rowersBefore = shells.data.rowers.find((r) => r.year === shellBefore?.year)?.sameDates ?? null;
  }

  const story = storyLines({ doorChange: door?.change ?? null, shellChange, rowersNow, rowersBefore });

  const dates: string[] = [`member visits ${formatDay(data.dataThrough, true)}`];
  const lastDoor = data.door.periods[data.door.periods.length - 1]?.lastDay;
  if (lastDoor) dates.push(`front door ${formatDay(lastDoor, true)}`);
  if (shells.status === "ready") dates.push(`shells ${formatDay(shells.data.through, true)}`);
  if (email.status === "ready" && email.data.through) dates.push(`email ${formatDay(email.data.through, true)}`);
  if (membership.status === "ready") {
    const latest = latestMonth(membership.data.months);
    if (latest) dates.push(`membership ${monthLabel(latest)}`);
  }

  return (
    <>
      <p className="page-sub">
        The numbers the board watches, each against the same dates last year. Open a card for the detail behind it.
      </p>
      {data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up numbers for testing, not the real club.
        </p>
      )}

      <div className="stack">
        {story.length > 0 && (
          <section className="story" aria-label="What this means" data-testid="story">
            {story.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </section>
        )}

        <div className="stat-grid">
          <StatCard
            testId="card-quiet"
            area="Members who rarely visit"
            value={fmtInt(h.quiet)}
            lead={`of ${fmtInt(h.total)} members came in less than once a month this year (${h.quietShare}%).`}
            detail={`${fmtInt(h.noVisits)} have not come in at all.`}
            note={h.notStarted > 0 ? `${fmtInt(h.notStarted)} new members haven't started yet (off the waitlist).` : undefined}
            rosterChange={`Down from ${fmtInt(ICREW_QUIET_BEFORE)} because the count now uses the QuickBooks list of paying members (${fmtInt(h.total)}) instead of the iCrew list. Club usage didn’t improve; the list of who counts as a member changed.`}
            href="/visits"
            linkText="Visits"
          />

          {shells.status === "ready" && shellNow ? (
            <StatCard
              testId="card-shells"
              area="Club shell outings"
              value={shellChange === null ? fmtInt(shellNow.outings) : fmtChange(shellChange)}
              lead={
                shellBefore
                  ? `${fmtInt(shellNow.outings)} outings so far in ${shellNow.year}, against ${fmtInt(shellBefore.outings)} by the same date in ${shellBefore.year}.`
                  : `${fmtInt(shellNow.outings)} outings so far in ${shellNow.year}.`
              }
              detail={
                rowersNow !== null
                  ? `${fmtInt(rowersNow)} different members rowed a club shell${rowersBefore !== null ? `, against ${fmtInt(rowersBefore)} last year` : ""}.`
                  : undefined
              }
              href="/shells"
              linkText="Shells"
            />
          ) : (
            <Pending area="Club shell outings" state={shells} />
          )}

          {door && (
            <StatCard
              testId="card-door"
              area="Front-door entries"
              value={fmtChange(door.change)}
              lead={`${fmtInt(door.thisYear)} entries from ${door.fromLabel} to ${door.toLabel} ${door.year}, against ${fmtInt(door.lastYear)} in ${door.previousYear}.`}
              href="/timing"
              linkText="Timing"
            />
          )}

          {bookings && (
            <StatCard
              testId="card-bookings"
              area="Reservations"
              value={fmtChange(bookings.change)}
              lead={`${fmtInt(bookings.thisYear)} reservations from ${bookings.fromLabel} to ${bookings.toLabel} ${bookings.year}, against ${fmtInt(bookings.lastYear)} in ${bookings.previousYear}.`}
              detail="Every booking in iCrew: gym, dock, shells, rooms, paddle boards and more."
              href="/reservations"
              linkText="Reservations"
            />
          )}

          <StatCard
            testId="card-work"
            area="Working from the club"
            value={fmtInt(mb.workFromClub)}
            lead={`members often book more than once a day, on weekday daytimes or evenings (${mb.workFromClubShareOfAll}% of members).`}
            detail="A good estimate from July to September bookings and door times, not an exact count."
            href="/visits"
            linkText="Visits"
          />

          <EmailCard state={email} />

          <MembershipCard state={membership} />
        </div>

        <p className="data-dates" data-testid="data-dates">
          Data through: {dates.join(" · ")}.
        </p>
        <p className="data-dates" data-testid="roster-note">
          {data.roster.asOf ? `Roster: ${data.roster.source}, ${formatDay(data.roster.asOf, true)}.` : `Roster: ${data.roster.source}.`}
        </p>
      </div>
    </>
  );
}

function MembershipCard({ state }: { state: JsonState<MembershipData> }) {
  if (state.status !== "ready") return <Pending area="Membership" state={state} />;
  const latest = latestMonth(state.data.months);
  if (!latest) return <Pending area="Membership" state={{ status: "error", message: "No membership counts yet." }} />;
  const flag = reconciliationFlags([latest])[0];
  return (
    <StatCard
      testId="card-membership"
      area="Membership"
      value={fmtInt(latest.withApprovals)}
      lead={`${fmtInt(latest.resignations)} left and ${fmtInt(latest.applicants)} applied in ${monthLabel(latest)}.`}
      detail={`${latest.transferred !== null ? `${fmtInt(latest.transferred)} transferred. ` : ""}Waitlist ${latest.waitlist !== null ? fmtInt(latest.waitlist) : "not shown"}.`}
      note={flag ? `Figure that doesn't add up: ${flag}` : undefined}
      href="/membership"
      linkText="Membership"
    />
  );
}

function EmailCard({ state }: { state: JsonState<EmailData> }) {
  if (state.status !== "ready") return <Pending area="Email" state={state} />;
  const campaigns = state.data.campaigns;
  const points = listSize(campaigns, 30);
  const latest = points[points.length - 1];
  if (!latest) return <Pending area="Email" state={{ status: "error", message: "No Watercooler sends yet." }} />;
  const jump = listJump(points);
  const q = quarterVsYearAgo(weeklyByQuarter(campaigns), state.data.through);
  const clicks = q ? `Watercooler clicks: ${fmtPct(q.now.clickRate)} in ${q.now.label}${q.yearAgo ? `, ${fmtPct(q.yearAgo.clickRate)} a year before` : ""}.` : undefined;
  return (
    <StatCard
      testId="card-email"
      area="Email reach"
      value={fmtInt(latest.delivered)}
      lead={
        jump
          ? `people got the latest Watercooler. The list jumped from ${fmtInt(jump.from)} to ${fmtInt(jump.to)} on ${formatDay(jump.on)}, and ${jump.spikesSince} of ${jump.sendsSince} sends since had high unsubscribes.`
          : "people got the latest Watercooler."
      }
      detail={clicks}
      href="/email"
      linkText="Email"
    />
  );
}
