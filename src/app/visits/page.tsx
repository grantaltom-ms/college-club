"use client";

import { ChartCard } from "@/components/ChartCard";
import { ColumnChart } from "@/components/ColumnChart";
import { WithData } from "@/components/DataProvider";
import { StackedBarChart } from "@/components/StackedBarChart";
import { useElementWidth } from "@/components/useElementWidth";
import { formatDay } from "@/lib/dates";
import { BAND_COLORS, BAND_LABELS, bandSummary, dataRange, fmtInt, headline, multiBooking, percent, quietByJoined, visitsByType } from "@/lib/stats";
import { BAND_ORDER, type DashboardData } from "@/lib/types";

const SERIES_COLORS = BAND_ORDER.map((b) => BAND_COLORS[b]);
const percentTick = (n: number) => `${n}%`;

export default function VisitsPage() {
  return (
    <>
      <h1 className="page-title">Member visits.</h1>
      <WithData>{(data) => <Visits data={data} />}</WithData>
    </>
  );
}

function Visits({ data }: { data: DashboardData }) {
  const rows = bandSummary(data.members);
  const h = headline(data.members);
  const mb = multiBooking(data.members);
  const widest = Math.max(1, ...rows.map((r) => r.members));
  const types = visitsByType(data.members);
  const cohorts = quietByJoined(data.members, data.dataThrough);
  const rosterNote = data.roster.asOf ? `Roster: ${data.roster.source}, ${formatDay(data.roster.asOf, true)}.` : `Roster: ${data.roster.source}.`;
  const complete = cohorts.filter((c) => !c.partial && c.members > 0);
  const quietest = complete.reduce<(typeof cohorts)[number] | null>((a, c) => (a === null || c.quietShare > a.quietShare ? c : a), null);
  const steadiest = complete.reduce<(typeof cohorts)[number] | null>((a, c) => (a === null || c.quietShare < a.quietShare ? c : a), null);
  const cohortTitle =
    quietest && steadiest && quietest.key !== steadiest.key
      ? `Members who joined ${quietest.phrase} are the quietest (${quietest.quietShare}% under once a month); those who joined ${steadiest.phrase} are the most regular (${steadiest.quietShare}%)`
      : "Share who visit under once a month, by when they joined";
  const typeNote = (t: (typeof types)[number]) => `${t.quietShare}% under once a month`;

  return (
    <>
      <p className="page-sub">
        {dataRange(data)}. Door entries and boat reservations for {fmtInt(h.total)} paying members.{" "}
        <span data-testid="roster-note">{rosterNote}</span>
      </p>
      {data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up members for testing, not the real club.
        </p>
      )}

      <div className="stack">
        <section className="hero" aria-label="Headline">
          <p className="hero-number num">{fmtInt(h.quiet)}</p>
          <div className="hero-copy">
            <p className="hero-lead">
              of {fmtInt(h.total)} members visited less than once a month.
            </p>
            <p className="hero-support">
              {fmtInt(h.noVisits)} had no visit at all. The other {fmtInt(h.quiet - h.noVisits)} came in, but rarely.
              {h.notStarted > 0 && <> {fmtInt(h.notStarted)} new members haven&rsquo;t started yet, so they are not in the {fmtInt(h.quiet)}.</>}
            </p>
          </div>
        </section>

        <section className="card" aria-labelledby="bands-title">
          <div className="card-head">
            <div>
              <h2 className="card-title" id="bands-title">
                {fmtInt(h.regulars)} regulars make {h.regularEntryShare}% of all member door entries
              </h2>
              <p className="card-sub">Members by how often they visit. A visit is any day with a door entry or a boat or class booking.</p>
            </div>
          </div>
          <div className="bands num" role="table" aria-label="Members by how often they visit">
            <div className="band-head" role="row">
              <span role="columnheader">Visits</span>
              <span role="columnheader">Members</span>
              <span role="columnheader">Door entries</span>
            </div>
            {rows.map((r) => (
              <div className="band-row" role="row" key={r.band} data-band={r.band}>
                <span className="band-name" role="cell">
                  {r.label}
                </span>
                <span className="band-bar-area" role="cell">
                  <span
                    className="band-bar"
                    style={{ width: `${(r.members / widest) * 70}%`, background: BAND_COLORS[r.band] }}
                    aria-hidden="true"
                  />
                  <span className="band-count">
                    {fmtInt(r.members)} <small>{r.memberShare}%</small>
                  </span>
                </span>
                <span className="band-entries" role="cell">
                  {fmtInt(r.doorEntries)}
                  <small>{r.entryShare}% of member entries</small>
                </span>
              </div>
            ))}
            {h.notStarted > 0 && (
              <div className="band-row" role="row" data-band="Not started yet">
                <span className="band-name" role="cell">
                  Not started yet
                </span>
                <span className="band-bar-area" role="cell">
                  <span
                    className="band-bar"
                    style={{ width: `${(h.notStarted / widest) * 70}%`, background: "#d4dbde" }}
                    aria-hidden="true"
                  />
                  <span className="band-count">
                    {fmtInt(h.notStarted)} <small>{percent(h.notStarted, h.total)}%</small>
                  </span>
                </span>
                <span className="band-entries" role="cell">
                  <small>Joined this year, no visit yet. Not counted as rarely visiting.</small>
                </span>
              </div>
            )}
          </div>
        </section>

        <ChartCard
          title={`Under once a month: ${types.map((t) => `${t.type} ${t.quietShare}%`).join(", ")}`}
          subtitle="Each bar is one membership type, split by how often those members visit. New members who haven't started are left out."
          legend={BAND_ORDER.map((b, i) => ({ label: BAND_LABELS[b], color: SERIES_COLORS[i] }))}
          table={{
            headers: ["Membership type", "Members", ...BAND_ORDER.map((b) => BAND_LABELS[b]), "Under 1 a month"],
            rows: types.map((t) => [t.type, fmtInt(t.members), ...t.counts.map(fmtInt), `${t.quietShare}%`]),
          }}
        >
          <StackedBarChart
            ariaLabel="Visit groups by membership type"
            colors={SERIES_COLORS}
            rows={types.map((t) => ({
              key: t.type,
              label: t.type,
              note: typeNote(t),
              values: t.counts,
              tooltip: [
                `${t.type}: ${t.quietShare}% under once a month`,
                `${fmtInt(t.members)} members`,
                ...BAND_ORDER.map((b, i) => `${BAND_LABELS[b]}: ${fmtInt(t.counts[i])}`),
              ] as [string, ...string[]],
            }))}
          />
        </ChartCard>

        <ChartCard
          title={cohortTitle}
          subtitle="Share who visit under once a month, by when their membership record was created. Members who joined before October 2019 are grouped together because the member list only holds one date for them. New members who haven't started are left out."
          table={{
            headers: ["Joined", "Members", "Under 1 a month", "Share", "Not started yet"],
            rows: cohorts.map((c) => [c.label, fmtInt(c.members), fmtInt(c.quiet), `${c.quietShare}%`, fmtInt(c.notStarted)]),
          }}
        >
          <CohortChart cohorts={cohorts} />
        </ChartCard>

        <section className="card" aria-labelledby="multi-title" data-testid="multi-booking">
          <div className="card-head">
            <div>
              <h2 className="card-title" id="multi-title">
                {fmtInt(mb.workFromClub)} members seem to use the club as a place to work
              </h2>
              <p className="card-sub">
                They often book more than once in a day, and come on weekday daytimes or evenings. That is{" "}
                {mb.workFromClubShareOfAll}% of all {fmtInt(mb.total)} members. Reservations from July to September.
              </p>
            </div>
          </div>
          <p className="multi-line" data-testid="multi-wfc">
            More broadly, <strong data-testid="multi-share">{mb.multiDayShare}%</strong> of members who booked (
            {fmtInt(mb.multiDay)} of {fmtInt(mb.booked)}) booked more than once on at least one day.
          </p>
          <details className="how">
            <summary>How we tell</summary>
            <p>
              The reservation export has no start times, so a member counts as double-booking when they have more
              bookings than booking days. {fmtInt(mb.often)} do it often (5 or more extra bookings). We set aside{" "}
              {fmtInt(mb.earlyBirds)} who mostly arrive 4 to 8 am (rowers booking two boats), {fmtInt(mb.households)}{" "}
              shared accounts for two people, and {fmtInt(mb.unknown)} with no door data. A double booking can also be a
              boat plus a class, so this is a good estimate, not a count. A day with one or more bookings counts as one
              visit everywhere else on this page.
            </p>
          </details>
        </section>

        <aside className="callout" aria-label="How we count">
          <h3>How we count</h3>
          <p>
            Members are the paying members on the QuickBooks member list, one record per household. Door entries come
            from the front-door fobs and bookings from the reservation system.
          </p>
          <p>
            The systems share no ID, so members are matched to their visits by name. A household with one set of
            visits counts once. Members with a door fob but no reservation record use door entries as visit days, which
            is approximate. Members with no record of any kind count as no visits. People who are in the reservation
            system but not on QuickBooks are not counted.
          </p>
          <p>
            New members who joined this year and haven&rsquo;t visited yet came off the waitlist and haven&rsquo;t started, so
            they are shown on their own and left out of the &ldquo;rarely visit&rdquo; counts.
          </p>
          <p>
            {fmtInt(h.withoutFob)} members have no door fob on file. Their visits show up only when they book a boat or
            class, so they can look quieter than they are.
          </p>
        </aside>
      </div>
    </>
  );
}

function CohortChart({ cohorts }: { cohorts: ReturnType<typeof quietByJoined> }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  // On a phone the group names shrink so they do not overlap, and a star marks the partial year.
  const short = width > 0 && width < 520;
  return (
    <div ref={ref}>
      <ColumnChart
        ariaLabel="Share of members who visit under once a month, by when they joined"
        columns={cohorts.map((c) => ({
          key: c.key,
          xLabel: short ? c.shortLabel : c.label,
          value: c.quietShare,
          emphasis: !c.partial,
          tooltip: [
            `${c.quietShare}% under once a month`,
            `${fmtInt(c.quiet)} of ${fmtInt(c.members)} members who joined ${c.phrase}`,
            ...(c.partial ? ["The year is not over, so this is partial"] : []),
          ] as [string, ...string[]],
        }))}
        baseColor="#a7b3b9"
        emphasisColor="#2b3a42"
        maxValue={50}
        tick={percentTick}
      />
      {short && <p className="card-sub">* 2026 is not over yet, so that group is partial.</p>}
    </div>
  );
}
