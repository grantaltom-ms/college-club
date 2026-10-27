"use client";

import { useMemo, useState } from "react";
import { ColumnChart } from "@/components/ColumnChart";
import { GroupedColumnChart } from "@/components/GroupedColumnChart";
import { useJson } from "@/components/useJson";
import {
  ASK_QUESTIONS,
  answerAsk,
  clubYear,
  fmtMoney,
  fmtPercent,
  lastFullClubYear,
  latestMonth,
  lossMonths,
  monthKey,
  monthLabel,
  netMargin,
  sortMonths,
  subtotalSums,
  type AskQuestionId,
  type SubtotalSums,
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

type TableRow =
  | { kind: "month"; month: FinanceMonth }
  | { kind: "subtotal"; label: string; totals: SubtotalSums };

export function FinancialsView() {
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

  // The one filter on the page. It controls the chart and the table together,
  // and the subtotal rows below are built from the filtered months, so the
  // totals always match what is on screen.
  const [fiscalYear, setFiscalYear] = useState<string>("all");
  const [chartView, setChartView] = useState<"netIncome" | "incomeExpenses">("netIncome");
  const [showFull, setShowFull] = useState(false);

  const filtered = useMemo(() => {
    if (fiscalYear === "all") return allMonths;
    return allMonths.filter((m) => clubYear(m) === fiscalYear);
  }, [allMonths, fiscalYear]);

  // Summary strip: fixed figures from all loaded months, not the filtered view.
  const latest = latestMonth(allMonths);
  const fullYearLabel = lastFullClubYear(allMonths);
  const fullYearTotals = fullYearLabel ? subtotalSums(allMonths.filter((m) => clubYear(m) === fullYearLabel)) : null;
  const losses = lossMonths(allMonths);

  // Table rows: each club year in the filtered view, its months in order,
  // then that year's subtotal row showing both the sum of the months and
  // the package's labeled year-to-date figures.
  const tableRows: TableRow[] = useMemo(() => {
    const groups = new Map<string, FinanceMonth[]>();
    for (const m of filtered) {
      const label = clubYear(m);
      groups.set(label, [...(groups.get(label) ?? []), m]);
    }
    const rows: TableRow[] = [];
    for (const [label, months] of groups) {
      for (const month of months) rows.push({ kind: "month", month });
      const totals = subtotalSums(months);
      if (totals) rows.push({ kind: "subtotal", label, totals });
    }
    return rows;
  }, [filtered]);

  // Ask the numbers: same dropdowns and deterministic answers as before,
  // computed from all loaded months. The panel sits below the table now,
  // and says so when an answer's highlighted month is not in the filtered view.
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
  const filteredKeys = new Set(filtered.map(monthKey));
  const hiddenHighlights = answer.highlightKeys.filter((key) => !filteredKeys.has(key));

  const notes = allMonths.filter((m) => m.note);

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
        <section className="summary-strip" aria-label="At a glance">
          <div className="summary-tile" data-testid="summary-latest">
            <p className="summary-label">Latest month</p>
            <p className="summary-number num">{latest ? fmtMoney(latest.netIncome) : "—"}</p>
            <p className="summary-support">{latest ? `${monthLabel(latest)} net income, on ${fmtMoney(latest.income)} income.` : "No months loaded."}</p>
          </div>
          <div className="summary-tile" data-testid="summary-full-year">
            <p className="summary-label">Last full club year</p>
            <p className="summary-number num">{fullYearTotals ? fmtMoney(fullYearTotals.labeledYtdNetIncome) : "—"}</p>
            <p className="summary-support">
              {fullYearLabel && fullYearTotals
                ? `${fullYearLabel} labeled year-to-date net income.`
                : "No 12-month club year in the loaded figures."}
            </p>
          </div>
          <div className="summary-tile" data-testid="summary-losses">
            <p className="summary-label">Loss months</p>
            <p className="summary-number num">{losses.length === 0 ? "None" : String(losses.length)}</p>
            <p className="summary-support">
              {losses.length === 0 ? "No month in the loaded figures lost money." : losses.map((m) => `${monthLabel(m)} (${fmtMoney(m.netIncome)})`).join(", ") + "."}
            </p>
          </div>
        </section>

        <section className="card" aria-labelledby="chart-title">
          <div className="card-head">
            <div>
              <h2 className="card-title" id="chart-title">
                {chartView === "netIncome" ? "Net income by month" : "Income and expenses"}
              </h2>
              <p className="card-sub">
                {chartView === "netIncome" ? "Each month's net income." : "Each month's Total Income against its Total Expenses."}
              </p>
            </div>
            <div className="filter-row">
              <label className="filter-label" htmlFor="finance-chart">
                Chart
              </label>
              <select id="finance-chart" value={chartView} onChange={(e) => setChartView(e.target.value as "netIncome" | "incomeExpenses")}>
                <option value="netIncome">Net income</option>
                <option value="incomeExpenses">Income vs expenses</option>
              </select>
            </div>
          </div>
          {chartView === "netIncome" && (
            <>
              <ColumnChart
                ariaLabel="Net income by month"
                tick={tickMoney}
                columns={filtered.map((m) => ({
                  key: monthKey(m),
                  xLabel: shortLabel(m),
                  value: m.netIncome,
                  emphasis: m.netIncome < 0,
                  tooltip: [`${fmtMoney(m.netIncome)} net income`, monthLabel(m)],
                }))}
              />
            </>
          )}
          {chartView === "incomeExpenses" && (
            <>
              <ul className="legend" aria-label="Legend">
                <li>
                  <span className="legend-key" style={{ background: "#2b3a42" }} aria-hidden="true" /> Income
                </li>
                <li>
                  <span className="legend-key" style={{ background: "#a7b3b9" }} aria-hidden="true" /> Expenses
                </li>
              </ul>
              <GroupedColumnChart
                ariaLabel="Income and expenses by month"
                colors={["#2b3a42", "#a7b3b9"]}
                tick={tickMoney}
                groups={filtered.map((m) => ({
                  key: monthKey(m),
                  xLabel: shortLabel(m),
                  values: [m.income, m.expenses],
                  tooltip: [`${fmtMoney(m.income)} income, ${fmtMoney(m.expenses)} expenses`, monthLabel(m)],
                }))}
              />
            </>
          )}
        </section>

        <section className="card" aria-labelledby="table-title">
          <div className="card-head">
            <div>
              <h2 className="card-title" id="table-title">
                Month by month
              </h2>
              <p className="card-sub">Every month&apos;s P&amp;L, in club-year order, with each club year&apos;s subtotal row underneath its months.</p>
            </div>
          </div>
          <div className="filter-bar filter-bar--scroll" role="group" aria-label="Financials filters">
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
              <label className="filter-label" htmlFor="finance-full">
                <input id="finance-full" type="checkbox" checked={showFull} onChange={(e) => setShowFull(e.target.checked)} /> Show full P&amp;L lines
              </label>
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="status" role="status">
              No finance figures loaded yet.
            </p>
          ) : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Finance figures by month">
              <table className="data-table num" data-testid="finance-table">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col" className="right">
                      Income
                    </th>
                    {showFull && (
                      <>
                        <th scope="col" className="right">
                          Cost of goods
                        </th>
                        <th scope="col" className="right">
                          Gross profit
                        </th>
                      </>
                    )}
                    <th scope="col" className="right">
                      Expenses
                    </th>
                    {showFull && (
                      <>
                        <th scope="col" className="right">
                          Operating income
                        </th>
                        <th scope="col" className="right">
                          Other income
                        </th>
                        <th scope="col" className="right">
                          Other expenses
                        </th>
                        <th scope="col" className="right">
                          Net other
                        </th>
                      </>
                    )}
                    <th scope="col" className="right">
                      Net income
                    </th>
                    {showFull && (
                      <th scope="col" className="right">
                        Depreciation
                      </th>
                    )}
                    <th scope="col" className="right">
                      Net margin
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row) => {
                    if (row.kind === "month") {
                      const m = row.month;
                      const key = monthKey(m);
                      const isHighlighted = highlighted.has(key);
                      return (
                        <tr key={key} data-month={key} data-highlighted={isHighlighted ? "true" : undefined} style={isHighlighted ? { backgroundColor: "var(--oyster-50)" } : undefined}>
                          <td>{monthLabel(m)}</td>
                          <td className="right">{fmtMoney(m.income)}</td>
                          {showFull && (
                            <>
                              <td className="right">{fmtMoney(m.cogs)}</td>
                              <td className="right">{fmtMoney(m.grossProfit)}</td>
                            </>
                          )}
                          <td className="right">{fmtMoney(m.expenses)}</td>
                          {showFull && (
                            <>
                              <td className="right">{fmtMoney(m.netOperatingIncome)}</td>
                              <td className="right">{fmtMoney(m.otherIncome)}</td>
                              <td className="right">{fmtMoney(m.otherExpenses)}</td>
                              <td className="right">{fmtMoney(m.netOtherIncome)}</td>
                            </>
                          )}
                          <td className="right">{fmtMoney(m.netIncome)}</td>
                          {showFull && <td className="right">{fmtMoney(m.depreciation)}</td>}
                          <td className="right">{fmtPercent(netMargin(m))}</td>
                        </tr>
                      );
                    }
                    const t = row.totals;
                    const hasGap = Math.abs(t.gapIncome) >= 0.01 || Math.abs(t.gapNet) >= 0.01;
                    return (
                      <tr key={`subtotal-${row.label}`} data-testid={`subtotal-${row.label}`} className="subtotal-row">
                        <td>
                          {row.label} subtotal
                          {hasGap && (
                            <span style={{ display: "block" }}>
                              Unreconciled gap: {fmtMoney(t.gapIncome)} income, {fmtMoney(t.gapNet)} net.
                            </span>
                          )}
                        </td>
                        <td className="right">
                          <span style={{ display: "block" }}>Months {fmtMoney(t.sumIncome)}</span>
                          <span style={{ display: "block" }}>Labeled YTD {fmtMoney(t.labeledYtdIncome)}</span>
                        </td>
                        {showFull && (
                          <>
                            <td className="right">{fmtMoney(t.sumCogs)}</td>
                            <td className="right">{fmtMoney(t.sumGrossProfit)}</td>
                          </>
                        )}
                        <td className="right">{fmtMoney(t.sumExpenses)}</td>
                        {showFull && (
                          <>
                            <td className="right">{fmtMoney(t.sumNetOperatingIncome)}</td>
                            <td className="right">{fmtMoney(t.sumOtherIncome)}</td>
                            <td className="right">{fmtMoney(t.sumOtherExpenses)}</td>
                            <td className="right">{fmtMoney(t.sumNetOtherIncome)}</td>
                          </>
                        )}
                        <td className="right">
                          <span style={{ display: "block" }}>Months {fmtMoney(t.sumNet)}</span>
                          <span style={{ display: "block" }}>Labeled YTD {fmtMoney(t.labeledYtdNetIncome)}</span>
                        </td>
                        {showFull && <td className="right">{fmtMoney(t.sumDepreciation)}</td>}
                        <td className="right">{fmtPercent(t.sumIncome === 0 ? null : t.sumNet / t.sumIncome)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="card-sub">
            Club-year subtotals show both the sum of the monthly sheets and the package&apos;s labeled fiscal year-to-date figures; where they differ, the gap is flagged in the subtotal row and neither figure is corrected.
          </p>
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

        <section className="card" aria-labelledby="ask-title">
          <h2 className="card-title" id="ask-title">
            Ask the numbers
          </h2>
          <p className="card-sub">
            Computed from all loaded months — no model, no guessing. The answer highlights the months it rests on in the table above.
          </p>
          <div className="filter-bar filter-bar--scroll">
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
          {hiddenHighlights.length > 0 && (
            <p className="card-sub" data-testid="ask-hidden-note">
              Note: {hiddenHighlights.length} highlighted month{hiddenHighlights.length === 1 ? "" : "s"} {hiddenHighlights.length === 1 ? "is" : "are"} not in the current club-year view — choose &quot;All years&quot; to see {hiddenHighlights.length === 1 ? "it" : "them"} highlighted in the table.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
