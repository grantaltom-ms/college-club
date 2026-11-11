"use client";

import { WithData } from "@/components/DataProvider";
import { useJson, type JsonState } from "@/components/useJson";
import { formatDay } from "@/lib/dates";
import { capacityFilledPct, isUpcoming, sortEvents } from "@/lib/events";
import { monthLabel, sortMonths } from "@/lib/membership";
import { dataRange, fmtInt, standing } from "@/lib/stats";
import type { DashboardData, EventsData, MembershipData, MembershipMonth, PromotedEvent } from "@/lib/types";

/**
 * Where members stand and the "where we are now" column of the board targets.
 *
 * Live since Nov 11, 2026 (Grant asked why the Social committee page still said 550 members as of Sep 27). They were typed in
 * until then, a snapshot of the iCrew list; now they come from the same roster and usage groups as the Summary page (the
 * QuickBooks list), and each card says how far the visit data goes. The waitlist is the latest month of the membership table
 * that has a waitlist count. Only the event capacity row is still written text: it describes the Sep–Oct ticketed events.
 */
const CAPACITY_NOW = "53–78% across Sep–Oct ticketed events";

/** The newest month that has a waitlist count, or null. */
function latestWaitlist(state: JsonState<MembershipData>): MembershipMonth | null {
  if (state.status !== "ready") return null;
  const withCount = sortMonths(state.data.months).filter((m) => m.waitlist !== null);
  return withCount[withCount.length - 1] ?? null;
}

const TARGET_UNSET = "Not set yet — board to set";

const HOW_TO_READ = [
  "These numbers are directional, not exact — the club is small, so a single busy night swings a percentage.",
  "An RSVP is an intention, not attendance; iCrew does not record who actually came, and one member’s registration usually includes guests.",
  "Door entries count entries, not people — one swipe can let a group in, and people already inside never swipe.",
  "Compare like with like: same season last year, not last month — club use is strongly seasonal.",
  "Email “opens” overstate reading (many mail apps open messages automatically), so treat the email stage as the softest number on the page.",
] as const;

const KEEPING_HONEST = [
  "Every promoted event gets its own iCrew RSVP link — never reuse a link, and don’t promote an event with only a website signup.",
  "Set a capacity on every event, or “filled %” can’t be shown.",
  "Door data is loaded monthly; event rows are added after each Watercooler goes out.",
] as const;

/** The body of the Events dashboard page, without its heading, so a committee page can show it too. */
export function EventsSection() {
  const { state, retry } = useJson<EventsData>("/api/events", "The event figures could not be loaded.");
  const membership = useJson<MembershipData>("/api/membership", "The membership figures could not be loaded.");
  const waitlist = latestWaitlist(membership.state);
  return (
    <>
      <p className="page-sub">What we promoted, who signed up, and who showed up — from the Watercooler, iCrew and the front door.</p>
      {state.status === "ready" && state.data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up numbers for testing, not the real club.
        </p>
      )}

      {/* The scoreboard reads the event_scoreboard table; the member cards and targets read the dashboard data. The rest is written text. */}
      <div className="stack">
        <Scoreboard state={state} retry={retry} />
        <HowToRead />
        <WithData>
          {(data) => <WhereMembersStand data={data} waitlist={waitlist} />}
        </WithData>
        <TestsWeAreRunning />
        <WithData>
          {(data) => <BoardTargets data={data} waitlist={waitlist} />}
        </WithData>
        <KeepingHonest />
      </div>
    </>
  );
}

/** "48" for a held event, "48 so far" for one still taking registrations. */
function Count({ value, event }: { value: string; event: PromotedEvent }) {
  return (
    <>
      {value}
      {isUpcoming(event) && value !== "—" && <span className="ev-so-far"> so far</span>}
    </>
  );
}

