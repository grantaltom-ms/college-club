import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { BILLING_RULES } from "../settings/billing-rules";
import { EVENT_RULES } from "../settings/event-rules";
import { pacificWall } from "../time";
import type { BillingRules, ClubState } from "../types";
import {
  MAX_CHARGE_CENTS,
  planBilling,
  recordCharge,
  recordVisitors,
  runBilling,
  suggestedMonth,
  typeOnDay,
  visitorsOnDay,
  voidCharge,
  voidVisitors,
  type BillingPlan,
  type ChargeInput,
} from "./billing";
import { cancelEvent, cancelRsvp, createEvent, rsvp, updateEvent, type NewEvent } from "./events";
import { changeMembershipType, createHousehold, endHousehold, setQuickbooksId } from "./households";
import { clubLedger } from "./ledger";
import { historyOf } from "./queries";
import { NOW, STORE_KINDS, fixtureFor, mark, memberCtx, staff, staffCtx, type Fixture } from "./testkit";

/**
 * Today is Wed Oct 28, 2026, 1 pm. The month under test is September 2026, which has finished. The invented club is two
 * households, Quill (Ada, Ben, Cy) and Reed (Dee, Eli), both Resident and members since 2020. With the placeholder rules,
 * Resident dues are $154.50, a member can bring 4 visitors a day for free and over that every visitor costs $10.
 */
const SEP = "2026-09";
const OCT = "2026-10";
const RULES = BILLING_RULES;
/** The club's own rules tax nothing (Grant, Oct 25). These keep the tax mechanism itself under test. */
const TAXED: BillingRules = { ...RULES, defaults: { ...RULES.defaults, taxable: ["bar", "snack_bar"] } };
const at =(iso: string) => new Date(iso);
const SEP_10 = at("2026-09-10T19:00:00Z");
const SEP_12 = at("2026-09-12T19:00:00Z");
const NOV_2 = at("2026-11-02T20:00:00Z");

const plan = async (f: Fixture, month = SEP, now: Date = NOW, rules: BillingRules = RULES): Promise<BillingPlan> => planBilling(await f.store.read(), rules, month, now);
const invoiceOf = (p: BillingPlan, f: Fixture, who: "Quill" | "Reed") => p.invoices.find((i) => i.householdId === f.h[who]);
const linesOf = (p: BillingPlan, f: Fixture, who: "Quill" | "Reed") => invoiceOf(p, f, who)?.lines ?? [];
const kinds = (p: BillingPlan, f: Fixture, who: "Quill" | "Reed") => linesOf(p, f, who).map((l) => l.kind);

/** Links both households to QuickBooks, so a month can be closed. */
async function linkBoth(f: Fixture) {
  await setQuickbooksId(f.store, staffCtx(), f.h.Quill, "QB-100");
  await setQuickbooksId(f.store, staffCtx(), f.h.Reed, "QB-200");
}

const rejection = async (attempt: Promise<unknown>): Promise<ClubError> => {
  try {
    await attempt;
  } catch (e) {
    if (e instanceof ClubError) return e;
    throw e;
  }
  throw new Error("expected a refusal, but it went through");
};

const sale = (f: Fixture, over: Partial<ChargeInput> = {}, now: Date = NOW) => recordCharge(f.store, staffCtx(now), { householdId: f.h.Quill, category: "bar", adjustment: false, amountCents: 1250, ...over });

const mkEvent = (f: Fixture, over: Partial<NewEvent> = {}) =>
  createEvent(f.store, staffCtx(SEP_10), { title: "Members' Dinner", startsAt: pacificWall("2026-09-20", 18 * 60), endsAt: pacificWall("2026-09-20", 21 * 60), priceCents: 4500, ...over });
const goes = (f: Fixture, who: string, eventId: string, guests = 0, now: Date = SEP_12) => rsvp(f.store, EVENT_RULES, memberCtx(f.m[who], who, now), { eventId, memberId: f.m[who], guests });

const visitorsAt = (f: Fixture, who: string, visitors: number, now: Date) => recordVisitors(f.store, memberCtx(f.m[who], who, now), RULES, { memberId: f.m[who], visitors, via: "ipad" });
const visitorsByStaff = (f: Fixture, who: string, visitors: number, day: string, now: Date = NOW) => recordVisitors(f.store, staffCtx(now), RULES, { memberId: f.m[who], visitors, via: "staff", day });

