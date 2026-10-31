import { closeIncident, fileIncident, reviewIncident } from "../engine/incidents";
import { fullName } from "../engine/queries";
import { INCIDENT_RULES } from "../settings/incident-rules";
import type { ClubStore } from "../store/memory";
import { SAMPLE_STAFF } from "./club";

/**
 * Invented incident reports. A capsize filed by the sample coach (Kenji Tanaka) with someone hurt and first aid given, reviewed by
 * staff and still open; a dock cleat that pulled out, filed by staff and still open with nobody hurt; and a near-miss from twelve
 * days ago, filed by staff, reviewed and closed. The people are the invented club's members plus one invented guest; nothing here
 * is real. Incidents never touch bookings, so these use boats and members the other sample data uses.
 */
export async function seedSampleIncidents(store: ClubStore, now: Date): Promise<void> {
  const state = await store.read();
  const member = (name: string) => {
    const m = state.members.find((x) => fullName(x) === name);
    if (!m) throw new Error(`Sample member ${name} is missing.`);
    return m;
  };
  const item = (name: string) => {
    const i = state.items.find((x) => x.name === name);
    if (!i) throw new Error(`Sample item ${name} is missing.`);
    return i.id;
  };
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600000);
  const staffAt = (when: Date) => ({ actor: SAMPLE_STAFF, now: when });
  const coach = member("Kenji Tanaka");
  const coachAt = (when: Date) => ({ actor: { kind: "member" as const, memberId: coach.id, label: fullName(coach) }, now: when });

  // Open: a capsize, someone hurt, first aid given. Reviewed by staff, who are following up.
  const capsize = await fileIncident(store, coachAt(hoursAgo(30)), INCIDENT_RULES, {
    occurredAt: hoursAgo(32),
    whatHappened: "The double flipped in a gust and both rowers went into the water. The boat stayed upright on its side and we towed it in.",
    location: "North shore, off the dock",
    onTheWater: true,
    conditions: "Gusts to about 20 knots, water around 52 degrees.",
    boatIds: [item("Pelican")],
    people: [
      { memberId: member("Tomas Vandermeer").id, injured: true },
      { memberId: member("Alex Brooks").id, injured: false },
      { name: "Jordan Example", injured: false },
    ],
    firstAidGiven: true,
    firstAidNotes: "Kenji cleaned and bandaged a cut hand at the dock.",
    emergencyCalled: false,
  });
  await reviewIncident(store, staffAt(hoursAgo(20)), INCIDENT_RULES, {
    incidentId: capsize.id,
    cause: "The wind came up faster than the forecast said.",
    whatWillChange: "Check the wind before launching and call the boats in above 15 knots.",
    followUpBy: "Safety officer",
  });

  // Open: nobody hurt, on land. Filed by staff, not reviewed yet.
  await fileIncident(store, staffAt(hoursAgo(5)), INCIDENT_RULES, {
    occurredAt: hoursAgo(6),
    whatHappened: "A cleat pulled out of the wood when a boat tied up. Nobody was hurt.",
    location: "Dock slip A",
    onTheWater: false,
    boatIds: [item("Dock slip A")],
    firstAidGiven: false,
    emergencyCalled: false,
  });

  // Closed: a near-miss twelve days ago.
  const nearMiss = await fileIncident(store, staffAt(hoursAgo(24 * 12)), INCIDENT_RULES, {
    occurredAt: hoursAgo(24 * 12 + 1),
    whatHappened: "A launch came close to a kayak at the dock as it came in. Nobody was hurt and nothing was damaged.",
    location: "Main dock",
    onTheWater: true,
    boatIds: [item("Otter")],
    firstAidGiven: false,
    emergencyCalled: false,
  });
  await reviewIncident(store, staffAt(hoursAgo(24 * 11)), INCIDENT_RULES, {
    incidentId: nearMiss.id,
    cause: "Two boats came in together and nobody called the dock.",
    whatWillChange: "Post the dock rules and remind coaches to call the dock before coming in.",
  });
  await closeIncident(store, staffAt(hoursAgo(24 * 10)), INCIDENT_RULES, { incidentId: nearMiss.id, outcome: "The dock rules are posted and every coach has been reminded." });
}
