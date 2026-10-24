import { beforeEach, describe, expect, it, vi } from "vitest";
import { planBilling } from "@/club/engine/billing";
import { fullName } from "@/club/engine/queries";
import { BILLING_RULES } from "@/club/settings/billing-rules";
import { buildSampleStore } from "@/club/sample/club";
import type { ClubStore } from "@/club/store/memory";
import type { ClubState } from "@/club/types";

/**
 * The staff billing screens' server actions, called directly with who is signed in, whether the member area is on, and the
 * club's records replaced by fakes. What matters about them lives in the actions: staff only (anyone else gets "page not
 * found" before the form is even read), plain words for a mistake, and nothing saved when something is wrong.
 */
const NOW = new Date("2026-10-28T20:00:00Z");
const h = vi.hoisted(() => ({ enabled: true, actor: null as unknown, store: null as unknown, now: null as unknown }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/club/enabled", () => ({ clubEnabled: () => h.enabled }));
vi.mock("@/club/clock", () => ({ clubNow: () => h.now }));
vi.mock("@/club/identity", () => ({
  getCurrentActor: async () => h.actor,
  toEngineActor: (a: { kind: string; label: string }) => ({ kind: a.kind, label: a.label }),
}));
vi.mock("@/club/store/instance", () => ({ getClubStore: async () => h.store }));

import { addCharge, voidChargeAction } from "./charges/actions";
import { saveQuickbooksId } from "./households/actions";
import { closeMonth } from "./billing/actions";
import { addVisitors, voidVisitorsAction } from "./visitors/actions";

const STAFF = { kind: "staff", label: "Alex Staffer", source: "login" };
const MEMBER = { kind: "member", label: "Una Aldridge" };

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const state = (): Promise<ClubState> => (h.store as ClubStore).read();
const person = async (name: string) => (await state()).members.find((m) => fullName(m) === name)!;
const householdNamed = async (name: string) => (await state()).households.find((x) => x.displayName === name)!;
const counts = async () => {
  const s = await state();
  return { charges: s.charges.length, visitors: s.visitors.length, runs: s.billingRuns.length, lines: s.billingLines.length };
};

beforeEach(async () => {
  h.enabled = true;
  h.actor = STAFF;
  h.now = NOW;
  h.store = await buildSampleStore("2026-10-28", NOW);
});

describe("the staff billing actions: who may use them", () => {
  it("answer 'not found' when the member area is off, when nobody is signed in, and for a member, and save nothing", async () => {
    const lindqvist = await householdNamed("The Lindqvist household");
    const erik = await person("Erik Lindqvist");
    const before = await counts();
    const every: [string, () => Promise<unknown>][] = [
      ["addCharge", () => addCharge(form({ household: lindqvist.id, type: "bar", amount: "5" }))],
      ["voidCharge", () => voidChargeAction(form({ id: crypto.randomUUID(), reason: "x" }))],
      ["addVisitors", () => addVisitors(form({ member: erik.id, visitors: "2" }))],
      ["voidVisitors", () => voidVisitorsAction(form({ id: crypto.randomUUID(), reason: "x" }))],
      ["closeMonth", () => closeMonth(form({ month: "2026-09", fingerprint: "a".repeat(64) }))],
      ["saveQuickbooksId", () => saveQuickbooksId(form({ household: lindqvist.id, quickbooks: "NEW-1" }))],
    ];
    for (const [name, call] of every) {
      h.enabled = false;
      await expect(call(), `${name} with the area off`).rejects.toThrow("NEXT_NOT_FOUND");
      h.enabled = true;
      h.actor = null;
      await expect(call(), `${name} signed out`).rejects.toThrow("NEXT_NOT_FOUND");
      h.actor = MEMBER;
      await expect(call(), `${name} as a member`).rejects.toThrow("NEXT_NOT_FOUND");
      h.actor = STAFF;
    }
    expect(await counts()).toEqual(before);
    expect((await householdNamed("The Lindqvist household")).quickbooksId).toBe(lindqvist.quickbooksId);
  });
});

describe("the staff billing actions: adding a charge", () => {
  it("asks for what is missing, in words", async () => {
    const lindqvist = await householdNamed("The Lindqvist household");
    const before = await counts();
    expect(await addCharge(form({ type: "bar", amount: "5" }))).toEqual({ kind: "error", message: "Choose a household." });
    expect(await addCharge(form({ household: "not-an-id", type: "bar", amount: "5" }))).toEqual({ kind: "error", message: "Choose a household." });
    expect(await addCharge(form({ household: lindqvist.id, type: "dues", amount: "5" }))).toEqual({ kind: "error", message: "Choose Bar, Snack bar or Adjustment." });
    expect(await addCharge(form({ household: lindqvist.id, type: "adjustment", amount: "5", note: "x" }))).toEqual({ kind: "error", message: "Choose which line of the invoice the adjustment goes under." });
    expect(await addCharge(form({ household: lindqvist.id, type: "adjustment", goesUnder: "rent", amount: "5", note: "x" }))).toEqual({ kind: "error", message: "Choose which line of the invoice the adjustment goes under." });
    for (const amount of ["", "abc", "12.505", "$$5"]) {
      expect(await addCharge(form({ household: lindqvist.id, type: "bar", amount })), amount).toEqual({ kind: "error", message: "Enter an amount like 12.50. For a credit, put a minus sign in front." });
    }
    expect(await counts()).toEqual(before);
  });

  it("adds a bar sale as the signed-in staff member and says what was added", async () => {
    const lindqvist = await householdNamed("The Lindqvist household");
    const before = (await counts()).charges;
    const result = await addCharge(form({ household: lindqvist.id, type: "bar", amount: "12.50", note: "Two beers", day: "2026-10-27" }));
    expect(result).toMatchObject({ kind: "ok" });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.message).toContain("Bar");
    expect(result.message).toContain("$12.50");
    expect(result.message).toContain("The Lindqvist household");
    const s = await state();
    expect(s.charges).toHaveLength(before + 1);
    expect(s.charges.at(-1)).toMatchObject({ householdId: lindqvist.id, category: "bar", adjustment: false, amountCents: 1250, day: "2026-10-27", description: "Two beers", status: "open", createdBy: { kind: "staff", label: "Alex Staffer" } });
  });

  it("adds an adjustment that is a credit, and refuses one with no reason", async () => {
    const lindqvist = await householdNamed("The Lindqvist household");
    expect(await addCharge(form({ household: lindqvist.id, type: "adjustment", goesUnder: "dues", amount: "-15.00", note: "" }))).toEqual({ kind: "error", message: "Say what the adjustment is for." });
    const ok = await addCharge(form({ household: lindqvist.id, type: "adjustment", goesUnder: "dues", amount: "-15.00", note: "Dues credit" }));
    expect(ok.kind).toBe("ok");
    expect((await state()).charges.at(-1)).toMatchObject({ category: "dues", adjustment: true, amountCents: -1500 });
  });

  it("puts an adjustment under the line that was chosen, not always under dues", async () => {
    const lindqvist = await householdNamed("The Lindqvist household");
    for (const under of ["bar", "snack_bar", "event_tickets", "visitor_fees", "dues"]) {
      expect((await addCharge(form({ household: lindqvist.id, type: "adjustment", goesUnder: under, amount: "-1.00", note: `Under ${under}` }))).kind).toBe("ok");
      expect((await state()).charges.at(-1)).toMatchObject({ category: under, adjustment: true, amountCents: -100, description: `Under ${under}` });
    }
  });

  it("ignores spaces around what was typed", async () => {
    const lindqvist = await householdNamed("The Lindqvist household");
    expect(await addCharge(form({ household: ` ${lindqvist.id} `, type: " bar ", amount: " 12.50 ", note: "  Two beers  " }))).toMatchObject({ kind: "ok" });
    expect((await state()).charges.at(-1)).toMatchObject({ householdId: lindqvist.id, category: "bar", amountCents: 1250, description: "Two beers" });
    const erik = await person("Erik Lindqvist");
    expect(await addVisitors(form({ member: ` ${erik.id} `, visitors: " 3 " }))).toMatchObject({ kind: "ok" });
    expect((await state()).visitors.at(-1)).toMatchObject({ memberId: erik.id, visitors: 3 });
    const plan = planBilling(await state(), BILLING_RULES, "2026-09", NOW);
    expect((await closeMonth(form({ month: " 2026-09 ", fingerprint: ` ${plan.fingerprint} ` }))).kind).toBe("ok");
  });

  it("passes on the engine's own words: nothing for zero, nothing in the future, a sale is never negative", async () => {
    const lindqvist = await householdNamed("The Lindqvist household");
    const before = await counts();
    expect(await addCharge(form({ household: lindqvist.id, type: "bar", amount: "0" }))).toEqual({ kind: "error", message: "Enter an amount that is not zero." });
    expect(await addCharge(form({ household: lindqvist.id, type: "bar", amount: "5", day: "2026-10-29" }))).toEqual({ kind: "error", message: "That date is in the future." });
    expect(await addCharge(form({ household: lindqvist.id, type: "bar", amount: "-5" }))).toEqual({ kind: "error", message: "A sale cannot be negative. Use an adjustment for a credit." });
    expect(await counts()).toEqual(before);
  });

  it("will not date a charge in a month that was already billed", async () => {
    const lindqvist = await householdNamed("The Lindqvist household");
    const plan = planBilling(await state(), BILLING_RULES, "2026-09", NOW);
    expect((await closeMonth(form({ month: "2026-09", fingerprint: plan.fingerprint }))).kind).toBe("ok");
    const result = await addCharge(form({ household: lindqvist.id, type: "bar", amount: "5", day: "2026-09-15" }));
    expect(result).toEqual({ kind: "error", message: "September 2026 was already billed, so nothing can be dated in it. Date it today instead, as an adjustment." });
  });

  it("passes on a failure it does not understand instead of hiding it", async () => {
    const lindqvist = await householdNamed("The Lindqvist household");
    (h.store as ClubStore).transaction = async () => {
      throw new Error("the database is down");
    };
    await expect(addCharge(form({ household: lindqvist.id, type: "bar", amount: "5" }))).rejects.toThrow("the database is down");
  });
});

describe("the staff billing actions: voiding a charge", () => {
  it("needs a reason, then voids it and keeps the line, with the reason and who did it", async () => {
    const charge = (await state()).charges.find((c) => c.status === "open")!;
    expect(await voidChargeAction(form({ id: "nope", reason: "x" }))).toEqual({ kind: "error", message: "That charge could not be found." });
    expect(await voidChargeAction(form({ id: charge.id, reason: "  " }))).toEqual({ kind: "error", message: "Say why it is being voided." });
    expect((await state()).charges.find((c) => c.id === charge.id)!.status).toBe("open");
    expect(await voidChargeAction(form({ id: charge.id, reason: "Entered twice" }))).toEqual({ kind: "ok", message: "Charge voided." });
    expect((await state()).charges.find((c) => c.id === charge.id)).toMatchObject({ status: "voided", voidReason: "Entered twice", voidedBy: { kind: "staff", label: "Alex Staffer" } });
    expect(await voidChargeAction(form({ id: charge.id, reason: "again" }))).toMatchObject({ kind: "error" });
  });
});

describe("the staff billing actions: visitors", () => {
  it("asks for a member and a whole number, in words", async () => {
    const erik = await person("Erik Lindqvist");
    const before = await counts();
    expect(await addVisitors(form({ visitors: "2" }))).toEqual({ kind: "error", message: "Choose a member." });
    for (const visitors of ["", "two", "2.5", "-1", "1000"]) {
      expect(await addVisitors(form({ member: erik.id, visitors })), visitors).toEqual({ kind: "error", message: "Enter how many visitors, as a whole number." });
    }
    expect(await addVisitors(form({ member: erik.id, visitors: "0" }))).toEqual({ kind: "error", message: "Enter between 1 and 12 visitors." });
    expect(await addVisitors(form({ member: erik.id, visitors: "13" }))).toEqual({ kind: "error", message: "Enter between 1 and 12 visitors." });
    expect(await counts()).toEqual(before);
  });

  it("records visitors for a day and says what the day now costs", async () => {
    const hollis = await person("Hollis Whitcombe");
    const result = await addVisitors(form({ member: hollis.id, visitors: "5", day: "2026-10-27" }));
    if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.message).toContain("5 visitors recorded for Hollis Whitcombe");
    expect(result.message).toContain("$10");
    expect(result.message).not.toContain("today");
    expect((await state()).visitors.at(-1)).toMatchObject({ memberId: hollis.id, visitors: 5, day: "2026-10-27", via: "staff", status: "recorded", createdBy: { kind: "staff", label: "Alex Staffer" } });
    const one = await addVisitors(form({ member: (await person("Tomas Vandermeer")).id, visitors: "1" }));
    expect(one).toMatchObject({ kind: "ok" });
    if (one.kind === "ok") expect(one.message).toContain("1 visitor recorded");
  });

  it("will not let a member's day go past the daily most, and voids a wrong entry with a reason", async () => {
    const hollis = await person("Hollis Whitcombe");
    for (let i = 0; i < 2; i += 1) expect((await addVisitors(form({ member: hollis.id, visitors: "12" }))).kind).toBe("ok");
    const over = await addVisitors(form({ member: hollis.id, visitors: "12" }));
    expect(over).toMatchObject({ kind: "error" });
    if (over.kind === "error") expect(over.message).toContain("The most that can be recorded is 30");
    const entry = (await state()).visitors.at(-1)!;
    expect(await voidVisitorsAction(form({ id: entry.id, reason: "" }))).toEqual({ kind: "error", message: "Say why it is being voided." });
    expect(await voidVisitorsAction(form({ id: "nope", reason: "x" }))).toEqual({ kind: "error", message: "That entry could not be found." });
    expect(await voidVisitorsAction(form({ id: entry.id, reason: "Counted twice" }))).toEqual({ kind: "ok", message: "Entry voided." });
    expect((await state()).visitors.find((v) => v.id === entry.id)).toMatchObject({ status: "voided", voidReason: "Counted twice" });
  });
});

