"use client";

import { ChartCard } from "@/components/ChartCard";
import { GroupedColumnChart } from "@/components/GroupedColumnChart";
import { useJson } from "@/components/useJson";
import { formatDay } from "@/lib/dates";
import { ENOUGH_TO_COMPARE, GROUP_KEYS, MONTHS_BEFORE, seasonSplit, type GroupKey, type LeaverAnalysis } from "@/lib/leavers";
import { fmtInt } from "@/lib/stats";
import type { MembershipMonth } from "@/lib/types";

/** The dashboard's validated categorical order: blue, orange, aqua. Every chart also has a legend, tooltips and a table view. */
const COLORS: Record<Exclude<GroupKey, "allStayed">, string> = {
  notUsing: "#2a78d6",
  otherReasons: "#eb6834",
  lowStayed: "#1baf7a",
};
const CHART_GROUPS = ["notUsing", "otherReasons", "lowStayed"] as const;

const monthsBeforeLabel = (k: number) => (k === 1 ? "1 month before" : `${k} months before`);
const shortBefore = (k: number) => `${k} mo`;
const avg = (n: number | null) => (n === null ? "—" : n.toFixed(1));
const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

/** Who resigns for not using the club, and what sets them apart from low-use members who stay. Its own data source, so a failure only blanks this section. */
export function LeaversSection({ months }: { months: MembershipMonth[] }) {
  const { state, retry } = useJson<LeaverAnalysis>("/api/membership/leavers", "The resignation figures could not be loaded.");
  return (
    <div data-testid="leavers-section">
      {state.status === "loading" && (
        <p className="status" role="status">
          Loading resignation figures
        </p>
      )}
      {state.status === "error" && (
        <section className="card" aria-labelledby="leavers-error-title">
          <h2 className="card-title" id="leavers-error-title">
            Who resigns for not using it
          </h2>
          <div className="status-error" role="alert">
            <p>{state.message}</p>
            <button type="button" className="link-button" onClick={retry}>
              Try again
            </button>
          </div>
        </section>
      )}
      {state.status === "ready" && <Leavers data={state.data} months={months} />}
    </div>
  );
}

