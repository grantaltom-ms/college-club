"use server";

import { addDamageNote, fileDamageReport } from "@/club/engine/damage";
import { DAMAGE_RULES } from "@/club/settings/damage-rules";
import { error, ok, refusal, startSignedInAction, textOf, type ActionResult } from "@/club/web-actions";

/**
 * Anyone signed in files a damage report. The boxes are read generously (up to 2,000 characters) so that a text that is too long
 * is refused by the engine in words rather than quietly cut short.
 */
export async function fileDamage(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startSignedInAction();
  const item = textOf(formData, "item", 60);
  if (!item) return error("Choose the boat or space.");
  const severity = textOf(formData, "severity", 10);
  if (severity !== "major" && severity !== "minor") return error("Say whether the damage is major or minor.");
  try {
    const report = await fileDamageReport(store, ctx, DAMAGE_RULES, {
      itemId: item,
      description: textOf(formData, "description", 2000),
      location: textOf(formData, "location", 2000),
      howItHappened: textOf(formData, "how", 2000),
      major: severity === "major",
    });
    const name = (await store.read()).items.find((i) => i.id === report.itemId)?.name ?? "the boat";
    return ok(
      report.major
        ? `Thank you. Your report on ${name} is filed. You marked it major, so club staff will look at it first.`
        : `Thank you. Your report on ${name} is filed. Club staff will see it.`,
    );
  } catch (e) {
    return refusal(e);
  }
}

/** A note on a report: staff on any report, and the person who filed it while it is open. */
export async function addDamageNoteAction(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startSignedInAction();
  const report = textOf(formData, "report", 60);
  if (!report) return error("Choose the report.");
  try {
    await addDamageNote(store, ctx, DAMAGE_RULES, { reportId: report, text: textOf(formData, "text", 2000) });
    return ok("Note added.");
  } catch (e) {
    return refusal(e);
  }
}
