"use client";

import { ChartCard } from "@/components/ChartCard";
import { ColumnChart } from "@/components/ColumnChart";
import { GroupedColumnChart } from "@/components/GroupedColumnChart";
import { useJson } from "@/components/useJson";
import {
  categoryParts,
  latestMonth,
  membershipFlags,
  monthLabel,
  monthsWithout,
  notesMatching,
  periodTotals,
  reasonParts,
  shortMonthLabel,
  sortMonths,
  trailingReasons,
  type PeriodTotals,
} from "@/lib/membership";
import { fmtInt } from "@/lib/stats";
import type { MembershipData, MembershipMonth } from "@/lib/types";

/**
 * Series colors for the two stacked charts: the dashboard's validated categorical order (blue, orange, aqua, yellow, magenta),
 * in that fixed order, so a series keeps its color. They sit on the white card; the lighter ones fall under 3:1 against it, so
 * every chart has a legend, a numbers-in-the-tooltip hover and a "View as table" view.
 */
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const REASON_LABELS = ["Moved", "Not using it / too busy", "Other / unknown"];
const CATEGORY_LABELS = ["Resident", "Intermediate", "Non-Resident", "Suburban", "Honorary"];

/** The two totals are different counts and are never one series: dues-paying is the sheet's own total, the other adds Suburban and Honorary. */
const DUES_PAYING = "Dues-paying";
const ALL_CATEGORIES = "All categories (incl. Suburban and Honorary)";

/** The club year a month belongs to: July starts a new year, so Oct 2026 is 2026-27. */
function clubYear(m: MembershipMonth): string {
  return m.month >= 7 ? `${m.year}–${String(m.year + 1).slice(2)}` : `${m.year - 1}–${String(m.year).slice(2)}`;
}

function groupTotals(months: MembershipMonth[]): { label: string; totals: PeriodTotals }[] {
  const groups = new Map<string, MembershipMonth[]>();
  for (const m of sortMonths(months)) {
    const label = clubYear(m);
    groups.set(label, [...(groups.get(label) ?? []), m]);
  }
  return [...groups.entries()].flatMap(([label, rows]) => {
    const totals = periodTotals(rows);
    return totals ? [{ label, totals }] : [];
  });
}

/** The notes of the given months, each under its month, next to the chart they are about. Nothing when there are none. */
function MonthNotes({ months, testId }: { months: MembershipMonth[]; testId: string }) {
  if (months.length === 0) return null;
  return (
    <ul data-testid={testId}>
      {months.map((m) => (
        <li key={`${m.year}-${m.month}`}>
          {monthLabel(m)}: {m.note}
        </li>
      ))}
    </ul>
  );
}

/** A figure for a month that has none shows as a dash in a table, never as 0. */
const cell = (n: number | null) => (n === null ? "—" : fmtInt(n));

