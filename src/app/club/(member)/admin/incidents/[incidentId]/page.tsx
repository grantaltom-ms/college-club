import Link from "next/link";
import { notFound } from "next/navigation";
import { incidentDetail } from "@/club/engine/incidents";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { INCIDENT_RULES } from "@/club/settings/incident-rules";
import { getClubStore } from "@/club/store/instance";
import { formatMoment } from "@/club/time";
import { IncidentNoteForm } from "../../../incidents/IncidentForms";
import { SignedOut } from "../../../SignedOut";
import { CloseIncidentForm, ReviewIncidentForm } from "../StaffIncidentForms";

/** Staff only: one incident report with everything on it, its log, and the buttons that record what was found and close it. */
export default async function IncidentReportPage({ params }: { params: Promise<{ incidentId: string }> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const { incidentId } = await params;
  const state = await (await getClubStore()).read();
  const detail = incidentDetail(state, incidentId);
  if (!detail) notFound();
  const i = detail.incident;
  const open = i.status === "open";
  const limits = INCIDENT_RULES.defaults;

  return (
    <section>
      <h1>Incident on {detail.occurredWords}</h1>
      <p>
        <Link href="/club/admin/incidents">Back to incident reports</Link>
      </p>

      <article className="club-card" data-testid="incident-report" data-status={i.status}>
        <p>{i.whatHappened}</p>
        <p className="club-meta">
          <span data-testid="incident-status">{detail.statusWords}</span> &middot; filed {formatMoment(i.reportedAt)} by {detail.reporter}
          {i.location !== "" ? ` · ${i.location}` : ""} &middot; {i.onTheWater ? "on the water" : "not on the water"}
        </p>
        {i.conditions !== "" && (
          <p>
            <strong>Water and weather:</strong> {i.conditions}
          </p>
        )}
        {detail.boats.length > 0 && (
          <p>
            <strong>Boats and spaces:</strong> {detail.boats.map((b) => b.name).join(", ")}
          </p>
        )}
        <p>
          <strong>First aid:</strong> {i.firstAidGiven ? `given${i.firstAidNotes ? `. ${i.firstAidNotes}` : ""}` : "not given"}
        </p>
        <p>
          <strong>Emergency services:</strong> {i.emergencyCalled ? `called${i.emergencyNotes ? `. ${i.emergencyNotes}` : ""}` : "not called"}
        </p>
        {i.status === "closed" && (
          <p data-testid="incident-closed">
            <strong>Closed</strong> {i.closedAt ? formatMoment(i.closedAt) : ""}: {i.closedNote}
          </p>
        )}
      </article>

      <h2>People involved</h2>
      {detail.people.length === 0 ? (
        <p>No one was named.</p>
      ) : (
        <ul className="club-list" data-testid="incident-people">
          {detail.people.map((p) => (
            <li key={p.name + String(p.member)} data-testid="incident-person" data-name={p.name}>
              <strong>{p.name}</strong> <span className="club-meta">{p.member ? "member" : "not a member"}</span>
              {p.injured ? <span className="club-tag">Hurt</span> : null}
              {p.parentTold ? <span className="club-meta"> &middot; a parent was told</span> : null}
            </li>
          ))}
        </ul>
      )}

      {detail.damage && (
        <p data-testid="incident-damage-link">
          <strong>Damage report:</strong> <Link href={`/club/admin/damage/${detail.damage.reportId}`}>{detail.damage.itemName}</Link>: {detail.damage.description} ({detail.damage.statusWords})
        </p>
      )}

      {open && (
        <>
          <h2>What we found</h2>
          <ReviewIncidentForm
            incidentId={i.id}
            cause={i.cause}
            change={i.whatWillChange}
            followUpBy={i.followUpBy}
            damageReportId={i.damageReportId}
            damageChoices={detail.damageChoices}
            limits={{ cause: limits.causeMax, change: limits.changeMax, followUpBy: limits.followUpByMax }}
          />
        </>
      )}
      {!open && (i.cause || i.whatWillChange || i.followUpBy) && (
        <>
          <h2>What we found</h2>
          {i.cause && (
            <p>
              <strong>Cause:</strong> {i.cause}
            </p>
          )}
          {i.whatWillChange && (
            <p>
              <strong>What will change:</strong> {i.whatWillChange}
            </p>
          )}
          {i.followUpBy && (
            <p>
              <strong>Followed up by:</strong> {i.followUpBy}
            </p>
          )}
        </>
      )}

      {open && (
        <>
          <h2>Close it</h2>
          <CloseIncidentForm incidentId={i.id} limit={limits.closingNoteMax} />
        </>
      )}

      <h2>Add a note</h2>
      <IncidentNoteForm incidentId={i.id} label="A note for the log" />

      <h2>Log</h2>
      <ul className="club-list" data-testid="incident-log">
        {detail.log.map((l) => (
          <li key={l.at + l.kind + l.text}>
            {l.text} <span className="club-meta">&middot; {l.kind === "note" ? `${l.by}, ` : ""}{formatMoment(l.at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
