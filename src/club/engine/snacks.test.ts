import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { BILLING_RULES } from "../settings/billing-rules";
import { SNACK_RULES } from "../settings/snack-rules";
import type { SnackRules } from "../types";
import { planBilling, recordCharge, runBilling, voidCharge } from "./billing";
import { createHousehold, endHousehold, removeMember, setQuickbooksId } from "./households";
import { clubLedger } from "./ledger";
import { recordSnacks, SnackDayLimit, snackBarMonth, snackCountWords, snackItemsOnDay, snackPriceWords, snackThanks, snackTotalWords, type SnackInput } from "./snacks";
import { NOW, STORE_KINDS, TODAY, fixtureFor, memberCtx, staffCtx, type Fixture } from "./testkit";

/**
 * Today is Wed Oct 28, 2026, 1 pm. The invented club is two households: Quill (Ada, Ben, Cy) and Reed (Dee, Eli). Every
 * snack is $1.50, a purchase is 1 to 20 snacks, and a member can have 40 recorded in a day.
 */
const RULES = SNACK_RULES;
const at = (iso: string) => new Date(iso);
const SEP_12 = at("2026-09-12T19:00:00Z");
const NOV_2 = at("2026-11-02T20:00:00Z");
const TOMORROW = at("2026-10-29T20:00:00Z");

let counter = 0;
/** A fresh token each time, the way each drawing of the iPad screen carries its own. */
const token = () => `tok-${String(++counter).padStart(8, "0")}-abcdefgh`;

const rejection = async (attempt: Promise<unknown>): Promise<ClubError> => {
  try {
    await attempt;
  } catch (e) {
    if (e instanceof ClubError) return e;
    throw e;
  }
  throw new Error("expected a refusal, but it went through");
};

/** The iPad acts as whoever was picked, labelled with their full name. */
const fullNameOf = (who: string) => `${who} ${who === "Dee" || who === "Eli" ? "Reed" : "Quill"}`;
const buy = (f: Fixture, who: string, items: number, now: Date = NOW, extra: Partial<SnackInput> = {}, rules: SnackRules = RULES) =>
  recordSnacks(f.store, memberCtx(f.m[who], fullNameOf(who), now), rules, { memberId: f.m[who], items, entryToken: token(), ...extra });