describe("the staff billing actions: closing a month", () => {
  it("needs a preview first: a month and a fingerprint of the right shape", async () => {
    const refusal = { kind: "error", message: "Preview the month first, then close it." };
    expect(await closeMonth(form({}))).toEqual(refusal);
    expect(await closeMonth(form({ month: "2026-09" }))).toEqual(refusal);
    expect(await closeMonth(form({ month: "September", fingerprint: "a".repeat(64) }))).toEqual(refusal);
    expect(await closeMonth(form({ month: "2026-09", fingerprint: "abc" }))).toEqual(refusal);
    expect(await closeMonth(form({ month: "2026-09", fingerprint: "G".repeat(64) }))).toEqual(refusal);
    expect((await counts()).runs).toBe(0);
  });

  it("will not close a month that no longer matches what was previewed", async () => {
    const lindqvist = await householdNamed("The Lindqvist household");
    const plan = planBilling(await state(), BILLING_RULES, "2026-09", NOW);
    await addCharge(form({ household: lindqvist.id, type: "bar", amount: "9.00", day: "2026-09-30" }));
    const result = await closeMonth(form({ month: "2026-09", fingerprint: plan.fingerprint }));
    expect(result).toEqual({ kind: "error", message: "The month's charges changed since you previewed it, so nothing was billed. Preview it again." });
    expect(await counts()).toMatchObject({ runs: 0, lines: 0 });
  });

  it("will not close a month that has not finished, or one that is missing a QuickBooks ID", async () => {
    const early = await closeMonth(form({ month: "2026-10", fingerprint: planBilling(await state(), BILLING_RULES, "2026-10", NOW).fingerprint }));
    expect(early).toMatchObject({ kind: "error" });
    if (early.kind === "error") expect(early.message).toContain("October 2026 has not finished yet");
    // A household with a charge and no QuickBooks ID stops the month.
    const nakamura = await person("Yuki Nakamura");
    await addCharge(form({ household: nakamura.householdId, type: "bar", amount: "6.00", day: "2026-09-02" }));
    const blocked = await closeMonth(form({ month: "2026-09", fingerprint: planBilling(await state(), BILLING_RULES, "2026-09", NOW).fingerprint }));
    expect(blocked).toMatchObject({ kind: "error" });
    if (blocked.kind === "error") expect(blocked.message).toContain("The Nakamura household has charges but no QuickBooks ID");
    expect((await counts()).runs).toBe(0);
  });

  it("closes the previewed month, says how many invoices and how much, and cannot close it twice", async () => {
    const plan = planBilling(await state(), BILLING_RULES, "2026-09", NOW);
    expect(plan.problems).toEqual([]);
    const done = await closeMonth(form({ month: "2026-09", fingerprint: plan.fingerprint }));
    expect(done.kind).toBe("ok");
    if (done.kind !== "ok") throw new Error("expected ok");
    expect(done.message).toContain("September 2026 is closed");
    expect(done.message).toContain(`${plan.invoices.length} invoices`);
    const s = await state();
    expect(s.billingRuns).toHaveLength(1);
    expect(s.billingRuns[0]).toMatchObject({ month: "2026-09", createdBy: { kind: "staff", label: "Alex Staffer" } });
    expect(s.billingLines.length).toBeGreaterThan(0);
    const again = await closeMonth(form({ month: "2026-09", fingerprint: plan.fingerprint }));
    expect(again).toMatchObject({ kind: "error" });
    expect((await state()).billingRuns).toHaveLength(1);
  });
});

