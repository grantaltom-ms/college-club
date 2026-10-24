import { describe, expect, it } from "vitest";
import { BILLING_RULES } from "../settings/billing-rules";
import { recordCharge, recordVisitors, runBilling, voidCharge, voidVisitors } from "./billing";
import { chargeRows, closedInvoices, closedMonths, householdChoices, linesComplete, memberChoices, visitorRows } from "./billing-views";
import { createHousehold, endHousehold, setQuickbooksId } from "./households";
import { clubLedger } from "./ledger";
import { NOW, STORE_KINDS, fixtureFor, staffCtx, type Fixture } from "./testkit";

/**
 * The lists the staff billing screens show. Today is Wed Oct 28, 2026. The invented club is two households, Quill (Ada, Ben,
 * Cy) and Reed (Dee, Eli), both Resident and members since 2020.
 */
const RULES = BILLING_RULES;

describe.each(STORE_KINDS)("the billing list views (%s store)", (kind) => {
  const setup = async (): Promise<Fixture> => {
    const f = await fixtureFor(kind)();
    await setQuickbooksId(f.store, staffCtx(), f.h.Quill, "QB-100");
    await setQuickbooksId(f.store, staffCtx(), f.h.Reed, "QB-200");
    return f;
  };
  const read = (f: Fixture) => f.store.read();
  const sale = (f: Fixture, over: Parameters<typeof recordCharge>[2]) => recordCharge(f.store, staffCtx(), over);

  it("lists charges newest day first, with who entered them, whose tab, and whether they can still be voided", async () => {
    const f = await setup();
    await sale(f, { householdId: f.h.Quill, memberId: f.m.Ada, day: "2026-10-20", category: "bar", adjustment: false, amountCents: 1250, description: "Two beers" });
    await sale(f, { householdId: f.h.Reed, day: "2026-10-27", category: "snack_bar", adjustment: false, amountCents: 400 });
    await sale(f, { householdId: f.h.Reed, day: "2026-10-27", category: "dues", adjustment: true, amountCents: -500, description: "Credit" });
    const rows = chargeRows(await read(f));
    expect(rows.map((r) => [r.householdName, r.day, r.kindLabel, r.amountCents])).toEqual([
      ["The Reed household", "2026-10-27", "Adjustment, dues", -500],
      ["The Reed household", "2026-10-27", "Snack bar", 400],
      ["The Quill household", "2026-10-20", "Bar", 1250],
    ]);
    expect(rows[2]).toMatchObject({ memberName: "Ada Quill", enteredBy: "Test staff", status: "open", billedIn: null, canVoid: true, description: "Two beers" });
    expect(rows[1].memberName).toBeNull();
    expect(rows[1].description).toBe("Snack bar");
    expect(rows[0].adjustment).toBe(true);
  });

  it("limits the list, and puts a voided charge, and a charge in a closed month, out of reach of another void", async () => {
    const f = await setup();
    const made = [];
    for (const day of ["2026-09-10", "2026-10-01", "2026-10-02"]) made.push(await sale(f, { householdId: f.h.Quill, day, category: "bar", adjustment: false, amountCents: 100 }));
    await voidCharge(f.store, staffCtx(), made[2].id, "Entered twice");
    await runBilling(f.store, staffCtx(), RULES, "2026-09");
    const rows = chargeRows(await read(f));
    expect(rows.map((r) => [r.day, r.status, r.canVoid, r.billedIn, r.voidReason])).toEqual([
      ["2026-10-02", "voided", false, null, "Entered twice"],
      ["2026-10-01", "open", true, null, null],
      ["2026-09-10", "open", false, "September 2026", null],
    ]);
    expect(chargeRows(await read(f), 2)).toHaveLength(2);
  });

  it("lists visitor entries with the member's whole day and what that day costs", async () => {
    const f = await setup();
    await recordVisitors(f.store, staffCtx(), RULES, { memberId: f.m.Ada, visitors: 3, via: "staff", day: "2026-10-27" });
    await recordVisitors(f.store, staffCtx(), RULES, { memberId: f.m.Ada, visitors: 2, via: "staff", day: "2026-10-27" });
    await recordVisitors(f.store, staffCtx(), RULES, { memberId: f.m.Dee, visitors: 1, via: "staff", day: "2026-10-26" });
    const rows = visitorRows(await read(f), RULES);
    expect(rows.map((r) => [r.memberName, r.day, r.visitors, r.dayTotal, r.dayFeeCents, r.canVoid])).toEqual([
      ["Ada Quill", "2026-10-27", 2, 5, 5000, true],
      ["Ada Quill", "2026-10-27", 3, 5, 5000, true],
      ["Dee Reed", "2026-10-26", 1, 1, 0, true],
    ]);
    expect(rows[0]).toMatchObject({ via: "staff", enteredBy: "Test staff", status: "recorded", billedIn: null, householdName: "The Quill household" });
    expect(visitorRows(await read(f), RULES, 1)).toHaveLength(1);
  });

  it("shows a voided visitor entry as voided with its reason, and no longer counts it in the day", async () => {
    const f = await setup();
    const first = await recordVisitors(f.store, staffCtx(), RULES, { memberId: f.m.Ada, visitors: 3, via: "staff", day: "2026-10-27" });
    const second = await recordVisitors(f.store, staffCtx(), RULES, { memberId: f.m.Ada, visitors: 2, via: "staff", day: "2026-10-27" });
    await voidVisitors(f.store, staffCtx(), second.entry.id, "Counted twice");
    const rows = visitorRows(await read(f), RULES);
    expect(rows.find((r) => r.id === second.entry.id)).toMatchObject({ status: "voided", voidReason: "Counted twice", canVoid: false });
    expect(rows.find((r) => r.id === first.entry.id)).toMatchObject({ dayTotal: 3, dayFeeCents: 0, canVoid: true });
  });

  it("does not offer to void visitors once their month is closed", async () => {
    const f = await setup();
    await recordVisitors(f.store, staffCtx(), RULES, { memberId: f.m.Ada, visitors: 2, via: "staff", day: "2026-09-12" });
    await recordVisitors(f.store, staffCtx(), RULES, { memberId: f.m.Ada, visitors: 2, via: "staff", day: "2026-10-12" });
    await runBilling(f.store, staffCtx(), RULES, "2026-09");
    const rows = visitorRows(await read(f), RULES);
    expect(rows.map((r) => [r.day, r.billedIn, r.canVoid])).toEqual([
      ["2026-10-12", null, true],
      ["2026-09-12", "September 2026", false],
    ]);
  });

  it("lists closed months newest first and rebuilds each invoice from its frozen lines", async () => {
    const f = await setup();
    await sale(f, { householdId: f.h.Quill, day: "2026-09-12", category: "bar", adjustment: false, amountCents: 1000, description: "Drinks" });
    await runBilling(f.store, staffCtx(), RULES, "2026-09");
    await runBilling(f.store, staffCtx(), RULES, "2026-10").catch(() => undefined);
    const state = await read(f);
    expect(closedMonths(state).map((m) => [m.month, m.label, m.closedBy, m.invoiceCount])).toEqual([["2026-09", "September 2026", "Test staff", 2]]);
    const run = state.billingRuns[0];
    const invoices = closedInvoices(state, run);
    expect(invoices).toHaveLength(run.invoiceCount);
    expect(invoices.reduce((n, i) => n + i.totalCents, 0)).toBe(run.totalCents);
    const mine = invoices.find((i) => i.householdId === f.h.Quill)!;
    expect(mine.quickbooksId).toBe("QB-100");
    expect(mine.householdName).toBe("The Quill household");
    expect(mine.lines.map((l) => l.kind)).toEqual(["dues", "bar"]);
    expect(linesComplete(state, run)).toBe(true);
  });

  it("gives each closed month only its own lines", async () => {
    const f = await setup();
    await sale(f, { householdId: f.h.Quill, day: "2026-08-12", category: "bar", adjustment: false, amountCents: 700, description: "August drinks" });
    await runBilling(f.store, staffCtx(), RULES, "2026-08");
    await runBilling(f.store, staffCtx(), RULES, "2026-09");
    const state = await read(f);
    const [sep, aug] = [state.billingRuns.find((r) => r.month === "2026-09")!, state.billingRuns.find((r) => r.month === "2026-08")!];
    const augInvoices = closedInvoices(state, aug);
    const sepInvoices = closedInvoices(state, sep);
    expect(augInvoices.flatMap((i) => i.lines.map((l) => l.description))).toContain("Bar: 1 charge in August 2026");
    expect(sepInvoices.flatMap((i) => i.lines.map((l) => l.description))).not.toContain("Bar: 1 charge in August 2026");
    expect(sepInvoices.reduce((n, i) => n + i.totalCents, 0)).toBe(sep.totalCents);
    expect(augInvoices.reduce((n, i) => n + i.totalCents, 0)).toBe(aug.totalCents);
    expect(augInvoices.map((i) => i.invoiceNo).every((no) => no.startsWith("2608-"))).toBe(true);
    expect(sepInvoices.map((i) => i.invoiceNo).every((no) => no.startsWith("2609-"))).toBe(true);
  });

  it("puts a later closed month above an earlier one", async () => {
    const f = await setup();
    await runBilling(f.store, staffCtx(), RULES, "2026-08");
    await runBilling(f.store, staffCtx(), RULES, "2026-09");
    expect(closedMonths(await read(f)).map((m) => m.month)).toEqual(["2026-09", "2026-08"]);
  });

  it("notices when a closed month's lines are not all loaded", async () => {
    const f = await setup();
    await runBilling(f.store, staffCtx(), RULES, "2026-09");
    const state = structuredClone(await read(f));
    const run = state.billingRuns[0];
    expect(run.invoiceCount).toBe(2);
    expect(linesComplete(state, run)).toBe(true);
    state.billingLines = state.billingLines.filter((l) => l.invoiceNo !== state.billingLines[0].invoiceNo);
    expect(linesComplete(state, run)).toBe(false);
    state.billingLines = [];
    expect(linesComplete(state, run)).toBe(false);
  });

  it("offers every household for a charge, marking one whose membership ended, and every active adult for visitors", async () => {
    const f = await setup();
    const { household } = await createHousehold(f.store, staffCtx(), { displayName: "The Zed household", membershipType: "Resident", joinedOn: "2020-01-01", primary: { firstName: "Zed", lastName: "Zed", email: "zed@example.com" } });
    await endHousehold(f.store, clubLedger, staffCtx(NOW), household.id);
    const state = await read(f);
    expect(householdChoices(state).map((c) => c.name)).toEqual(["The Quill household", "The Reed household", "The Zed household (membership ended)"]);
    expect(householdChoices(state).find((c) => c.name.startsWith("The Quill"))!.id).toBe(f.h.Quill);
    const members = memberChoices(state);
    expect(members.map((c) => c.name)).toEqual(["Ada Quill", "Ben Quill", "Cy Quill", "Dee Reed", "Eli Reed"]);
  });

  it("does not offer an adult whose household has ended, even if the adult's own record still says active", async () => {
    const f = await setup();
    const state = structuredClone(await read(f));
    state.households.find((h) => h.id === f.h.Reed)!.status = "ended";
    expect(state.members.filter((m) => m.householdId === f.h.Reed).every((m) => m.status === "active")).toBe(true);
    expect(memberChoices(state).map((c) => c.name)).toEqual(["Ada Quill", "Ben Quill", "Cy Quill"]);
  });

  it("tells two members with the same name apart by household in the picker", async () => {
    const f = await setup();
    await createHousehold(f.store, staffCtx(), { displayName: "The Other household", membershipType: "Resident", joinedOn: "2020-01-01", primary: { firstName: "Ada", lastName: "Quill", email: "ada.other@example.com" } });
    const same = memberChoices(await read(f)).filter((c) => c.name.startsWith("Ada Quill"));
    expect(same.map((c) => c.name).sort()).toEqual(["Ada Quill (The Other household)", "Ada Quill (The Quill household)"]);
    expect(memberChoices(await read(f)).map((c) => c.name)).toContain("Ben Quill");
  });
});
