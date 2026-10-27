"use client";

import { useMemo, useState } from "react";
import { ChartCard } from "@/components/ChartCard";
import { ColumnChart } from "@/components/ColumnChart";
import { GroupedColumnChart } from "@/components/GroupedColumnChart";
import { useJson } from "@/components/useJson";
import {
  ASK_QUESTIONS,
  answerAsk,
  clubYear,
  cumulativeByClubYear,
  expenseRatio,
  fmtMoney,
  fmtPercent,
  latestMonth,
  METRIC_LABELS,
  metricValue,
  monthKey,
  monthLabel,
  netMargin,
  operatingMargin,
  periodTotals,
  sortMonths,
  ytdFlags,
  type AskQuestionId,
  type FinanceMetric,
} from "@/lib/financials";
import type { FinanceData, FinanceMonth } from "@/lib/types";

/** "$177K" style axis ticks, keeping the minus sign on loss months. */
function tickMoney(n: number): string {
  const sign = n < 0 ? "-$" : "$";
  const abs = Math.abs(n);
  return abs >= 1000 ? `${sign}${+(abs / 1000).toFixed(1)}K` : `${sign}${abs}`;
}

function shortLabel(m: FinanceMonth): string {
  return `${monthLabel(m).slice(0, 3)} ’${String(m.year).slice(2)}`;
}