describe("the staff billing actions: a household's QuickBooks ID", () => {
  it("sets it, says so, and writes it to the household's file; refuses a repeat and a clash", async () => {
    const nakamura = await person("Yuki Nakamura");
    const lindqvist = await householdNamed("The Lindqvist household");
    expect(await saveQuickbooksId(form({ quickbooks: "QB-9" }))).toEqual({ kind: "error", message: "That household could not be found." });
    expect(await saveQuickbooksId(form({ household: nakamura.householdId, quickbooks: "   " }))).toMatchObject({ kind: "error" });
    expect(await saveQuickbooksId(form({ household: nakamura.householdId, quickbooks: "QB-9" }))).toEqual({ kind: "ok", message: "QuickBooks ID saved: QB-9. The change is in the household's file." });
    const s = await state();
    expect(s.households.find((x) => x.id === nakamura.householdId)!.quickbooksId).toBe("QB-9");
    expect(s.history.filter((l) => l.householdId === nakamura.householdId && l.kind === "quickbooks_linked")).toHaveLength(1);
    expect(await saveQuickbooksId(form({ household: nakamura.householdId, quickbooks: "QB-9" }))).toMatchObject({ kind: "error" });
    const clash = await saveQuickbooksId(form({ household: nakamura.householdId, quickbooks: lindqvist.quickbooksId! }));
    expect(clash).toEqual({ kind: "error", message: `QuickBooks ID ${lindqvist.quickbooksId} already belongs to The Lindqvist household.` });
  });
});
