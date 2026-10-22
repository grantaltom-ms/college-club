"use client";

import { useState } from "react";
import { ChartCard } from "@/components/ChartCard";
import { GroupedColumnChart } from "@/components/GroupedColumnChart";
import { WithData } from "@/components/DataProvider";
import { HeatmapChart } from "@/components/HeatmapChart";
import { busiestSlots, doorPeriod, doorYears, fmtInt, heatmap, monthComparison, periodRange, weekdaySeries, yearOverYear } from "@/lib/stats";
import type { DashboardData } from "@/lib/types";

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
  const heat = heatmap(data.door, year);
  const yoy = yearOverYear(data.door);

  const compare = monthComparison(data.door);
  const yearColors = compare.years.map((_, i) => YEAR_COLORS[Math.max(0, YEAR_COLORS.length - compare.years.length + i)]);
  const monthCell = (m: ReturnType<typeof monthComparison>["rows"][number]["years"][number]) =>
    m.complete ? fmtInt(m.entries) : m.entries ? `${fmtInt(m.entries)} (so far)` : "—";
  const changeText = (change: number | null) => (change === null ? "—" : `${change > 0 ? "+" : ""}${change}%`);
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
  const changed = compare.rows.filter((r) => r.change !== null);
  const biggestRise = [...changed].sort((a, b) => (b.change ?? 0) - (a.change ?? 0))[0];
  const biggestFall = [...changed].sort((a, b) => (a.change ?? 0) - (b.change ?? 0))[0];

  const weekendDrop = Math.round((weekdays[5].belowWeekday + weekdays[6].belowWeekday) / 2);
  const top = busiestSlots(heat, 1)[0];
  const heatTitle = top
    ? `Busiest on ${top.day}s at ${top.hour}; weekends are about ${weekendDrop}% quieter`
    : `Weekends are about ${weekendDrop}% quieter than weekdays`;

  const monthTitle = yoy
    ? `Door entries are ${Math.abs(yoy.change)}% ${yoy.change >= 0 ? "higher" : "lower"} than in ${yoy.previousYear}`
    : "Door entries by month";
  const monthSub = [
    yoy ? `${yoy.fromLabel} to ${yoy.toLabel}: ${fmtInt(yoy.thisYear)} entries in ${yoy.year}, ${fmtInt(yoy.lastYear)} in ${yoy.previousYear}.` : "",
    biggestRise && (biggestRise.change ?? 0) > 0 ? `Biggest rise: ${biggestRise.label} (+${biggestRise.change}%).` : "",
    biggestFall && (biggestFall.change ?? 0) < 0
      ? `${changed.filter((r) => (r.change ?? 0) < 0).length === 1 ? "Only fall" : "Biggest fall"}: ${biggestFall.label} (${biggestFall.change}%).`
      : "",
    "Months not finished yet are left blank.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <p className="page-sub">
        Front-door entries{period ? `, ${periodRange(period)}` : ""}. Each entry is one fob tap, so a person who comes
        and goes twice counts twice. Reservations have their own page.
      </p>
      {data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up numbers for testing, not the real club.
        </p>
      )}

      <div className="stack">
        <ChartCard
          title={monthTitle}
          subtitle={monthSub}
          legend={compare.years.map((y, i) => ({ label: String(y), color: yearColors[i] }))}
          table={{ headers: monthHeaders, rows: monthTable }}
        >
          <GroupedColumnChart
            groups={monthGroups}
            colors={yearColors}
            ariaLabel={`Door entries by month, ${compare.years.join(" and ")}`}
          />
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
          title={heatTitle}
          subtitle={`Average door entries in each hour, for each day of the week, ${year}. Darker means busier.`}
          table={{
            headers: ["Day", "Average per day", ...heat.hours.map((h) => hourLabelShort(h))],
            rows: heat.rows.map((r, i) => [r.name, fmtInt(weekdays[i].perDay), ...r.cells.map((c) => c.perDay.toFixed(1))]),
          }}
        >
          <HeatmapChart data={heat} ariaLabel="Average door entries by day of the week and hour" />
        </ChartCard>

        <aside className="callout" aria-label="Limits of this data">
          <h3>Limits of this data</h3>
          <p>
            Door counts come from the front-door log with staff and non-person credentials removed, so they run lower
            than the full log. Members are matched to door fobs by name, and the 2025 split by member uses today&apos;s
            roster.
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
