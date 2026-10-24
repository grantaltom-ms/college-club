"use server";

import { recordVisitors, voidVisitors } from "@/club/engine/billing";
import { visitorTotalWords } from "@/club/engine/billing-words";
import { fullName, memberById } from "@/club/engine/queries";
import { BILLING_RULES } from "@/club/settings/billing-rules";
import { formatDay } from "@/club/time";
import { idParam } from "@/club/web";
import { error, ok, refusal, startStaffAction, textOf, type ActionResult } from "@/club/web-actions";

/** Staff enter the visitors a member brought, on today or an earlier open day. Staff only; anyone else gets "page not found". */
export async function addVisitors(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const memberId = idParam(textOf(formData, "member"));
  if (!memberId) return error("Choose a member.");
  const typed = textOf(formData, "visitors", 6);
  if (!/^\d{1,3}$/.test(typed)) return error("Enter how many visitors, as a whole number.");
  try {
    const result = await recordVisitors(store, ctx, BILLING_RULES, { memberId, visitors: Number(typed), via: "staff", day: textOf(formData, "day", 10) || undefined });
    const member = memberById(await store.read(), memberId);
    return ok(`${result.entry.visitors} visitor${result.entry.visitors === 1 ? "" : "s"} recorded for ${member ? fullName(member) : "the member"} on ${formatDay(result.entry.day)}. ${visitorTotalWords(result.dayTotal, BILLING_RULES.defaults).replace("today", "that day")}`);
  } catch (e) {
    return refusal(e);
  }
}

/** Staff void a wrong visitor entry, with a reason. */
export async function voidVisitorsAction(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const id = idParam(textOf(formData, "id"));
  if (!id) return error("That entry could not be found.");
  try {
    await voidVisitors(store, ctx, id, textOf(formData, "reason"));
    return ok("Entry voided.");
  } catch (e) {
    return refusal(e);
  }
}
