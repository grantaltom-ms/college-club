"use client";

import type { ReactNode } from "react";
import { WithData } from "@/components/DataProvider";
import { useJson, type JsonState } from "@/components/useJson";
import { formatDay } from "@/lib/dates";
import { rowingOutlook, usageOutlook, waitlistOutlook } from "@/lib/executive";
import type { ShellData } from "@/lib/shells";
import { fmtInt } from "@/lib/stats";
import type { DashboardData, MembershipData } from "@/lib/types";

/** A live figure, or a plain placeholder while it loads or when its source cannot be read. */
function Live<T>({ state, children }: { state: JsonState<T>; children: (data: T) => ReactNode }) {
  if (state.status === "loading") return <span className="exec-pending">(loading)</span>;
  if (state.status === "error") return <span className="exec-pending">(this figure could not be loaded)</span>;
  return <>{children(state.data)}</>;
}

interface PriorityProps {
  n: number;
  id: string;
  title: string;
  facts: ReactNode[];
  meaning: string;
  question: string;
  careful: string;
}

function Priority({ n, id, title, facts, meaning, question, careful }: PriorityProps) {
  return (
    <section id={id} className="exec-priority" aria-labelledby={`${id}-heading`} data-testid={`priority-${id}`}>
      <p className="exec-number" aria-hidden="true">
        {n}
      </p>
      <div>
        <h2 id={`${id}-heading`} className="exec-title">
          {title}
        </h2>
        <h3 className="exec-label">What the data says</h3>
        <ul className="exec-facts">
          {facts.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
        <h3 className="exec-label">What it means</h3>
        <p>{meaning}</p>
        <p className="exec-question">
          <strong>Question for the board:</strong> {question}
        </p>
        <p className="exec-careful">
          <strong>Read with care:</strong> {careful}
        </p>
      </div>
    </section>
  );
}

const pct = (n: number | null) => (n === null ? "no change to compare" : `${n > 0 ? "up" : "down"} ${Math.abs(n)}%`);

export function ExecutivePage() {
  const membership = useJson<MembershipData>("/api/membership", "The membership figures could not be loaded.");
  const shells = useJson<ShellData>("/api/shells", "The shell figures could not be loaded.");
  return (
    <>
      <h1 className="page-title">Three things to watch.</h1>
      <p className="page-sub">
        For the board and club leadership: where the club&apos;s data points for the year ahead. Membership, visit and boat figures are
        the dashboard&apos;s own and update with it. Survey and building figures come from the dated documents named under each one.
      </p>
      <WithData>{(data) => <Body data={data} membership={membership.state} shells={shells.state} />}</WithData>
    </>
  );
}

function Body({ data, membership, shells }: { data: DashboardData; membership: JsonState<MembershipData>; shells: JsonState<ShellData> }) {
  const usage = usageOutlook(data.members);
  const through = formatDay(data.dataThrough, true);
  return (
    <>
      {data.source === "sample" && <p className="sample-banner">Sample data: these are invented figures, not the club&apos;s.</p>}
      <ol className="exec-summary" aria-label="The three in one line each">
        <li>
          <a href="#waitlist">The waitlist that refills the club is almost gone, so keeping members is now the membership plan.</a>
        </li>
        <li>
          <a href="#direction">Members use the club for fitness and social life as much as rowing, and rowing use is falling.</a>
        </li>
        <li>
          <a href="#building">The building plan has large bills coming and almost none of them has a price.</a>
        </li>
      </ol>

      <Priority
        n={1}
        id="waitlist"
        title="The waitlist that refills the club is almost gone."
        facts={[
          <Live key="w" state={membership}>
            {(m) => {
              const o = waitlistOutlook(m.months);
              if (!o) return "No waitlist figure has been loaded yet.";
              return (
                <>
                  The waitlist was <strong data-testid="waitlist-now">{fmtInt(o.now.waitlist)}</strong> in {o.now.label}
                  {o.yearAgo && (
                    <>
                      , down from {fmtInt(o.yearAgo.waitlist)} a year earlier
                    </>
                  )}
                  {o.twoYearsAgo && <> and {fmtInt(o.twoYearsAgo.waitlist)} two years earlier</>}.
                </>
              );
            }}
          </Live>,
          <Live key="r" state={membership}>
            {(m) => {
              const o = waitlistOutlook(m.months);
              if (!o) return "No resignation figures have been loaded yet.";
              return (
                <>
                  <strong data-testid="resignations-12">{fmtInt(o.resignations12)}</strong> households resigned in the last{" "}
                  {o.monthsCounted} months, about {o.perMonth} a month.
                  {o.monthsOfCover !== null && (
                    <>
                      {" "}
                      Today&apos;s waitlist would replace about <strong data-testid="months-of-cover">{o.monthsOfCover}</strong> months of
                      that.
                    </>
                  )}
                  {o.lastWinter && (
                    <>
                      {" "}
                      Last winter ({o.lastWinter.label}) {fmtInt(o.lastWinter.resignations)} resigned.
                    </>
                  )}
                </>
              );
            }}
          </Live>,
          <>
            <strong data-testid="rarely">{fmtInt(usage.rarely)}</strong> of {fmtInt(usage.total)} member households ({usage.rarelyShare}%)
            came in less than once a month this year (visits through {through}). They are the likeliest to leave.
          </>,
          <Live key="m" state={membership}>
            {(m) => {
              const o = waitlistOutlook(m.months);
              if (!o) return "";
              return (
                <>
                  Dues-paying members were {fmtInt(o.members)} in {o.membersLabel}. The total has held steady for two years because
                  applicants from the waitlist replaced the people who left.
                </>
              );
            }}
          </Live>,
        ]}
        meaning="Until now a resignation cost the club little, because someone on the waitlist took the place. With the waitlist this short, each resignation this winter is very likely a lost household and lost dues. Keeping the members the club has is worth more than recruiting this season."
        question="What winter resignation number would the board call a success, and who owns reaching it?"
        careful="A few older monthly waitlist counts are estimates (they are flagged on the Membership page). A visit is a day with a door entry or a booking."
      />

      <Priority
        n={2}
        id="direction"
        title="Members use the club for more than rowing, and rowing use is falling."
        facts={[
          <Live key="s" state={shells}>
            {(s) => {
              const o = rowingOutlook(s.outings, s.through);
              if (!o) return "Not enough shell data has been loaded to compare years.";
              const day = formatDay(o.through);
              return (
                <>
                  Member outings in club boats from Jan 1 to {day}: <strong data-testid="rowing-now">{fmtInt(o.now)}</strong> in {o.year}{" "}
                  against {fmtInt(o.before)} in {o.year - 1}, <strong data-testid="rowing-change">{pct(o.change)}</strong>, with a similar
                  number of boats in use. Team practices are not counted.
                </>
              );
            }}
          </Live>,
          <>
            In the 2026 member survey, gym and fitness (94%) and social events (93%) were rated very or somewhat important. Rowing split
            members: 42% very important, 30% not important.
          </>,
          <>Households that say they never row rose from 34% (2025 survey) to 45% (2026 survey).</>,
          <>
            The recommend score fell from 78 to 70. It is lowest among members who never row and members aged 33 to 50 (+59 each) and
            highest among regular rowers (+85).
          </>,
          <>
            The <strong data-testid="regulars">{fmtInt(usage.regulars)}</strong> members who come weekly or more make {usage.regularEntryShare}%
            of door entries. Most of them are early-morning rowers and gym users.
          </>,
        ]}
        meaning="Most members now value the club for fitness and social life, and those members are the least enthusiastic about it. At the same time the regular rowers are the club's most loyal core, and their use is falling. The club needs to know why rowing fell before deciding whether to invest in it or shift attention away from it."
        question="Why did rowing outings fall by about a quarter, and does the way the club spends its time and money match how members actually use it?"
        careful="Each survey is about 120 self-selected responses, two-thirds from members over 50, so year-to-year changes are signals rather than proof. Outings are reservations, not confirmed trips."
      />

      <Priority
        n={3}
        id="building"
        title="The building plan has large bills coming and almost none of them has a price."
        facts={[
          <>Exterior painting of both vessels, $60,156, is approved and scheduled for spring or summer 2027.</>,
          <>
            The locker room remodel is the plan&apos;s number one priority and has no price. About 25 projects planned for FY27 to FY32 have
            no price either, including the FY30 dry-dock group: both roofs, siding, the boathouse floor and water damage.
          </>,
          <>In 2023 the club spent $64,800 on house projects against a $30,000 budget.</>,
          <>
            Members&apos; top repair requests in the 2026 survey: the dock (about 25 comments, 12 &ldquo;needs improvement&rdquo; votes)
            and the gym (about 19 comments, 14 votes).
          </>,
        ]}
        meaning="Without prices the board cannot tell whether dues and savings will cover the next five years, or whether the dry-dock year will force a special assessment. The longer pricing waits, the fewer choices the club has."
        question="What will the next five years of building work cost, and how will the club pay for it?"
        careful="Building figures are from the House Committee's capital planner and capital requests (reviewed Sep 2026); its actual-cost columns are empty, and its files are kept in one member's personal Google account."
      />

      <section className="exec-footer" aria-labelledby="exec-missing">
        <h2 id="exec-missing" className="exec-label">
          What all three are missing
        </h2>
        <p>
          A board target. None of these has a number the board has agreed to aim for, so there is no way yet to say whether the club is
          on track. One target for each would turn this page into a scorecard.
        </p>
      </section>
    </>
  );
}
