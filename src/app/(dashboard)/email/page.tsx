"use client";

import { useEffect, useState } from "react";
import { ChartCard } from "@/components/ChartCard";
import { ColumnChart } from "@/components/ColumnChart";
import {
  extremes,
  filteredOpenRate,
  filteredSummary,
  fmtDate,
  fmtPct,
  clickRate,
  listJump,
  listSize,
  openRate,
  quarterVsYearAgo,
  recentSends,
  seasonRange,
  unsubRate,
  weeklyByMonthOfYear,
  weeklyByQuarter,
  weeklyVsOther,
  type Campaign,
  type EmailData,
  type Summary,
} from "@/lib/mailchimp";
import { formatDay } from "@/lib/dates";
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
  const groups = weeklyVsOther(campaigns);
  const { best } = extremes(campaigns, 5);
  const filtered = filteredSummary(campaigns);
  const recent = recentSends(campaigns, 12);
  const hasFiltered = recent.some((c) => c.filteredOpens !== null);
  const quarters = weeklyByQuarter(campaigns);
  const season = seasonRange(weeklyByMonthOfYear(campaigns));
  const list = listSize(campaigns, 30);
  const spikes = list.filter((p) => p.spike).length;
  const jump = listJump(list);
  const q = quarterVsYearAgo(quarters, data.through);
  const [weekly, other] = groups;
  const latest = list[list.length - 1];

  if (campaigns.length === 0) {
    return <p className="status">No sent emails were found for this audience.</p>;
  }

  const groupTitle =
    weekly.campaigns && other.campaigns
      ? other.clickRate > weekly.clickRate
        ? `One-off emails get more clicks than the Watercooler (${fmtPct(other.clickRate)} against ${fmtPct(weekly.clickRate)})`
        : `The Watercooler gets more clicks than one-off emails (${fmtPct(weekly.clickRate)} against ${fmtPct(other.clickRate)})`
      : "Weekly Watercooler against everything else";
  const quarterTitle = q
    ? `Watercooler clicks: ${fmtPct(q.now.clickRate)} in ${q.now.label}${q.yearAgo ? `, against ${fmtPct(q.yearAgo.clickRate)} a year before` : ""}`
    : "Watercooler click rate by quarter";

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
        {latest && (
          <section className="hero" aria-label="Headline">
            <p className="hero-number num" data-testid="email-reach">
              {fmtInt(latest.delivered)}
            </p>
            <div className="hero-copy">
              <p className="hero-lead">people got the latest Watercooler, on {formatDay(latest.sentOn, true)}.</p>
              <p className="hero-support" data-testid="email-jump">
                {jump
                  ? `The list jumped from ${fmtInt(jump.from)} to ${fmtInt(jump.to)} on ${formatDay(jump.on, true)}. ${jump.spikesSince} of the ${jump.sendsSince} Watercoolers since then had more than half a percent of readers unsubscribe.`
                  : `${spikes} of the last ${list.length} Watercoolers had more than half a percent of readers unsubscribe.`}
              </p>
            </div>
          </section>
        )}

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

        <section className="card" aria-label="Weekly Watercooler compared with everything else">
          <h2 className="card-title">{groupTitle}</h2>
          <p className="card-sub">Every send since {fmtDate(campaigns[0].sentOn)}. One-off emails usually carry a single clear ask.</p>
          <SummaryTable list={groups} />
        </section>

        {quarters.length > 0 && (
          <ChartCard
            title={quarterTitle}
            subtitle="Only the weekly newsletter, so the trend is not pulled around by one-off surveys and notices. Hover a column for the number of sends behind it."
            table={{ headers: SUMMARY_HEADERS.map((h, i) => (i === 0 ? "Quarter" : h)), rows: summaryRows(quarters) }}
          >
            <ColumnChart
              columns={quarters.map((qq) => ({
                key: qq.label,
                xLabel: qq.label.endsWith("Q1") ? qq.label.slice(0, 4) : null,
                value: Math.round(qq.clickRate * 10) / 10,
                emphasis: qq.label === q?.now.label,
                tooltip: [`${fmtPct(qq.clickRate)} clicked`, qq.label, `${fmtInt(qq.campaigns)} sends, ${fmtInt(qq.delivered)} delivered`, `${fmtPct(qq.openRate)} opened (raw)`],
              }))}
              ariaLabel="Watercooler click rate by quarter"
              tick={(n) => `${n}%`}
            />
          </ChartCard>
        )}

        <section className="card" aria-label="Best emails by click rate">
          <h2 className="card-title">Best five by click rate</h2>
          <p className="card-sub">Sends of 100 or more. An email sent to two lists on the same day counts once.</p>
          <CampaignTable list={best} />
        </section>

        <section className="card" aria-label="Most recent emails">
          <h2 className="card-title">Most recent twelve</h2>
          <p className="card-sub">Watch the delivered count: the list size changes how every other number reads.</p>
          <CampaignTable list={recent} filtered={hasFiltered} />
        </section>

        <aside className="callout" aria-label="Limits of this data">
          <h3>Limits of this data</h3>
          <p>
            Open rates run too high: Apple Mail and security software open emails automatically, so the opened figures
            count some people who never read the email.
            {filtered
              ? ` Since ${fmtDate(filtered.since)}, Mailchimp can remove those: across ${fmtInt(filtered.campaigns)} emails the raw open rate is ${fmtPct(filtered.rawOpenRate)} and the filtered one is ${fmtPct(filtered.filteredOpenRate)}.`
              : ""}{" "}
            Clicks are the more honest measure.
          </p>
          <p>
            {season
              ? `Watercooler clicks ${season.high.clickRate - season.low.clickRate < 1.5 ? "barely change" : "change"} with the season: from ${fmtPct(season.low.clickRate)} in ${season.low.label} to ${fmtPct(season.high.clickRate)} in ${season.high.label}, all years pooled. `
              : ""}
            Best send time cannot be judged because almost every Watercooler goes out Tuesday at about 5:30 pm. Rates are
            totals divided by delivered emails, so they can differ slightly from the figures Mailchimp shows per email.
          </p>
        </aside>
      </div>
    </>
  );
}
