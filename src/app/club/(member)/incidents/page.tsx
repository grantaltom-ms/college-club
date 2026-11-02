import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { canFileIncident, incidentBoatChoices, myIncidents } from "@/club/engine/incidents";
import { requireClub } from "@/club/guard";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { INCIDENT_RULES } from "@/club/settings/incident-rules";
import { getClubStore } from "@/club/store/instance";
import { formatMoment, pacificDate } from "@/club/time";
import { viewerOf } from "@/club/web-actor";
import { SignedOut } from "../SignedOut";
import { FileIncidentForm, IncidentNoteForm } from "./IncidentForms";

/**
 * Report an incident: someone hurt, a capsize, a near miss. For staff and for coaches (members staff have marked), who are the people
 * on the scene. Anyone else gets "page not found". A coach sees only the reports they filed, with their own notes; what staff find
 * out afterwards is staff's.
 */
export default async function IncidentsPage() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  const state = await (await getClubStore()).read();
  if (!canFileIncident(state, toEngineActor(actor))) notFound();
  const limits = INCIDENT_RULES.defaults;
  const boats = incidentBoatChoices(state, viewerOf(actor)).map((i) => ({ id: i.id, name: i.name }));
  const mine = actor.kind === "member" ? myIncidents(state, actor.member.id) : [];

  return (
    <section>
      <h1>Report an incident</h1>
      <p>
        Use this when someone is hurt, a boat capsizes, or something nearly goes wrong. Club staff read every report. If anyone needs help right now, call 911 first and fill this in afterwards.
        {actor.kind === "staff" && (
          <>
            {" "}
            <Link href="/club/admin/incidents">Incident reports (staff)</Link>
          </>
        )}
      </p>
      <p className="club-meta">Staff add the cause and what will change when they look at the report, so you only need to say what you saw.</p>

      <FileIncidentForm boats={boats} today={pacificDate(clubNow())} limits={{ what: limits.whatHappenedMax, location: limits.locationMax, conditions: limits.conditionsMax, firstAid: limits.firstAidMax, emergency: limits.emergencyMax, personName: limits.personNameMax, people: limits.maxPeople, boats: limits.maxBoats }} />

      {actor.kind === "member" && (
        <>
          <h2>Your reports</h2>
          {mine.length === 0 ? (
            <p data-testid="no-incidents">You have not filed any incident reports.</p>
          ) : (
            <ul className="club-cards" aria-label="Your incident reports">
              {mine.map((r) => (
                <li key={r.incidentId} className="club-card" data-testid="my-incident" data-status={r.status}>
                  <h3>{formatMoment(r.occurredAt)}</h3>
                  <p>{r.whatHappened}</p>
                  <p className="club-meta">
                    <span data-testid="incident-status">{r.statusWords}</span>
                    {r.location !== "" ? ` · ${r.location}` : ""}
                    {r.boats.length > 0 ? ` · ${r.boats.join(", ")}` : ""}
                    {r.people.length > 0 ? ` · ${r.people.length} ${r.people.length === 1 ? "person" : "people"} named` : ""}
                  </p>
                  {r.notes.length > 0 && (
                    <ul className="club-list" aria-label="Your notes">
                      {r.notes.map((n) => (
                        <li key={n.at + n.text}>
                          {n.text} <span className="club-meta">&middot; {formatMoment(n.at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.status === "open" && <IncidentNoteForm incidentId={r.incidentId} label="Add something to this report" />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
