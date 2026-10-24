"use server";

import { KIND_LABEL, recordCharge, voidCharge } from "@/club/engine/billing";
import { formatMoney, parseDollars } from "@/club/engine/billing-words";
import { householdOf } from "@/club/engine/queries";
import { BILLING_KINDS, type BillingKind } from "@/club/types";
import { idParam } from "@/club/web";
import { error, ok, refusal, startStaffAction, textOf, type ActionResult } from "@/club/web-actions";
import { formatDay } from "@/club/time";

/** Staff enter a bar or snack-bar sale, or an adjustment, on a household's account. Staff only; anyone else gets "page not found". */
export async function addCharge(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const householdId = idParam(textOf(formData, "household"));
  if (!householdId) return error("Choose a household.");
  const type = textOf(formData, "type");
  if (type !== "bar" && type !== "snack_bar" && type !== "adjustment") return error("Choose Bar, Snack bar or Adjustment.");
  const goesUnder = textOf(formData, "goesUnder");
  if (type === "adjustment" && !(BILLING_KINDS as readonly string[]).includes(goesUnder)) return error("Choose which line of the invoice the adjustment goes under.");
  const amountCents = parseDollars(textOf(formData, "amount", 20));
  if (amountCents === null) return error("Enter an amount like 12.50. For a credit, put a minus sign in front.");
  const day = textOf(formData, "day", 10) || undefined;
  const category: BillingKind = type === "adjustment" ? (goesUnder as BillingKind) : type;
  try {
    const charge = await recordCharge(store, ctx, { householdId, day, category, adjustment: type === "adjustment", amountCents, description: textOf(formData, "note", 300) });
    const household = householdOf(await store.read(), householdId);
    return ok(`${type === "adjustment" ? "Adjustment" : KIND_LABEL[category]}: ${formatMoney(charge.amountCents)} added to ${household?.displayName ?? "the household"} for ${formatDay(charge.day)}.`);
  } catch (e) {
    return refusal(e);
  }
}

/** Staff void a wrong charge, with a reason. */
export async function voidChargeAction(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const id = idParam(textOf(formData, "id"));
  if (!id) return error("That charge could not be found.");
  try {
    await voidCharge(store, ctx, id, textOf(formData, "reason"));
    return ok("Charge voided.");
  } catch (e) {
    return refusal(e);
  }
}