function Leavers({ data, months }: { data: LeaverAnalysis; months: MembershipMonth[] }) {
  const group = (key: GroupKey) => data.groups.find((g) => g.key === key);
  const notUsing = group("notUsing");
  const season = seasonSplit(months);
  const range =
    data.from && data.to ? (data.from === data.to ? formatDay(data.from, true) : `${formatDay(data.from, true)} to ${formatDay(data.to, true)}`) : "";
  const steps = Array.from({ length: MONTHS_BEFORE }, (_, i) => MONTHS_BEFORE - i);

  return (
    <>
      <section className="card" aria-labelledby="leavers-title" data-testid="leavers-insights">
        <h2 className="card-title" id="leavers-title">
          Who resigns for not using it
        </h2>
        <p className="card-sub">
          {fmtInt(data.resignations)} named {data.resignations === 1 ? "resignation" : "resignations"}
          {range ? ` (${range})` : ""}, matched to how often each person came, against the members who stayed. Usage is visit days: a day counts
          once if the person came through the front door or had a reservation. Visits run through {formatDay(data.dataThrough, true)}. Counts and
          averages only, no names.
        </p>
        {data.source === "sample" && (
          <p className="sample-banner" role="note">
            Sample data. These are made-up numbers for testing, not the real club.
          </p>
        )}
        {!data.enough && (
          <p className="leavers-caution" role="note" data-testid="leavers-caution">
            Only {fmtInt(notUsing?.people ?? 0)} {notUsing?.people === 1 ? "person has" : "people have"} resigned for not using it so far. Read the
            comparisons as early hints: they firm up once about {ENOUGH_TO_COMPARE} are loaded. Each month&apos;s named resignations add to them.
          </p>
        )}
        {data.matched < data.resignations && (
          <p data-testid="leavers-unmatched">
            {fmtInt(data.resignations - data.matched)} of the resignations have no usage record to compare, so they are left out of the figures
            below.
          </p>
        )}
        <h3 className="card-title">What the data says</h3>
        <ul data-testid="leavers-insight-list">
          {data.insights.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {season && season.darkCount > 0 && season.lightCount > 0 && (
            <li data-testid="leavers-season">
              From the monthly sheets: {fmtInt(season.darkMonths)} &ldquo;not using it&rdquo; resignations from October to March ({season.darkCount}{" "}
              months) against {fmtInt(season.lightMonths)} from April to September ({season.lightCount} months).
            </li>
          )}
        </ul>
      </section>

      <ChartCard
        title="Visits in the months before resigning"
        subtitle="Average visit days a person each month, counted back from the month they resigned. For low-use members who stayed, counted back from the latest data. A dash means no data for that month."
        legend={CHART_GROUPS.map((key) => ({ label: `${group(key)?.label} (${fmtInt(group(key)?.people ?? 0)})`, color: COLORS[key] }))}
        table={{
          headers: ["Month", ...CHART_GROUPS.map((key) => group(key)?.label ?? key)],
          rows: steps.map((k, i) => [monthsBeforeLabel(k), ...CHART_GROUPS.map((key) => avg(group(key)?.monthsBefore[i] ?? null))]),
        }}
      >
        <GroupedColumnChart
          ariaLabel="Average visit days in the months before resigning"
          colors={CHART_GROUPS.map((key) => COLORS[key])}
          tick={(n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))}
          groups={steps.map((k, i) => ({
            key: `before-${k}`,
            xLabel: shortBefore(k),
            values: CHART_GROUPS.map((key) => group(key)?.monthsBefore[i] ?? 0),
            tooltip: [
              monthsBeforeLabel(k),
              ...CHART_GROUPS.map((key) => `${group(key)?.label}: ${avg(group(key)?.monthsBefore[i] ?? null)} visit days`),
            ],
          }))}
        />
      </ChartCard>

      <ChartCard
        title="Resignations by how often members came"
        subtitle="Each usage group's resignations, split by reason. The tooltip and table give the share of that group who resigned."
        legend={[
          { label: "Not using it", color: COLORS.notUsing },
          { label: "Moved or other", color: COLORS.otherReasons },
        ]}
        table={{
          headers: ["Visits a month", "Members in the group", "Resigned: not using it", "Resigned: moved or other", "Share who resigned"],
          rows: data.bands.map((b) => [b.label, fmtInt(b.people), fmtInt(b.resignedNotUsing), fmtInt(b.resignedOther), `${b.rate}%`]),
        }}
      >
        <GroupedColumnChart
          ariaLabel="Resignations by usage group"
          stacked
          colors={[COLORS.notUsing, COLORS.otherReasons]}
          groups={data.bands.map((b) => ({
            key: b.band,
            xLabel: b.label,
            values: [b.resignedNotUsing, b.resignedOther],
            tooltip: [
              `${fmtInt(b.resignedNotUsing + b.resignedOther)} resigned (${b.rate}% of ${fmtInt(b.people)})`,
              b.label,
              `${fmtInt(b.resignedNotUsing)} not using it, ${fmtInt(b.resignedOther)} moved or other`,
            ],
          }))}
        />
      </ChartCard>

      <section className="card" aria-labelledby="leavers-compare-title">
        <div className="card-head">
          <div>
            <h2 className="card-title" id="leavers-compare-title">
              What resigners have in common
            </h2>
            <p className="card-sub">
              The share of each group with each trait. Compare the first column with the third: both used the club very little, but only the first
              left.
            </p>
          </div>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Traits of members who resigned and members who stayed">
          <table className="data-table num" data-testid="leavers-traits">
            <thead>
              <tr>
                <th scope="col">Trait</th>
                {GROUP_KEYS.map((key) => (
                  <th scope="col" className="right" key={key}>
                    {group(key)?.label} ({fmtInt(group(key)?.people ?? 0)})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.traits.map((t) => (
                <tr key={t.key}>
                  <td>{t.label}</td>
                  {GROUP_KEYS.map((key) => (
                    <td className="right" key={key}>
                      {pct(t.values[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
