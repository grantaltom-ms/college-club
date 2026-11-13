"use client";

import { useEffect, useState } from "react";
import { ChartCard } from "@/components/ChartCard";
import { ColumnChart, type Column } from "@/components/ColumnChart";
import { GroupedColumnChart } from "@/components/GroupedColumnChart";
import { formatDay } from "@/lib/dates";
import {
  boatChanges,
  byBoat,
  byStartHour,
  changePct,
  memberOutingsBefore,
  memberOutingsIn,
  memberYearComparable,
  monthCompare,
  monthStacks,
  outingsForShellCharts,
  seatLabel,
  shellOwnershipQuery,
  shellYears,
  yearToDate,
  type MonthCompareRow,
  type MonthStackRow,
  type ShellData,
  type ShellOwnership,
} from "@/lib/shells";
import { fmtInt } from "@/lib/stats";

const BASE = "#536872";
/** Older year light, newest year dark, the same as the Timing page. */
const YEAR_COLORS = ["#a7b3b9", "#2b3a42"];
/** Member-owned segment. A warm bronze so it reads apart from the blue-grey club years. */
const OWNED_COLOR = "#b5812f";
/** Color for year `i` of `n`, so the newest year is always the dark one. */
const yearColor = (i: number, n: number) => YEAR_COLORS[Math.max(0, YEAR_COLORS.length - n + i)];

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ShellData };

