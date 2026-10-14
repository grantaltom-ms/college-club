"use client";

import { useState } from "react";
import { ChartCard } from "@/components/ChartCard";
import { ColumnChart, type Column } from "@/components/ColumnChart";
import { GroupedColumnChart } from "@/components/GroupedColumnChart";
import { WithData } from "@/components/DataProvider";
import { HeatmapChart } from "@/components/HeatmapChart";
import { WEEKDAYS, formatDay, weekdayIndex } from "@/lib/dates";
import {
  bookingMonths,
  bookingSeries,
  bookingWeekdays,
  bookingYearOverYear,
  bookingYears,
  busiestSlots,
  doorPeriod,
  doorYears,
  fmtInt,
  heatmap,
  hourSeries,
  monthComparison,
  periodRange,
  weekdaySeries,
  yearOverYear,
} from "@/lib/stats";
import type { DashboardData } from "@/lib/types";

const BASE = "#536872";
const EMPHASIS = "#2b3a42";
/** Older year light, newest year dark, so this year stands out next to last year. */
const YEAR_COLORS = ["#a7b3b9", EMPHASIS];

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
  const bookings = bookingSeries(data.totals).slice(-92);
  const bookingYoy = bookingYearOverYear(data.totals);
  const bYears = bookingYears(data.totals).sort((a, b) => a - b);
  const bookingsByYear = bYears.map((y) => ({ year: y, months: bookingMonths(data.totals, y) }));
  const bookingMax = Math.max(0, ...bookingsByYear.flatMap((y) => y.months.filter((m) => m.complete).map((m) => m.bookings)));
  const bookingWeek = bookingWeekdays(data.totals, bYears[bYears.length - 1] ?? year);
  const bookingWeekYear = bYears[bYears.length - 1];
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

  const compare = monthComparison(data.door);
  const yearColors = compare.years.map((_, i) => YEAR_COLORS[Math.max(0, YEAR_COLORS.length - compare.years.length + i)]);
  const monthCell = (m: ReturnType<typeof monthComparison>["rows"][number]["years"][number]) =>
    m.complete ? fmtInt(m.entries) : m.entries ? `${fmtInt(m.entries)} (so far)` : "\u2014";
  const changeText = (change: number | null) => (change === null ? "\u2014" : `${change > 0 ? "+" : ""}${change}%`);
  const newest = compare.years[compare.years.length - 1];
  const oldest = compare.years[0];
  const monthGroups = compare.rows.map((r) => ({
    key: String(r.month),
    xLabel: r.label,
    values: r.years.map((m) => (m.complete ? m.entries : 0)),
    tooltip: [
      r.change === null ? r.label : `${r.label}: ${Math.abs(r.change)}% ${r.change >= 0 ? "higher" : "lower"} in ${newest}`,
      ...r.years.map((m, i) => {
        const y = compare.years[i];
        if (m.complete) return `${y}: ${fmtInt(m.entries)} entries`;
        return m.entries ? `${y}: ${fmtInt(m.entries)} so far, month not finished` : `${y}: no data yet`;
      }),
    ] as [string, ...string[]],
  }));
  const monthTable = compare.rows.map((r) => [
    r.label,
    ...r.years.map(monthCell),
    ...(compare.years.length > 1 ? [changeText(r.change)] : []),
  ]);
  const monthHeaders = ["Month", ...compare.years.map(String), ...(compare.years.length > 1 ? [`Change, ${oldest} to ${newest}`] : [])];

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
          subtitle={
            compare.years.length > 1
              ? `Each month with ${compare.years.join(" and ")} side by side, on the same scale. Months not finished yet are left blank.`
              : "Months not finished yet are left blank."
          }
          legend={compare.years.map((y, i) => ({ label: String(y), color: yearColors[i] }))}
          table={{ headers: monthHeaders, rows: monthTable }}
        >
          <GroupedColumnChart
            groups={monthGroups}
            colors={yearColors}
            ariaLabel={`Door entries by month, ${compare.years.join(" and ")}`}
          />
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

        {bookingsByYear.length > 0 && (
          <>
            <ChartCard
              title="Reservations by month"
              subtitle="All iCrew bookings, with each year on the same scale. Months that are not finished are left blank."
              table={{
                headers: ["Month", ...bookingsByYear.map((y) => String(y.year))],
                rows: bookingsByYear[0].months.map((m, i) => [
                  m.label,
                  ...bookingsByYear.map((y) => {
                    const row = y.months[i];
                    return row.complete ? fmtInt(row.bookings) : row.bookings ? `${fmtInt(row.bookings)} (so far)` : "\u2014";
                  }),
                ]),
              }}
            >
              <div className="chart-pair">
                {bookingsByYear.map((y) => (
                  <div key={y.year}>
                    <h3>{y.year}</h3>
                    <ColumnChart
                      columns={y.months.map((m) => ({
                        key: m.key,
                        xLabel: m.label,
                        value: m.complete ? m.bookings : 0,
                        tooltip: m.complete ? [`${fmtInt(m.bookings)} reservations`, m.label] : ["Month not finished", m.label],
                      }))}
                      ariaLabel={`Reservations by month, ${y.year}`}
                      baseColor={BASE}
                      maxValue={bookingMax}
                      height={200}
                    />
                  </div>
                ))}
              </div>
            </ChartCard>

            {bookingYoy && (
              <aside className="callout" aria-label="Reservations compared with last year">
                <h3>Reservations compared with last year</h3>
                <p>
                  From {bookingYoy.fromLabel} to {bookingYoy.toLabel}, reservations are {Math.abs(bookingYoy.change)}%{" "}
                  {bookingYoy.change >= 0 ? "higher" : "lower"} in {bookingYoy.year} than in {bookingYoy.previousYear} (
                  {fmtInt(bookingYoy.thisYear)} against {fmtInt(bookingYoy.lastYear)}).
                </p>
              </aside>
            )}

            <ChartCard
              title={`Reservations on an average day, ${bookingWeekYear}`}
              subtitle="Each weekday's total divided by how many of that weekday are in the data."
              legend={legend}
              table={{
                headers: ["Day", "Average reservations per day", "Total reservations", "Days counted"],
                rows: bookingWeek.map((w) => [w.name, fmtInt(w.perDay), fmtInt(w.bookings), w.days]),
              }}
            >
              <ColumnChart
                columns={bookingWeek.map((w) => ({
                  key: w.short,
                  xLabel: w.short,
                  value: Math.round(w.perDay),
                  emphasis: w.index >= 5,
                  tooltip: [`${fmtInt(w.perDay)} reservations`, `${w.name}, average over ${w.days} days`],
                }))}
                ariaLabel="Average reservations per day, by day of the week"
              />
            </ChartCard>
          </>
        )}

        <ChartCard
          title="Reservations per day, recent"
          subtitle="The last 92 days of data."
          legend={legend}
          table={{
            headers: ["Day", "Reservations"],
            rows: bookings.map((b) => [`${WEEKDAYS[weekdayIndex(b.day)]}, ${formatDay(b.day)}`, fmtInt(b.bookings)]),
          }}
        >
          <ColumnChart columns={bookingColumns} ariaLabel="Reservations per day, recent" />
        </ChartCard>

        <aside className="callout" aria-label="Limits of this data">
          <h3>Limits of this data</h3>
          <p>
            Door counts come from the front-door log with staff and non-person credentials removed, so they run lower
            than the full log. Reservations come from the iCrew daily totals for all accounts, including staff and juniors, and are bookings, not attendance. Members are matched to door fobs by name, and
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
