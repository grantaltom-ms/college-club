import { describe, expect, it } from "vitest";
import raw from "./billing-rules.json";
import { BILLING_RULES, BillingRulesError, parseBillingRules } from "./billing-rules";

const withDefaults = (change: Record<string, unknown>) => ({ ...raw, defaults: { ...raw.defaults, ...change } });

describe("the billing rules file", () => {
  it("is read, marked as placeholders, and has every rule", () => {
    expect(BILLING_RULES.placeholder).toBe(true);
    expect(Object.keys(BILLING_RULES.defaults).sort()).toEqual(["duesCents", "invoiceDueDays", "items", "taxable", "visitorFeeCents", "visitorFreePerDay", "visitorsPerDayMax", "visitorsPerEntryMax"]);
  });

  it("carries the public prices, the visitor rule Grant described, and taxes nothing", () => {
    const d = BILLING_RULES.defaults;
    expect(d.duesCents.Resident).toBe(15450);
    expect(d.duesCents.Intermediate).toBe(10300);
    expect(d.visitorFreePerDay).toBe(4);
    expect(d.visitorFeeCents).toBe(1000);
    expect(d.taxable).toEqual([]);
    expect(Object.keys(d.items).sort()).toEqual(["bar", "dues", "event_tickets", "snack_bar", "visitor_fees"]);
  });

  it("refuses a missing, misspelled or nonsense number in words", () => {
    const { visitorFeeCents: _omit, ...rest } = raw.defaults;
    void _omit;
    expect(() => parseBillingRules({ ...raw, defaults: rest })).toThrow('defaults is missing "visitorFeeCents".');
    expect(() => parseBillingRules(withDefaults({ visitorFee: 1000 }))).toThrow('"visitorFee" is not a billing rule');
    expect(() => parseBillingRules(withDefaults({ visitorFeeCents: 10.5 }))).toThrow("must be a whole number");
    expect(() => parseBillingRules(withDefaults({ visitorFeeCents: "1000" }))).toThrow("must be a whole number");
    expect(() => parseBillingRules(withDefaults({ visitorFeeCents: -1 }))).toThrow("must be 0 or more");
    expect(() => parseBillingRules(withDefaults({ visitorFeeCents: 100001 }))).toThrow("cannot be more than 100,000");
    expect(() => parseBillingRules(withDefaults({ visitorFreePerDay: 51 }))).toThrow("cannot be more than 50");
    expect(() => parseBillingRules(withDefaults({ visitorsPerEntryMax: 0 }))).toThrow("must be 1 or more");
    expect(() => parseBillingRules(withDefaults({ invoiceDueDays: 121 }))).toThrow("cannot be more than 120");
    expect(() => parseBillingRules(null)).toThrow(BillingRulesError);
    expect(() => parseBillingRules({ placeholder: true })).toThrow('needs a "defaults" section');
  });

  it("will not let one entry allow more visitors than a whole day does", () => {
    expect(() => parseBillingRules(withDefaults({ visitorsPerEntryMax: 20, visitorsPerDayMax: 10 }))).toThrow("visitorsPerDayMax (10) cannot be less than visitorsPerEntryMax (20)");
    expect(parseBillingRules(withDefaults({ visitorsPerEntryMax: 10, visitorsPerDayMax: 10 })).defaults.visitorsPerDayMax).toBe(10);
  });

  it("checks the dues for every membership type, in words", () => {
    expect(() => parseBillingRules(withDefaults({ duesCents: { Resident: 15450, Intermediate: 10300 } }))).toThrow('duesCents (monthly dues in cents) is missing "Non-Resident"');
    expect(() => parseBillingRules(withDefaults({ duesCents: { ...raw.defaults.duesCents, Student: 500 } }))).toThrow('"Student" is not one of: Resident, Intermediate, Non-Resident');
    expect(() => parseBillingRules(withDefaults({ duesCents: { ...raw.defaults.duesCents, Resident: 154.5 } }))).toThrow("duesCents for Resident (in cents) must be a whole number");
    expect(() => parseBillingRules(withDefaults({ duesCents: { ...raw.defaults.duesCents, Resident: -1 } }))).toThrow("duesCents for Resident (in cents) must be 0 or more");
    expect(() => parseBillingRules(withDefaults({ duesCents: { ...raw.defaults.duesCents, Resident: 1_000_001 } }))).toThrow("cannot be more than 1,000,000");
    expect(() => parseBillingRules(withDefaults({ duesCents: [15450, 10300, 7725] }))).toThrow("must be a list of entries");
    expect(parseBillingRules(withDefaults({ duesCents: { Resident: 0, Intermediate: 0, "Non-Resident": 0 } })).defaults.duesCents.Resident).toBe(0);
  });

  it("checks the QuickBooks names for every kind of line, in words", () => {
    const items = raw.defaults.items;
    expect(() => parseBillingRules(withDefaults({ items: { dues: "Dues", event_tickets: "Tickets", visitor_fees: "Guests", bar: "Bar" } }))).toThrow('items (the QuickBooks product or service name for each kind of line) is missing "snack_bar"');
    expect(() => parseBillingRules(withDefaults({ items: { ...items, extras: "Extras" } }))).toThrow('"extras" is not one of: dues, event_tickets, visitor_fees, bar, snack_bar');
    expect(() => parseBillingRules(withDefaults({ items: { ...items, bar: "" } }))).toThrow("items for bar must be a name");
    expect(() => parseBillingRules(withDefaults({ items: { ...items, bar: 5 } }))).toThrow("items for bar must be a name");
    expect(() => parseBillingRules(withDefaults({ items: { ...items, bar: " Bar Sales" } }))).toThrow("has spaces at the start or end");
    expect(() => parseBillingRules(withDefaults({ items: { ...items, bar: "x".repeat(101) } }))).toThrow("100 characters or fewer");
    for (const bad of ["Bar, Food", 'Bar "Sales"', "Bar\nSales"]) {
      expect(() => parseBillingRules(withDefaults({ items: { ...items, bar: bad } })), bad).toThrow("cannot contain a comma, a quotation mark or a line break");
    }
    expect(parseBillingRules(withDefaults({ items: { ...items, bar: "Food & Drink:Bar" } })).defaults.items.bar).toBe("Food & Drink:Bar");
  });

  it("checks the list of kinds that carry sales tax, in words", () => {
    expect(() => parseBillingRules(withDefaults({ taxable: "bar" }))).toThrow("must be a list");
    expect(() => parseBillingRules(withDefaults({ taxable: ["bars"] }))).toThrow('"bars" is not a kind of line. The kinds are: dues, event_tickets');
    expect(() => parseBillingRules(withDefaults({ taxable: ["bar", "bar"] }))).toThrow("names the same kind of line twice");
    expect(() => parseBillingRules(withDefaults({ taxable: [3] }))).toThrow("is not a kind of line");
    const { taxable: _omit, ...rest } = raw.defaults;
    void _omit;
    expect(() => parseBillingRules({ ...raw, defaults: rest })).toThrow('defaults is missing "taxable".');
    expect(parseBillingRules(withDefaults({ taxable: [] })).defaults.taxable).toEqual([]);
  });

  it("treats the numbers as placeholders unless the file says otherwise", () => {
    expect(parseBillingRules({ defaults: raw.defaults }).placeholder).toBe(true);
    expect(parseBillingRules({ placeholder: false, defaults: raw.defaults }).placeholder).toBe(false);
  });
});