export default function FinancialsPage() {
  const { state, retry } = useJson<FinanceData>("/api/financials", "The finance figures could not be loaded.");
  return (
    <>
      <h1 className="page-title">Financials.</h1>
      {state.status === "loading" && (
        <p className="status" role="status">
          Loading finance figures
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
      {state.status === "ready" && <Financials data={state.data} />}
    </>
  );
}

function Financials({ data }: { data: FinanceData }) {
  const allMonths = sortMonths(data.months);
  const clubYears = [...new Set(allMonths.map(clubYear))];

  // Filters change the headline, the charts and the monthly table together.
  // The club-year summaries and flags below always use all loaded months,
  // so a filtered view can never make a year-to-date figure look complete.
  const [fiscalYear, setFiscalYear] = useState<string>("all");
  const [startKey, setStartKey] = useState<string>("");
  const [endKey, setEndKey] = useState<string>("");
  const [metric, setMetric] = useState<FinanceMetric>("netIncome");
  const [view, setView] = useState<"monthly" | "ytd">("monthly");

  const filtered = useMemo(() => {
    let rows = allMonths;
    if (fiscalYear !== "all") rows = rows.filter((m) => clubYear(m) === fiscalYear);
    if (startKey) {
      const start = allMonths.findIndex((m) => monthKey(m) === startKey);
      if (start >= 0) rows = rows.filter((m) => allMonths.indexOf(m) >= start);
    }
    if (endKey) {
      const end = allMonths.findIndex((m) => monthKey(m) === endKey);
      if (end >= 0) rows = rows.filter((m) => allMonths.indexOf(m) <= end);
    }
    return rows;
  }, [allMonths, fiscalYear, startKey, endKey]);

  const latest = latestMonth(filtered);
  const cumulative = useMemo(() => cumulativeByClubYear(allMonths, metric), [allMonths, metric]);
  const cumulativeExpenses = useMemo(() => cumulativeByClubYear(allMonths, "expenses"), [allMonths]);

  /** Fiscal-YTD value for a month: the labeled figure for income and net income, the running sum otherwise. */
  const ytdValue = (m: FinanceMonth): number => {
    if (metric === "income") return m.labeledYtdIncome;
    if (metric === "netIncome") return m.labeledYtdNetIncome;
    return cumulative.get(monthKey(m)) ?? metricValue(m, metric);
  };

  const periods = useMemo(() => {
    const groups = new Map<string, FinanceMonth[]>();
    for (const m of allMonths) {
      const label = clubYear(m);
      groups.set(label, [...(groups.get(label) ?? []), m]);
    }
    return [...groups.entries()].flatMap(([label, rows]) => {
      const totals = periodTotals(rows);
      return totals ? [{ label, totals }] : [];
    });
  }, [allMonths]);

  const flags = ytdFlags(allMonths);
  const notes = allMonths.filter((m) => m.note);

  // Ask the numbers answers from all loaded months, whatever the filters show.
  const [question, setQuestion] = useState<AskQuestionId>("highest-net");
  const [askMonthKey, setAskMonthKey] = useState<string>("");
  const [askStartKey, setAskStartKey] = useState<string>("");
  const [askEndKey, setAskEndKey] = useState<string>("");
  const [askYear, setAskYear] = useState<string>(clubYears[0] ?? "");
  const questionMeta = ASK_QUESTIONS.find((q) => q.id === question) ?? ASK_QUESTIONS[0];
  const answer = useMemo(
    () =>
      answerAsk(question, allMonths, {
        monthKey: askMonthKey || undefined,
        startKey: askStartKey || undefined,
        endKey: askEndKey || undefined,
        clubYear: askYear || undefined,
      }),
    [question, allMonths, askMonthKey, askStartKey, askEndKey, askYear],
  );
  const highlighted = new Set(answer.highlightKeys);

  return (
    <>
      <p className="page-sub">
        Profit and loss month by month, from the Finance Committee&apos;s Board Reporting Packages. Organizational aggregates only — no member
        names.
      </p>
      {data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up numbers for testing, not the real club.
        </p>
      )}

      <div className="stack">
        <div className="filter-bar" role="group" aria-label="Financials filters">
          <div className="filter-row">
            <label className="filter-label" htmlFor="finance-year">
              Club year
            </label>
            <select id="finance-year" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}>
              <option value="all">All years</option>
              {clubYears.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
            <label className="filter-label" htmlFor="finance-start">
              From
            </label>
            <select id="finance-start" value={startKey} onChange={(e) => setStartKey(e.target.value)}>
              <option value="">Earliest</option>
              {allMonths.map((m) => (
                <option key={monthKey(m)} value={monthKey(m)}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            <label className="filter-label" htmlFor="finance-end">
              To
            </label>
            <select id="finance-end" value={endKey} onChange={(e) => setEndKey(e.target.value)}>
              <option value="">Latest</option>
              {allMonths.map((m) => (
                <option key={monthKey(m)} value={monthKey(m)}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-row">
            <label className="filter-label" htmlFor="finance-metric">
              Metric
            </label>
            <select id="finance-metric" value={metric} onChange={(e) => setMetric(e.target.value as FinanceMetric)}>
              {(Object.keys(METRIC_LABELS) as FinanceMetric[]).map((key) => (
                <option key={key} value={key}>
                  {METRIC_LABELS[key]}
                </option>
              ))}
            </select>
            <label className="filter-label" htmlFor="finance-view">
              View
            </label>
            <select id="finance-view" value={view} onChange={(e) => setView(e.target.value as "monthly" | "ytd")}>
              <option value="monthly">Monthly</option>
              <option value="ytd">Fiscal year-to-date</option>
            </select>
          </div>
        </div>

        {latest ? (
          <section className="hero" aria-label="Headline">
            <p className="hero-number num">{fmtMoney(latest.netIncome)}</p>
            <div className="hero-copy">
              <p className="hero-lead">net income in {monthLabel(latest)}.</p>
              <p className="hero-support">
                {fmtMoney(latest.income)} income, {fmtMoney(latest.expenses)} expenses, net margin {fmtPercent(netMargin(latest))}.
              </p>
            </div>
          </section>
        ) : (
          <p className="status" role="status">
            No months in this range. Widen the filters to see figures.
          </p>
        )}

        <section className="card" aria-labelledby="periods-title">
          <h2 className="card-title" id="periods-title">
            Each club year
          </h2>
          <p className="card-sub">Summaries use all loaded months, whatever the filters above show.</p>
          <ul>
            {periods.map(({ label, totals }) => (
              <li key={label} data-testid={`period-${label}`}>
                {label}: monthly sheets add up to {fmtMoney(totals.sumIncome)} income and {fmtMoney(totals.sumNet)} net over {totals.months}{" "}
                months; labeled fiscal year-to-date is {fmtMoney(totals.labeledYtdIncome)} income and {fmtMoney(totals.labeledYtdNetIncome)}{" "}
                net.
              </li>
            ))}
          </ul>
        </section>

        <ChartCard
          title="Income and expenses"
          subtitle={
            view === "monthly"
              ? "Each month's Total Income against its Total Expenses."
              : "Fiscal year-to-date: income is the package's labeled figure, expenses are the running sum of the monthly sheets."
          }
          legend={[
            { label: "Income", color: "#2b3a42" },
            { label: "Expenses", color: "#a7b3b9" },
          ]}
          table={{
            headers: ["Month", "Income", "Expenses"],
            rows: filtered.map((m) => [
              monthLabel(m),
              fmtMoney(view === "monthly" ? m.income : m.labeledYtdIncome),
              fmtMoney(view === "monthly" ? m.expenses : (cumulativeExpenses.get(monthKey(m)) ?? m.expenses)),
            ]),
          }}
        >
          <GroupedColumnChart
            ariaLabel="Income and expenses by month"
            colors={["#2b3a42", "#a7b3b9"]}
            tick={tickMoney}
            groups={filtered.map((m) => ({
              key: monthKey(m),
              xLabel: shortLabel(m),
              values:
                view === "monthly"
                  ? [m.income, m.expenses]
                  : [m.labeledYtdIncome, cumulativeExpenses.get(monthKey(m)) ?? m.expenses],
              tooltip: [
                `${fmtMoney(view === "monthly" ? m.income : m.labeledYtdIncome)} income, ${fmtMoney(view === "monthly" ? m.expenses : (cumulativeExpenses.get(monthKey(m)) ?? m.expenses))} expenses`,
                monthLabel(m),
              ],
            }))}
          />
        </ChartCard>

        <ChartCard
          title={`${METRIC_LABELS[metric]} over time`}
          subtitle={
            view === "monthly"
              ? `Each month's ${METRIC_LABELS[metric].toLowerCase()}.`
              : "Fiscal year-to-date: income and net income use the package's labeled figures; other metrics are the running sum of the monthly sheets."
          }
          table={{
            headers: ["Month", METRIC_LABELS[metric]],
            rows: filtered.map((m) => [monthLabel(m), fmtMoney(view === "monthly" ? metricValue(m, metric) : ytdValue(m))]),
          }}
        >
          <ColumnChart
            ariaLabel={`${METRIC_LABELS[metric]} by month`}
            tick={tickMoney}
            columns={filtered.map((m) => ({
              key: monthKey(m),
              xLabel: shortLabel(m),
              value: view === "monthly" ? metricValue(m, metric) : ytdValue(m),
              emphasis: metricValue(m, metric) < 0,
              tooltip: [`${fmtMoney(view === "monthly" ? metricValue(m, metric) : ytdValue(m))} ${METRIC_LABELS[metric].toLowerCase()}`, monthLabel(m)],
            }))}
          />
        </ChartCard>

        <section className="card" aria-labelledby="ask-title">
          <h2 className="card-title" id="ask-title">
            Ask the numbers
          </h2>
          <p className="card-sub">
            Computed from all loaded months, whatever the filters above show — no model, no guessing. The answer highlights the months it rests
            on in the table below.
          </p>
          <div className="filter-bar">
            <div className="filter-row">
              <label className="filter-label" htmlFor="ask-question">
                Question
              </label>
              <select id="ask-question" value={question} onChange={(e) => setQuestion(e.target.value as AskQuestionId)}>
                {ASK_QUESTIONS.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
              {questionMeta.needsMonth && (
                <>
                  <label className="filter-label" htmlFor="ask-month">
                    Month
                  </label>
                  <select id="ask-month" value={askMonthKey} onChange={(e) => setAskMonthKey(e.target.value)}>
                    <option value="">Pick a month</option>
                    {allMonths.map((m) => (
                      <option key={monthKey(m)} value={monthKey(m)}>
                        {monthLabel(m)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {questionMeta.needsYear && (
                <>
                  <label className="filter-label" htmlFor="ask-year">
                    Club year
                  </label>
                  <select id="ask-year" value={askYear} onChange={(e) => setAskYear(e.target.value)}>
                    {clubYears.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {questionMeta.needsRange && (
                <>
                  <label className="filter-label" htmlFor="ask-start">
                    From
                  </label>
                  <select id="ask-start" value={askStartKey} onChange={(e) => setAskStartKey(e.target.value)}>
                    <option value="">Pick a month</option>
                    {allMonths.map((m) => (
                      <option key={monthKey(m)} value={monthKey(m)}>
                        {monthLabel(m)}
                      </option>
                    ))}
                  </select>
                  <label className="filter-label" htmlFor="ask-end">
                    To
                  </label>
                  <select id="ask-end" value={askEndKey} onChange={(e) => setAskEndKey(e.target.value)}>
                    <option value="">Pick a month</option>
                    {allMonths.map((m) => (
                      <option key={monthKey(m)} value={monthKey(m)}>
                        {monthLabel(m)}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>
          <p data-testid="ask-answer" role="status">
            {answer.text}
          </p>
          {answer.monthsUsed.length > 0 && <p className="card-sub">Months used: {answer.monthsUsed.join(", ")}.</p>}
        </section>

        <section className="card" aria-labelledby="table-title">
          <div className="card-head">
            <div>
              <h2 className="card-title" id="table-title">
                Month by month
              </h2>
              <p className="card-sub">Every line of each month&apos;s P&L sheet, exactly as shown in its package. Highlighted rows are the ones the answer above rests on.</p>
            </div>
          </div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Finance figures by month">
            <table className="data-table num" data-testid="finance-table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="right">Income</th>
                  <th scope="col" className="right">Cost of goods</th>
                  <th scope="col" className="right">Gross profit</th>
                  <th scope="col" className="right">Expenses</th>
                  <th scope="col" className="right">Operating income</th>
                  <th scope="col" className="right">Other income</th>
                  <th scope="col" className="right">Other expenses</th>
                  <th scope="col" className="right">Net other</th>
                  <th scope="col" className="right">Net income</th>
                  <th scope="col" className="right">Depreciation</th>
                  <th scope="col" className="right">Net margin</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const key = monthKey(m);
                  const isHighlighted = highlighted.has(key);
                  return (
                    <tr key={key} data-month={key} data-highlighted={isHighlighted ? "true" : undefined} style={isHighlighted ? { backgroundColor: "var(--oyster-50)" } : undefined}>
                      <td>{monthLabel(m)}</td>
                      <td className="right">{fmtMoney(m.income)}</td>
                      <td className="right">{fmtMoney(m.cogs)}</td>
                      <td className="right">{fmtMoney(m.grossProfit)}</td>
                      <td className="right">{fmtMoney(m.expenses)}</td>
                      <td className="right">{fmtMoney(m.netOperatingIncome)}</td>
                      <td className="right">{fmtMoney(m.otherIncome)}</td>
                      <td className="right">{fmtMoney(m.otherExpenses)}</td>
                      <td className="right">{fmtMoney(m.netOtherIncome)}</td>
                      <td className="right">{fmtMoney(m.netIncome)}</td>
                      <td className="right">{fmtMoney(m.depreciation)}</td>
                      <td className="right">{fmtPercent(netMargin(m))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {notes.length > 0 && (
            <ul>
              {notes.map((m) => (
                <li key={monthKey(m)}>
                  {monthLabel(m)}: {m.note}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="flags-title" data-testid="finance-flags">
          <h2 className="card-title" id="flags-title">
            Figures that don&apos;t add up
          </h2>
          <p className="card-sub">
            The figures above are copied exactly as shown in the packages. Nothing here corrects a figure that doesn&apos;t add up, and neither
            the sum of the months nor the labeled year-to-date is picked over the other.
          </p>
          {flags.length === 0 ? (
            <p>Every club year&apos;s monthly sheets add up to its labeled fiscal year-to-date figures.</p>
          ) : (
            <ul>
              {flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          )}
          <p className="card-sub">
            Also shown for reference: operating margin is net operating income as a share of income, and the expense ratio is expenses as a share
            of income. For the latest filtered month those are {latest ? fmtPercent(operatingMargin(latest)) : "—"} and{" "}
            {latest ? fmtPercent(expenseRatio(latest)) : "—"}.
          </p>
        </section>
      </div>
    </>
  );
}
