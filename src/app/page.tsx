"use client";

import { WithData } from "@/components/DataProvider";
import { BAND_COLORS, bandSummary, dataRange, fmtInt, headline } from "@/lib/stats";
import type { DashboardData } from "@/lib/types";

export default function OverviewPage() {
  return (
    <>
      <h1 className="page-title">Member usage.</h1>
      <WithData>{(data) => <Overview data={data} />}</WithData>
    </>
  );
}

function Overview({ data }: { data: DashboardData }) {
  const rows = bandSummary(data.members);
  const h = headline(data.members);
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
                Members by how often they visit
              </h2>
              <p className="card-sub">A visit is any day with a door entry or a boat or class booking.</p>
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

        <section aria-labelledby="stands-out">
          <h2 className="section-title" id="stands-out">
            What stands out
          </h2>
          <ul className="facts">
            <li>
              {fmtInt(h.regulars)} members come at least four times a month. They make {h.regularEntryShare}% of all
              door entries by members.
            </li>
            <li>
              {fmtInt(h.withoutFob)} members have no door fob on file. Their visits show up only when they book a
              boat or class, so they can look quieter than they are.
            </li>
          </ul>
        </section>

        <aside className="callout" aria-label="How we count">
          <h3>How we count</h3>
          <p>
            Members are the adults on the boat-reservation roster. Staff and juniors are left out. Door entries come
            from the front-door fobs and bookings from the reservation system.
          </p>
          <p>The two systems share no ID, so members are matched by name. A few matches are close guesses.</p>
        </aside>
      </div>
    </>
  );
}
