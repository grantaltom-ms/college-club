import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { shorten } from "@/club/engine/damage";
import { officeSummary } from "@/club/engine/office";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { getClubStore } from "@/club/store/instance";
import { formatClock, formatDay, formatDayLong, pacificDate } from "@/club/time";
import { NOTICES } from "@/club/web";
import { SignedOut } from "../SignedOut";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/**
 * Staff only: the Attention board by the front desk.
 * Today's pulse, then things that need a real decision (damage, incidents, waitlists, out of service).
 * Missed boat check-ins are not chased here — they live under Reservation attendance.
 */
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
  const attentionBits = [
    summary.damage.open > 0,
    summary.incidents.open > 0,
    summary.outOfService.length > 0,
    summary.lockedBoats.length > 0,
    summary.waiting.length > 0,
  ].filter(Boolean).length;

  return (
    <section>
      <header className="club-page-head">
        <div>
          <h1>Staff office</h1>
          <p className="club-meta">
            {formatDayLong(pacificDate(now))}. Front desk board — today, then what needs a decision. Everything here is invented test
            data.
          </p>
        </div>
        <p className="club-page-actions">
          <Link href="/club/admin/check-in" className="club-button club-button-link" data-testid="check-in-link">
            Check someone in
          </Link>
        </p>
      </header>
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

      <h2>Today</h2>
      <ul className="club-today" data-testid="today">
        <li>
          <Link href="/club/my-bookings">
            <span className="club-today-count">{summary.today.bookings}</span>
            <span>boat and space booking{summary.today.bookings === 1 ? "" : "s"}</span>
          </Link>
        </li>
        <li>
          <Link href="/club/classes">
            <span className="club-today-count">{summary.today.classes}</span>
            <span>class{summary.today.classes === 1 ? "" : "es"}</span>
          </Link>
        </li>
        <li>
          <Link href="/club/events">
            <span className="club-today-count">{summary.today.events}</span>
            <span>event{summary.today.events === 1 ? "" : "s"}</span>
          </Link>
        </li>
      </ul>

      <h2>
        Needs attention <span className="club-count" data-testid="attention-count">({attentionBits})</span>
      </h2>
      <p className="club-meta">
        Damage, incidents, waitlists, and gear out of service. Missed check-ins on boats or work-from-club are fine to leave alone — see{" "}
        <Link href="/club/admin/reservations">Reservation attendance</Link> only if you need to correct a record.
      </p>

      <h3>Damage reports</h3>
      {summary.damage.open === 0 ? (
        <p data-testid="damage-board">
          Nothing is waiting to be fixed. <Link href="/club/admin/damage">Damage reports</Link>
        </p>
      ) : (
        <>
          <p data-testid="damage-board">
            {summary.damage.open} waiting to be fixed{summary.damage.major > 0 ? `, ${summary.damage.major} marked major` : ""}
            {summary.damage.majorInService > 0 ? `, ${summary.damage.majorInService} of those on a boat still in service` : ""}.{" "}
            <Link href="/club/admin/damage">Damage reports</Link>
          </p>
          <ul className="club-list" data-testid="damage-top">
            {summary.damage.top.map((r) => (
              <li key={r.reportId}>
                <Link href={`/club/admin/damage/${r.reportId}`}>{r.itemName}</Link>
                {r.major ? " (major)" : ""}: {r.description} &middot; priority {r.priority}
                {r.outOfService ? " · out of service" : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Incident reports</h3>
      {summary.incidents.open === 0 ? (
        <p data-testid="incident-board">
          No incident reports are open. <Link href="/club/admin/incidents">Incident reports</Link>
        </p>
      ) : (
        <>
          <p data-testid="incident-board">
            {summary.incidents.open} open{summary.incidents.hurt > 0 ? `, ${summary.incidents.hurt} with someone hurt` : ""}
            {summary.incidents.emergency > 0 ? `, ${summary.incidents.emergency} where emergency services were called` : ""}.{" "}
            <Link href="/club/admin/incidents">Incident reports</Link>
          </p>
          <ul className="club-list" data-testid="incident-top">
            {summary.incidents.top.map((r) => (
              <li key={r.incidentId}>
                <Link href={`/club/admin/incidents/${r.incidentId}`}>{shorten(r.whatHappened, 90)}</Link>
                {r.hurtCount > 0 ? ` · ${r.hurtCount === 1 ? "1 person hurt" : `${r.hurtCount} people hurt`}` : ""}
                {r.emergencyCalled ? " · emergency services called" : ""} &middot; filed by {r.reporter}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Out of service</h3>
      {summary.outOfService.length === 0 ? (
        <p data-testid="out-of-service-empty">Everything is in service.</p>
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

      {summary.lockedBoats.length > 0 && (
        <>
          <h3>Private boats with no owner</h3>
          <ul className="club-list" data-testid="locked-boats">
            {summary.lockedBoats.map((b) => (
              <li key={b.itemId}>
                <strong>{b.name}</strong>: nobody can book it until an owner is added
                {b.upcoming > 0 ? ` · ${b.upcoming} upcoming booking${b.upcoming === 1 ? "" : "s"} stay` : ""} ·{" "}
                <Link href="/club/admin/boats">Private boats</Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Full, with people waiting (next 7 days)</h3>
      {summary.waiting.length === 0 ? (
        <p data-testid="waiting-empty">Nobody is waiting for anything.</p>
      ) : (
        <ul className="club-list" data-testid="waiting">
          {summary.waiting.map((w) => (
            <li key={`${w.kind}-${w.id}`}>
              <Link href={w.kind === "class" ? `/club/classes/${w.id}` : `/club/events/${w.id}`}>{w.title}</Link>,{" "}
              {formatDayLong(pacificDate(new Date(w.startsAt)))}, {formatClock(w.startsAt)} &middot; {w.fullness} &middot; {w.waiting}{" "}
              waiting
            </li>
          ))}
        </ul>
      )}

      <h2>Tools</h2>
      <div className="club-tool-board" data-testid="tools">
        <article className="club-card club-tool-card">
          <h3>People</h3>
          <ul className="club-tool-links">
            <li>
              <Link href="/club">Households</Link>
            </li>
            <li>
              <Link href="/club/admin/households/new">Add a household</Link>
            </li>
            <li>
              <Link href="/club/admin/import">Import households</Link>
            </li>
            <li>
              <Link href="/club/admin/resignations">Resignations</Link>
            </li>
            <li>
              <Link href="/club/admin/history">Old bookings</Link>
            </li>
            <li>
              <Link href="/club/admin/tours">Tour requests</Link>
            </li>
          </ul>
        </article>
        <article className="club-card club-tool-card">
          <h3>Front desk</h3>
          <ul className="club-tool-links">
            <li>
              <Link href="/club/admin/check-in">Check someone in</Link>
            </li>
            <li>
              <Link href="/club/admin/ipad">Front-desk iPad</Link>
            </li>
            <li>
              <Link href="/club/my-bookings">All bookings</Link>
            </li>
            <li>
              <Link href="/club/admin/reservations">Reservation attendance</Link>
            </li>
          </ul>
        </article>
        <article className="club-card club-tool-card">
          <h3>Boats and spaces</h3>
          <ul className="club-tool-links">
            <li>
              <Link href="/club/equipment">Equipment</Link>
            </li>
            <li>
              <Link href="/club/admin/equipment-import">Load the equipment list</Link>
            </li>
            <li>
              <Link href="/club/admin/boats">Private boats</Link>
            </li>
            <li>
              <Link href="/club/admin/damage">Damage reports</Link>
            </li>
            <li>
              <Link href="/club/admin/incidents">Incident reports</Link>
            </li>
            <li>
              <Link href="/club/incidents">Report an incident</Link>
            </li>
            <li>
              <Link href="/club/practices">Practices</Link>
            </li>
          </ul>
        </article>
        <article className="club-card club-tool-card">
          <h3>Classes and events</h3>
          <ul className="club-tool-links">
            <li>
              <Link href="/club/classes/manage">Add a class or schedule sessions</Link>
            </li>
            <li>
              <Link href="/club/classes">Cancel a class (open it, then Cancel class)</Link>
            </li>
            <li>
              <Link href="/club/events/manage">Add an event</Link>
            </li>
          </ul>
        </article>
        <article className="club-card club-tool-card">
          <h3>Billing</h3>
          <ul className="club-tool-links">
            <li>
              <Link href="/club/admin/charges">Bar and snack-bar charges</Link>
            </li>
            <li>
              <Link href="/club/admin/visitors">Visitors</Link>
            </li>
            <li>
              <Link href="/club/admin/billing">Monthly billing</Link>
            </li>
          </ul>
        </article>
      </div>
    </section>
  );
}
