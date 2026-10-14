"use client";

import { useEffect, useState } from "react";
import { ChartCard } from "@/components/ChartCard";
import { ColumnChart } from "@/components/ColumnChart";
import {
  byYear,
  clickRate,
  extremes,
  filteredOpenRate,
  filteredSummary,
  fmtDate,
  fmtPct,
  listSize,
  openRate,
  recentSends,
  unsubRate,
  weeklyByMonthOfYear,
  weeklyByQuarter,
  weeklyVsOther,
  type Campaign,
  type EmailData,
  type Summary,
} from "@/lib/mailchimp";
import { fmtInt } from "@/lib/stats";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: EmailData };

async function load(): Promise<State> {
  try {
    const res = await fetch("/api/email", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) return { status: "error", message: body?.error ?? "The email figures could not be loaded." };
    return { status: "ready", data: body as EmailData };
  } catch {
    return { status: "error", message: "The email figures could not be loaded. Check your connection and try again." };
  }
}

export default function EmailPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <h1 className="page-title">Email.</h1>
      {state.status === "loading" && (
        <p className="status" role="status">
          Loading email figures
        </p>
      )}
      {state.status === "error" && (
        <div className="status-error" role="alert">
          <p>{state.message}</p>
          <button type="button" className="link-button" onClick={() => load().then(setState)}>
            Try again
          </button>
        </div>
      )}
      {state.status === "ready" && <Email data={state.data} />}
    </>
  );
}

function summaryRows(list: Summary[]) {
  return list.map((s) => [
    s.label,
    fmtInt(s.campaigns),
    fmtInt(s.delivered),
    fmtPct(s.openRate),
    fmtPct(s.clickRate),
    `${s.unsubRate.toFixed(2)}%`,
  ]);
}

const SUMMARY_HEADERS = ["", "Emails sent", "Delivered", "Opened", "Clicked", "Unsubscribed"];

