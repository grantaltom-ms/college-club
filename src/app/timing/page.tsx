"use client";

import { useState } from "react";
import { ChartCard } from "@/components/ChartCard";
import { ColumnChart, type Column } from "@/components/ColumnChart";
import { WithData } from "@/components/DataProvider";
import { HeatmapChart } from "@/components/HeatmapChart";
import { WEEKDAYS, formatDay, weekdayIndex } from "@/lib/dates";
import {
  bookingSeries,
  busiestSlots,
  doorPeriod,
  doorYears,
  fmtInt,
  heatmap,
  hourSeries,
  monthSeries,
  periodRange,
  weekdaySeries,
  yearOverYear,
} from "@/lib/stats";
import type { DashboardData } from "@/lib/types";

const BASE = "#536872";
const EMPHASIS = "#2b3a42";

export default function TimingPage() {
  return (
    <>
      <h1 className="page-title">When people come.</h1>
      <WithData>{(data) => <Timing data={data} />}</WithData>
    </>
  );
}

function Timing({ data }: { data: DashboardData }) {
  const years = doorYears(data.door);
  const [chosen, setChosen] = useState<number | null>(null);
  const year = chosen !== null && years.includes(chosen) ? chosen : years[0];
  const period = doorPeriod(data.door, year);

  const weekdays = weekdaySeries(data.door, year);
  const hours = hourSeries(data.door, year);
  const heat = heatmap(data.door, year);
  const bookings = bookingSeries(data.totals);
  const yoy = yearOverYear(data.door);

  const weekdayColumns: Column[] = weekdays.map((w) => ({
    key: w.short,
    xLabel: w.short,
    value: Math.round(w.perDay),
    emphasis: w.index >= 5,
    tooltip: [
      `${fmtInt(w.perDay)} entries`,
      `${w.name}, average over ${w.days} days`,
      ...(w.index >= 5 ? [`${w.belowWeekday}% below a weekday`] : []),
    ],
  }));

  const hourColumns: Column[] = hours.map((h) => ({
    key: String(h.hour),
    xLabel: h.hour % 6 === 0 ? h.label : null,
    value: h.entries,
    tooltip: [`${fmtInt(h.entries)} entries`, h.label],
  }));

  const bookingColumns: Column[] = bookings.map((b) => ({
    key: b.day,
    xLabel: b.day.endsWith("-01") ? formatDay(b.day) : null,
    value: b.bookings,
    emphasis: b.weekend,
    tooltip: [`${fmtInt(b.bookings)} bookings`, `${WEEKDAYS[weekdayIndex(b.day)]}, ${formatDay(b.day)}`],
  }));

  const monthsByYear = years
    .slice()
    .sort((a, b) => a - b)
    .map((y) => ({ year: y, months: monthSeries(data.door, y) }));
  const monthMax = Math.max(0, ...monthsByYear.flatMap((m) => m.months.filter((p) => p.complete).map((p) => p.entries)));
  const monthColumns = (months: ReturnType<typeof monthSeries>): Column[] =>
    months.map((m) => ({
      key: m.key,
      xLabel: m.label,
      value: m.complete ? m.entries : 0,
      tooltip: m.complete
        ? [`${fmtInt(m.entries)} entries`, m.label, `${fmtInt(m.people)} different people`]
        : [m.entries ? "Month not finished" : "No data yet", m.label],
    }));
  const monthTable = monthsByYear.length
    ? monthsByYear[0].months.map((m, i) => [
        m.label,
        ...monthsByYear.map((y) => {
          const row = y.months[i];
          return row.complete ? fmtInt(row.entries) : row.entries ? `${fmtInt(row.entries)} (so far)` : "\u2014";
        }),
      ])
    : [];

  const sat = weekdays[5];
  const sun = weekdays[6];
  const weekdayPerDay = weekdays.slice(0, 5).map((w) => Math.round(w.perDay));
  const peaks = [...hours].sort((a, b) => b.entries - a.entries).slice(0, 2).sort((a, b) => a.hour - b.hour);
  const slots = busiestSlots(heat, 3);
  const legend = [
    { label: "Weekday", color: BASE },
    { label: "Weekend", color: EMPHASIS },
  ];

  return (
    <>
      <p className="page-sub">
        Front-door entries{period ? `, ${periodRange(period)}` : ""}. Each entry is one fob tap, so a person who comes
        and goes twice counts twice.
      </p>
      {data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up numbers for testing, not the real club.
        </p>
      )}

      <div className="stack">
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
          title="Door entries on an average day"
          subtitle="Each weekday's total divided by how many of that weekday fell in the period."
          legend={legend}
          table={{
            headers: ["Day", "Average entries per day", "Total entries", "Days counted"],
            rows: weekdays.map((w) => [w.name, fmtInt(w.perDay), fmtInt(w.entries), w.days]),
          }}
        >
          <ColumnChart columns={weekdayColumns} ariaLabel="Average door entries per day, by day of the week" />
        </ChartCard>

        <aside className="callout" aria-label="Weekends">
          <h3>Weekends are the quiet days</h3>
          <p>
            Sunday averages {fmtInt(sun.perDay)} door entries a day, {sun.belowWeekday}% fewer than a typical
            weekday. Saturday averages {fmtInt(sat.perDay)}, {sat.belowWeekday}% fewer. Monday to Friday run{" "}
            {Math.min(...weekdayPerDay)} to {Math.max(...weekdayPerDay)} a day.
          </p>
        </aside>

        <ChartCard
          title="Door entries by day and hour"
          subtitle="Average entries in each hour, for that day of the week. Darker means busier."
          table={{
            headers: ["Day", ...heat.hours.map((h) => hourLabelShort(h))],
            rows: heat.rows.map((r) => [r.name, ...r.cells.map((c) => c.perDay.toFixed(1))]),
          }}
        >
          <HeatmapChart data={heat} ariaLabel="Average door entries by day of the week and hour" />
        </ChartCard>

        {slots.length > 0 && (
          <aside className="callout" aria-label="Busiest hours">
            <h3>When the door is busiest</h3>
            <p>
              The three busiest hours are {slots.map((s) => `${s.day} at ${s.hour} (${s.perDay.toFixed(1)} entries)`).join(", ")}.
            </p>
          </aside>
        )}

        <ChartCard
          title="Door entries by hour"
          subtitle={`All days combined, ${year}. Busiest at ${peaks.map((p) => p.label).join(" and ")}.`}
          table={{
            headers: ["Hour", "Entries"],
            rows: hours.filter((h) => h.entries > 0).map((h) => [h.label, fmtInt(h.entries)]),
          }}
        >
          <ColumnChart columns={hourColumns} ariaLabel="Door entries by hour of the day" baseColor={BASE} />
        </ChartCard>

        <ChartCard
          title="Door entries by month"
          subtitle="Both years on the same scale. Months that are not finished yet are left blank."
          table={{ headers: ["Month", ...monthsByYear.map((y) => String(y.year))], rows: monthTable }}
        >
          <div className="chart-pair">
            {monthsByYear.map((y) => (
              <div key={y.year}>
                <h3>{y.year}</h3>
                <ColumnChart
                  columns={monthColumns(y.months)}
                  ariaLabel={`Door entries by month, ${y.year}`}
                  baseColor={BASE}
                  maxValue={monthMax}
                  height={200}
                />
              </div>
            ))}
          </div>
        </ChartCard>

        {yoy && (
          <aside className="callout" aria-label="Compared with last year">
            <h3>Compared with last year</h3>
            <p>
              From {yoy.fromLabel} to {yoy.toLabel}, door entries are {Math.abs(yoy.change)}%{" "}
              {yoy.change >= 0 ? "higher" : "lower"} in {yoy.year} than in {yoy.previousYear} ({fmtInt(yoy.thisYear)}{" "}
              against {fmtInt(yoy.lastYear)}).
            </p>
          </aside>
        )}

        <ChartCard
          title="Boat and class reservations per day"
          subtitle="July 1 to September 30, 2026."
          legend={legend}
          table={{
            headers: ["Day", "Reservations"],
            rows: bookings.map((b) => [`${WEEKDAYS[weekdayIndex(b.day)]}, ${formatDay(b.day)}`, fmtInt(b.bookings)]),
          }}
        >
          <ColumnChart columns={bookingColumns} ariaLabel="Boat and class reservations per day" />
        </ChartCard>

        <aside className="callout" aria-label="Limits of this data">
          <h3>Limits of this data</h3>
          <p>
            Door counts come from the front-door log with staff and non-person credentials removed, so they run lower
            than the full log. Reservations are bookings, not attendance. Members are matched to door fobs by name, and
            the 2025 split by member uses today&apos;s roster.
          </p>
        </aside>
      </div>
    </>
  );
}

function hourLabelShort(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}
