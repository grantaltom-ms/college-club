"use client";

import { useEffect, useState } from "react";
import { ChartCard } from "@/components/ChartCard";
import { ColumnChart, type Column } from "@/components/ColumnChart";
import { GroupedColumnChart } from "@/components/GroupedColumnChart";
import { formatDay } from "@/lib/dates";
import {
  boatChanges,
  byBoat,
  byStartHour,
  changePct,
  monthCompare,
  seatLabel,
  shellYears,
  yearToDate,
  type ShellData,
} from "@/lib/shells";
import { fmtInt } from "@/lib/stats";

const BASE = "#536872";
/** Older year light, newest year dark, the same as the Timing page. */
const YEAR_COLORS = ["#a7b3b9", "#2b3a42"];
/** Color for year `i` of `n`, so the newest year is always the dark one. */
const yearColor = (i: number, n: number) => YEAR_COLORS[Math.max(0, YEAR_COLORS.length - n + i)];

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ShellData };

async function load(): Promise<State> {
  try {
    const res = await fetch("/api/shells", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) return { status: "error", message: body?.error ?? "The shell figures could not be loaded." };
    return { status: "ready", data: body as ShellData };
  } catch {
    return { status: "error", message: "The shell figures could not be loaded. Check your connection and try again." };
  }
}

export default function ShellsPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <>
      <h1 className="page-title">Shells.</h1>
      {state.status === "loading" && (
        <p className="status" role="status">
          Loading shell figures
        </p>
      )}
      {state.status === "error" && (
        <div className="status-error" role="alert">
          <p>{state.message}</p>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {state.status === "ready" && <Shells data={state.data} />}
    </>
  );
}

const changeText = (change: number | null) => (change === null ? "—" : `${change > 0 ? "+" : ""}${change}%`);
const moreOrFewer = (change: number) => `${Math.abs(change)}% ${change >= 0 ? "more" : "fewer"}`;