function Scoreboard({ state, retry }: { state: JsonState<EventsData>; retry: () => void }) {
  return (
    <section className="card" aria-labelledby="scoreboard-title">
      <h2 className="card-title" id="scoreboard-title">
        Event scoreboard
      </h2>
      {state.status === "loading" && (
        <p className="status" role="status">
          Loading event figures
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
      {state.status === "ready" && <ScoreboardTable events={sortEvents(state.data.events)} />}
    </section>
  );
}

function ScoreboardTable({ events }: { events: PromotedEvent[] }) {
  return (
    <>
      <p className="card-sub">
        One row for each event we promoted, oldest first. Counts only — no member names. “Capacity filled” is persons ÷ capacity, shown only when the
        event had a capacity. Upcoming events show their registrations so far.
      </p>
      <div className="ev-table-scroll" tabIndex={0} role="region" aria-label="Counts for each event">
        <table className="data-table num" data-testid="events-table">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Date</th>
              <th scope="col">Price</th>
              <th scope="col" className="right">Promoted</th>
              <th scope="col" className="right">Registered (members)</th>
              <th scope="col" className="right">Attending (persons incl. guests)</th>
              <th scope="col" className="right">Capacity filled %</th>
              <th scope="col" className="right">Door entries (event window)</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const filled = capacityFilledPct(e);
              return (
                <tr key={`${e.name}|${e.date}`} data-testid="event-row">
                  <td>
                    {e.name}
                    {isUpcoming(e) && (
                      <>
                        {" "}
                        <span className="ev-tag">Upcoming</span>
                      </>
                    )}
                  </td>
                  <td className="ev-nowrap">{formatDay(e.date, true)}</td>
                  <td className="ev-nowrap">{e.priceLabel ?? "—"}</td>
                  <td className="right">{e.timesPromoted === null ? "—" : fmtInt(e.timesPromoted)}</td>
                  <td className="right">
                    <Count value={e.rsvpMembers === null ? "—" : fmtInt(e.rsvpMembers)} event={e} />
                  </td>
                  <td className="right">
                    <Count value={e.rsvpPersons === null ? "—" : fmtInt(e.rsvpPersons)} event={e} />
                  </td>
                  <td className="right">
                    <Count value={filled === null ? "—" : `${filled}%`} event={e} />
                  </td>
                  <td className="right ev-door-cell">
                    {e.doorEntriesWindow === null ? "—" : fmtInt(e.doorEntriesWindow)}
                    {e.doorComparison && (
                      <>
                        {" "}
                        <span className="ev-door-note">{e.doorComparison}</span>
                      </>
                    )}
                  </td>
                  <td className="ev-note-cell">{e.note ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="card-sub" data-testid="events-summary">
        Paid tastings filled best this fall; watch parties barely register — members just come.
      </p>
    </>
  );
}

function HowToRead() {
  return (
    <section className="card" aria-labelledby="how-to-read-title" data-testid="how-to-read">
      <h2 className="card-title" id="how-to-read-title">
        How to read these numbers
      </h2>
      <ul>
        {HOW_TO_READ.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

function WhereMembersStand({ data, waitlist }: { data: DashboardData; waitlist: MembershipMonth | null }) {
  const st = standing(data.members);
  const visits = `visits ${dataRange(data)}`;
  const cards = [
    { key: "visited", area: "Visited at least once", value: `${fmtInt(st.visited)} of ${fmtInt(st.total)}`, lead: "members came in at least once this year.", asOf: visits },
    {
      key: "rarely",
      area: "Rarely visit",
      value: `${fmtInt(st.rarely)} of ${fmtInt(st.total)} (${st.rarelyShare}%)`,
      lead: "came in less than once a month, or not at all.",
      asOf: visits,
    },
    { key: "none", area: "No visits at all", value: fmtInt(st.none), lead: "have not visited at all in the data we hold.", asOf: visits },
    {
      key: "waitlist",
      area: "Waitlist",
      value: waitlist ? fmtInt(waitlist.waitlist as number) : "—",
      lead: "people on the waitlist.",
      asOf: waitlist ? monthLabel(waitlist) : "not loaded yet",
    },
  ];
  return (
    <section aria-labelledby="stand-title">
      <h2 className="card-title" id="stand-title">
        Where members stand
      </h2>
      <p className="card-sub">
        The same member list and visit data as the Summary page, so the two always agree. Each card says how far its data goes.
        {data.roster.asOf && <> Member list: {data.roster.source}, {formatDay(data.roster.asOf, true)}.</>}
      </p>
      <div className="stat-grid ev-two-up">
        {cards.map((s) => (
          <section className="stat-card" key={s.key} aria-label={s.area} data-testid={`stand-${s.key}`}>
            <h3 className="stat-area">{s.area}</h3>
            <p className="stat-value ev-stand-value num">{s.value}</p>{" "}
            <p className="stat-lead">{s.lead}</p>
            <p className="stat-detail">As of: {s.asOf}</p>
          </section>
        ))}
      </div>
    </section>
  );
}

function TestsWeAreRunning() {
  return (
    <section aria-labelledby="tests-title">
      <h2 className="card-title" id="tests-title">
        Tests we are running
      </h2>
      <div className="stat-grid ev-two-up">
        <section className="card" aria-labelledby="test-retention-title" data-testid="test-retention">
          <h3 className="card-title" id="test-retention-title">
            Winter retention test — approved, not sent
          </h3>
          <p>
            Approved Nov 2, 2026. When it goes: an email to 134 at-risk members, with about 20 similar members held back and not contacted, so results can
            be compared honestly. Sending waits on the final go-ahead. Owner: Membership committee (Amy and Rick).
          </p>
        </section>
        <section className="card" aria-labelledby="test-happy-hour-title" data-testid="test-happy-hour">
          <h3 className="card-title" id="test-happy-hour-title">
            Happy Hour invitation — list ready, not sent
          </h3>
          <p>
            20 disengaged members identified and checked against Mailchimp (19 currently sendable). No date set and nothing sent. Success measure, agreed
            before sending: visits within 60 days, compared with similar members not contacted.
          </p>
        </section>
      </div>
    </section>
  );
}

function BoardTargets({ data, waitlist }: { data: DashboardData; waitlist: MembershipMonth | null }) {
  const st = standing(data.members);
  const targets = [
    { measure: "% of members visiting at least monthly", now: `${st.monthlyShare}% (${fmtInt(st.monthly)} of ${fmtInt(st.total)})` },
    { measure: "Members with no visit at all in the data", now: fmtInt(st.none) },
    { measure: "Event capacity filled (persons)", now: CAPACITY_NOW },
    { measure: "New members with 3+ visits in their first 90 days", now: "Not measured yet" },
    { measure: "Waitlist", now: waitlist ? fmtInt(waitlist.waitlist as number) : "—" },
  ];
  return (
    <section className="card" aria-labelledby="targets-title">
      <h2 className="card-title" id="targets-title">
        Board targets
      </h2>
      <div className="ev-table-scroll" tabIndex={0} role="region" aria-label="Targets by measure">
        <table className="data-table" data-testid="targets-table">
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">Where we are now</th>
              <th scope="col">Target</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.measure}>
                <td>{t.measure}</td>
                <td>{t.now}</td>
                <td className="ev-target-unset">{TARGET_UNSET}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KeepingHonest() {
  return (
    <section className="card" aria-labelledby="honest-title" data-testid="keeping-honest">
      <h2 className="card-title" id="honest-title">
        Keeping this page honest
      </h2>
      <ul>
        {KEEPING_HONEST.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
