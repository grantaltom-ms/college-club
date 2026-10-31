"use server";

import { closeIncident, reviewIncident } from "@/club/engine/incidents";
import { INCIDENT_RULES } from "@/club/settings/incident-rules";
import { error, ok, refusal, startStaffAction, textOf, type ActionResult } from "@/club/web-actions";

/**
 * The staff buttons on an incident report. Each starts by checking the member area is on and the person is staff; anyone else, and
 * the live site, gets "page not found". The engine writes the report's log line in the same all-or-nothing change.
 */

export async function reviewIncidentAction(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const incident = textOf(formData, "incident", 60);
  if (!incident) return error("Choose the report.");
  const damage = textOf(formData, "damage", 60);
  try {
    await reviewIncident(store, ctx, INCIDENT_RULES, {
      incidentId: incident,
      cause: textOf(formData, "cause", 5000),
      whatWillChange: textOf(formData, "change", 5000),
      followUpBy: textOf(formData, "followUpBy", 500),
      damageReportId: damage === "" ? null : damage,
    });
    return ok("Saved.");
  } catch (e) {
    return refusal(e);
  }
}

export async function closeIncidentAction(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const incident = textOf(formData, "incident", 60);
  if (!incident) return error("Choose the report.");
  try {
    await closeIncident(store, ctx, INCIDENT_RULES, { incidentId: incident, outcome: textOf(formData, "outcome", 5000) });
    return ok("Report closed.");
  } catch (e) {
    return refusal(e);
  }
}
