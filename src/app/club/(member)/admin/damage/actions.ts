"use server";

import {
  assignDamageReport,
  dismissDamageReport,
  markDamageRepaired,
  setDamagePriority,
  startDamageRepair,
  takeOutOfServiceForReport,
} from "@/club/engine/damage";
import { DAMAGE_RULES } from "@/club/settings/damage-rules";
import { dollarsToCents, hoursToMinutes } from "@/club/web-damage";
import { error, ok, refusal, startStaffAction, textOf, type ActionResult } from "@/club/web-actions";

/**
 * The staff buttons on a damage report. Each starts by checking the member area is on and the person is staff; anyone else, and
 * the live site, gets "page not found". The engine writes the report's log line in the same all-or-nothing change.
 */

export async function assignReport(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const report = textOf(formData, "report", 60);
  if (!report) return error("Choose the report.");
  try {
    const done = await assignDamageReport(store, ctx, DAMAGE_RULES, { reportId: report, assignedTo: textOf(formData, "assignedTo", 500) });
    return ok(done.assignedTo ? `Assigned to ${done.assignedTo}.` : "No longer assigned to anyone.");
  } catch (e) {
    return refusal(e);
  }
}

export async function changePriority(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const report = textOf(formData, "report", 60);
  if (!report) return error("Choose the report.");
  const priority = textOf(formData, "priority", 4);
  if (!/^\d$/.test(priority)) return error("Pick a priority from 1 to 4.");
  try {
    const done = await setDamagePriority(store, ctx, { reportId: report, priority: Number(priority) });
    return ok(`Priority is now ${done.priority}.`);
  } catch (e) {
    return refusal(e);
  }
}

export async function startReport(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const report = textOf(formData, "report", 60);
  if (!report) return error("Choose the report.");
  try {
    await startDamageRepair(store, ctx, { reportId: report });
    return ok("Marked as being fixed.");
  } catch (e) {
    return refusal(e);
  }
}

export async function outOfServiceForReport(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const report = textOf(formData, "report", 60);
  if (!report) return error("Choose the report.");
  const back = textOf(formData, "expectedReturn", 10);
  try {
    const done = await takeOutOfServiceForReport(store, ctx, { reportId: report, expectedReturn: back === "" ? null : back });
    const n = done.affected.length;
    return ok(n === 0 ? "Taken out of service. Nobody had it booked." : `Taken out of service. ${n === 1 ? "1 upcoming booking stays" : `${n} upcoming bookings stay`}; the Equipment page lists who to contact.`);
  } catch (e) {
    return refusal(e);
  }
}

export async function repairedReport(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const report = textOf(formData, "report", 60);
  if (!report) return error("Choose the report.");
  const hours = hoursToMinutes(textOf(formData, "hours", 20));
  if (!hours.ok) return error(hours.message);
  const cost = dollarsToCents(textOf(formData, "cost", 20));
  if (!cost.ok) return error(cost.message);
  try {
    const done = await markDamageRepaired(store, ctx, DAMAGE_RULES, {
      reportId: report,
      repairedOn: textOf(formData, "repairedOn", 10),
      repairedBy: textOf(formData, "repairedBy", 500),
      repairMinutes: hours.value,
      costCents: cost.value,
      notes: textOf(formData, "notes", 3000),
      returnToService: formData.get("returnToService") === "on",
    });
    const bits = [done.returned ? "The boat is back in service." : "", done.otherOpenMajor > 0 ? `${done.otherOpenMajor} other major report${done.otherOpenMajor === 1 ? " is" : "s are"} still open on it.` : ""].filter(Boolean);
    return ok(`Marked as repaired. ${bits.join(" ")}`.trim());
  } catch (e) {
    return refusal(e);
  }
}

export async function dismissReport(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const report = textOf(formData, "report", 60);
  if (!report) return error("Choose the report.");
  try {
    await dismissDamageReport(store, ctx, DAMAGE_RULES, { reportId: report, reason: textOf(formData, "reason", 1000) });
    return ok("Report dismissed.");
  } catch (e) {
    return refusal(e);
  }
}
