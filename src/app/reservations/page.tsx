"use client";

import { useEffect, useMemo, useState } from "react";
import { ChartCard } from "@/components/ChartCard";
import { GroupedColumnChart } from "@/components/GroupedColumnChart";
import { formatDay } from "@/lib/dates";
import {
  asShare,
  byHour,
  byMonth,
  byWeek,
  byWeekday,
  typeColor,
  typeSummary,
  type Bucket,
  type ReservationData,
} from "@/lib/reservations";
import { fmtInt } from "@/lib/stats";

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

function Reservations({ data }: { data: ReservationData }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(data.types));
  const [mode, setMode] = useState<Mode>("count");
  const colors = useMemo(() => data.types.map(typeColor), [data.types]);
  const chosen = data.types.filter((t) => selected.has(t));
  const share = mode === "share";

  const weeks = useMemo(() => byWeek(data, selected), [data, selected]);
  const months = useMemo(() => byMonth(data, selected), [data, selected]);
  const weekdays = useMemo(() => byWeekday(data, selected), [data, selected]);
  const hours = useMemo(() => byHour(data, selected), [data, selected]);
  const summary = useMemo(() => typeSummary(data, selected), [data, selected]);
  const total = summary.reduce((s, r) => s + r.total, 0);

  const toggle = (type: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  /** One chart column per bucket: stacked counts, or each type's share of the column. */
  const groups = (buckets: Bucket[]) =>
    buckets.map((b) => ({
      key: b.key,
      xLabel: b.axis,
      values: share ? asShare(b.counts, b.total) : b.counts,
      tooltip: [
        b.total ? `${fmtInt(b.total)} reservations` : "No reservations",
        b.label,
        ...data.types.flatMap((t, i) => (b.counts[i] > 0 ? [`${t}: ${fmtInt(b.counts[i])} (${Math.round((b.counts[i] / b.total) * 100)}%)`] : [])),
      ] as [string, ...string[]],
    }));

  const table = (first: string, buckets: Bucket[]) => ({
    headers: [first, ...chosen, "Total"],
    rows: buckets.map((b) => [b.label, ...chosen.map((t) => fmtInt(b.counts[data.types.indexOf(t)])), fmtInt(b.total)]),
  });

  const tick = share ? (n: number) => `${n}%` : undefined;
  const chart = (buckets: Bucket[], label: string) => (
    <GroupedColumnChart groups={groups(buckets)} colors={colors} ariaLabel={label} stacked tick={tick} height={280} />
  );
  const how = share ? "Each column shows the mix: what share of that column each type is." : "Each column stacks the chosen types.";
  const top = summary[0];

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

        {chosen.length === 0 ? (
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
                  reservations{chosen.length === data.types.length ? "" : ` for ${chosen.length === 1 ? chosen[0] : `${chosen.length} types`}`}, {formatDay(data.first)} to{" "}
                  {formatDay(data.through)}.
                </p>
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

            <ChartCard
              title="Over time, week by week"
              subtitle={`${how} The first and last weeks are part weeks.`}
              table={table("Week", weeks)}
            >
              {chart(weeks, "Reservations by type, week by week")}
            </ChartCard>

            <ChartCard title="By month" subtitle={`${how} The latest month is not finished.`} table={table("Month", months)}>
              {chart(months, "Reservations by type, by month")}
            </ChartCard>

            <ChartCard title="By day of the week" subtitle={`${how} Totals over the whole period.`} table={table("Day", weekdays)}>
              {chart(weekdays, "Reservations by type, by day of the week")}
            </ChartCard>

            <ChartCard title="By hour of the day" subtitle={`${how} By the hour a reservation starts.`} table={table("Start hour", hours)}>
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
