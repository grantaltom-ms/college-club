import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { damageDetail, repairTimeWords } from "@/club/engine/damage";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { formatDay, formatMoment, pacificDate } from "@/club/time";
import { OPEN_DAMAGE } from "@/club/types";
import { DamageNoteForm } from "../../../damage/DamageForms";
import { SignedOut } from "../../../SignedOut";
import { AssignForm, DismissForm, OutOfServiceForm, PriorityForm, RepairedForm, StartButton } from "../StaffDamageForms";

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Staff only: one damage report with everything, its log, and the buttons that triage, take the boat out of service, and close it. */
export default async function DamageReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const { reportId } = await params;
  const now = clubNow();
  const state = await (await getClubStore()).read();
  const detail = damageDetail(state, reportId, now);
  if (!detail) notFound();
  const r = detail.report;
  const open = OPEN_DAMAGE.includes(r.status);
  const oos = detail.outOfService;

  return (
    <section>
      <h1>
        {detail.itemName}
        {r.major && <span className="club-tag">Major</span>}
      </h1>
      <p>
        <Link href="/club/admin/damage">Back to damage reports</Link>
      </p>

      <article className="club-card" data-testid="damage-report" data-status={r.status}>
        <p>{r.description}</p>
        <p className="club-meta">
          <span data-testid="damage-status">{detail.statusWords}</span> &middot; priority {r.priority} ({detail.priorityWords.toLowerCase()}) &middot; reported {formatMoment(r.reportedAt)} by {detail.reporter}
          {detail.assignedTo ? ` · ${detail.assignedTo} is on it` : ""}
        </p>
        {r.location !== "" && (
          <p>
            <strong>Where:</strong> {r.location}
          </p>
        )}
        {r.howItHappened !== "" && (
          <p data-testid="damage-how">
            <strong>How it happened (staff only):</strong> {r.howItHappened}
          </p>
        )}
        {detail.privateBoat && <p className="club-meta">This is a private boat. Its owners decide who uses it.</p>}
        {r.status === "repaired" && (
          <p data-testid="damage-repair">
            <strong>Repaired</strong> on {formatDay(r.repairedOn!)} by {r.repairedBy}
            {r.repairMinutes !== null ? ` · ${repairTimeWords(r.repairMinutes)} spent` : ""}
            {r.costCents !== null ? ` · cost ${money(r.costCents)}` : ""}
            {r.repairNotes ? `. ${r.repairNotes}` : ""}
          </p>
        )}
        {r.status === "dismissed" && (
          <p data-testid="damage-dismissed">
            <strong>Dismissed:</strong> {r.dismissedReason}
          </p>
        )}
      </article>

      {oos && (
        <p className="club-alert" role="note" data-testid="boat-out-of-service">
          {detail.itemName} is out of service: {oos.reason}
          {oos.expectedReturn ? ` · expected back ${formatDay(oos.expectedReturn)}` : ""}. <Link href={`/club/equipment?affected=${oos.id}`}>See who has it booked, to tell them</Link>
        </p>
      )}
      {detail.upcomingBookings > 0 && (
        <p className="club-meta">
          {detail.upcomingBookings} upcoming booking{detail.upcomingBookings === 1 ? "" : "s"} on {detail.itemName}.
        </p>
      )}
      {detail.otherOpen.length > 0 && (
        <>
          <h2>Other open reports on {detail.itemName}</h2>
          <ul className="club-list" data-testid="other-open">
            {detail.otherOpen.map((o) => (
              <li key={o.reportId}>
                <Link href={`/club/admin/damage/${o.reportId}`}>{o.description}</Link> &middot; {o.major ? "major, " : ""}priority {o.priority}
              </li>
            ))}
          </ul>
        </>
      )}

      {open && (
        <>
          <h2>Triage</h2>
          <AssignForm reportId={r.id} current={r.assignedTo} />
          <PriorityForm reportId={r.id} current={r.priority} />
          {r.status === "open" && <StartButton reportId={r.id} />}

          {!oos && (
            <>
              <h2>Take it out of service</h2>
              <p className="club-meta">
                {r.major ? "The filer marked this major. " : ""}New bookings are refused from now on. Bookings already made stay, and the Equipment page lists who to contact.
              </p>
              <OutOfServiceForm reportId={r.id} boat={detail.itemName} />
            </>
          )}

          <h2>Close it</h2>
          <RepairedForm reportId={r.id} today={pacificDate(now)} otherOpenMajor={detail.otherOpen.filter((o) => o.major).length} outOfService={oos !== null} />
          <DismissForm reportId={r.id} />
        </>
      )}

      <h2>Add a note</h2>
      <DamageNoteForm reportId={r.id} label="A note for the log" />

      <h2>Log</h2>
      <ul className="club-list" data-testid="damage-log">
        {detail.log.map((l) => (
          <li key={l.at + l.kind + l.text}>
            {l.text} <span className="club-meta">&middot; {l.kind === "note" ? `${l.by}, ` : ""}{formatMoment(l.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
