"use client";

import { useEffect, useMemo, useState } from "react";
import { ChartCard } from "@/components/ChartCard";
import { GroupedColumnChart } from "@/components/GroupedColumnChart";
import { formatDay } from "@/lib/dates";
import { useDashboard } from "@/components/DataProvider";
import {
  asShare,
  byHour,
  byMonth,
  byWeekday,
  collapseTypes,
  driverOf,
  topTypeIn,
  typeColor,
  typeSummary,
  type Bucket,
  type ReservationData,
} from "@/lib/reservations";
import { bookingYearOverYear, fmtInt } from "@/lib/stats";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ReservationData };

async function load(): Promise<State> {
  try {
    const res = await fetch("/api/reservations", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) return { status: "error", message: body?.error ?? "The reservation figures could not be loaded." };
    return { status: "ready", data: body as ReservationData };
  } catch {
    return { status: "error", message: "The reservation figures could not be loaded. Check your connection and try again." };
  }
}

export default function ReservationsPage() {
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
      <h1 className="page-title">Reservations.</h1>
      {state.status === "loading" && (
        <p className="status" role="status">
          Loading reservation figures
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
      {state.status === "ready" && <Reservations data={state.data} />}
    </>
  );
}

type Mode = "count" | "share";

/** How many of the busiest types get their own color before the rest are added up as "Other". */
const TOP_TYPES = 4;

interface View {
  types: string[];
  colors: string[];
  buckets: Bucket[];
}

/** In the default view the busiest few types keep their color and the rest become "Other". */
function shape(data: ReservationData, buckets: Bucket[], picking: boolean): View {
  return picking ? { types: data.types, colors: data.types.map(typeColor), buckets } : collapseTypes(data, buckets, TOP_TYPES);
}

function Reservations({ data }: { data: ReservationData }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(data.types));
  const [mode, setMode] = useState<Mode>("count");
  const [picking, setPicking] = useState(false);
  const dashboard = useDashboard();
  const yoy = dashboard ? bookingYearOverYear(dashboard.totals) : null;
  const chosen = data.types.filter((t) => selected.has(t));
  const share = mode === "share";

  const allSelected = useMemo(() => new Set(data.types), [data.types]);
  const active = picking ? selected : allSelected;
  const months = useMemo(() => shape(data, byMonth(data, active), picking), [data, active, picking]);
  const weekdays = useMemo(() => shape(data, byWeekday(data, active), picking), [data, active, picking]);
  const hours = useMemo(() => shape(data, byHour(data, active), picking), [data, active, picking]);
  const summary = useMemo(() => typeSummary(data, active), [data, active]);
  const total = summary.reduce((s, r) => s + r.total, 0);

  const toggle = (type: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  /** One chart column per bucket: stacked counts, or each type's share of the column. */
  const groups = ({ types, buckets }: View) =>
    buckets.map((b) => ({
      key: b.key,
      xLabel: b.axis,
      values: share ? asShare(b.counts, b.total) : b.counts,
      tooltip: [
        b.total ? `${fmtInt(b.total)} reservations` : "No reservations",
        b.label,
        ...types.flatMap((t, i) => (b.counts[i] > 0 ? [`${t}: ${fmtInt(b.counts[i])} (${Math.round((b.counts[i] / b.total) * 100)}%)`] : [])),
      ] as [string, ...string[]],
    }));

  const table = (first: string, v: View) => {
    const shown = v.types.filter((t, i) => t === "Other" || !picking || selected.has(t) || v.buckets.some((b) => b.counts[i] > 0));
    const cols = picking ? chosen : shown;
    return {
      headers: [first, ...cols, "Total"],
      rows: v.buckets.map((b) => [b.label, ...cols.map((t) => fmtInt(b.counts[v.types.indexOf(t)])), fmtInt(b.total)]),
    };
  };

  const tick = share ? (n: number) => `${n}%` : undefined;
  const chart = (v: View, label: string) => (
    <GroupedColumnChart groups={groups(v)} colors={v.colors} ariaLabel={label} stacked tick={tick} height={280} />
  );
  const legend = (v: View) => v.types.map((t, i) => ({ label: t, color: v.colors[i] }));
  const how = share
    ? "Each column shows the mix: what share of that column each type is."
    : picking
      ? "Each column stacks the chosen types."
      : `Each column stacks the ${TOP_TYPES} busiest types, with the rest as Other.`;
  const top = summary[0];

  const peakMonth = months.buckets.filter((b) => b.complete).reduce<Bucket | null>((best, b) => (!best || b.total > best.total ? b : best), null);
  const monthDriver = peakMonth ? driverOf(months.types, months.buckets, peakMonth) : null;
  const monthTitle = peakMonth
    ? `Reservations peak in ${peakMonth.label}${monthDriver && monthDriver !== "Other" ? `, driven by ${monthDriver.toLowerCase()}` : ""}`
    : "By month";
  const busiestDay = weekdays.buckets.reduce<Bucket | null>((best, b) => (!best || b.total > best.total ? b : best), null);
  const weekendTop = topTypeIn(weekdays.types, weekdays.buckets.slice(5));
  const weekdayTop = topTypeIn(weekdays.types, weekdays.buckets.slice(0, 5));
  const dayTitle =
    busiestDay && weekendTop && weekdayTop && weekendTop !== weekdayTop
      ? `${weekdayTop} leads on weekdays; ${weekendTop.toLowerCase()} leads on weekends`
      : busiestDay
        ? `Busiest on ${busiestDay.label}`
        : "By day of the week";
  const hourNum = (b: Bucket) => Number(b.key);
  const morningTop = topTypeIn(hours.types, hours.buckets.filter((b) => hourNum(b) < 10));
  const laterTop = topTypeIn(hours.types, hours.buckets.filter((b) => hourNum(b) >= 15));
  const hourTitle =
    morningTop && laterTop && morningTop !== laterTop
      ? `${morningTop} leads early mornings; ${laterTop.toLowerCase()} leads late afternoons`
      : "By hour of the day";

  return (
    <>
      <p className="page-sub">
        Every reservation in iCrew, {formatDay(data.first, true)} to {formatDay(data.through, true)}, by what was reserved. A
        reservation counts on the day and hour it starts.
      </p>
      {data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up reservations for testing, not the real club.
        </p>
      )}

      <div className="stack">
        <div className="filter-bar">
          <div className="filter-row" role="group" aria-label="View">
            <span className="filter-label">Types</span>
            <button type="button" className="chip" aria-pressed={!picking} onClick={() => setPicking(false)}>
              Top {TOP_TYPES} and other
            </button>
            <button type="button" className="chip" aria-pressed={picking} onClick={() => setPicking(true)}>
              Pick types
            </button>
          </div>
          {picking && (
          <div className="filter-row" role="group" aria-label="Reservation types">
            <span className="filter-label">Show</span>
            {data.types.map((type) => (
              <button
                key={type}
                type="button"
                className="chip"
                aria-pressed={selected.has(type)}
                style={{ "--dot": typeColor(type) } as React.CSSProperties}
                onClick={() => toggle(type)}
              >
                <span className="chip-dot" aria-hidden="true" />
                {type}
              </button>
            ))}
            <button type="button" className="link-button" onClick={() => setSelected(new Set(data.types))}>
              All
            </button>
            <button type="button" className="link-button" onClick={() => setSelected(new Set())}>
              None
            </button>
          </div>
          )}
          <div className="filter-row" role="group" aria-label="Measure">
            <span className="filter-label">Charts show</span>
            <button type="button" className="chip" aria-pressed={!share} onClick={() => setMode("count")}>
              Number of reservations
            </button>
            <button type="button" className="chip" aria-pressed={share} onClick={() => setMode("share")}>
              Mix (share of each column)
            </button>
          </div>
        </div>

        {picking && chosen.length === 0 ? (
          <p className="status" role="status">
            Pick at least one type above to see it.
          </p>
        ) : (
          <>
            <section className="hero" aria-label="Headline">
              <p className="hero-number num" data-testid="res-total">
                {fmtInt(total)}
              </p>
              <div className="hero-copy">
                <p className="hero-lead">
                  reservations{!picking || chosen.length === data.types.length ? "" : ` for ${chosen.length === 1 ? chosen[0] : `${chosen.length} types`}`}, {formatDay(data.first)} to{" "}
                  {formatDay(data.through)}.
                </p>
                {yoy && (!picking || chosen.length === data.types.length) && (
                  <p className="hero-support" data-testid="res-yoy">
                    From {yoy.fromLabel} to {yoy.toLabel}, reservations are {Math.abs(yoy.change)}% {yoy.change >= 0 ? "higher" : "lower"} than in{" "}
                    {yoy.previousYear} ({fmtInt(yoy.thisYear)} against {fmtInt(yoy.lastYear)}).
                  </p>
                )}
                {top && (
                  <p className="hero-support">
                    {top.type} is the most reserved{chosen.length > 1 ? `, ${top.share}% of these` : ""}. It is busiest on {top.peakWeekday}s, starting at{" "}
                    {top.peakHour}.
                  </p>
                )}
              </div>
            </section>

            <section className="card" aria-labelledby="res-types-title">
              <div className="card-head">
                <div>
                  <h2 className="card-title" id="res-types-title">
                    What people reserve
                  </h2>
                  <p className="card-sub">Each type, how often it was reserved, and when it is busiest.</p>
                </div>
              </div>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="What people reserve, as a table">
                <table className="data-table num" data-testid="res-summary">
                  <thead>
                    <tr>
                      <th scope="col">Type</th>
                      <th scope="col" className="right">
                        Reservations
                      </th>
                      <th scope="col">Share</th>
                      <th scope="col">Busiest day</th>
                      <th scope="col">Busiest start hour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((r) => (
                      <tr key={r.type}>
                        <th scope="row">
                          <span className="swatch" style={{ background: r.color }} aria-hidden="true" />
                          {r.type}
                        </th>
                        <td className="right">{fmtInt(r.total)}</td>
                        <td>
                          <span className="share-cell">
                            <span className="share-bar" style={{ width: `${Math.max(2, r.share * 1.2)}px`, background: r.color }} aria-hidden="true" />
                            {r.share}%
                          </span>
                        </td>
                        <td>{r.peakWeekday}</td>
                        <td>{r.peakHour}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <ChartCard title={monthTitle} subtitle={`${how} The latest month is not finished.`} legend={legend(months)} table={table("Month", months)}>
              {chart(months, "Reservations by type, by month")}
            </ChartCard>

            <ChartCard title={dayTitle} subtitle={`${how} Totals over the whole period.`} legend={legend(weekdays)} table={table("Day", weekdays)}>
              {chart(weekdays, "Reservations by type, by day of the week")}
            </ChartCard>

            <ChartCard title={hourTitle} subtitle={`${how} By the hour a reservation starts.`} legend={legend(hours)} table={table("Start hour", hours)}>
              {chart(hours, "Reservations by type, by start hour")}
            </ChartCard>
          </>
        )}

        <aside className="callout" aria-label="Limits of this data">
          <h3>Limits of this data</h3>
          <p>
            This counts reservations made in iCrew, not who turned up. Events are club events and classes, and each person who signs up counts once.
            Shell here includes members&apos; own boats stored at the club, so it will not match the Shells tab, which only covers the club&apos;s own shells.
            Names of who booked are never used on this page.
          </p>
        </aside>
      </div>
    </>
  );
}