describe.each(STORE_KINDS)("the snack bar on the %s store", (kind) => {
  const fixture = fixtureFor(kind);

  describe("a purchase", () => {
    it("puts one charge on the member's own household, for the day, at the price, and says what it came to", async () => {
      const f = await fixture();
      const entryToken = token();
      const r = await buy(f, "Ben", 3, NOW, { entryToken });
      expect(r).toMatchObject({ items: 3, totalCents: 450, repeated: false });
      const state = await f.store.read();
      expect(state.charges).toHaveLength(1);
      expect(state.charges[0]).toMatchObject({
        householdId: f.h.Quill,
        memberId: f.m.Ben,
        day: TODAY,
        category: "snack_bar",
        adjustment: false,
        amountCents: 450,
        description: "3 snacks at $1.50",
        quantity: 3,
        unitCents: 150,
        entryToken,
        status: "open",
        createdBy: { kind: "member", memberId: f.m.Ben, label: "Ben Quill" },
        voidedAt: null,
        voidedBy: null,
        voidReason: null,
      });
      expect(r.charge.id).toBe(state.charges[0].id);
      expect(state.charges[0].createdAt).toBe(NOW.toISOString());
    });

    it("says one snack in the singular, and charges the price once", async () => {
      const f = await fixture();
      const r = await buy(f, "Dee", 1);
      expect(r.totalCents).toBe(150);
      expect((await f.store.read()).charges[0]).toMatchObject({ householdId: f.h.Reed, description: "1 snack at $1.50", amountCents: 150 });
    });

    it("works out the amount from the rules, whatever the price is", async () => {
      const f = await fixture();
      const dear: SnackRules = { ...RULES, defaults: { ...RULES.defaults, priceCents: 275 } };
      const r = await buy(f, "Ada", 4, NOW, {}, dear);
      expect(r.totalCents).toBe(1100);
      expect((await f.store.read()).charges[0]).toMatchObject({ description: "4 snacks at $2.75", unitCents: 275, amountCents: 1100 });
    });

    it("takes exactly one and exactly the most in a purchase, and refuses none, a part of one, and one more than the most", async () => {
      const f = await fixture();
      expect((await buy(f, "Ada", 1)).totalCents).toBe(150);
      expect((await buy(f, "Ben", 20)).totalCents).toBe(3000);
      for (const bad of [0, -1, 1.5, 21, Number.NaN]) {
        const e = await rejection(buy(f, "Cy", bad));
        expect(e.code, String(bad)).toBe("invalid");
        expect(e.message, String(bad)).toBe("Choose between 1 and 20 snacks.");
      }
      expect((await f.store.read()).charges).toHaveLength(2);
    });

    it("names the most in the refusal from the rules, not from a fixed number", async () => {
      const f = await fixture();
      const few: SnackRules = { ...RULES, defaults: { ...RULES.defaults, itemsPerEntryMax: 6, itemsPerDayMax: 10 } };
      expect((await rejection(buy(f, "Ada", 7, NOW, {}, few))).message).toBe("Choose between 1 and 6 snacks.");
      expect((await buy(f, "Ada", 6, NOW, {}, few)).items).toBe(6);
    });

    it("lets several people in one household each buy, and keeps each on their own tab", async () => {
      const f = await fixture();
      await buy(f, "Ada", 2);
      await buy(f, "Ben", 1);
      await buy(f, "Eli", 5);
      const state = await f.store.read();
      expect(state.charges.map((c) => [c.householdId === f.h.Quill ? "Quill" : "Reed", c.memberId === f.m.Ada ? "Ada" : c.memberId === f.m.Ben ? "Ben" : "Eli", c.amountCents])).toEqual([
        ["Quill", "Ada", 300],
        ["Quill", "Ben", 150],
        ["Reed", "Eli", 750],
      ]);
    });
  });

  describe("who can add snacks", () => {
    it("is only the member themselves: staff and other members are refused, and nothing is saved", async () => {
      const f = await fixture();
      const asStaff = await rejection(recordSnacks(f.store, staffCtx(), RULES, { memberId: f.m.Ada, items: 2, entryToken: token() }));
      expect(asStaff.code).toBe("forbidden");
      expect(asStaff.message).toContain("Club staff can add a charge on the Charges screen.");
      const asOther = await rejection(recordSnacks(f.store, memberCtx(f.m.Ben, "Ben Quill"), RULES, { memberId: f.m.Ada, items: 2, entryToken: token() }));
      expect(asOther.code).toBe("forbidden");
      expect((await f.store.read()).charges).toEqual([]);
    });

    it("refuses someone who has left the club or whose household ended, in words, and nothing is saved", async () => {
      const f = await fixture();
      await removeMember(f.store, clubLedger, staffCtx(), f.m.Cy);
      const left = await rejection(buy(f, "Cy", 1));
      expect(left).toMatchObject({ code: "conflict", message: "Cy Quill is not an active member, so snacks cannot be put on their account." });
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Reed);
      const ended = await rejection(buy(f, "Dee", 1));
      expect(ended).toMatchObject({ code: "conflict", message: "Dee Reed is not an active member, so snacks cannot be put on their account." });
      expect((await f.store.read()).charges).toEqual([]);
    });

    it("refuses a member who does not exist", async () => {
      const f = await fixture();
      const ghost = "00000000-0000-4000-8000-0000000000ff";
      const e = await rejection(recordSnacks(f.store, memberCtx(ghost, "Nobody"), RULES, { memberId: ghost, items: 1, entryToken: token() }));
      expect(e).toMatchObject({ code: "not_found", message: "That member no longer exists." });
    });
  });

  describe("one purchase for one screen", () => {
    it("records a screen pressed twice once, and gives the second press the first answer", async () => {
      const f = await fixture();
      const entryToken = token();
      const first = await buy(f, "Ada", 3, NOW, { entryToken });
      const second = await buy(f, "Ada", 3, NOW, { entryToken });
      expect(second).toMatchObject({ items: 3, totalCents: 450, repeated: true });
      expect(second.charge.id).toBe(first.charge.id);
      expect(first.repeated).toBe(false);
      expect((await f.store.read()).charges).toHaveLength(1);
    });

    it("still gives the first answer when the screen is pressed again later, even on another day", async () => {
      const f = await fixture();
      const entryToken = token();
      const first = await buy(f, "Ada", 3, NOW, { entryToken });
      const later = await buy(f, "Ada", 3, TOMORROW, { entryToken });
      expect(later.repeated).toBe(true);
      expect(later.charge.id).toBe(first.charge.id);
      expect((await f.store.read()).charges).toHaveLength(1);
    });

    it("lets the same member buy the same count again on a fresh screen", async () => {
      const f = await fixture();
      await buy(f, "Ada", 2);
      const again = await buy(f, "Ada", 2);
      expect(again.repeated).toBe(false);
      expect((await f.store.read()).charges).toHaveLength(2);
    });

    it("refuses a token that was used for a different count or another member, and records nothing new", async () => {
      const f = await fixture();
      const entryToken = token();
      await buy(f, "Ada", 3, NOW, { entryToken });
      const otherCount = await rejection(buy(f, "Ada", 4, NOW, { entryToken }));
      expect(otherCount).toMatchObject({ code: "conflict", message: "That purchase was already recorded. Start again if you want to add more." });
      const otherMember = await rejection(buy(f, "Ben", 3, NOW, { entryToken }));
      expect(otherMember.code).toBe("conflict");
      expect((await f.store.read()).charges).toHaveLength(1);
    });

    it("refuses a missing, short, long or oddly spelled token", async () => {
      const f = await fixture();
      for (const bad of ["", "short", "x".repeat(15), "x".repeat(65), "has spaces in it 1234", "semi;colon-chars-1234", undefined as unknown as string, 12345678901234567 as unknown as string]) {
        const e = await rejection(buy(f, "Ada", 1, NOW, { entryToken: bad }));
        expect(e, String(bad)).toMatchObject({ code: "invalid", message: "That screen is out of date. Start again from the beginning." });
      }
      expect((await buy(f, "Ada", 1, NOW, { entryToken: "x".repeat(16) })).repeated).toBe(false);
      expect((await buy(f, "Ada", 1, NOW, { entryToken: "y".repeat(64) })).repeated).toBe(false);
      expect((await f.store.read()).charges).toHaveLength(2);
    });

    it("records ten simultaneous presses of one screen exactly once", async () => {
      const f = await fixture();
      const entryToken = token();
      const results = await Promise.all(Array.from({ length: 10 }, () => buy(f, "Ada", 2, NOW, { entryToken })));
      expect(results.filter((r) => !r.repeated)).toHaveLength(1);
      expect(new Set(results.map((r) => r.charge.id)).size).toBe(1);
      expect((await f.store.read()).charges).toHaveLength(1);
    });

    it("records many different screens at the same moment, each once", async () => {
      const f = await fixture();
      await Promise.all(Array.from({ length: 12 }, (_, i) => buy(f, i % 2 === 0 ? "Ada" : "Eli", 1)));
      const state = await f.store.read();
      expect(state.charges).toHaveLength(12);
      expect(state.charges.reduce((n, c) => n + c.amountCents, 0)).toBe(1800);
    });
  });

  describe("the most in a day", () => {
    it("allows exactly the day's limit across several purchases and refuses the one that goes over, naming the count", async () => {
      const f = await fixture();
      await buy(f, "Ada", 20);
      await buy(f, "Ada", 19);
      expect(await snackItemsOnDay(await f.store.read(), f.m.Ada, TODAY)).toBe(39);
      const over = await rejection(buy(f, "Ada", 2));
      expect(over).toMatchObject({ code: "invalid", message: "That would make 41 snacks today for Ada Quill. The most that can be recorded in a day is 40. If that is right, ask club staff." });
      // The iPad tells this refusal apart from a bad number, so it can say "the most in a day" in its own words.
      expect(over).toBeInstanceOf(SnackDayLimit);
      expect(await rejection(buy(f, "Ada", 21))).not.toBeInstanceOf(SnackDayLimit);
      expect((await buy(f, "Ada", 1)).items).toBe(1);
      const full = await rejection(buy(f, "Ada", 1));
      expect(full.message).toContain("That would make 41 snacks today");
      expect((await f.store.read()).charges).toHaveLength(3);
    });

    it("counts each member's day on their own, and starts a fresh count the next day", async () => {
      const f = await fixture();
      await buy(f, "Ada", 20);
      await buy(f, "Ada", 20);
      expect((await buy(f, "Ben", 20)).items).toBe(20);
      expect((await rejection(buy(f, "Ada", 1))).code).toBe("invalid");
      expect((await buy(f, "Ada", 20, TOMORROW)).items).toBe(20);
      expect(await snackItemsOnDay(await f.store.read(), f.m.Ada, "2026-10-29")).toBe(20);
    });

    it("does not count a voided purchase, nor a charge staff typed in", async () => {
      const f = await fixture();
      const first = await buy(f, "Ada", 20);
      await buy(f, "Ada", 20);
      expect((await rejection(buy(f, "Ada", 1))).code).toBe("invalid");
      await voidCharge(f.store, staffCtx(), first.charge.id, "Tapped the wrong member");
      expect(await snackItemsOnDay(await f.store.read(), f.m.Ada, TODAY)).toBe(20);
      expect((await buy(f, "Ada", 20)).items).toBe(20);
      await recordCharge(f.store, staffCtx(), { householdId: f.h.Quill, memberId: f.m.Ada, category: "snack_bar", adjustment: false, amountCents: 99_900, description: "Case of granola bars" });
      expect(await snackItemsOnDay(await f.store.read(), f.m.Ada, TODAY)).toBe(40);
    });
  });

  describe("in the evening, when the Pacific date is a day behind the world clock", () => {
    // From 4 pm in the afternoon, the date in Greenwich is already tomorrow. The club's day, and so the month's bill, is Pacific.
    const EVENING_NOV_1 = at("2026-11-02T01:12:00Z"); // 5:12 pm on Sun Nov 1, Pacific
    const LATE_NOV_1 = at("2026-11-02T07:30:00Z"); // 11:30 pm the same evening
    const NEXT_MORNING = at("2026-11-02T17:00:00Z"); // 9 am on Mon Nov 2

    it("dates a 5 pm purchase on the Pacific day, lists it for that month, and counts it in that day", async () => {
      const f = await fixture();
      const r = await buy(f, "Ben", 3, EVENING_NOV_1);
      expect(r.charge.day).toBe("2026-11-01");
      const state = await f.store.read();
      expect(state.charges[0].day).toBe("2026-11-01");
      expect(snackItemsOnDay(state, f.m.Ben, "2026-11-01")).toBe(3);
      expect(snackItemsOnDay(state, f.m.Ben, "2026-11-02")).toBe(0);
      expect(snackBarMonth(state, "2026-11-01")).toEqual({ label: "November 2026", purchases: 1, items: 3, totalCents: 450 });
    });

    it("keeps one Pacific evening as one day for the day's limit, and starts a fresh count at Pacific midnight", async () => {
      const f = await fixture();
      await buy(f, "Ada", 20, EVENING_NOV_1);
      await buy(f, "Ada", 20, LATE_NOV_1);
      expect((await rejection(buy(f, "Ada", 1, LATE_NOV_1))).code).toBe("invalid");
      expect((await buy(f, "Ada", 20, NEXT_MORNING)).charge.day).toBe("2026-11-02");
    });

    it("puts a 9:30 pm purchase on the last day of the month into that month, and not the next", async () => {
      const f = await fixture();
      const r = await buy(f, "Cy", 2, at("2026-12-01T05:30:00Z")); // 9:30 pm on Mon Nov 30, Pacific
      expect(r.charge.day).toBe("2026-11-30");
      const month = snackBarMonth(await f.store.read(), "2026-11-30");
      expect(month).toEqual({ label: "November 2026", purchases: 1, items: 2, totalCents: 300 });
      expect(snackBarMonth(await f.store.read(), "2026-12-01").purchases).toBe(0);
    });

    it("dates 12:30 am on the day the clocks fall back to that day, and 11:30 pm the evening before to the day before", async () => {
      const f = await fixture();
      expect((await buy(f, "Dee", 1, at("2026-11-01T07:30:00Z"))).charge.day).toBe("2026-11-01"); // 12:30 am PDT
      expect((await buy(f, "Eli", 1, at("2026-11-01T06:30:00Z"))).charge.day).toBe("2026-10-31"); // 11:30 pm PDT
    });
  });

  describe("billing and the staff's view", () => {
    const month = "2026-09";
    const linkBoth = async (f: Fixture) => {
      await setQuickbooksId(f.store, staffCtx(), f.h.Quill, "QB-100");
      await setQuickbooksId(f.store, staffCtx(), f.h.Reed, "QB-200");
    };
    const snackLines = async (f: Fixture, who: "Quill" | "Reed") => {
      const p = planBilling(await f.store.read(), BILLING_RULES, month, NOV_2);
      expect(p.problems).toEqual([]);
      return p.invoices.find((i) => i.householdId === f.h[who])!.lines.filter((l) => l.kind === "snack_bar");
    };

    it("adds up into the household's one Snack bar line for the month, together with a snack sale staff typed in", async () => {
      const f = await fixture();
      await linkBoth(f);
      await buy(f, "Ada", 3, SEP_12);
      await buy(f, "Ben", 2, SEP_12);
      await recordCharge(f.store, staffCtx(SEP_12), { householdId: f.h.Quill, category: "snack_bar", adjustment: false, amountCents: 400 });
      await buy(f, "Dee", 4, SEP_12);
      expect(await snackLines(f, "Quill")).toEqual([
        { kind: "snack_bar", description: "Snack bar: 3 charges in September 2026", quantity: 1, unitCents: 1150, amountCents: 1150, taxable: false, adjustment: false },
      ]);
      expect(await snackLines(f, "Reed")).toEqual([
        { kind: "snack_bar", description: "Snack bar: 1 charge in September 2026", quantity: 1, unitCents: 600, amountCents: 600, taxable: false, adjustment: false },
      ]);
    });

    it("leaves a voided purchase out of the month's line", async () => {
      const f = await fixture();
      await linkBoth(f);
      const wrong = await buy(f, "Ada", 9, SEP_12);
      await buy(f, "Ada", 1, SEP_12);
      await voidCharge(f.store, staffCtx(SEP_12), wrong.charge.id, "Wrong name");
      expect((await snackLines(f, "Quill"))[0].amountCents).toBe(150);
    });

    it("cannot be added to a day in a month that was already billed", async () => {
      const f = await fixture();
      await linkBoth(f);
      await buy(f, "Ada", 1, SEP_12);
      await runBilling(f.store, staffCtx(NOV_2), BILLING_RULES, month);
      const e = await rejection(buy(f, "Ada", 1, SEP_12));
      expect(e).toMatchObject({ code: "conflict", message: "September 2026 was already billed, so nothing can be added to it. Ask club staff." });
      expect((await f.store.read()).charges).toHaveLength(1);
    });

    it("lets staff void a purchase from the iPad, with a reason, and the member cannot", async () => {
      const f = await fixture();
      const r = await buy(f, "Ada", 2);
      expect((await rejection(voidCharge(f.store, memberCtx(f.m.Ada, "Ada Quill"), r.charge.id, "Changed my mind"))).code).toBe("forbidden");
      const voided = await voidCharge(f.store, staffCtx(), r.charge.id, "Tapped the wrong name");
      expect(voided).toMatchObject({ status: "voided", voidReason: "Tapped the wrong name" });
      expect(voided).toMatchObject({ quantity: 2, unitCents: 150, entryToken: r.charge.entryToken });
    });

    it("sums the iPad's purchases for the month, leaving out staff's charges, voided ones and other months", async () => {
      const f = await fixture();
      const wrong = await buy(f, "Ada", 7);
      await buy(f, "Ada", 3);
      await buy(f, "Eli", 5);
      await buy(f, "Eli", 2, SEP_12);
      await recordCharge(f.store, staffCtx(), { householdId: f.h.Quill, category: "snack_bar", adjustment: false, amountCents: 1000 });
      await recordCharge(f.store, staffCtx(), { householdId: f.h.Quill, category: "bar", adjustment: false, amountCents: 1000 });
      await voidCharge(f.store, staffCtx(), wrong.charge.id, "Wrong name");
      expect(snackBarMonth(await f.store.read(), TODAY)).toEqual({ label: "October 2026", purchases: 2, items: 8, totalCents: 1200 });
      expect(snackBarMonth(await f.store.read(), "2026-09-12")).toEqual({ label: "September 2026", purchases: 1, items: 2, totalCents: 300 });
      expect(snackBarMonth(await f.store.read(), "2026-08-12")).toEqual({ label: "August 2026", purchases: 0, items: 0, totalCents: 0 });
    });
  });

  it("works for a household added later, on the same screen", async () => {
    const f = await fixture();
    const h = await createHousehold(f.store, staffCtx(), { displayName: "The Lund household", membershipType: "Intermediate", joinedOn: "2026-10-01", primary: { firstName: "Mia", lastName: "Lund", email: "mia@example.com" } });
    const mia = h.members[0].id;
    const r = await recordSnacks(f.store, memberCtx(mia, "Mia Lund"), RULES, { memberId: mia, items: 2, entryToken: token() });
    expect(r.charge.householdId).toBe(h.household.id);
  });
});

describe("the snack bar's words", () => {
  it("says one or many, states the price first, and totals a count", () => {
    expect(snackCountWords(1)).toBe("1 snack");
    expect(snackCountWords(2)).toBe("2 snacks");
    expect(snackCountWords(20)).toBe("20 snacks");
    expect(snackPriceWords(RULES)).toBe("Every snack is $1.50.");
    expect(snackTotalWords(1, RULES)).toBe("1 snack, $1.50");
    expect(snackTotalWords(3, RULES)).toBe("3 snacks, $4.50");
    expect(snackTotalWords(7, RULES)).toBe("7 snacks, $10.50");
  });

  it("thanks the member by first name with what it came to and the month it goes on", async () => {
    const f = await fixtureFor("memory")();
    const r = await buy(f, "Ben", 3);
    expect(snackThanks("Ben", r.charge)).toBe("Thanks, Ben! 3 snacks, $4.50, added to your account for October 2026. Enjoy.");
    const one = await buy(f, "Ben", 1, SEP_12);
    expect(snackThanks("Ben", one.charge)).toBe("Thanks, Ben! 1 snack, $1.50, added to your account for September 2026. Enjoy.");
  });
});