describe.each(STORE_KINDS)("billing on the %s store", (kind) => {
  const fixture = fixtureFor(kind);

  describe("dues", () => {
    it("bills every household that was a member on the 1st a full month at the rate for its type, one invoice each, in name order", async () => {
      const f = await fixture();
      await linkBoth(f);
      const p = await plan(f);
      expect(p.problems).toEqual([]);
      expect(p.invoices.map((i) => [i.householdName, i.invoiceNo, i.quickbooksId, i.totalCents])).toEqual([
        ["The Quill household", "2609-0001", "QB-100", 15450],
        ["The Reed household", "2609-0002", "QB-200", 15450],
      ]);
      expect(linesOf(p, f, "Quill")).toEqual([{ kind: "dues", description: "September 2026 dues (Resident)", quantity: 1, unitCents: 15450, amountCents: 15450, taxable: false, adjustment: false }]);
      expect(p.totalCents).toBe(30900);
      expect(p.creditCents).toBe(0);
    });

    it("bills a household that joined on the 1st, but not one that joined a day later", async () => {
      const f = await fixture();
      const joined = (name: string, joinedOn: string) =>
        createHousehold(f.store, staffCtx(), { displayName: name, membershipType: "Resident", joinedOn, quickbooksId: name, primary: { firstName: name, lastName: "Person", email: `${name.toLowerCase()}@example.com` } });
      await joined("OnTheFirst", "2026-09-01");
      await joined("DayAfter", "2026-09-02");
      await joined("LastDay", "2026-09-30");
      await linkBoth(f);
      const p = await plan(f);
      expect(p.invoices.map((i) => i.householdName)).toEqual(["OnTheFirst", "The Quill household", "The Reed household"]);
    });

    it("bills a household that ended on or after the 1st for the whole month, and one that ended before it for nothing", async () => {
      const f = await fixture();
      const ended = async (name: string, on: Date) => {
        const h = await createHousehold(f.store, staffCtx(), { displayName: name, membershipType: "Resident", joinedOn: "2020-01-01", quickbooksId: name, primary: { firstName: name, lastName: "Person", email: `${name.toLowerCase()}@example.com` } });
        await endHousehold(f.store, clubLedger, staffCtx(on), h.household.id);
      };
      await ended("EndedAug31", at("2026-08-31T19:00:00Z"));
      await ended("EndedSep1", at("2026-09-01T19:00:00Z"));
      await ended("EndedSep15", at("2026-09-15T19:00:00Z"));
      await ended("EndedOct2", at("2026-10-02T19:00:00Z"));
      await linkBoth(f);
      const p = await plan(f);
      expect(p.invoices.map((i) => i.householdName).sort()).toEqual(["EndedOct2", "EndedSep1", "EndedSep15", "The Quill household", "The Reed household"].sort());
      expect(p.notices.some((n) => n.startsWith("2 households that ended during September 2026 are billed dues for the whole month"))).toBe(true);
    });

    it("charges the type a household had on the 1st: a change made later in the month waits, one made before the 1st counts", async () => {
      const f = await fixture();
      await linkBoth(f);
      await changeMembershipType(f.store, staffCtx(at("2026-09-15T19:00:00Z")), f.h.Quill, "Intermediate");
      await changeMembershipType(f.store, staffCtx(at("2026-08-20T19:00:00Z")), f.h.Reed, "Non-Resident");
      const p = await plan(f);
      expect(linesOf(p, f, "Quill")[0]).toMatchObject({ description: "September 2026 dues (Resident)", unitCents: 15450 });
      expect(linesOf(p, f, "Reed")[0]).toMatchObject({ description: "September 2026 dues (Non-Resident)", unitCents: 7725 });
      // October's 1st comes after the September 15 change, so October is billed at the new type.
      const state = await f.store.read();
      expect(typeOnDay(state, state.households.find((h) => h.id === f.h.Quill)!, "2026-10-01")).toBe("Intermediate");
      expect(typeOnDay(state, state.households.find((h) => h.id === f.h.Quill)!, "2026-09-01")).toBe("Resident");
      expect(typeOnDay(state, state.households.find((h) => h.id === f.h.Quill)!, "2026-09-15")).toBe("Intermediate");
    });

    it("follows several type changes, putting each later one back in turn", async () => {
      const f = await fixture();
      await changeMembershipType(f.store, staffCtx(at("2026-09-05T19:00:00Z")), f.h.Quill, "Intermediate");
      await changeMembershipType(f.store, staffCtx(at("2026-09-20T19:00:00Z")), f.h.Quill, "Non-Resident");
      await changeMembershipType(f.store, staffCtx(at("2026-10-10T19:00:00Z")), f.h.Quill, "Resident");
      const state = await f.store.read();
      const h = state.households.find((x) => x.id === f.h.Quill)!;
      expect(typeOnDay(state, h, "2026-09-01")).toBe("Resident");
      expect(typeOnDay(state, h, "2026-09-05")).toBe("Intermediate");
      expect(typeOnDay(state, h, "2026-09-19")).toBe("Intermediate");
      expect(typeOnDay(state, h, "2026-09-20")).toBe("Non-Resident");
      expect(typeOnDay(state, h, "2026-10-09")).toBe("Non-Resident");
      expect(typeOnDay(state, h, "2026-10-10")).toBe("Resident");
      expect(historyOf(state, f.h.Quill).filter((l) => l.kind === "type_changed")).toHaveLength(3);
    });

    it("follows the rates in the rules, and leaves a household with a rate of nothing off the month", async () => {
      const f = await fixture();
      await linkBoth(f);
      const rules: BillingRules = { ...RULES, defaults: { ...RULES.defaults, duesCents: { ...RULES.defaults.duesCents, Resident: 20000 } } };
      expect(linesOf(await plan(f, SEP, NOW, rules), f, "Quill")[0].unitCents).toBe(20000);
      const free: BillingRules = { ...RULES, defaults: { ...RULES.defaults, duesCents: { Resident: 0, Intermediate: 0, "Non-Resident": 0 } } };
      expect((await plan(f, SEP, NOW, free)).invoices).toEqual([]);
    });
  });

  describe("event tickets", () => {
    it("bills the whole party at the price when the RSVP was made, for everyone who held spots: going, attended, no-show and a late cancellation", async () => {
      const f = await fixture();
      await linkBoth(f);
      const event = await mkEvent(f);
      const ada = await goes(f, "Ada", event.id, 2);
      const ben = await goes(f, "Ben", event.id, 0);
      const cy = await goes(f, "Cy", event.id, 1);
      const dee = await goes(f, "Dee", event.id, 0);
      const eli = await goes(f, "Eli", event.id, 0);
      await mark(f.store, staffCtx(), "event", ben.rsvp.id, "attended");
      await mark(f.store, staffCtx(), "event", cy.rsvp.id, "no_show");
      await cancelRsvp(f.store, EVENT_RULES, memberCtx(f.m.Eli, "Eli", at("2026-09-19T19:00:00Z")), eli.rsvp.id);
      await cancelRsvp(f.store, EVENT_RULES, memberCtx(f.m.Dee, "Dee", at("2026-09-14T19:00:00Z")), dee.rsvp.id);
      expect(ada.outcome).toBe("going");
      const p = await plan(f);
      const quill = linesOf(p, f, "Quill").filter((l) => l.kind === "event_tickets");
      expect(quill.map((l) => [l.description, l.quantity, l.unitCents, l.amountCents])).toEqual([
        ["Members' Dinner, Sep 20, 2026: Ada Quill, party of 3", 3, 4500, 13500],
        ["Members' Dinner, Sep 20, 2026: Ben Quill, 1 person", 1, 4500, 4500],
        ["Members' Dinner, Sep 20, 2026: Cy Quill, party of 2", 2, 4500, 9000],
      ]);
      // Eli cancelled late and is billed; Dee cancelled in good time and is not.
      const reed = linesOf(p, f, "Reed").filter((l) => l.kind === "event_tickets");
      expect(reed.map((l) => l.description)).toEqual(["Members' Dinner, Sep 20, 2026: Eli Reed, 1 person"]);
    });

    it("never bills an event that is marked cancelled, even if an RSVP somehow still says going", async () => {
      const f = await fixture();
      await linkBoth(f);
      const event = await mkEvent(f);
      await goes(f, "Ada", event.id, 1);
      expect(linesOf(await plan(f), f, "Quill").some((l) => l.kind === "event_tickets")).toBe(true);
      // Cancelling an event through the engine cancels every RSVP too; this holds the bill to the event's own state.
      await f.store.transaction(async (s) => {
        const e = s.events.find((x) => x.id === event.id)!;
        e.status = "cancelled";
        e.statusChangedAt = NOW.toISOString();
        e.cancelledBy = staff;
        e.cancelReason = "Test";
      });
      expect(linesOf(await plan(f), f, "Quill").some((l) => l.kind === "event_tickets")).toBe(false);
    });

    it("does not bill a waiting place, a free event, a cancelled event, or an event that ended in another month", async () => {
      const f = await fixture();
      await linkBoth(f);
      const small = await mkEvent(f, { title: "Small", capacity: 2 });
      await goes(f, "Ada", small.id, 1);
      const waiting = await goes(f, "Dee", small.id, 0);
      expect(waiting.outcome).toBe("waitlisted");
      const free = await mkEvent(f, { title: "Free", priceCents: null });
      await goes(f, "Ben", free.id);
      const gone = await mkEvent(f, { title: "Called off" });
      await goes(f, "Cy", gone.id);
      await cancelEvent(f.store, staffCtx(SEP_12), gone.id, { reason: "Weather" });
      const august = await createEvent(f.store, staffCtx(at("2026-08-01T19:00:00Z")), { title: "August party", startsAt: pacificWall("2026-08-30", 18 * 60), endsAt: pacificWall("2026-08-30", 21 * 60), priceCents: 4500 });
      await rsvp(f.store, EVENT_RULES, memberCtx(f.m.Eli, "Eli", at("2026-08-02T19:00:00Z")), { eventId: august.id, memberId: f.m.Eli });
      const october = await createEvent(f.store, staffCtx(SEP_10), { title: "October party", startsAt: pacificWall("2026-10-03", 18 * 60), endsAt: pacificWall("2026-10-03", 21 * 60), priceCents: 4500 });
      await goes(f, "Ada", october.id);
      const p = await plan(f);
      expect(kinds(p, f, "Reed")).toEqual(["dues"]);
      expect(linesOf(p, f, "Quill").filter((l) => l.kind === "event_tickets").map((l) => l.description)).toEqual(["Small, Sep 20, 2026: Ada Quill, party of 2"]);
      // September billing leaves August's and October's events to their own months.
      const aug = await plan(f, "2026-08", at("2026-09-02T19:00:00Z"));
      expect(linesOf(aug, f, "Reed").filter((l) => l.kind === "event_tickets").map((l) => l.description)).toEqual(["August party, Aug 30, 2026: Eli Reed, 1 person"]);
    });

    it("puts an event in the month it ended: one ending 11:30 pm on the 30th is September's, one ending just after midnight is October's", async () => {
      const f = await fixture();
      await linkBoth(f);
      const late = await mkEvent(f, { title: "Late night", startsAt: pacificWall("2026-09-30", 20 * 60), endsAt: pacificWall("2026-09-30", 23 * 60 + 30) });
      const overnight = await mkEvent(f, { title: "Overnight", startsAt: pacificWall("2026-09-30", 22 * 60), endsAt: pacificWall("2026-10-01", 30) });
      await goes(f, "Ada", late.id);
      await goes(f, "Ben", overnight.id);
      const sep = await plan(f);
      expect(linesOf(sep, f, "Quill").filter((l) => l.kind === "event_tickets").map((l) => l.description)).toEqual(["Late night, Sep 30, 2026: Ada Quill, 1 person"]);
      const oct = await plan(f, OCT, NOV_2);
      expect(linesOf(oct, f, "Quill").filter((l) => l.kind === "event_tickets").map((l) => l.description)).toEqual(["Overnight, Sep 30, 2026: Ben Quill, 1 person"]);
    });

    it("keeps the price each RSVP was made at, even if staff change the event's price afterwards", async () => {
      const f = await fixture();
      await linkBoth(f);
      const event = await mkEvent(f, { priceCents: 4500 });
      await goes(f, "Ada", event.id);
      await updateEvent(f.store, EVENT_RULES, staffCtx(SEP_12), event.id, { priceCents: 9900 });
      await goes(f, "Dee", event.id, 0, at("2026-09-13T19:00:00Z"));
      const p = await plan(f);
      expect(linesOf(p, f, "Quill").find((l) => l.kind === "event_tickets")).toMatchObject({ unitCents: 4500 });
      expect(linesOf(p, f, "Reed").find((l) => l.kind === "event_tickets")).toMatchObject({ unitCents: 9900 });
    });

    it("tells staff when held spots are being billed that nobody marked", async () => {
      const f = await fixture();
      await linkBoth(f);
      const event = await mkEvent(f);
      await goes(f, "Ada", event.id);
      const ben = await goes(f, "Ben", event.id);
      await mark(f.store, staffCtx(), "event", ben.rsvp.id, "attended");
      expect((await plan(f)).notices).toContain("1 event RSVP is billed although nobody marked attendance. Held spots are billed whether or not they were marked.");
    });
  });

  describe("visitor fees", () => {
    it("is nothing for 4 visitors in a day, and every visitor for 5 or more: 5 costs $50", async () => {
      const f = await fixture();
      await linkBoth(f);
      await visitorsAt(f, "Ada", 4, at("2026-09-06T19:00:00Z"));
      await visitorsAt(f, "Dee", 5, at("2026-09-06T19:00:00Z"));
      const p = await plan(f);
      expect(kinds(p, f, "Quill")).toEqual(["dues"]);
      expect(linesOf(p, f, "Reed").filter((l) => l.kind === "visitor_fees")).toEqual([
        { kind: "visitor_fees", description: "Visitor fee: 5 visitors on Sep 6, 2026 (Dee Reed)", quantity: 5, unitCents: 1000, amountCents: 5000, taxable: false, adjustment: false },
      ]);
    });

    it("adds up a member's visitors across several entries in one day, but counts each day and each member separately", async () => {
      const f = await fixture();
      await linkBoth(f);
      await visitorsAt(f, "Ada", 3, at("2026-09-06T17:00:00Z"));
      await visitorsAt(f, "Ada", 3, at("2026-09-06T23:00:00Z"));
      await visitorsAt(f, "Ada", 4, at("2026-09-07T19:00:00Z"));
      await visitorsAt(f, "Ben", 4, at("2026-09-06T19:00:00Z"));
      const p = await plan(f);
      expect(linesOf(p, f, "Quill").filter((l) => l.kind === "visitor_fees").map((l) => [l.description, l.amountCents])).toEqual([["Visitor fee: 6 visitors on Sep 6, 2026 (Ada Quill)", 6000]]);
    });

    it("does not count a voided entry, and drops the fee when a day falls back under the limit", async () => {
      const f = await fixture();
      await linkBoth(f);
      await visitorsAt(f, "Ada", 3, at("2026-09-06T17:00:00Z"));
      const second = await visitorsAt(f, "Ada", 3, at("2026-09-06T23:00:00Z"));
      expect(second.dayTotal).toBe(6);
      expect(second.feeCents).toBe(6000);
      await voidVisitors(f.store, staffCtx(), second.entry.id, "Typed 3, there were none");
      expect(kinds(await plan(f), f, "Quill")).toEqual(["dues"]);
    });

    it("counts a day on the Pacific clock: 10 pm on the 30th is September, 1 am Pacific on the 1st is October", async () => {
      const f = await fixture();
      await linkBoth(f);
      await visitorsAt(f, "Ada", 5, at("2026-10-01T05:00:00Z"));
      await visitorsAt(f, "Ben", 5, at("2026-10-01T09:00:00Z"));
      const sep = await plan(f);
      expect(linesOf(sep, f, "Quill").filter((l) => l.kind === "visitor_fees").map((l) => l.description)).toEqual(["Visitor fee: 5 visitors on Sep 30, 2026 (Ada Quill)"]);
      const oct = await plan(f, OCT, NOV_2);
      expect(linesOf(oct, f, "Quill").filter((l) => l.kind === "visitor_fees").map((l) => l.description)).toEqual(["Visitor fee: 5 visitors on Oct 1, 2026 (Ben Quill)"]);
    });

    it("follows the free number and the fee in the rules", async () => {
      const f = await fixture();
      await linkBoth(f);
      await visitorsAt(f, "Ada", 2, at("2026-09-06T19:00:00Z"));
      const strict: BillingRules = { ...RULES, defaults: { ...RULES.defaults, visitorFreePerDay: 1, visitorFeeCents: 750 } };
      expect(linesOf(await plan(f, SEP, NOW, strict), f, "Quill").find((l) => l.kind === "visitor_fees")).toMatchObject({ quantity: 2, unitCents: 750, amountCents: 1500 });
    });
  });

  describe("bar, snack bar and adjustments", () => {
    it("adds a household's bar sales into one line and its snack-bar sales into another, leaving out voided ones", async () => {
      const f = await fixture();
      await linkBoth(f);
      const day = (d: number) => at(`2026-09-${String(d).padStart(2, "0")}T19:00:00Z`);
      await sale(f, { amountCents: 850, day: "2026-09-04" }, day(5));
      await sale(f, { amountCents: 1200, day: "2026-09-18", memberId: f.m.Ben }, day(19));
      const wrong = await sale(f, { amountCents: 99900, day: "2026-09-18" }, day(19));
      await voidCharge(f.store, staffCtx(day(19)), wrong.id, "Rang up the wrong tab");
      await sale(f, { category: "snack_bar", amountCents: 400, day: "2026-09-04" }, day(5));
      await sale(f, { householdId: f.h.Reed, amountCents: 700, day: "2026-09-30" }, day(30));
      const p = await plan(f);
      expect(linesOf(p, f, "Quill").filter((l) => l.kind !== "dues")).toEqual([
        { kind: "bar", description: "Bar: 2 charges in September 2026", quantity: 1, unitCents: 2050, amountCents: 2050, taxable: false, adjustment: false },
        { kind: "snack_bar", description: "Snack bar: 1 charge in September 2026", quantity: 1, unitCents: 400, amountCents: 400, taxable: false, adjustment: false },
      ]);
      expect(linesOf(p, f, "Reed").filter((l) => l.kind === "bar").map((l) => l.description)).toEqual(["Bar: 1 charge in September 2026"]);
    });

    it("puts no sales tax on any line with the club's own rules, and marks the kinds a rule names when one is added", async () => {
      const f = await fixture();
      await linkBoth(f);
      await sale(f, { amountCents: 850, day: "2026-09-04" });
      await sale(f, { category: "snack_bar", amountCents: 400, day: "2026-09-04" });
      await sale(f, { adjustment: true, category: "bar", amountCents: -500, description: "Refund one drink", day: "2026-09-11" });
      const none = await plan(f);
      expect(none.invoices.flatMap((i) => i.lines).filter((l) => l.taxable)).toEqual([]);
      expect(RULES.defaults.taxable).toEqual([]);
      const taxed = await plan(f, SEP, NOW, TAXED);
      expect(linesOf(taxed, f, "Quill").filter((l) => l.taxable).map((l) => `${l.kind}${l.adjustment ? " (adjustment)" : ""}`)).toEqual(["bar", "bar (adjustment)", "snack_bar"]);
      expect(taxed.totalCents).toBe(none.totalCents);
    });

    it("bills a sale in the month of the day it happened, so the 30th and the 1st land in different months", async () => {
      const f = await fixture();
      await linkBoth(f);
      await sale(f, { day: "2026-09-30", amountCents: 100 }, at("2026-10-01T19:00:00Z"));
      await sale(f, { day: "2026-10-01", amountCents: 200 }, at("2026-10-01T19:00:00Z"));
      expect(linesOf(await plan(f), f, "Quill").find((l) => l.kind === "bar")).toMatchObject({ amountCents: 100 });
      expect(linesOf(await plan(f, OCT, NOV_2), f, "Quill").find((l) => l.kind === "bar")).toMatchObject({ amountCents: 200 });
    });

    it("gives every adjustment its own line under the line it belongs to, and a negative one is a credit", async () => {
      const f = await fixture();
      await linkBoth(f);
      const now = at("2026-09-29T19:00:00Z");
      await sale(f, { adjustment: true, category: "dues", amountCents: -2000, description: "Charged twice in August", day: "2026-09-10" }, now);
      await sale(f, { adjustment: true, category: "event_tickets", amountCents: 4500, description: "Missed ticket for the Regatta", day: "2026-09-10" }, now);
      await sale(f, { adjustment: true, category: "bar", amountCents: -500, description: "Refund one drink", day: "2026-09-11" }, now);
      const p = await plan(f);
      const extras = linesOf(p, f, "Quill").filter((l) => l.adjustment);
      expect(extras.map((l) => [l.kind, l.description, l.amountCents])).toEqual([
        ["dues", "Adjustment: Charged twice in August", -2000],
        ["event_tickets", "Adjustment: Missed ticket for the Regatta", 4500],
        ["bar", "Adjustment: Refund one drink", -500],
      ]);
      expect(extras.find((l) => l.kind === "bar")).toMatchObject({ taxable: false });
      expect(linesOf(await plan(f, SEP, NOW, TAXED), f, "Quill").find((l) => l.kind === "bar" && l.adjustment)).toMatchObject({ taxable: true });
      expect(p.creditCents).toBe(-2500);
      expect(p.creditLines).toBe(2);
      expect(invoiceOf(p, f, "Quill")!.totalCents).toBe(15450 - 2000 + 4500 - 500);
      expect(p.notices.some((n) => n.startsWith("2 credit lines (-$25.00) cannot go in QuickBooks' invoice file"))).toBe(true);
    });

    it("orders each invoice's lines by kind, sales before adjustments", async () => {
      const f = await fixture();
      await linkBoth(f);
      const now = at("2026-09-29T19:00:00Z");
      await sale(f, { day: "2026-09-10" }, now);
      await sale(f, { adjustment: true, category: "dues", amountCents: 100, description: "Extra", day: "2026-09-10" }, now);
      await sale(f, { category: "snack_bar", amountCents: 300, day: "2026-09-10" }, now);
      expect(kinds(await plan(f), f, "Quill")).toEqual(["dues", "dues", "bar", "snack_bar"]);
      expect(linesOf(await plan(f), f, "Quill").map((l) => l.adjustment)).toEqual([false, true, false, false]);
    });
  });

  describe("entering charges", () => {
    it("lets staff enter a sale or an adjustment, tidied up, and nobody else", async () => {
      const f = await fixture();
      const charge = await sale(f, { description: "  Two beers  ", memberId: f.m.Ada });
      expect(charge).toMatchObject({ householdId: f.h.Quill, memberId: f.m.Ada, day: "2026-10-28", category: "bar", adjustment: false, amountCents: 1250, description: "Two beers", status: "open", createdBy: staff });
      expect((await sale(f, { description: "" })).description).toBe("Bar");
      expect((await sale(f, { category: "snack_bar", description: "" })).description).toBe("Snack bar");
      const member = await rejection(recordCharge(f.store, memberCtx(f.m.Ada, "Ada"), { householdId: f.h.Quill, category: "bar", adjustment: false, amountCents: 100 }));
      expect(member.code).toBe("forbidden");
      expect((await rejection(voidCharge(f.store, memberCtx(f.m.Ada, "Ada"), charge.id, "x"))).code).toBe("forbidden");
      expect((await f.store.read()).charges).toHaveLength(3);
    });

    it("refuses, in words, a wrong household or person, a bad date, a bad amount, a sale that is not a sale, and a missing note on an adjustment", async () => {
      const f = await fixture();
      const refused = async (over: Partial<ChargeInput>) => (await rejection(sale(f, over))).message;
      expect(await refused({ householdId: "00000000-0000-4000-8000-0000000fffff" })).toBe("That household no longer exists.");
      expect(await refused({ memberId: f.m.Dee })).toBe("That person is not in The Quill household.");
      expect(await refused({ day: "2026-13-40" })).toBe("That is not a real date.");
      expect(await refused({ day: "10/28/2026" })).toBe("That is not a real date.");
      expect(await refused({ day: "1999-12-31" })).toBe("That date is too long ago.");
      expect(await refused({ day: "2026-10-29" })).toBe("That date is in the future.");
      expect(await refused({ amountCents: 0 })).toBe("Enter an amount that is not zero.");
      expect(await refused({ amountCents: 12.5 })).toBe("Enter an amount that is not zero.");
      expect(await refused({ amountCents: MAX_CHARGE_CENTS + 1 })).toBe("An amount cannot be more than $100,000.00.");
      expect(await refused({ amountCents: -100 })).toBe("A sale cannot be negative. Use an adjustment for a credit.");
      expect(await refused({ category: "dues" })).toBe("A sale is a bar or snack-bar charge. Use an adjustment for anything else.");
      expect(await refused({ category: "nonsense" as never })).toBe("Choose which line of the invoice this goes under.");
      expect(await refused({ adjustment: true, description: "  " })).toBe("Say what the adjustment is for.");
      expect(await refused({ description: "x".repeat(201) })).toBe("The note must be 200 characters or fewer.");
      expect((await f.store.read()).charges).toEqual([]);
    });

    it("accepts the largest amount, a credit under any line, and a household whose membership has ended", async () => {
      const f = await fixture();
      expect((await sale(f, { amountCents: MAX_CHARGE_CENTS })).amountCents).toBe(MAX_CHARGE_CENTS);
      expect((await sale(f, { adjustment: true, category: "event_tickets", amountCents: -4500, description: "Refund" })).amountCents).toBe(-4500);
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Reed);
      expect((await sale(f, { householdId: f.h.Reed, amountCents: 300 })).householdId).toBe(f.h.Reed);
    });

    it("voids a charge with a reason, once, and says why if it cannot", async () => {
      const f = await fixture();
      const charge = await sale(f);
      expect((await rejection(voidCharge(f.store, staffCtx(), charge.id, "   "))).message).toBe("Say why it is being voided.");
      expect((await rejection(voidCharge(f.store, staffCtx(), "00000000-0000-4000-8000-0000000fffff", "x"))).code).toBe("not_found");
      const voided = await voidCharge(f.store, staffCtx(), charge.id, "  Rang up twice ");
      expect(voided).toMatchObject({ status: "voided", voidReason: "Rang up twice", voidedBy: staff, voidedAt: NOW.toISOString() });
      expect((await rejection(voidCharge(f.store, staffCtx(), charge.id, "again"))).message).toBe("That charge was already voided.");
      expect((await f.store.read()).charges).toHaveLength(1);
    });
  });

  describe("signing visitors in", () => {
    it("lets a member sign in their own visitors, today, and says what the day's total costs", async () => {
      const f = await fixture();
      const first = await visitorsAt(f, "Ada", 3, NOW);
      expect(first).toMatchObject({ dayTotal: 3, feeCents: 0, entry: { memberId: f.m.Ada, day: "2026-10-28", visitors: 3, via: "ipad", status: "recorded", createdBy: { kind: "member", memberId: f.m.Ada, label: "Ada" } } });
      const second = await visitorsAt(f, "Ada", 3, NOW);
      expect(second).toMatchObject({ dayTotal: 6, feeCents: 6000 });
      expect(visitorsOnDay(await f.store.read(), f.m.Ada, "2026-10-28")).toBe(6);
      expect(visitorsOnDay(await f.store.read(), f.m.Ben, "2026-10-28")).toBe(0);
    });

    it("lets staff enter visitors for a member on today or an earlier open day, and records that staff did", async () => {
      const f = await fixture();
      const r = await visitorsByStaff(f, "Ada", 2, "2026-10-20");
      expect(r.entry).toMatchObject({ day: "2026-10-20", via: "staff", createdBy: staff });
      expect((await visitorsByStaff(f, "Ada", 2, "2026-10-28")).entry.day).toBe("2026-10-28");
      expect((await recordVisitors(f.store, staffCtx(), RULES, { memberId: f.m.Ada, visitors: 1, via: "staff" })).entry.day).toBe("2026-10-28");
    });

    it("on the iPad is always today, whatever day it is asked for, and only for the member signing in", async () => {
      const f = await fixture();
      const sneaky = await recordVisitors(f.store, memberCtx(f.m.Ada, "Ada"), RULES, { memberId: f.m.Ada, visitors: 1, via: "ipad", day: "2026-10-01" });
      expect(sneaky.entry.day).toBe("2026-10-28");
      for (const attempt of [
        recordVisitors(f.store, memberCtx(f.m.Ben, "Ben"), RULES, { memberId: f.m.Ada, visitors: 1, via: "ipad" }),
        recordVisitors(f.store, staffCtx(), RULES, { memberId: f.m.Ada, visitors: 1, via: "ipad" }),
        recordVisitors(f.store, memberCtx(f.m.Ada, "Ada"), RULES, { memberId: f.m.Ada, visitors: 1, via: "staff" }),
        recordVisitors(f.store, { actor: { kind: "system", label: "System" }, now: NOW }, RULES, { memberId: f.m.Ada, visitors: 1, via: "ipad" }),
      ]) {
        expect((await rejection(attempt)).code).toBe("forbidden");
      }
      expect((await f.store.read()).visitors).toHaveLength(1);
    });

    it("refuses, in words, a bad count, too many in a day, a future or unreal day, a person who is not active, and an unknown member", async () => {
      const f = await fixture();
      const words = async (attempt: Promise<unknown>) => (await rejection(attempt)).message;
      expect(await words(visitorsAt(f, "Ada", 0, NOW))).toBe("Enter between 1 and 12 visitors.");
      expect(await words(visitorsAt(f, "Ada", 13, NOW))).toBe("Enter between 1 and 12 visitors.");
      expect(await words(visitorsAt(f, "Ada", 1.5, NOW))).toBe("Enter between 1 and 12 visitors.");
      for (let i = 0; i < 2; i++) await visitorsAt(f, "Ada", 12, NOW);
      expect(await words(visitorsAt(f, "Ada", 7, NOW))).toBe("That would make 31 visitors in one day for Ada Quill. The most that can be recorded is 30. If it is right, ask club staff.");
      expect((await visitorsAt(f, "Ada", 6, NOW)).dayTotal).toBe(30);
      expect(await words(visitorsByStaff(f, "Ben", 2, "2026-10-29"))).toBe("That date is in the future.");
      expect(await words(visitorsByStaff(f, "Ben", 2, "2026-02-30"))).toBe("That is not a real date.");
      expect((await rejection(recordVisitors(f.store, staffCtx(), RULES, { memberId: "00000000-0000-4000-8000-0000000fffff", visitors: 1, via: "staff" }))).code).toBe("not_found");
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Reed);
      expect(await words(visitorsAt(f, "Dee", 1, NOW))).toBe("Dee Reed is not an active member, so visitors cannot be recorded for them.");
    });

    it("voids an entry with a reason, once, and staff only", async () => {
      const f = await fixture();
      const { entry } = await visitorsAt(f, "Ada", 3, NOW);
      expect((await rejection(voidVisitors(f.store, memberCtx(f.m.Ada, "Ada"), entry.id, "Oops"))).code).toBe("forbidden");
      expect((await rejection(voidVisitors(f.store, staffCtx(), entry.id, ""))).message).toBe("Say why it is being voided.");
      const voided = await voidVisitors(f.store, staffCtx(), entry.id, "Typed 3, was 2");
      expect(voided).toMatchObject({ status: "voided", voidReason: "Typed 3, was 2", voidedBy: staff });
      expect((await rejection(voidVisitors(f.store, staffCtx(), entry.id, "again"))).message).toBe("That entry was already voided.");
      expect(visitorsOnDay(await f.store.read(), f.m.Ada, "2026-10-28")).toBe(0);
      expect((await visitorsAt(f, "Ada", 12, NOW)).dayTotal).toBe(12);
    });
  });

  describe("what stops a month being closed", () => {
    it("says so for a month that has not finished, or is not a month", async () => {
      const f = await fixture();
      await linkBoth(f);
      expect((await plan(f, OCT)).problems).toEqual(["October 2026 has not finished yet. It can be billed from Nov 1, 2026."]);
      expect((await plan(f, "2026-09", at("2026-09-30T19:00:00Z"))).problems).toEqual(["September 2026 has not finished yet. It can be billed from Oct 1, 2026."]);
      expect((await plan(f, "2026-09", at("2026-10-01T07:00:00Z"))).problems).toEqual([]);
      for (const bad of ["", "2026-13", "September", "2026-9", "2026-09-01"]) expect((await plan(f, bad)).problems, bad).toEqual(["Choose a month, like 2026-09."]);
      expect((await plan(f, "2099-01")).problems[0]).toContain("has not finished yet");
    });

    it("refuses a household with something to bill and no QuickBooks ID, by name, and nothing else is wrong", async () => {
      const f = await fixture();
      await setQuickbooksId(f.store, staffCtx(), f.h.Quill, "QB-100");
      const p = await plan(f);
      expect(p.problems).toEqual(["The Reed household has charges but no QuickBooks ID. Add it on the household's page."]);
      expect(p.invoices).toHaveLength(2);
    });

    it("does not mind a household with no QuickBooks ID that has nothing to bill", async () => {
      const f = await fixture();
      await linkBoth(f);
      await createHousehold(f.store, staffCtx(), { displayName: "Joined in October", membershipType: "Resident", joinedOn: "2026-10-10", primary: { firstName: "New", lastName: "Person", email: "new@example.com" } });
      expect((await plan(f)).problems).toEqual([]);
    });

    it("refuses a month from before the records that were loaded, rather than bill from a partial picture", async () => {
      const f = await fixture();
      await linkBoth(f);
      const state: ClubState = { ...(await f.store.read()), dataSince: "2026-09-15T00:00:00.000Z" };
      expect(planBilling(state, RULES, SEP, NOW).problems).toEqual(["September 2026 starts before the records this screen has loaded, so it cannot be billed safely from here. Pick a more recent month, or ask for help."]);
      expect(planBilling({ ...state, dataSince: "2026-08-31T00:00:00.000Z" }, RULES, SEP, NOW).problems).toEqual([]);
    });
  });

  describe("closing a month", () => {
    it("keeps every line exactly as it was previewed once the store has saved and read it back, tax flags and adjustments included", async () => {
      const f = await fixture();
      await linkBoth(f);
      await sale(f, { day: "2026-09-10", description: "Drinks" });
      await sale(f, { day: "2026-09-12", category: "snack_bar", amountCents: 450 });
      await sale(f, { day: "2026-09-14", category: "dues", adjustment: true, amountCents: -2000, description: "Credit" });
      const preview = await plan(f, SEP, NOW, TAXED);
      await runBilling(f.store, staffCtx(), TAXED, SEP, { fingerprint: preview.fingerprint });
      const saved = (await f.store.read()).billingLines;
      const shape = (l: { invoiceNo: string; kind: string; description: string; quantity: number; unitCents: number; amountCents: number; taxable: boolean; adjustment: boolean }) => ({ invoiceNo: l.invoiceNo, kind: l.kind, description: l.description, quantity: l.quantity, unitCents: l.unitCents, amountCents: l.amountCents, taxable: l.taxable, adjustment: l.adjustment });
      expect(saved.map(shape)).toEqual(preview.invoices.flatMap((i) => i.lines.map((l) => shape({ ...l, invoiceNo: i.invoiceNo }))));
      expect(saved.filter((l) => l.taxable).map((l) => l.kind)).toEqual(["bar", "snack_bar"]);
      expect(saved.find((l) => l.adjustment)).toMatchObject({ amountCents: -2000, taxable: false });
    });

    it("freezes every household's lines in one step: a run, its invoice lines, and who did it", async () => {

      const f = await fixture();
      await linkBoth(f);
      const event = await mkEvent(f);
      await goes(f, "Ada", event.id, 1);
      const preview = await plan(f);
      const done = await runBilling(f.store, staffCtx(), RULES, SEP, { fingerprint: preview.fingerprint });
      expect(done).toMatchObject({ invoiceCount: 2, totalCents: preview.totalCents, run: { month: SEP, createdBy: staff, createdAt: NOW.toISOString() } });
      const state = await f.store.read();
      expect(state.billingRuns).toHaveLength(1);
      expect(state.billingLines).toHaveLength(preview.invoices.flatMap((i) => i.lines).length);
      expect(state.billingLines.every((l) => l.runId === done.run.id)).toBe(true);
      expect(state.billingLines.reduce((n, l) => n + l.amountCents, 0)).toBe(preview.totalCents);
      expect(new Set(state.billingLines.map((l) => l.invoiceNo))).toEqual(new Set(["2609-0001", "2609-0002"]));
      expect(state.billingLines.find((l) => l.kind === "event_tickets")).toMatchObject({ householdId: f.h.Quill, quantity: 2, unitCents: 4500, amountCents: 9000 });
    });

    it("is staff only", async () => {
      const f = await fixture();
      await linkBoth(f);
      expect((await rejection(runBilling(f.store, memberCtx(f.m.Ada, "Ada"), RULES, SEP))).code).toBe("forbidden");
      expect((await f.store.read()).billingRuns).toEqual([]);
    });

    it("closes a month with nothing in it (so later months are not stuck behind it)", async () => {
      const f = await fixture();
      const none: BillingRules = { ...RULES, defaults: { ...RULES.defaults, duesCents: { Resident: 0, Intermediate: 0, "Non-Resident": 0 } } };
      const done = await runBilling(f.store, staffCtx(), none, SEP);
      expect(done).toMatchObject({ invoiceCount: 0, totalCents: 0 });
      expect((await f.store.read()).billingLines).toEqual([]);
    });

    it("refuses a month with problems, and writes nothing", async () => {
      const f = await fixture();
      expect((await rejection(runBilling(f.store, staffCtx(), RULES, SEP))).message).toBe("The preview has 2 problems, so nothing was billed. Fix them and preview the month again.");
      await setQuickbooksId(f.store, staffCtx(), f.h.Quill, "QB-100");
      expect((await rejection(runBilling(f.store, staffCtx(), RULES, SEP))).message).toBe("The Reed household has charges but no QuickBooks ID. Add it on the household's page. Nothing was billed.");
      expect((await rejection(runBilling(f.store, staffCtx(), RULES, OCT))).message).toContain("has not finished yet");
      const state = await f.store.read();
      expect(state.billingRuns).toEqual([]);
      expect(state.billingLines).toEqual([]);
    });

    it("refuses to close a month that changed since it was previewed, and works once previewed again", async () => {
      const f = await fixture();
      await linkBoth(f);
      const preview = await plan(f);
      await sale(f, { day: "2026-09-10" }, at("2026-09-11T19:00:00Z"));
      const stale = await rejection(runBilling(f.store, staffCtx(), RULES, SEP, { fingerprint: preview.fingerprint }));
      expect(stale).toMatchObject({ code: "conflict", message: "The month's charges changed since you previewed it, so nothing was billed. Preview it again." });
      expect((await f.store.read()).billingRuns).toEqual([]);
      const again = await plan(f);
      expect(again.fingerprint).not.toBe(preview.fingerprint);
      expect((await runBilling(f.store, staffCtx(), RULES, SEP, { fingerprint: again.fingerprint })).invoiceCount).toBe(2);
    });

    it("gives the same fingerprint to the same month and a different one when anything in it changes", async () => {
      const f = await fixture();
      await linkBoth(f);
      const a = await plan(f);
      expect((await plan(f)).fingerprint).toBe(a.fingerprint);
      await visitorsByStaff(f, "Ada", 5, "2026-09-10");
      expect((await plan(f)).fingerprint).not.toBe(a.fingerprint);
    });

    it("refuses to close a month whose lines would carry different tax flags than the preview showed", async () => {
      const f = await fixture();
      await linkBoth(f);
      await sale(f, { day: "2026-09-10" });
      const preview = await plan(f);
      const other = await plan(f, SEP, NOW, TAXED);
      expect(other.totalCents).toBe(preview.totalCents);
      expect(other.fingerprint).not.toBe(preview.fingerprint);
      const stale = await rejection(runBilling(f.store, staffCtx(), TAXED, SEP, { fingerprint: preview.fingerprint }));
      expect(stale.code).toBe("conflict");
      expect((await f.store.read()).billingRuns).toEqual([]);
    });

    it("keeps the placeholder warning in the notices while the rules say they are placeholders, and drops it when they do not", async () => {
      const f = await fixture();
      await linkBoth(f);
      const warning = "The dues, the visitor fee and the QuickBooks names are placeholders until staff confirm them.";
      expect((await plan(f)).notices).toContain(warning);
      expect((await plan(f, SEP, NOW, { ...RULES, placeholder: false })).notices).not.toContain(warning);
    });

    it("cannot close the same month twice, even when two staff press the button at the same moment", async () => {
      const f = await fixture();
      await linkBoth(f);
      const results = await Promise.allSettled([runBilling(f.store, staffCtx(), RULES, SEP), runBilling(f.store, staffCtx(), RULES, SEP), runBilling(f.store, staffCtx(), RULES, SEP)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((x): x is PromiseRejectedResult => x.status === "rejected")) expect((r.reason as ClubError).message).toContain("was already billed");
      const state = await f.store.read();
      expect(state.billingRuns).toHaveLength(1);
      expect(state.billingLines).toHaveLength(2);
    });

    it("closes months in order: the next one after the last, and none earlier or later", async () => {
      const f = await fixture();
      await linkBoth(f);
      await runBilling(f.store, staffCtx(), RULES, SEP);
      const dec = at("2026-12-02T20:00:00Z");
      expect((await plan(f, SEP, dec)).problems).toEqual(["September 2026 was already billed on Oct 28, 2026. Its files are below."]);
      expect((await plan(f, "2026-08", dec)).problems).toEqual(["August 2026 comes before September 2026, which was already billed. Months are billed in order."]);
      expect((await plan(f, "2026-11", dec)).problems).toEqual(["Months are billed in order. October 2026 comes next."]);
      expect((await plan(f, OCT, NOV_2)).problems).toEqual([]);
      await runBilling(f.store, staffCtx(NOV_2), RULES, OCT);
      expect((await plan(f, "2026-11", dec)).problems).toEqual([]);
      expect(suggestedMonth(await f.store.read(), dec)).toBe("2026-11");
    });

    it("suggests the month after the last one closed, even when later months have finished too", async () => {
      const f = await fixture();
      await linkBoth(f);
      await runBilling(f.store, staffCtx(), RULES, SEP);
      const state = await f.store.read();
      expect(suggestedMonth(state, NOW)).toBe("2026-10");
      expect(suggestedMonth(state, at("2026-12-02T20:00:00Z"))).toBe("2026-10");
    });

    it("suggests the latest finished month before anything is closed, across a year end", async () => {
      const f = await fixture();
      const state = await f.store.read();
      expect(suggestedMonth(state, NOW)).toBe("2026-09");
      expect(suggestedMonth(state, at("2027-01-10T20:00:00Z"))).toBe("2026-12");
      expect(suggestedMonth(state, at("2026-11-01T07:30:00Z"))).toBe("2026-10");
    });
  });

  describe("after a month is closed", () => {
    it("refuses a charge or visitors dated in it, and voiding one from it, and says to use an adjustment", async () => {
      const f = await fixture();
      await linkBoth(f);
      const charge = await sale(f, { day: "2026-09-10" }, at("2026-09-11T19:00:00Z"));
      const { entry } = await visitorsAt(f, "Ada", 3, at("2026-09-12T19:00:00Z"));
      await runBilling(f.store, staffCtx(), RULES, SEP);
      expect((await rejection(sale(f, { day: "2026-09-20" }))).message).toBe("September 2026 was already billed, so nothing can be dated in it. Date it today instead, as an adjustment.");
      expect((await rejection(visitorsByStaff(f, "Ada", 1, "2026-09-20"))).message).toContain("September 2026 was already billed");
      expect((await rejection(voidCharge(f.store, staffCtx(), charge.id, "Too late"))).message).toBe("That charge was billed in September 2026. Add an adjustment dated today instead.");
      expect((await rejection(voidVisitors(f.store, staffCtx(), entry.id, "Too late"))).message).toBe("That entry was billed in September 2026. Add an adjustment dated today instead.");
      const state = await f.store.read();
      expect(state.charges.find((c) => c.id === charge.id)!.status).toBe("open");
      expect(state.visitors.find((v) => v.id === entry.id)!.status).toBe("recorded");
    });

    it("puts a mistake right with an adjustment dated in the open month, which is billed once, in that month", async () => {
      const f = await fixture();
      await linkBoth(f);
      await sale(f, { day: "2026-09-10", amountCents: 5000 }, at("2026-09-11T19:00:00Z"));
      await runBilling(f.store, staffCtx(), RULES, SEP);
      // On Oct 28 staff find the September sale was rung up twice: take $50 off, dated today.
      await sale(f, { adjustment: true, category: "bar", amountCents: -5000, description: "Rang up twice in September" });
      const october = await plan(f, OCT, NOV_2);
      expect(linesOf(october, f, "Quill").filter((l) => l.adjustment).map((l) => [l.kind, l.description, l.amountCents])).toEqual([["bar", "Adjustment: Rang up twice in September", -5000]]);
      expect(october.creditCents).toBe(-5000);
      await runBilling(f.store, staffCtx(NOV_2), RULES, OCT);
      // September's frozen lines are untouched, and it is not billed again.
      const state = await f.store.read();
      const september = state.billingLines.filter((l) => l.runId === state.billingRuns.find((r) => r.month === SEP)!.id);
      expect(september.find((l) => l.kind === "bar")).toMatchObject({ amountCents: 5000 });
      expect(state.billingLines.filter((l) => l.adjustment)).toHaveLength(1);
    });

    it("keeps a closed month's lines as they were even if rates, records or rules change later", async () => {
      const f = await fixture();
      await linkBoth(f);
      await runBilling(f.store, staffCtx(), RULES, SEP);
      const frozen = (await f.store.read()).billingLines.map((l) => ({ ...l }));
      await changeMembershipType(f.store, staffCtx(), f.h.Quill, "Non-Resident");
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Reed);
      await visitorsByStaff(f, "Ada", 9, "2026-10-01");
      expect((await f.store.read()).billingLines).toEqual(frozen);
    });
  });

  describe("linking a household to QuickBooks", () => {
    it("sets the ID, writes a line in the household's file saying what it was and is now, and lets staff correct it", async () => {
      const f = await fixture();
      const set = await setQuickbooksId(f.store, staffCtx(), f.h.Quill, "  QB-100 ");
      expect(set.quickbooksId).toBe("QB-100");
      await setQuickbooksId(f.store, staffCtx(), f.h.Quill, "QB-101");
      const lines = historyOf(await f.store.read(), f.h.Quill).filter((l) => l.kind === "quickbooks_linked");
      // The household's file lists the newest line first.
      expect(lines.map((l) => [l.summary, l.details, l.actor])).toEqual([
        ["QuickBooks ID changed from QB-100 to QB-101.", { from: "QB-100", to: "QB-101" }, staff],
        ["QuickBooks ID set to QB-100.", { from: null, to: "QB-100" }, staff],
      ]);
      expect((await f.store.read()).households.find((h) => h.id === f.h.Quill)!.quickbooksId).toBe("QB-101");
    });

    it("refuses an ID already on another household, the same ID again, an empty one, and anyone but staff", async () => {
      const f = await fixture();
      await setQuickbooksId(f.store, staffCtx(), f.h.Quill, "QB-100");
      expect((await rejection(setQuickbooksId(f.store, staffCtx(), f.h.Reed, "QB-100"))).message).toBe("QuickBooks ID QB-100 already belongs to The Quill household.");
      expect(await rejection(setQuickbooksId(f.store, staffCtx(), f.h.Quill, "QB-100"))).toMatchObject({ code: "unchanged", message: "The Quill household already has QuickBooks ID QB-100." });
      expect((await rejection(setQuickbooksId(f.store, staffCtx(), f.h.Quill, "   "))).message).toBe("The QuickBooks ID is required.");
      expect((await rejection(setQuickbooksId(f.store, staffCtx(), f.h.Quill, "x".repeat(101)))).message).toBe("The QuickBooks ID must be 100 characters or fewer.");
      expect((await rejection(setQuickbooksId(f.store, memberCtx(f.m.Ada, "Ada"), f.h.Quill, "QB-5"))).code).toBe("forbidden");
      expect((await rejection(setQuickbooksId(f.store, staffCtx(), "00000000-0000-4000-8000-0000000fffff", "QB-5"))).code).toBe("not_found");
      expect((await f.store.read()).households.find((h) => h.id === f.h.Quill)!.quickbooksId).toBe("QB-100");
    });

    it("works on a household whose membership has ended, because its last month is still billed", async () => {
      const f = await fixture();
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Reed);
      expect((await setQuickbooksId(f.store, staffCtx(), f.h.Reed, "QB-200")).quickbooksId).toBe("QB-200");
      expect(historyOf(await f.store.read(), f.h.Reed).some((l) => l.kind === "quickbooks_linked")).toBe(true);
    });
  });
});
