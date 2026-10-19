"use client";

import { WithData } from "@/components/DataProvider";
import { BAND_COLORS, bandSummary, dataRange, fmtInt, headline, multiBooking } from "@/lib/stats";
import type { DashboardData } from "@/lib/types";

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

  return (
    <>
      <p className="page-sub">
        {dataRange(data)}. Door entries and boat reservations for {fmtInt(h.total)} adult members.
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
          </div>
        </section>

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
            Members are the adults on the boat-reservation roster. Staff and juniors are left out. Door entries come
            from the front-door fobs and bookings from the reservation system.
          </p>
          <p>The two systems share no ID, so members are matched by name. A few matches are close guesses.</p>
          <p>
            {fmtInt(h.withoutFob)} members have no door fob on file. Their visits show up only when they book a boat or
            class, so they can look quieter than they are.
          </p>
        </aside>
      </div>
    </>
  );
}