function SummaryTable({ list }: { list: Summary[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {SUMMARY_HEADERS.map((h, i) => (
              <th key={h || "label"} scope="col" className={i > 0 ? "right" : ""}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summaryRows(list).map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) => (
                <td key={i} className={i > 0 ? "right num" : ""}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignTable({ list, filtered = false }: { list: Campaign[]; filtered?: boolean }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Sent</th>
            <th scope="col">Email</th>
            <th scope="col" className="right">Delivered</th>
            {filtered && <th scope="col" className="right">Opened (filtered)</th>}
            <th scope="col" className="right">Opened</th>
            <th scope="col" className="right">Clicked</th>
            <th scope="col" className="right">Unsubscribed</th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => {
            const f = filteredOpenRate(c);
            return (
              <tr key={c.id}>
                <td>{fmtDate(c.sentOn)}</td>
                <td>{c.subject || c.title}</td>
                <td className="right num">{fmtInt(c.delivered)}</td>
                {filtered && <td className="right num">{f === null ? "—" : fmtPct(f)}</td>}
                <td className="right num">{fmtPct(openRate(c))}</td>
                <td className="right num">{fmtPct(clickRate(c))}</td>
                <td className="right num">{unsubRate(c).toFixed(2)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Email({ data }: { data: EmailData }) {
  const { campaigns } = data;
  const years = byYear(campaigns);
  const groups = weeklyVsOther(campaigns);
  const { best, worst } = extremes(campaigns, 5);
  const filtered = filteredSummary(campaigns);
  const recent = recentSends(campaigns, 12);
  const hasFiltered = recent.some((c) => c.filteredOpens !== null);
  const quarters = weeklyByQuarter(campaigns);
  const months = weeklyByMonthOfYear(campaigns);
  const list = listSize(campaigns, 30);
  const spikes = list.filter((p) => p.spike).length;

  if (campaigns.length === 0) {
    return <p className="status">No sent emails were found for this audience.</p>;
  }

  return (
    <>
      <p className="page-sub">
        {fmtInt(campaigns.length)} emails to the member list, {fmtDate(campaigns[0].sentOn)} to {fmtDate(data.through)}.
        Counts come from Mailchimp. People are never shown here, only totals.
      </p>
      {data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up numbers for testing, not the real club.
        </p>
      )}

      <div className="stack">
        <aside className="callout" aria-label="About open rates">
          <h3>Open rates run too high</h3>
          <p>
            Apple Mail and security software open emails automatically, so the opened figures count some people who
            never read the email.
            {filtered
              ? ` Since ${fmtDate(filtered.since)}, Mailchimp can remove those: across ${fmtInt(filtered.campaigns)} emails the raw open rate is ${fmtPct(filtered.rawOpenRate)} and the filtered one is ${fmtPct(filtered.filteredOpenRate)}.`
              : " Mailchimp has no filtered figure for these emails."}{" "}
            Clicks are the more honest measure.
          </p>
        </aside>

        <ChartCard
          title="Click rate by year"
          subtitle="Share of delivered emails where someone clicked a link."
          table={{ headers: SUMMARY_HEADERS.map((h, i) => (i === 0 ? "Year" : h)), rows: summaryRows(years) }}
        >
          <ColumnChart
            columns={years.map((y) => ({
              key: y.label,
              xLabel: y.label,
              value: Math.round(y.clickRate * 10) / 10,
              tooltip: [`${fmtPct(y.clickRate)} clicked`, y.label, `${fmtInt(y.campaigns)} emails, ${fmtInt(y.delivered)} delivered`],
            }))}
            ariaLabel="Click rate by year"
            tick={(n) => `${n}%`}
          />
        </ChartCard>

        <section className="card" aria-label="Weekly Watercooler compared with everything else">
          <h2 className="card-title">Weekly Watercooler against everything else</h2>
          <p className="card-sub">The Watercooler is steady. One-off emails with a single clear ask do much better.</p>
          <SummaryTable list={groups} />
        </section>

        {quarters.length > 0 && (
          <ChartCard
            title="Watercooler click rate by quarter"
            subtitle="Only the weekly newsletter, so the line is not pulled around by one-off surveys and notices. Hover a column for the number of sends behind it."
            table={{ headers: SUMMARY_HEADERS.map((h, i) => (i === 0 ? "Quarter" : h)), rows: summaryRows(quarters) }}
          >
            <ColumnChart
              columns={quarters.map((q) => ({
                key: q.label,
                xLabel: q.label.endsWith("Q1") ? q.label.slice(0, 4) : null,
                value: Math.round(q.clickRate * 10) / 10,
                emphasis: q.label === quarters[quarters.length - 1].label,
                tooltip: [`${fmtPct(q.clickRate)} clicked`, q.label, `${fmtInt(q.campaigns)} sends, ${fmtInt(q.delivered)} delivered`, `${fmtPct(q.openRate)} opened (raw)`],
              }))}
              ariaLabel="Watercooler click rate by quarter"
              tick={(n) => `${n}%`}
            />
          </ChartCard>
        )}

        <ChartCard
          title="Watercooler click rate by month of the year"
          subtitle="All years pooled, by the month the email went out. A low summer or a low winter says when members stop reading, which matters for off-season events."
          table={{ headers: SUMMARY_HEADERS.map((h, i) => (i === 0 ? "Month" : h)), rows: summaryRows(months) }}
        >
          <ColumnChart
            columns={months.map((m) => ({
              key: m.label,
              xLabel: m.label,
              value: Math.round(m.clickRate * 10) / 10,
              tooltip: [`${fmtPct(m.clickRate)} clicked`, m.label, `${fmtInt(m.campaigns)} sends, ${fmtInt(m.delivered)} delivered`],
            }))}
            ariaLabel="Watercooler click rate by month of the year"
            tick={(n) => `${n}%`}
          />
        </ChartCard>

        {list.length > 0 && (
          <ChartCard
            title={`List size, last ${list.length} Watercoolers`}
            subtitle={
              spikes > 0
                ? `Emails delivered per send. Dark columns are sends where more than half a percent of readers unsubscribed (${spikes} of ${list.length}).`
                : "Emails delivered per send. A column is darkened when more than half a percent of readers unsubscribe; none did here."
            }
            legend={[
              { label: "Delivered", color: "#536872" },
              { label: "Unsubscribes above 0.5%", color: "#8c3b2f" },
            ]}
            table={{
              headers: ["Sent", "Delivered", "Bounced", "Unsubscribed"],
              rows: list.map((p) => [fmtDate(p.sentOn), fmtInt(p.delivered), fmtInt(p.bounces), fmtInt(p.unsubscribes)]),
            }}
          >
            <ColumnChart
              columns={list.map((p, i) => ({
                key: p.id,
                xLabel: i % 5 === 0 || i === list.length - 1 ? fmtDate(p.sentOn).replace(/, \d{4}$/, "") : null,
                value: p.delivered,
                emphasis: p.spike,
                tooltip: [`${fmtInt(p.delivered)} delivered`, fmtDate(p.sentOn), `${fmtInt(p.unsubscribes)} unsubscribed, ${fmtInt(p.bounces)} bounced`],
              }))}
              ariaLabel={`List size, last ${list.length} Watercoolers`}
              emphasisColor="#8c3b2f"
            />
          </ChartCard>
        )}

        <section className="card" aria-label="Best and worst emails by click rate">
          <h2 className="card-title">Best five by click rate</h2>
          <p className="card-sub">Sends of 100 or more. Surveys and billing notices that need action lead.</p>
          <CampaignTable list={best} />
          <h2 className="card-title">Lowest five by click rate</h2>
          <p className="card-sub">Mostly notices with no link in them, so a low rate says little about quality.</p>
          <CampaignTable list={worst} />
        </section>

        <section className="card" aria-label="Most recent emails">
          <h2 className="card-title">Most recent twelve</h2>
          <p className="card-sub">Watch the delivered count: the list size changes how every other number reads.</p>
          <CampaignTable list={recent} filtered={hasFiltered} />
        </section>

        <aside className="callout" aria-label="Limits of this data">
          <h3>Limits of this data</h3>
          <p>
            Rates are totals divided by delivered emails, so they can differ slightly from the figures Mailchimp shows
            per email. Best send time cannot be judged because almost every Watercooler goes out Tuesday at about 5:30
            pm. The list size changed sharply in August 2026.
          </p>
        </aside>
      </div>
    </>
  );
}