/** The body of the Membership dashboard page, without its heading, so a committee page can show it too. */
export function MembershipSection() {
  const { state, retry } = useJson<MembershipData>("/api/membership", "The membership figures could not be loaded.");
  return (
    <>
      {state.status === "loading" && (
        <p className="status" role="status">
          Loading membership figures
        </p>
      )}
      {state.status === "error" && (
        <div className="status-error" role="alert">
          <p>{state.message}</p>
          <button type="button" className="link-button" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {state.status === "ready" && <Membership data={state.data} />}
    </>
  );
}

function Membership({ data }: { data: MembershipData }) {
  const months = sortMonths(data.months);
  const latest = latestMonth(months);
  const flags = membershipFlags(months);
  const periods = groupTotals(months);
  const notes = months.filter((m) => m.note);

  return (
    <>
      <p className="page-sub">
        Dues-paying members month by month, from the Membership Committee&apos;s count workbooks, with the reasons members leave and the
        membership mix from the committee&apos;s trend workbook. Counts only — no member names.
      </p>
      {data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up numbers for testing, not the real club.
        </p>
      )}

      <div className="stack">
        {latest && (
          <section className="hero" aria-label="Headline">
            <p className="hero-number num">{fmtInt(latest.withApprovals)}</p>
            <div className="hero-copy">
              <p className="hero-lead">paying members in {monthLabel(latest)}.</p>
              <p className="hero-support">
                {fmtInt(latest.resignations)} left, {fmtInt(latest.applicants)} applied
                {latest.transferred !== null ? `, ${fmtInt(latest.transferred)} transferred` : ""}, and the waitlist was{" "}
                {latest.waitlist !== null ? fmtInt(latest.waitlist) : "not shown"}.
              </p>
            </div>
          </section>
        )}

        <section className="card" aria-labelledby="periods-title">
          <h2 className="card-title" id="periods-title">
            Each club year
          </h2>
          <ul>
            {periods.map(({ label, totals }) => (
              <li key={label} data-testid={`period-${label}`}>
                {label}: {fmtInt(totals.start)} → {fmtInt(totals.end)} paying members, {fmtInt(totals.resignations)} left, {fmtInt(totals.applicants)}{" "}
                applied over {totals.months} months.
              </li>
            ))}
          </ul>
        </section>

        <ChartCard
          title="Paying members over time"
          subtitle={`${DUES_PAYING} members: the workbook's own total after each month's approvals. This is not the all-categories total in "Membership mix" below.`}
          table={{
            headers: ["Month", `${DUES_PAYING} members`],
            rows: months.map((m) => [monthLabel(m), m.withApprovals]),
          }}
        >
          <ColumnChart
            ariaLabel="Paying members by month"
            thinLabels
            columns={months.map((m) => ({
              key: `${m.year}-${m.month}`,
              xLabel: shortMonthLabel(m),
              value: m.withApprovals,
              tooltip: [`${fmtInt(m.withApprovals)} ${DUES_PAYING.toLowerCase()} members`, monthLabel(m)],
            }))}
          />
        </ChartCard>

        <ChartCard
          title="Leavers and applicants each month"
          subtitle="Resignations against applicants for approval."
          legend={[
            { label: "Left", color: "#a7b3b9" },
            { label: "Applied", color: "#2b3a42" },
          ]}
          table={{
            headers: ["Month", "Left", "Applied"],
            rows: months.map((m) => [monthLabel(m), m.resignations, m.applicants]),
          }}
          percent={{ of: "column", columns: [1, 2], note: "Each month's share of all leavers, and of all applicants, over these months." }}
        >
          <GroupedColumnChart
            ariaLabel="Resignations and applicants by month"
            colors={["#a7b3b9", "#2b3a42"]}
            thinLabels
            groups={months.map((m) => ({
              key: `${m.year}-${m.month}`,
              xLabel: shortMonthLabel(m),
              values: [m.resignations, m.applicants],
              tooltip: [`${fmtInt(m.resignations)} left, ${fmtInt(m.applicants)} applied`, monthLabel(m)],
            }))}
          />
        </ChartCard>

        <WhyMembersLeave months={months} />
        <MembershipMix months={months} />
        <Waitlist months={months} />

        <section className="card" aria-labelledby="table-title">
          <div className="card-head">
            <div>
              <h2 className="card-title" id="table-title">
                Month by month
              </h2>
              <p className="card-sub">Total Dues Paying row of each monthly workbook sheet. A dash means the sheet showed no figure.</p>
            </div>
          </div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Membership counts by month">
            <table className="data-table num" data-testid="membership-table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="right">Previous total</th>
                  <th scope="col" className="right">Left</th>
                  <th scope="col" className="right">Applied</th>
                  <th scope="col" className="right">Transferred</th>
                  <th scope="col" className="right">{DUES_PAYING}, with approvals</th>
                  <th scope="col" className="right">Waitlist</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={`${m.year}-${m.month}`}>
                    <td>{monthLabel(m)}</td>
                    <td className="right">{fmtInt(m.previousTotal)}</td>
                    <td className="right">{fmtInt(m.resignations)}</td>
                    <td className="right">{fmtInt(m.applicants)}</td>
                    <td className="right">{m.transferred === null ? "—" : fmtInt(m.transferred)}</td>
                    <td className="right">{fmtInt(m.withApprovals)}</td>
                    <td className="right">{m.waitlist === null ? "—" : fmtInt(m.waitlist)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {notes.length > 0 && (
            <ul data-testid="membership-notes">
              {notes.map((m) => (
                <li key={`${m.year}-${m.month}`}>
                  {monthLabel(m)}: {m.note}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="flags-title" data-testid="membership-flags">
          <h2 className="card-title" id="flags-title">
            Figures that don&apos;t add up
          </h2>
          <p className="card-sub">
            The figures above are copied exactly as shown in the workbooks. Nothing here corrects a figure that doesn&apos;t add up.
          </p>
          {flags.length === 0 ? (
            <p>Every month adds up, and each month starts where the last one ended.</p>
          ) : (
            <ul>
              {flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/** Why members leave: resignations split into moved, not using it and other, one stacked bar a month. */
function WhyMembersLeave({ months }: { months: MembershipMonth[] }) {
  if (!months.some((m) => reasonParts(m) !== null)) {
    return (
      <section className="card" aria-labelledby="reasons-title" data-testid="reasons-section">
        <h2 className="card-title" id="reasons-title">
          Why members leave
        </h2>
        <p data-testid="reasons-none">The reasons members left have not been loaded yet. See db/membership_monthly.sql.</p>
      </section>
    );
  }
  const summary = trailingReasons(months);
  const gaps = monthsWithout(months, reasonParts);
  return (
    <div data-testid="reasons-section">
      <ChartCard
        title="Why members leave"
        subtitle="Resignations by the reason given, from the committee's trend workbook. A month with no split is left blank, never shown as zero."
        legend={REASON_LABELS.map((label, i) => ({ label, color: SERIES[i] }))}
        table={{
          headers: ["Month", ...REASON_LABELS, "Resignations on the monthly sheet"],
          rows: months.map((m) => {
            const parts = reasonParts(m);
            return [monthLabel(m), parts ? fmtInt(parts[0]) : "—", parts ? fmtInt(parts[1]) : "—", parts ? fmtInt(parts[2]) : "—", fmtInt(m.resignations)];
          }),
        }}
        percent={{ of: 4, columns: [1, 2, 3], note: "Each reason's share of that month's resignations on the monthly sheet." }}
        footer={
          <div className="chart-footer">
            {summary && (
              <p data-testid="reasons-summary">
                Last {summary.monthsInWindow} months ({shortMonthLabel(summary.from)} to {shortMonthLabel(summary.to)}): {fmtInt(summary.moved)} moved,{" "}
                {fmtInt(summary.notUsing)} not using it, {fmtInt(summary.other)} other.
                {summary.monthsWithSplit < summary.monthsInWindow &&
                  ` Counted over ${summary.monthsWithSplit} of ${summary.monthsInWindow} months: the rest have no split.`}{" "}
                The reasons add up to {fmtInt(summary.moved + summary.notUsing + summary.other)}; the monthly sheets record{" "}
                {fmtInt(summary.resignations)} resignations in the same months.
              </p>
            )}
            {gaps.length > 0 && (
              <p data-testid="reasons-gaps">No reason split for {gaps.map(monthLabel).join(", ")}: shown as a gap, not as zero.</p>
            )}
            <MonthNotes months={notesMatching(months, /reason|resignation/i)} testId="reasons-notes" />
          </div>
        }
      >
        <GroupedColumnChart
          ariaLabel="Reasons members left, by month"
          stacked
          thinLabels
          colors={SERIES.slice(0, 3)}
          groups={months.map((m) => {
            const parts = reasonParts(m);
            return {
              key: `${m.year}-${m.month}`,
              xLabel: shortMonthLabel(m),
              // A month with no split draws nothing (a gap); its tooltip says so instead of showing zeroes.
              values: parts ?? [0, 0, 0],
              tooltip: parts
                ? [
                    `${fmtInt(parts[0] + parts[1] + parts[2])} left, by reason`,
                    monthLabel(m),
                    `${fmtInt(parts[0])} moved, ${fmtInt(parts[1])} not using it, ${fmtInt(parts[2])} other`,
                    `The monthly sheet shows ${fmtInt(m.resignations)} resignations`,
                  ]
                : ["No reason split", monthLabel(m), "Not in the committee workbook"],
            };
          })}
        />
      </ChartCard>
    </div>
  );
}

/** Membership mix: the five categories each month. The stack's height is the all-categories total, not the dues-paying total. */
function MembershipMix({ months }: { months: MembershipMonth[] }) {
  if (!months.some((m) => categoryParts(m) !== null)) {
    return (
      <section className="card" aria-labelledby="mix-title" data-testid="mix-section">
        <h2 className="card-title" id="mix-title">
          Membership mix
        </h2>
        <p data-testid="mix-none">The membership categories have not been loaded yet. See db/membership_monthly.sql.</p>
      </section>
    );
  }
  const gaps = monthsWithout(months, categoryParts);
  return (
    <div data-testid="mix-section">
      <ChartCard
        title="Membership mix"
        subtitle={`Members in each category. The top of each bar is the ${ALL_CATEGORIES} total, a different count from the ${DUES_PAYING} total in "Paying members over time".`}
        legend={CATEGORY_LABELS.map((label, i) => ({ label, color: SERIES[i] }))}
        table={{
          headers: ["Month", ...CATEGORY_LABELS, ALL_CATEGORIES],
          rows: months.map((m) => {
            const parts = categoryParts(m);
            return [monthLabel(m), ...(parts ?? [null, null, null, null, null]).map(cell), cell(m.totalAllCategories)];
          }),
        }}
        percent={{ of: CATEGORY_LABELS.length + 1, columns: CATEGORY_LABELS.map((_, i) => i + 1), note: `Each category's share of that month's ${ALL_CATEGORIES} total.` }}
        footer={
          <div className="chart-footer">
            {gaps.length > 0 && (
              <p data-testid="mix-gaps">No category split for {gaps.map(monthLabel).join(", ")}: shown as a gap, not as zero.</p>
            )}
            <MonthNotes months={notesMatching(months, /suburban|categor/i)} testId="mix-notes" />
          </div>
        }
      >
        <GroupedColumnChart
          ariaLabel="Members by category, by month"
          stacked
          thinLabels
          colors={SERIES}
          groups={months.map((m) => {
            const parts = categoryParts(m);
            return {
              key: `${m.year}-${m.month}`,
              xLabel: shortMonthLabel(m),
              values: parts ?? [0, 0, 0, 0, 0],
              tooltip: parts
                ? [
                    `${cell(m.totalAllCategories)} in ${ALL_CATEGORIES.toLowerCase()}`,
                    monthLabel(m),
                    `Resident ${fmtInt(parts[0])}, Intermediate ${fmtInt(parts[1])}, Non-Resident ${fmtInt(parts[2])}`,
                    `Suburban ${fmtInt(parts[3])}, Honorary ${fmtInt(parts[4])}`,
                  ]
                : ["No category split", monthLabel(m), "Not in the committee workbook"],
            };
          })}
        />
      </ChartCard>
    </div>
  );
}

/** The waitlist at the end of each month. A month whose sheet shows no figure is a gap; flagged estimates have their notes listed. */
function Waitlist({ months }: { months: MembershipMonth[] }) {
  if (!months.some((m) => m.waitlist !== null)) {
    return (
      <section className="card" aria-labelledby="waitlist-title" data-testid="waitlist-section">
        <h2 className="card-title" id="waitlist-title">
          Waitlist over time
        </h2>
        <p data-testid="waitlist-none">No waitlist figures are loaded yet.</p>
      </section>
    );
  }
  const flagged = notesMatching(months, /waitlist/i);
  return (
    <div data-testid="waitlist-section">
      <ChartCard
        title="Waitlist over time"
        subtitle="People on the waitlist each month. Where a value is a placeholder estimate from the committee workbook, its note is listed under the chart."
        table={{
          headers: ["Month", "Waitlist"],
          rows: months.map((m) => [monthLabel(m), cell(m.waitlist)]),
        }}
        footer={
          flagged.length > 0 ? (
            <div className="chart-footer">
              <MonthNotes months={flagged} testId="waitlist-notes" />
            </div>
          ) : undefined
        }
      >
        <ColumnChart
          ariaLabel="Waitlist by month"
          thinLabels
          columns={months.map((m) => ({
            key: `${m.year}-${m.month}`,
            xLabel: shortMonthLabel(m),
            value: m.waitlist ?? 0,
            tooltip: [
              m.waitlist === null ? "No waitlist figure" : `${fmtInt(m.waitlist)} on the waitlist`,
              monthLabel(m),
              ...(m.note && /waitlist/i.test(m.note) ? ["See the note under the chart"] : []),
            ],
          }))}
        />
      </ChartCard>
    </div>
  );
}
