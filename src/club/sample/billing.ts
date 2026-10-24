import { recordCharge, recordVisitors } from "../engine/billing";
import { fullName } from "../engine/queries";
import { BILLING_RULES } from "../settings/billing-rules";
import type { ClubStore } from "../store/memory";
import { addDays, middayPacific } from "../time";
import { SAMPLE_STAFF } from "./club";

/**
 * Invented bar and snack-bar charges, visitor sign-ins and one credit, dated over the last few weeks, so the billing screens
 * have something to show. Every amount and name is made up. Nothing here is real money or real members.
 */
export async function seedSampleBilling(store: ClubStore, today: string): Promise<void> {
  const state = await store.read();
  const member = (name: string) => {
    const m = state.members.find((x) => fullName(x) === name);
    if (!m) throw new Error(`Sample member ${name} is missing.`);
    return m;
  };
  const ctxOn = (day: string) => ({ actor: SAMPLE_STAFF, now: middayPacific(day) });

  const d5 = addDays(today, -5);
  const d12 = addDays(today, -12);
  const d35 = addDays(today, -35);

  const erik = member("Erik Lindqvist");
  const castellanos = member("Ines Castellanos");
  const hollis = member("Hollis Whitcombe");
  const tomas = member("Tomas Vandermeer");

  await recordCharge(store, ctxOn(d5), { householdId: erik.householdId, memberId: erik.id, day: d5, category: "bar", adjustment: false, amountCents: 3850, description: "Drinks after the evening row" });
  await recordCharge(store, ctxOn(d5), { householdId: erik.householdId, day: d5, category: "snack_bar", adjustment: false, amountCents: 725, description: "Snacks" });
  await recordCharge(store, ctxOn(d12), { householdId: castellanos.householdId, memberId: castellanos.id, day: d12, category: "bar", adjustment: false, amountCents: 2200, description: "Wine for the table" });
  await recordCharge(store, ctxOn(d35), { householdId: hollis.householdId, memberId: hollis.id, day: d35, category: "snack_bar", adjustment: false, amountCents: 1250, description: "Snacks" });
  await recordCharge(store, ctxOn(d12), { householdId: tomas.householdId, day: d12, category: "dues", adjustment: true, amountCents: -2000, description: "Credit: dues charged twice last month" });

  // Three visitors is under the free number; five in one day is over it, so every one of those five costs the fee.
  await recordVisitors(store, ctxOn(d12), BILLING_RULES, { memberId: erik.id, visitors: 3, via: "staff", day: d12 });
  const maren = member("Maren Lindqvist");
  await recordVisitors(store, ctxOn(d5), BILLING_RULES, { memberId: maren.id, visitors: 5, via: "staff", day: d5 });
  await recordVisitors(store, ctxOn(d35), BILLING_RULES, { memberId: tomas.id, visitors: 2, via: "staff", day: d35 });
}