function Shells({ data }: { data: ShellData }) {
  const years = shellYears(data.outings);
  const [chosen, setChosen] = useState<number | null>(null);
  const year = chosen !== null && years.includes(chosen) ? chosen : years[years.length - 1];
  const cutoffLabel = formatDay(data.through);

  const ytd = yearToDate(data.outings, data.through);
  const now = ytd[ytd.length - 1];
  const before = ytd.length > 1 ? ytd[ytd.length - 2] : null;
  const ytdChange = before ? changePct(now.outings, before.outings) : null;
  const memberChange = before ? changePct(now.member, before.member) : null;
  const rowersNow = data.rowers.find((r) => r.year === now?.year);
  const rowersBefore = before ? data.rowers.find((r) => r.year === before.year) : undefined;

  const compare = monthCompare(data.outings, data.through);
  const boats = byBoat(data.outings, data.through);
  const boatMax = Math.max(1, ...boats.rows.flatMap((b) => b.sameDates));
  const hours = byStartHour(data.outings, year);
  const [allBoats, setAllBoats] = useState(false);
  const changes = boatChanges(boats.rows);
  const newest = compare.years[compare.years.length - 1];
  const oldest = compare.years[0];

  if (!now) return <p className="status">There are no shell outings yet.</p>;

  const compareGroups = compare.rows.map((r) => ({
    key: String(r.month),
    xLabel: r.label,
    values: r.years.map((m) => (m?.complete ? m.member + m.team : 0)),
    tooltip: [
      r.change === null ? r.label : `${r.label}: ${moreOrFewer(r.change)} outings in ${newest}`,
      ...r.years.map((m, i) => {
        const y = compare.years[i];
        if (!m || m.member + m.team === 0) return `${y}: no data`;
        const split = `(${fmtInt(m.member)} member, ${fmtInt(m.team)} camp/team)`;
        return m.complete ? `${y}: ${fmtInt(m.member + m.team)} ${split}` : `${y}: ${fmtInt(m.member + m.team)} so far ${split}`;
      }),
    ] as [string, ...string[]],
  }));

  const hourColumns: Column[] = hours.map((h) => ({
    key: String(h.hour),
    xLabel: h.hour % 3 === 0 ? h.label : null,
    value: h.outings,
    tooltip: [`${fmtInt(h.outings)} outings`, `Starting ${h.label}`],
  }));
  const peak = [...hours].sort((a, b) => b.outings - a.outings)[0];
  const hourTotal = hours.reduce((sum, h) => sum + h.outings, 0);
  const early = hours.filter((h) => h.hour < 9).reduce((sum, h) => sum + h.outings, 0);
  const earlyShare = hourTotal ? Math.round((early / hourTotal) * 100) : 0;
  const finished = compare.rows.filter((r) => r.change !== null);
  const lower = finished.filter((r) => (r.change ?? 0) < 0);
  const higher = finished.filter((r) => (r.change ?? 0) > 0);
  const compareTitle =
    finished.length === 0
      ? "Each month against last year"
      : lower.length > higher.length
        ? `Fewer outings than ${oldest} in ${lower.length} of ${finished.length} finished months`
        : `More outings than ${oldest} in ${higher.length} of ${finished.length} finished months`;
  const exceptions = (lower.length > higher.length ? higher : lower).map((r) => `${r.label} (${changeText(r.change)})`);
  const shownBoats = allBoats ? boats.rows : boats.rows.slice(0, 10);
  const boatLine = (b: (typeof boats.rows)[number]) =>
    `${b.boat} (${b.sameDates.map(fmtInt).join(" \u2192 ")})`;

  return (
    <>
      <p className="page-sub">
        Every time a club shell went out, from the iCrew shell log, {formatDay(data.outings[0].day, true)} to{" "}
        {formatDay(data.through, true)}. Each outing is one boat going out once, whether one rower or four.
      </p>
      {data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up boats and numbers for testing, not the real club.
        </p>
      )}

      <div className="stack">
        <section className="hero" aria-label="Headline">
          <p className="hero-number num" data-testid="shells-ytd">
            {fmtInt(now.outings)}
          </p>
          <div className="hero-copy">
            <p className="hero-lead">
              outings from Jan 1 to {cutoffLabel}, {now.year}
              {before && ytdChange !== null ? `, ${moreOrFewer(ytdChange)} than the same dates in ${before.year} (${fmtInt(before.outings)}).` : "."}
            </p>
            <p className="hero-support">
              {fmtInt(now.member)} were members rowing on their own
              {before && memberChange !== null ? ` (${moreOrFewer(memberChange)} than ${before.year})` : ""} and{" "}
              {fmtInt(now.team)} were camps or team sessions
              {before ? ` (${fmtInt(before.team)} in ${before.year})` : ""}.
              {rowersNow && (
                <>
                  {" "}
                  {fmtInt(rowersNow.sameDates)} different members took a shell out
                  {rowersBefore ? `, against ${fmtInt(rowersBefore.sameDates)} over the same dates in ${rowersBefore.year}` : ""}.
                </>
              )}
            </p>
          </div>
        </section>

        {compare.years.length > 1 && (
          <ChartCard
            title={compareTitle}
            subtitle={`All outings in ${compare.years.join(" and ")}, side by side on one scale.${exceptions.length ? ` The exception${exceptions.length > 1 ? "s" : ""}: ${exceptions.join(", ")}.` : ""} Months not finished yet are left blank.`}
            legend={compare.years.map((y, i) => ({ label: String(y), color: yearColor(i, compare.years.length) }))}
            table={{
              headers: ["Month", ...compare.years.map(String), `Change, ${oldest} to ${newest}`],
              rows: compare.rows.map((r) => [
                r.label,
                ...r.years.map((m) => (!m || m.member + m.team === 0 ? "—" : m.complete ? fmtInt(m.member + m.team) : `${fmtInt(m.member + m.team)} (so far)`)),
                changeText(r.change),
              ]),
            }}
          >
            <GroupedColumnChart
              groups={compareGroups}
              colors={compare.years.map((_, i) => yearColor(i, compare.years.length))}
              ariaLabel={`Shell outings by month, ${compare.years.join(" and ")}`}
            />
          </ChartCard>
        )}

        {boats.years.length > 1 && (
          <section className="card" aria-labelledby="boat-changes-title" data-testid="boat-changes">
            <h2 className="card-title" id="boat-changes-title">
              Boats that changed most
            </h2>
            <p className="card-sub">
              Outings from Jan 1 to {cutoffLabel}, {boats.years[0]} {"\u2192"} {boats.years[boats.years.length - 1]}.
            </p>
            <dl className="change-list">
              {changes.drops.length > 0 && (
                <>
                  <dt>Biggest drops</dt>
                  <dd>{changes.drops.map(boatLine).join("; ")}</dd>
                </>
              )}
              {changes.gains.length > 0 && (
                <>
                  <dt>Biggest gains</dt>
                  <dd>{changes.gains.map(boatLine).join("; ")}</dd>
                </>
              )}
              {changes.started.length > 0 && (
                <>
                  <dt>New this year</dt>
                  <dd>{changes.started.map(boatLine).join("; ")}</dd>
                </>
              )}
              {changes.stopped.length > 0 && (
                <>
                  <dt>No outings this year</dt>
                  <dd>{changes.stopped.map(boatLine).join("; ")}</dd>
                </>
              )}
            </dl>
            {changes.started.length > 0 && changes.stopped.length > 0 && (
              <p className="card-sub">
                A boat that is new this year next to one with no outings may be the same boat renamed in iCrew. It is
                worth checking with staff, since a rename would change the boat figures above.
              </p>
            )}
          </section>
        )}

        <ChartCard
          title={allBoats ? `All ${boats.rows.length} boats` : `The ${Math.min(10, boats.rows.length)} busiest boats`}
          subtitle={`Jan 1 to ${cutoffLabel} in each year, so the years compare fairly. Busiest boat this year first.`}
          legend={boats.years.map((y, i) => ({ label: String(y), color: yearColor(i, boats.years.length) }))}
          table={{
            headers: ["Boat", "Type", ...boats.years.map((y) => `${y}, to ${cutoffLabel}`), ...(boats.years.length > 1 ? ["Change"] : [])],
            rows: boats.rows.map((b) => [b.boat, seatLabel(b.seats), ...b.sameDates.map(fmtInt), ...(boats.years.length > 1 ? [changeText(b.change)] : [])]),
          }}
        >
          <div className="boats num" role="list" aria-label="Outings by boat">
            {shownBoats.map((b) => (
              <div className="boat-row" role="listitem" key={b.boat} data-boat={b.boat}>
                <span className="boat-name">
                  {b.boat}
                  <small>{seatLabel(b.seats)}</small>
                </span>
                <span className="boat-bars">
                  {b.sameDates.map((n, i) => (
                    <span className="boat-bar-line" key={boats.years[i]}>
                      <span
                        className="boat-bar"
                        style={{
                          width: `${(n / boatMax) * 85}%`,
                          background: yearColor(i, boats.years.length),
                        }}
                        aria-hidden="true"
                      />
                      <span className="boat-count">
                        {fmtInt(n)} <span className="sr-only">in {boats.years[i]}</span>
                      </span>
                    </span>
                  ))}
                </span>
                <span className="boat-change">{boats.years.length > 1 ? changeText(b.change) : ""}</span>
              </div>
            ))}
          </div>
          {boats.rows.length > 10 && (
            <button type="button" className="link-button show-more" onClick={() => setAllBoats(!allBoats)}>
              {allBoats ? "Show the top 10" : `Show all ${boats.rows.length} boats`}
            </button>
          )}
        </ChartCard>

        {years.length > 1 && (
          <div className="chips" role="group" aria-label="Year">
            {years.map((y) => (
              <button key={y} type="button" className="chip" aria-pressed={y === year} onClick={() => setChosen(y)}>
                {y}
              </button>
            ))}
          </div>
        )}

        <ChartCard
          title={`${earlyShare}% of outings in ${year} started before 9 am`}
          subtitle={peak ? `By the hour each outing started. Busiest start: ${peak.label}.` : "By the hour each outing started."}
          table={{ headers: ["Start hour", "Outings"], rows: hours.map((h) => [h.label, fmtInt(h.outings)]) }}
        >
          <ColumnChart columns={hourColumns} ariaLabel={`Shell outings by start hour, ${year}`} baseColor={BASE} height={220} />
        </ChartCard>

        <aside className="callout" aria-label="Limits of this data">
          <h3>Limits of this data</h3>
          <p>
            This is the iCrew shell log: one line each time a boat was taken out. It counts outings, not people, so a
            double with two rowers is one outing. Camps and team sessions are counted by boat too. The log does not
            record distance, so meters are left out. Rowers are counted, never named, on this page.
          </p>
        </aside>
      </div>
    </>
  );
}
