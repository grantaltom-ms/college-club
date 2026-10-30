import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { describeAttendanceRules } from "@/club/engine/attendance";
import { officeSummary } from "@/club/engine/office";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { getClubStore } from "@/club/store/instance";
import { formatClock, formatDay, formatDayLong, pacificDate } from "@/club/time";
import { NOTICES } from "@/club/web";
import { SignedOut } from "../SignedOut";
import { AttendanceRowView } from "./AttendanceRowView";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/** Staff only: the board by the front desk. What needs a look, what is on today, what is out of service, who is waiting. */
export default async function StaffOffice({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const now = clubNow();
  const query = await searchParams;
  const state = await (await getClubStore()).read();
  const summary = officeSummary(state, now, ATTENDANCE_RULES);
  const notice = NOTICES[one(query.notice)];

  return (
    <section>
      <h1>Staff office</h1>
      <p className="club-meta">
        {formatDayLong(pacificDate(now))}. Everything here is invented test data.
      </p>
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      {one(query.checked) && (
        <p className="club-success" role="status" data-testid="checked">
          Saved. The change is on the check-in record.
        </p>
      )}

      <h2>
        Needs a look <span className="club-count" data-testid="needs-look-count">({summary.needsLook.length})</span>
      </h2>
      <p className="club-meta">These were marked no-shows automatically because nobody checked in. Either it is right, or someone forgot the iPad and you can put it right.</p>
      {summary.needsLook.length === 0 ? (
        <p data-testid="needs-look-empty">Nothing needs a look.</p>
      ) : (
        <ul className="club-cards" aria-label="Needs a look" data-testid="needs-look">
          {summary.needsLook.map((row) => (
            <AttendanceRowView key={`${row.kind}-${row.id}`} state={state} row={row} back="/club/admin" />
          ))}
        </ul>
      )}

      <h2>Today</h2>
      <ul className="club-list" data-testid="today">
        <li>
          <Link href="/club/my-bookings">
            {summary.today.bookings} boat and space booking{summary.today.bookings === 1 ? "" : "s"}
          </Link>
        </li>
        <li>
          <Link href="/club/classes">
            {summary.today.classes} class{summary.today.classes === 1 ? "" : "es"}
          </Link>
        </li>
        <li>
          <Link href="/club/events">
            {summary.today.events} event{summary.today.events === 1 ? "" : "s"}
          </Link>
        </li>
      </ul>
      <p>
        <Link href="/club/admin/check-in" className="club-button" data-testid="check-in-link">
          Check someone in
        </Link>
      </p>

      <h2>Out of service</h2>
      {summary.outOfService.length === 0 ? (
        <p>Everything is in service.</p>
      ) : (
        <ul className="club-list" data-testid="out-of-service">
          {summary.outOfService.map((o) => (
            <li key={o.itemId}>
              <strong>{o.name}</strong>: {o.reason}
              {o.expectedReturn ? ` · expected back ${formatDay(o.expectedReturn)}` : ""} · <Link href="/club/equipment">Equipment</Link>
            </li>
          ))}
        </ul>
      )}

      <h2>Full, with people waiting (next 7 days)</h2>
      {summary.waiting.length === 0 ? (
        <p>Nobody is waiting for anything.</p>
      ) : (
        <ul className="club-list" data-testid="waiting">
          {summary.waiting.map((w) => (
            <li key={`${w.kind}-${w.id}`}>
              <Link href={w.kind === "class" ? `/club/classes/${w.id}` : `/club/events/${w.id}`}>{w.title}</Link>, {formatDayLong(pacificDate(new Date(w.startsAt)))}, {formatClock(w.startsAt)}
                            · {w.fullness} · {w.waiting} waiting
            </li>
          ))}
        </ul>
      )}

      <h2>Tools</h2>
      <ul className="club-list" data-testid="tools">
        <li>
          <Link href="/club">Households</Link> · <Link href="/club/admin/households/new">Add a household</Link> · <Link href="/club/admin/import">Import households</Link> · <Link href="/club/admin/resignations">Resignations</Link> · <Link href="/club/admin/history">Old bookings</Link> · <Link href="/club/admin/tours">Tour requests</Link>
        </li>
        <li>
          <Link href="/club/admin/check-in">Check someone in</Link> · <Link href="/club/admin/ipad">Front-desk iPad</Link>
        </li>
        <li>
          <Link href="/club/my-bookings">All bookings</Link> · <Link href="/club/equipment">Equipment</Link> · <Link href="/club/admin/equipment-import">Load the equipment list</Link>
        </li>
        <li>
          <Link href="/club/classes/manage">Add a class or schedule sessions</Link> · <Link href="/club/events/manage">Add an event</Link>
        </li>
        <li>
          <Link href="/club/admin/charges">Bar and snack-bar charges</Link> · <Link href="/club/admin/visitors">Visitors</Link> · <Link href="/club/admin/billing">Monthly billing</Link>
        </li>
      </ul>

      <h2>How check-in works</h2>
      <p className="club-placeholder" data-testid="placeholder-note">
        <strong>Placeholder rules.</strong> The check-in times here are stand-ins until club staff confirm the real ones.
      </p>
      <ul className="club-list" data-testid="attendance-rules">
        {describeAttendanceRules(ATTENDANCE_RULES).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
