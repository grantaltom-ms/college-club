"use client";

import { ChartCard } from "@/components/ChartCard";
import { ColumnChart } from "@/components/ColumnChart";
import { GroupedColumnChart } from "@/components/GroupedColumnChart";
import { useJson } from "@/components/useJson";
import {
  latestMonth,
  membershipFlags,
  monthLabel,
  periodTotals,
  sortMonths,
  type PeriodTotals,
} from "@/lib/membership";
import { fmtInt } from "@/lib/stats";
import type { MembershipData, MembershipMonth } from "@/lib/types";

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

export default function MembershipPage() {
  const { state, retry } = useJson<MembershipData>("/api/membership", "The membership figures could not be loaded.");
  return (
    <>
      <h1 className="page-title">Membership.</h1>
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
        Paying members month by month, from the Membership Committee&apos;s count workbooks. Counts only — no member names.
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
          subtitle="The workbook's own total after each month's approvals."
          table={{
            headers: ["Month", "Paying members"],
            rows: months.map((m) => [monthLabel(m), m.withApprovals]),
          }}
        >
          <ColumnChart
            ariaLabel="Paying members by month"
            columns={months.map((m) => ({
              key: `${m.year}-${m.month}`,
              xLabel: `${monthLabel(m).slice(0, 3)} ’${String(m.year).slice(2)}`,
              value: m.withApprovals,
              tooltip: [`${fmtInt(m.withApprovals)} paying members`, monthLabel(m)],
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
        >
          <GroupedColumnChart
            ariaLabel="Resignations and applicants by month"
            colors={["#a7b3b9", "#2b3a42"]}
            groups={months.map((m) => ({
              key: `${m.year}-${m.month}`,
              xLabel: `${monthLabel(m).slice(0, 3)} ’${String(m.year).slice(2)}`,
              values: [m.resignations, m.applicants],
              tooltip: [`${fmtInt(m.resignations)} left, ${fmtInt(m.applicants)} applied`, monthLabel(m)],
            }))}
          />
        </ChartCard>

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
                  <th scope="col" className="right">With approvals</th>
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
            <ul>
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
