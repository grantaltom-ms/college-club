import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * The snack bar iPad as the DATABASE guards it, tested against a real Postgres. A snack bought on the iPad is one ordinary
 * charge entered by the member themselves, so the charges table now takes a member's entry, but only that: a snack-bar sale on
 * their own tab, with a count, the price of one, and a one-time token, whose amount is exactly count times price. Each test
 * breaks exactly one rule (a constraint runs after the triggers, so a second broken rule could hide the first). Needs
 * CLUB_TEST_DATABASE_URL (a local or throwaway Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

type Step = [sql: string, params?: unknown[]];
type Failure = { code?: string; message: string };

interface Entry {
  household?: string;
  member?: string | null;
  madeBy?: string | null;
  kind?: string;
  day?: string;
  category?: string;
  adjustment?: boolean;
  amount?: number;
  quantity?: number | null;
  unit?: number | null;
  token?: string | null;
}

describe.skipIf(!ADMIN_URL)("snack bar purchases", () => {
  const ref = { db: undefined as unknown as ScratchDb, n: 0 };
  beforeAll(async () => {
    ref.db = await createScratchDb(ADMIN_URL!);
  });
  afterAll(async () => {
    await ref.db?.drop();
  });
  const q = (sql: string, params: unknown[] = []) => ref.db.client.query(sql, params);

  async function change(steps: Step[]): Promise<Failure | null> {
    await q("begin");
    try {
      for (const [sql, params] of steps) await q(sql, params ?? []);
      await q("commit");
      return null;
    } catch (e) {
      await q("rollback").catch(() => undefined);
      return e as Failure;
    }
  }

  async function household(options: { ended?: boolean } = {}): Promise<{ hh: string; ada: string; ben: string }> {
    ref.n += 1;
    const hh = (await q(`insert into club.households (display_name, membership_type, joined_on) values ($1, 'Resident', '2020-01-01') returning id`, [`The Snack ${ref.n} household`])).rows[0].id;
    const add = async (first: string, role: string) =>
      (await q(`insert into club.members (household_id, first_name, last_name, email, phone, role) values ($1, $2, 'Test', $3, '206-555-0101', $4) returning id`, [hh, first, `${first.toLowerCase()}${ref.n}@example.com`, role])).rows[0].id;
    const people = { hh, ada: await add("Ada", "primary"), ben: await add("Ben", "additional") };
    if (options.ended) {
      await q(`update club.members set status = 'household_ended' where household_id = $1`, [hh]);
      await q(`update club.households set status = 'ended', ended_on = '2021-01-01' where id = $1`, [hh]);
    }
    return people;
  }

  let tokens = 0;
  const token = () => `snack-token-${String(++tokens).padStart(6, "0")}`;

  /** One charge row. The defaults are a good purchase by Ada on her own tab: 3 snacks at 150 cents. */
  function snack(p: { hh: string; ada: string }, over: Entry = {}): Step {
    const e = { household: p.hh, member: p.ada, madeBy: p.ada, kind: "member", day: "2026-10-28", category: "snack_bar", adjustment: false, amount: 450, quantity: 3, unit: 150, token: token(), ...over };
    return [
      `insert into club.charges (household_id, member_id, day, category, adjustment, amount_cents, description, quantity, unit_cents, entry_token, created_at, created_by_kind, created_by_id, created_by_label)
       values ($1, $2, $3, $4, $5, $6, '3 snacks at $1.50', $7, $8, $9, now(), $10, $11, 'Ada Test')`,
      [e.household, e.member, e.day, e.category, e.adjustment, e.amount, e.quantity, e.unit, e.token, e.kind, e.madeBy],
    ];
  }
  const rowsFor = async (hh: string) => (await q(`select * from club.charges where household_id = $1 order by seq`, [hh])).rows;

  describe("what is accepted", () => {
    it("saves a member's snack purchase on their own tab and reads back every field", async () => {
      const p = await household();
      const entry = token();
      expect(await change([snack(p, { token: entry })])).toBeNull();
      const [row] = await rowsFor(p.hh);
      expect(row).toMatchObject({ household_id: p.hh, member_id: p.ada, category: "snack_bar", adjustment: false, amount_cents: 450, quantity: 3, unit_cents: 150, entry_token: entry, created_by_kind: "member", created_by_id: p.ada, status: "open" });
    });

    it("still saves what staff type in, with none of the iPad's fields, for a household or for someone's tab", async () => {
      const p = await household();
      const staffSale = (member: string | null): Step => [
        `insert into club.charges (household_id, member_id, day, category, adjustment, amount_cents, description, created_at, created_by_kind, created_by_label) values ($1, $2, '2026-10-28', 'snack_bar', false, 900, 'Box of bars', now(), 'staff', 'Test staff')`,
        [p.hh, member],
      ];
      expect(await change([staffSale(null), staffSale(p.ben)])).toBeNull();
      const rows = await rowsFor(p.hh);
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r).toMatchObject({ quantity: null, unit_cents: null, entry_token: null, created_by_id: null, created_by_kind: "staff" });
    });

    it("takes the smallest and the largest purchase, one snack and a hundred, at the cheapest and dearest price", async () => {
      const p = await household();
      expect(await change([snack(p, { quantity: 1, unit: 1, amount: 1 })])).toBeNull();
      expect(await change([snack(p, { quantity: 100, unit: 100_000, amount: 10_000_000 })])).toBeNull();
      expect(await change([snack(p, { token: "a".repeat(16) }), snack(p, { token: "B_-".repeat(21) + "z" })])).toBeNull();
    });

    it("can be voided by staff with a reason, and a voided purchase stays on the record", async () => {
      const p = await household();
      expect(await change([snack(p)])).toBeNull();
      const [row] = await rowsFor(p.hh);
      expect(await change([[`update club.charges set status = 'voided', voided_at = now(), voided_by_label = 'Test staff', void_reason = 'Tapped the wrong name' where id = $1`, [row.id]]])).toBeNull();
      expect((await rowsFor(p.hh))[0]).toMatchObject({ status: "voided", quantity: 3, entry_token: row.entry_token });
    });
  });

  describe("what only a member's own snack purchase may be", () => {
    it("is refused as a bar sale, as an adjustment, with no tab, or on someone else's tab", async () => {
      const p = await household();
      const sales = /charges_member_entries_are_snack_sales/;
      expect((await change([snack(p, { category: "bar" })]))?.message).toMatch(sales);
      expect((await change([snack(p, { adjustment: true })]))?.message).toMatch(sales);
      expect((await change([snack(p, { member: null })]))?.message).toMatch(sales);
      expect((await change([snack(p, { member: p.ben })]))?.message).toMatch(sales);
      expect((await change([snack(p, { madeBy: p.ben })]))?.message).toMatch(sales);
      expect(await rowsFor(p.hh)).toEqual([]);
    });

    it("is refused when the member entry has no maker named (the guard stops it before the table rules look)", async () => {
      const p = await household();
      const failed = await change([snack(p, { madeBy: null })]);
      expect(failed?.code).toBe(CHECK_VIOLATION);
      expect(failed?.message).toContain("Only an active member can put snacks on their own account.");
      expect(await rowsFor(p.hh)).toEqual([]);
    });

    it("is refused when it is missing its count, price or token", async () => {
      const p = await household();
      expect((await change([snack(p, { quantity: null, unit: null, token: null })]))?.message).toMatch(/charges_member_entries_have_the_fields/);
      expect((await change([snack(p, { unit: null })]))?.message).toMatch(/charges_snack_fields_come_together/);
      expect((await change([snack(p, { token: null })]))?.message).toMatch(/charges_snack_fields_come_together/);
      expect((await change([snack(p, { quantity: null })]))?.message).toMatch(/charges_member_entries_have_the_fields/);
      expect(await rowsFor(p.hh)).toEqual([]);
    });

    it("is refused for staff to carry the iPad's fields, or to name a member as the maker", async () => {
      const p = await household();
      const failedFields = await change([snack(p, { kind: "staff" })]);
      expect(failedFields?.message).toMatch(/charges_member_entries_have_the_fields/);
      const failedMaker = await change([
        [
          `insert into club.charges (household_id, member_id, day, category, adjustment, amount_cents, description, created_at, created_by_kind, created_by_id, created_by_label) values ($1, $2, '2026-10-28', 'snack_bar', false, 150, 'x', now(), 'staff', $2, 'Test staff')`,
          [p.hh, p.ada],
        ],
      ]);
      expect(failedMaker?.message).toMatch(/charges_snack_fields_come_together/);
    });

    it("is refused when the amount is not exactly the count times the price", async () => {
      const p = await household();
      for (const amount of [449, 451, 150, 1]) {
        const failed = await change([snack(p, { amount })]);
        expect(failed?.code, String(amount)).toBe(CHECK_VIOLATION);
        expect(failed?.message, String(amount)).toMatch(/charges_snack_amount_is_quantity_times_price/);
      }
      expect(await rowsFor(p.hh)).toEqual([]);
    });

    it("is refused for a count over a hundred and a price over a thousand dollars", async () => {
      const p = await household();
      expect((await change([snack(p, { quantity: 101, unit: 150, amount: 101 * 150 })]))?.message).toMatch(/charges_snack_quantity_is_sensible/);
      expect((await change([snack(p, { quantity: 1, unit: 100_001, amount: 100_001 })]))?.message).toMatch(/charges_snack_price_is_sensible/);
      expect(await rowsFor(p.hh)).toEqual([]);
    });

    it("is refused when the token is too short, too long or spelled with anything but letters, digits, dashes and underscores", async () => {
      const p = await household();
      for (const bad of ["x".repeat(15), "x".repeat(65), "has a space in it!!", "semi;colon;token;1234", "slash/slash/slash/1"]) {
        expect((await change([snack(p, { token: bad })]))?.message, bad).toMatch(/charges_entry_token_shape/);
      }
      expect(await rowsFor(p.hh)).toEqual([]);
    });

    it("is refused when the same token is used twice, but staff entries with no token can repeat", async () => {
      const p = await household();
      const entry = token();
      expect(await change([snack(p, { token: entry })])).toBeNull();
      const again = await change([snack(p, { token: entry })]);
      expect(again?.code).toBe(UNIQUE_VIOLATION);
      expect(again?.message).toMatch(/charges_entry_token_unique/);
      const other = await household();
      expect((await change([snack(other, { token: entry })]))?.code).toBe(UNIQUE_VIOLATION);
      const staff: Step = [`insert into club.charges (household_id, day, category, adjustment, amount_cents, description, created_at, created_by_kind, created_by_label) values ($1, '2026-10-28', 'snack_bar', false, 100, 'x', now(), 'staff', 'Test staff')`, [p.hh]];
      expect(await change([staff, staff])).toBeNull();
    });

    it("is refused for someone who has left, or whose household has ended", async () => {
      const left = await household();
      await q(`update club.members set status = 'removed' where id = $1`, [left.ada]);
      const gone = await change([snack(left)]);
      expect(gone?.code).toBe(CHECK_VIOLATION);
      expect(gone?.message).toContain("Only an active member can put snacks on their own account.");
      const ended = await household({ ended: true });
      const closed = await change([snack(ended)]);
      expect(closed?.code).toBe(CHECK_VIOLATION);
      expect(closed?.message).toContain("Only an active member can put snacks on their own account.");
      expect(await rowsFor(left.hh)).toEqual([]);
      expect(await rowsFor(ended.hh)).toEqual([]);
    });

    it("is refused for a household's tab that is not the member's own household", async () => {
      const mine = await household();
      const other = await household();
      const failed = await change([snack(mine, { household: other.hh })]);
      expect(failed?.code).toBe(CHECK_VIOLATION);
      expect(failed?.message).toContain("A charge can only name someone in the household it is charged to.");
    });
  });

  describe("after it is saved", () => {
    it("can never have its count, price, token, maker or kind changed", async () => {
      const p = await household();
      expect(await change([snack(p)])).toBeNull();
      const [row] = await rowsFor(p.hh);
      for (const set of ["quantity = 4", "unit_cents = 200", "entry_token = 'a-different-token-0001'", `created_by_id = '${p.ben}'`, "created_by_kind = 'staff'", "amount_cents = 600"]) {
        const failed = await change([[`update club.charges set ${set} where id = $1`, [row.id]]]);
        expect(failed?.message, set).toContain("A charge cannot be changed. Void it and enter a new one.");
      }
      const after = (await rowsFor(p.hh))[0];
      expect(after).toMatchObject({ quantity: 3, unit_cents: 150, entry_token: row.entry_token, created_by_id: p.ada, created_by_kind: "member", amount_cents: 450 });
    });

    it("cannot be dated in a month that was already billed, and cannot be removed", async () => {
      const p = await household();
      await q(`insert into club.billing_runs (month, created_at, created_by_kind, created_by_label, invoice_count, total_cents) values ('2026-09', now(), 'staff', 'Test staff', 0, 0)`);
      const failed = await change([snack(p, { day: "2026-09-12" })]);
      expect(failed?.code).toBe(CHECK_VIOLATION);
      expect(failed?.message).toContain("That month was already billed");
      expect(await change([snack(p, { day: "2026-10-12" })])).toBeNull();
      const [row] = await rowsFor(p.hh);
      expect((await change([[`delete from club.charges where id = $1`, [row.id]]]))?.message).toContain("never removed");
    });
  });
});