async function load(ownership: string): Promise<State> {
  try {
    const res = await fetch(`/api/shells?ownership=${encodeURIComponent(ownership)}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) return { status: "error", message: body?.error ?? "The shell figures could not be loaded." };
    return { status: "ready", data: body as ShellData };
  } catch {
    return { status: "error", message: "The shell figures could not be loaded. Check your connection and try again." };
  }
}

/** The body of the Shells dashboard page, without its heading, so a committee page can show it too. */
export function ShellsSection() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [clubOn, setClubOn] = useState(true);
  const [memberOn, setMemberOn] = useState(false);
  const ownership = shellOwnershipQuery([...(clubOn ? ["club"] : []), ...(memberOn ? ["member"] : [])]);
  useEffect(() => {
    let cancelled = false;
    load(ownership).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, ownership]);

  function changeFleet(nextClub: boolean, nextMember: boolean) {
    const club = nextClub || !nextMember;
    const member = nextMember;
    if (club === clubOn && member === memberOn) return;
    setClubOn(club);
    setMemberOn(member);
    setState({ status: "loading" });
  }

  return (
    <>
      <div className="filter-row shells-ownership" role="group" aria-label="Boat ownership" data-testid="shells-ownership">
        <span className="filter-label">Boats</span>
        <label className="filter-check" htmlFor="shells-club">
          <input id="shells-club" type="checkbox" checked={clubOn} onChange={(e) => changeFleet(e.target.checked, memberOn)} />
          Club
        </label>
        <label className="filter-check" htmlFor="shells-member">
          <input id="shells-member" type="checkbox" checked={memberOn} onChange={(e) => changeFleet(clubOn, e.target.checked)} />
          Member-owned
        </label>
      </div>
      <p className="page-sub">Club boats stay selected unless you add member-owned boats.</p>
      {state.status === "loading" && (
        <p className="status" role="status">
          Loading shell figures
        </p>
      )}
      {state.status === "error" && (
        <div className="status-error" role="alert">
          <p>{state.message}</p>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {state.status === "ready" && <Shells data={state.data} />}
    </>
  );
}

const changeText = (change: number | null) => (change === null ? "—" : `${change > 0 ? "+" : ""}${change}%`);
const moreOrFewer = (change: number) => `${Math.abs(change)}% ${change >= 0 ? "more" : "fewer"}`;
const outingsWord = (n: number) => (n === 1 ? "outing" : "outings");

function fleetsOf(data: ShellData): ShellOwnership[] {
  return data.ownership ?? ["club"];
}

function fleetLead(data: ShellData): string {
  const fleets = fleetsOf(data);
  const club = fleets.includes("club");
  const member = fleets.includes("member");
  if (club && member) return "Every time a club or member-owned shell went out";
  if (member) return "Every time a member-owned shell went out";
  return "Every time a club shell went out";
}

function OwnershipNote({ data }: { data: ShellData }) {
  const fleets = fleetsOf(data);
  if (!fleets.includes("member")) return null;
  const years = shellYears(data.outings);
  const latest = years[years.length - 1];
  if (!latest) return null;
  const prior = memberOutingsBefore(data.outings, latest);
  const withClub = fleets.includes("club");
  if (withClub) {
    const oldest = years[0];
    const owned = memberOutingsIn(data.outings, oldest);
    const priorText =
      owned === 0
        ? `${oldest} has no member-owned outings in the log, so that column is club boats only. This page does not invent a member-owned year.`
        : memberYearComparable(owned)
          ? `${oldest} includes ${fmtInt(owned)} member-owned ${outingsWord(owned)}, stacked with the club boats.`
          : `${oldest} has ${fmtInt(owned)} member-owned ${outingsWord(owned)} in the log, not enough to compare as a member fleet. This page does not invent a full member-owned year.`;
    return (
      <p className="page-sub" data-testid="shells-ownership-note">
        The monthly chart stacks each year: club boats on the bottom, member-owned boats on top. {priorText}
      </p>
    );
  }
  if (prior === 0) {
    return (
      <p className="page-sub" data-testid="shells-ownership-note">
        These are member-owned boats in {latest}. There is no {latest - 1} member-owned year in the log, so there is no comparison with last year, and this page does not invent one.
      </p>
    );
  }
  if (!memberYearComparable(prior)) {
    return (
      <p className="page-sub" data-testid="shells-ownership-note">
        The log has {fmtInt(prior)} member-owned {outingsWord(prior)} before {latest}. That is not enough to compare years, so this page does not draw a year-over-year member chart from them.
      </p>
    );
  }
  return null;
}

function Shells({ data }: { data: ShellData }) {
  const shown = outingsForShellCharts(data);
  const years = shellYears(shown);
  const [chosen, setChosen] = useState<number | null>(null);
  const year = chosen !== null && years.includes(chosen) ? chosen : years[years.length - 1];
  const cutoffLabel = formatDay(data.through);

  const ytd = yearToDate(shown, data.through);
  const now = ytd[ytd.length - 1];
  const before = ytd.length > 1 ? ytd[ytd.length - 2] : null;
  const ytdChange = before ? changePct(now.outings, before.outings) : null;
  const memberChange = before ? changePct(now.member, before.member) : null;
  const rowersNow = data.rowers.find((r) => r.year === now?.year);
  const rowersBefore = before ? data.rowers.find((r) => r.year === before.year) : undefined;

  const compare = monthCompare(shown, data.through);
  const boats = byBoat(shown, data.through);
  const boatMax = Math.max(1, ...boats.rows.flatMap((b) => b.sameDates));
  const hours = byStartHour(shown, year);
  const [allBoats, setAllBoats] = useState(false);
  const changes = boatChanges(boats.rows);
  const newest = compare.years[compare.years.length - 1];
  const oldest = compare.years[0];

  if (!now) {
    return (
      <>
        <OwnershipNote data={data} />
        <p className="status">There are no shell outings yet.</p>
      </>
    );
  }

  const mixed = Boolean(data.memberFrom) && fleetsOf(data).includes("club");
  const stacks = monthStacks(shown, data.through);
  const useStacks = mixed && compare.years.length > 1;

  const yearTooltip = (r: MonthCompareRow) =>
    r.years.map((m, i) => {
      const y = compare.years[i];
      if (!m || m.member + m.team === 0) return `${y}: no data`;
      const split = `(${fmtInt(m.member)} member, ${fmtInt(m.team)} camp/team)`;
      return m.complete ? `${y}: ${fmtInt(m.member + m.team)} ${split}` : `${y}: ${fmtInt(m.member + m.team)} so far ${split}`;
    });

  const stackTooltip = (r: MonthStackRow) => {
    const source = compare.rows[r.month - 1];
    return source.years.map((m, i) => {
      const y = compare.years[i];
      if (!m || m.club + m.owned === 0) return `${y}: no data`;
      const owned = m.owned === 0 ? "no member-owned" : `${fmtInt(m.owned)} member-owned`;
      const body = `${fmtInt(m.club)} club, ${owned}`;
      return m.complete ? `${y}: ${body}` : `${y}: ${body} so far`;
    });
  };

  const compareGroups = useStacks
    ? stacks.rows.map((r) => ({
        key: String(r.month),
        xLabel: r.label,
        values: r.columns.map((c) => c.total),
        segments: r.columns.map((c) => [...c.segments]),
        tooltip: [
          r.clubChange === null ? r.label : `${r.label}: ${moreOrFewer(r.clubChange)} club outings in ${newest}`,
          ...stackTooltip(r),
        ] as [string, ...string[]],
      }))
    : compare.rows.map((r) => ({
        key: String(r.month),
        xLabel: r.label,
        values: r.years.map((m) => (m?.complete ? m.member + m.team : 0)),
        tooltip: [
          r.change === null ? r.label : `${r.label}: ${moreOrFewer(r.change)} outings in ${newest}`,
          ...yearTooltip(r),
        ] as [string, ...string[]],
      }));

  const hourColumns: Column[] = hours.map((h) => ({
    key: String(h.hour),
    xLabel: h.hour % 3 === 0 ? h.label : null,
    value: h.outings,
    tooltip: [`${fmtInt(h.outings)} outings`, `Starting ${h.label}`],
  }));
  const peak = [...hours].sort((a, b) => b.outings - a.outings)[0];
  const hourTotal = hours.reduce((sum, h) => sum + h.outings, 0);
  const early = hours.filter((h) => h.hour < 9).reduce((sum, h) => sum + h.outings, 0);
  const earlyShare = hourTotal ? Math.round((early / hourTotal) * 100) : 0;
  const finished = compare.rows.filter((r) => r.change !== null);
  const lower = finished.filter((r) => (r.change ?? 0) < 0);
  const higher = finished.filter((r) => (r.change ?? 0) > 0);
  const clubFinished = stacks.rows.filter((r) => r.clubChange !== null);
  const clubLower = clubFinished.filter((r) => (r.clubChange ?? 0) < 0);
  const clubHigher = clubFinished.filter((r) => (r.clubChange ?? 0) > 0);
  const exceptions = (lower.length > higher.length ? higher : lower).map((r) => `${r.label} (${changeText(r.change)})`);
  const finding = (fewer: boolean, count: number, of: number, what: string) =>
    fewer ? `Fewer ${what} than ${oldest} in ${count} of ${of} finished months` : `More ${what} than ${oldest} in ${count} of ${of} finished months`;
  const compareTitle = useStacks
    ? clubFinished.length === 0
      ? "Club and member-owned boats, stacked"
      : finding(clubLower.length > clubHigher.length, clubLower.length > clubHigher.length ? clubLower.length : clubHigher.length, clubFinished.length, "club outings")
    : finished.length === 0
      ? "Each month against last year"
      : finding(lower.length > higher.length, lower.length > higher.length ? lower.length : higher.length, finished.length, "outings");
  const oldestOwned = memberOutingsIn(data.outings, oldest);
  const stackHow = "Each year is one column: club boats on the bottom, member-owned boats on top.";
  const priorStack =
    oldestOwned === 0
      ? ` ${oldest} has no member-owned outings in the log, so that column is club boats only.`
      : memberYearComparable(oldestOwned)
        ? ` Both years include club and member-owned boats.`
        : ` ${oldest} has ${fmtInt(oldestOwned)} member-owned ${outingsWord(oldestOwned)} in the log, not enough to compare as a member fleet.`;
  const compareSubtitle = useStacks
    ? `${stackHow}${priorStack} Months not finished yet are left blank.`
    : `All outings in ${compare.years.join(" and ")}, side by side on one scale.${exceptions.length ? ` The exception${exceptions.length > 1 ? "s" : ""}: ${exceptions.join(", ")}.` : ""} Months not finished yet are left blank.`;
  const priorOwned = before ? memberOutingsIn(data.outings, before.year) : 0;
  const ytdNote =
    mixed && before && priorOwned === 0
      ? `. ${before.year} counts club boats only`
      : mixed && before && !memberYearComparable(priorOwned)
        ? `. ${before.year} includes ${fmtInt(priorOwned)} member-owned ${outingsWord(priorOwned)}, not a full member fleet`
        : "";
  const monthCell = (n: number, complete: boolean) => (complete ? fmtInt(n) : `${fmtInt(n)} (so far)`);
  const compareTable = useStacks
    ? {
        headers: ["Month", ...compare.years.flatMap((y) => [`${y} club`, `${y} member-owned`]), `Club change, ${oldest} to ${newest}`],
        rows: compare.rows.map((r, i) => [
          r.label,
          ...r.years.flatMap((m) => (m ? [monthCell(m.club, m.complete), monthCell(m.owned, m.complete)] : ["—", "—"])),
          changeText(stacks.rows[i]?.clubChange ?? null),
        ]),
      }
    : {
        headers: ["Month", ...compare.years.map(String), `Change, ${oldest} to ${newest}`],
        rows: compare.rows.map((r) => [
          r.label,
          ...r.years.map((m) => (!m || m.member + m.team === 0 ? "—" : m.complete ? fmtInt(m.member + m.team) : `${fmtInt(m.member + m.team)} (so far)`)),
          changeText(r.change),
        ]),
      };
  const compareLegend = useStacks
    ? [...compare.years.map((y, i) => ({ label: `${y} club`, color: yearColor(i, compare.years.length) })), { label: "Member-owned", color: OWNED_COLOR }]
    : compare.years.map((y, i) => ({ label: String(y), color: yearColor(i, compare.years.length) }));
  const shownBoats = allBoats ? boats.rows : boats.rows.slice(0, 10);
  const boatLine = (b: (typeof boats.rows)[number]) =>
    `${b.boat} (${b.sameDates.map(fmtInt).join(" \u2192 ")})`;

  return (
    <>
      <p className="page-sub">
        {fleetLead(data)}, from the iCrew shell log, {formatDay(shown[0].day, true)} to {formatDay(data.through, true)}. Each
        outing is one boat going out once, whether one rower or four.
      </p>
      <OwnershipNote data={data} />
      {data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up boats and numbers for testing, not the real club.
        </p>
      )}

      <div className="stack">
        <section className="hero" aria-label="Headline">
          <p className="hero-number num" data-testid="shells-ytd">
            {fmtInt(now.outings)}
          </p>
          <div className="hero-copy">
            <p className="hero-lead">
              outings from Jan 1 to {cutoffLabel}, {now.year}
              {before && ytdChange !== null
                ? `, ${moreOrFewer(ytdChange)} than the same dates in ${before.year} (${fmtInt(before.outings)})${ytdNote}.`
                : "."}
            </p>
            <p className="hero-support">
              {fmtInt(now.member)} were members rowing on their own
              {before && memberChange !== null ? ` (${moreOrFewer(memberChange)} than ${before.year})` : ""} and{" "}
              {fmtInt(now.team)} were camps or team sessions
              {before ? ` (${fmtInt(before.team)} in ${before.year})` : ""}.
              {rowersNow && (
                <>
                  {" "}
                  {fmtInt(rowersNow.sameDates)} different members took a shell out
                  {rowersBefore ? `, against ${fmtInt(rowersBefore.sameDates)} over the same dates in ${rowersBefore.year}` : ""}.
                </>
              )}
            </p>
          </div>
        </section>

        {compare.years.length > 1 && (
          <ChartCard
            title={compareTitle}
            subtitle={compareSubtitle}
            legend={compareLegend}
            table={compareTable}
            percent={{ of: "column", columns: compareTable.headers.map((_, i) => i).slice(1, -1), note: "Each month's share of that column's outings." }}
          >
            <GroupedColumnChart
              groups={compareGroups}
              colors={compare.years.map((_, i) => yearColor(i, compare.years.length))}
              segmentColors={useStacks ? compare.years.map((_, i) => [yearColor(i, compare.years.length), OWNED_COLOR]) : undefined}
              ariaLabel={`Shell outings by month, ${compare.years.join(" and ")}`}
            />
          </ChartCard>
        )}

        {boats.years.length > 1 && (
          <section className="card" aria-labelledby="boat-changes-title" data-testid="boat-changes">
            <h2 className="card-title" id="boat-changes-title">
              Boats that changed most
            </h2>
            <p className="card-sub">
              Outings from Jan 1 to {cutoffLabel}, {boats.years[0]} {"\u2192"} {boats.years[boats.years.length - 1]}.
            </p>
            <dl className="change-list">
              {changes.drops.length > 0 && (
                <>
                  <dt>Biggest drops</dt>
                  <dd>{changes.drops.map(boatLine).join("; ")}</dd>
                </>
              )}
              {changes.gains.length > 0 && (
                <>
                  <dt>Biggest gains</dt>
                  <dd>{changes.gains.map(boatLine).join("; ")}</dd>
                </>
              )}
              {changes.started.length > 0 && (
                <>
                  <dt>New this year</dt>
                  <dd>{changes.started.map(boatLine).join("; ")}</dd>
                </>
              )}
              {changes.stopped.length > 0 && (
                <>
                  <dt>No outings this year</dt>
                  <dd>{changes.stopped.map(boatLine).join("; ")}</dd>
                </>
              )}
            </dl>
            {changes.started.length > 0 && changes.stopped.length > 0 && (
              <p className="card-sub">
                A boat that is new this year next to one with no outings may be the same boat renamed in iCrew. It is
                worth checking with staff, since a rename would change the boat figures above.
              </p>
            )}
          </section>
        )}

        <ChartCard
          title={allBoats ? `All ${boats.rows.length} boats` : `The ${Math.min(10, boats.rows.length)} busiest boats`}
          subtitle={
            mixed
              ? `Jan 1 to ${cutoffLabel}. Club and member-owned boats for the same dates in each year. Busiest boat this year first.`
              : `Jan 1 to ${cutoffLabel} in each year, so the years compare fairly. Busiest boat this year first.`
          }
          legend={boats.years.map((y, i) => ({ label: String(y), color: yearColor(i, boats.years.length) }))}
          table={{
            headers: ["Boat", "Type", ...boats.years.map((y) => `${y}, to ${cutoffLabel}`), ...(boats.years.length > 1 ? ["Change"] : [])],
            rows: boats.rows.map((b) => [b.boat, seatLabel(b.seats), ...b.sameDates.map(fmtInt), ...(boats.years.length > 1 ? [changeText(b.change)] : [])]),
          }}
          percent={{ of: "column", columns: boats.years.map((_, i) => i + 2), note: "Each boat's share of that year's outings, every boat counted." }}
        >
          <div className="boats num" role="list" aria-label="Outings by boat">
            {shownBoats.map((b) => (
              <div className="boat-row" role="listitem" key={b.boat} data-boat={b.boat}>
                <span className="boat-name">
                  {b.boat}
                  <small>{seatLabel(b.seats)}</small>
                </span>
                <span className="boat-bars">
                  {b.sameDates.map((n, i) => (
                    <span className="boat-bar-line" key={boats.years[i]}>
                      <span
                        className="boat-bar"
                        style={{
                          width: `${(n / boatMax) * 85}%`,
                          background: yearColor(i, boats.years.length),
                        }}
                        aria-hidden="true"
                      />
                      <span className="boat-count">
                        {fmtInt(n)} <span className="sr-only">in {boats.years[i]}</span>
                      </span>
                    </span>
                  ))}
                </span>
                <span className="boat-change">{boats.years.length > 1 ? changeText(b.change) : ""}</span>
              </div>
            ))}
          </div>
          {boats.rows.length > 10 && (
            <button type="button" className="link-button show-more" onClick={() => setAllBoats(!allBoats)}>
              {allBoats ? "Show the top 10" : `Show all ${boats.rows.length} boats`}
            </button>
          )}
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
          title={`${earlyShare}% of outings in ${year} started before 9 am`}
          subtitle={peak ? `By the hour each outing started. Busiest start: ${peak.label}.` : "By the hour each outing started."}
          table={{ headers: ["Start hour", "Outings"], rows: hours.map((h) => [h.label, fmtInt(h.outings)]) }}
          percent={{ of: "column", columns: [1], note: "Each start hour's share of the year's outings." }}
        >
          <ColumnChart columns={hourColumns} ariaLabel={`Shell outings by start hour, ${year}`} baseColor={BASE} height={220} />
        </ChartCard>

        <aside className="callout" aria-label="Limits of this data">
          <h3>Limits of this data</h3>
          <p>
            This is the iCrew shell log: one line each time a boat was taken out. It counts outings, not people, so a
            double with two rowers is one outing. Camps and team sessions are counted by boat too. The log does not
            record distance, so meters are left out. Rowers are counted, never named, on this page. The checkboxes choose
            club boats, member-owned boats, or both. When both are on, each month has one column per year, with club
            boats on the bottom and member-owned boats on top. A year with no member-owned rows stays a club column.
            This page does not invent member-owned history.
          </p>
        </aside>
      </div>
    </>
  );
}
