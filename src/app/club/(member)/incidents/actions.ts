"use server";

import { notFound } from "next/navigation";
import type { BoatPeopleSearch } from "@/club/engine/boat-access";
import { isRealDay } from "@/club/engine/households";
import { IncidentRefused, addIncidentNote, canFileIncident, fileIncident, findIncidentPeople, type IncidentPersonInput } from "@/club/engine/incidents";
import { INCIDENT_RULES } from "@/club/settings/incident-rules";
import { clockToMinutes, pacificWall } from "@/club/time";
import { error, ok, refusal, startSignedInAction, textOf, type ActionResult } from "@/club/web-actions";

/**
 * The buttons on the incident screens. Each starts by checking the member area is on and somebody is signed in; anyone else, and the
 * live site, gets "page not found". Whether that person is staff or a coach (who may file), or staff (who may do the rest), is then
 * decided by the engine, not here, and a refusal comes back in the engine's own words (every reason, when there are several).
 */

function incidentRefusal(e: unknown): ActionResult {
  if (e instanceof IncidentRefused) return error(e.reasons.join(" "));
  return refusal(e);
}

/** "yes" or "no" from a pair of radio buttons. Anything else is left undefined, which the engine refuses in words. */
const yesNo = (value: string): boolean | undefined => (value === "yes" ? true : value === "no" ? false : undefined);

/** The most people rows the form reads. The engine's own limit (a smaller number) is what refuses a report with too many. */
const MOST_ROWS = 40;

export async function fileIncidentAction(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startSignedInAction();
  const day = textOf(formData, "day", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isRealDay(day)) return error("Choose the day it happened.");
  let occurredAt: Date;
  try {
    occurredAt = pacificWall(day, clockToMinutes(textOf(formData, "time", 5)));
  } catch {
    return error("Choose the time it happened.");
  }
  const rows = Math.min(Math.max(Number.parseInt(textOf(formData, "people", 3), 10) || 0, 0), MOST_ROWS);
  const people: IncidentPersonInput[] = [];
  for (let i = 0; i < rows; i++) {
    people.push({
      memberId: textOf(formData, `personMember${i}`, 60),
      name: textOf(formData, `personName${i}`, 500),
      injured: formData.get(`personHurt${i}`) === "on",
      parentTold: formData.get(`personParent${i}`) === "on",
    });
  }
  const boatIds = formData.getAll("boat").filter((b): b is string => typeof b === "string" && b.length > 0 && b.length <= 60);
  try {
    // The engine refuses a missing yes-or-no in words, so an unset radio button is passed on as it is.
    await fileIncident(store, ctx, INCIDENT_RULES, {
      occurredAt,
      whatHappened: textOf(formData, "what", 5000),
      location: textOf(formData, "location", 2000),
      onTheWater: yesNo(textOf(formData, "water", 3)) as boolean,
      conditions: textOf(formData, "conditions", 2000),
      boatIds,
      people,
      firstAidGiven: yesNo(textOf(formData, "firstAid", 3)) as boolean,
      firstAidNotes: textOf(formData, "firstAidNotes", 2000),
      emergencyCalled: yesNo(textOf(formData, "emergency", 3)) as boolean,
      emergencyNotes: textOf(formData, "emergencyNotes", 2000),
    });
    const hurt = people.filter((p) => p.injured).length;
    return ok(
      hurt > 0
        ? "Thank you. The report is filed. Club staff will see it first because someone was hurt."
        : "Thank you. The report is filed. Club staff will see it.",
    );
  } catch (e) {
    return incidentRefusal(e);
  }
}

/** A note on a report: staff on any report, and the coach who filed it while it is open. */
export async function addIncidentNoteAction(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startSignedInAction();
  const incident = textOf(formData, "incident", 60);
  if (!incident) return error("Choose the report.");
  try {
    await addIncidentNote(store, ctx, INCIDENT_RULES, { incidentId: incident, text: textOf(formData, "text", 5000) });
    return ok("Note added.");
  } catch (e) {
    return refusal(e);
  }
}

/**
 * The search box on the form: active members by name, three letters at least, never more than six. Only people who may file a
 * report can ask (anyone else gets "page not found"), so the box cannot be used to browse the membership.
 */
export async function searchIncidentPeople(typed: string, alreadyNamed: string[]): Promise<BoatPeopleSearch> {
  const { ctx, store } = await startSignedInAction();
  const state = await store.read();
  if (!canFileIncident(state, ctx.actor)) notFound();
  const named = Array.isArray(alreadyNamed) ? alreadyNamed.filter((id): id is string => typeof id === "string").slice(0, 60) : [];
  return findIncidentPeople(state, typeof typed === "string" ? typed.slice(0, 100) : "", named);
}
