import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "./testdb";

/**
 * Charges, visitors and the monthly billing run as the DATABASE guards them, tested against a real Postgres: a closed
 * month stays closed, billed lines can never change, an invoice's lines add up to what the run says, months close in
 * order, and a household's QuickBooks ID cannot change without a line in its file. Needs CLUB_TEST_DATABASE_URL (a local
 * or throwaway Postgres); skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const CHECK_VIOLATION = "23514";

type Step = [sql: string, params?: unknown[]];
type Failure = { code?: string; message: string };

/** One scratch database per group of tests, because a closed month can never be reopened. */
function useDatabase() {
  const ref = { db: undefined as unknown as ScratchDb, n: 0 };
  beforeAll(async () => {
    ref.db = await createScratchDb(ADMIN_URL!);
  });
  afterAll(async () => {
    await ref.db?.drop();
  });
  const q = (sql: string, params: unknown[] = []) => ref.db.client.query(sql, params);

  /** Runs the steps as one change. Returns the error (from a step or from the commit, where the deferred rules are checked), or null. */
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

  async function household(options: { ended?: boolean; quickbooks?: string } = {}): Promise<{ hh: string; ada: string; ben: string }> {
    ref.n += 1;
    const hh = (
      await q(`insert into club.households (display_name, membership_type, joined_on, quickbooks_id) values ($1, 'Resident', '2020-01-01', $2) returning id`, [`The Test ${ref.n} household`, options.quickbooks ?? null])
    ).rows[0].id;
    const add = async (first: string, role: string) =>
      (await q(`insert into club.members (household_id, first_name, last_name, email, phone, role) values ($1, $2, 'Test', $3, '206-555-0101', $4) returning id`, [hh, first, `${first.toLowerCase()}${ref.n}@example.com`, role])).rows[0].id;
    const people = { hh, ada: await add("Ada", "primary"), ben: await add("Ben", "additional") };
    if (options.ended) {
      await q(`update club.members set status = 'household_ended' where household_id = $1`, [hh]);
      await q(`update club.households set status = 'ended', ended_on = '2021-01-01' where id = $1`, [hh]);
    }
    return people;
  }

  return { q, change, household };
}

describe.skipIf(!ADMIN_URL)("a household's QuickBooks ID", () => {
  const { q, change, household } = useDatabase();
  const line = (hh: string, details: Record<string, string | null>, kind = "quickbooks_linked") =>
    [
      `insert into club.household_history (household_id, kind, summary, actor_kind, actor_label, details) values ($1, $2, 'QuickBooks ID set.', 'staff', 'Test staff', $3)`,
      [hh, kind, JSON.stringify(details)],
    ] as Step;
  const quickbooks = async (hh: string) => (await q(`select quickbooks_id from club.households where id = $1`, [hh])).rows[0].quickbooks_id;

  it("can be set when a matching line is written in the same change, before or after, and corrected the same way", async () => {
    const { hh } = await household();
    expect(await change([line(hh, { from: null, to: "QB-100" }), [`update club.households set quickbooks_id = 'QB-100' where id = $1`, [hh]]])).toBeNull();
    expect(await change([[`update club.households set quickbooks_id = 'QB-101' where id = $1`, [hh]], line(hh, { from: "QB-100", to: "QB-101" })])).toBeNull();
    expect(await quickbooks(hh)).toBe("QB-101");
  });

  it("can be given when the household is made, with no line needed (the joined line explains it)", async () => {
    const { hh } = await household({ quickbooks: "QB-200" });
    expect(await quickbooks(hh)).toBe("QB-200");
  });

  it("is refused with no line at all, and the household keeps what it had", async () => {
    const { hh } = await household({ quickbooks: "QB-300" });
    const failed = await change([[`update club.households set quickbooks_id = 'QB-301' where id = $1`, [hh]]]);
    expect(failed?.code).toBe(CHECK_VIOLATION);
    expect(failed?.message).toContain("cannot change without a matching line");
    expect(await quickbooks(hh)).toBe("QB-300");
  });

  it("is refused when the line does not say the same thing: wrong old value, wrong new value, another kind, or another household's file", async () => {
    const { hh } = await household({ quickbooks: "QB-400" });
    const other = await household({ quickbooks: "QB-401" });
    const update: Step = [`update club.households set quickbooks_id = 'QB-402' where id = $1`, [hh]];
    const bad: [string, Step][] = [
      ["a wrong old value", line(hh, { from: "QB-999", to: "QB-402" })],
      ["a wrong new value", line(hh, { from: "QB-400", to: "QB-999" })],
      ["a missing old value", line(hh, { to: "QB-402" })],
      ["another kind of line", line(hh, { from: "QB-400", to: "QB-402" }, "type_changed")],
      ["a line in another household's file", line(other.hh, { from: "QB-400", to: "QB-402" })],
    ];
    for (const [label, step] of bad) {
      expect((await change([step, update]))?.code, label).toBe(CHECK_VIOLATION);
      expect(await quickbooks(hh), label).toBe("QB-400");
    }
  });

  it("can be corrected but never cleared, even with a line", async () => {
    const { hh } = await household({ quickbooks: "QB-500" });
    const failed = await change([line(hh, { from: "QB-500", to: "" }), [`update club.households set quickbooks_id = null where id = $1`, [hh]]]);
    expect(failed?.code).toBe(CHECK_VIOLATION);
    expect(failed?.message).toContain("corrected but not cleared");
    expect(await quickbooks(hh)).toBe("QB-500");
  });

  it("belongs to one household only", async () => {
    await household({ quickbooks: "QB-600" });
    const { hh } = await household();
    const failed = await change([line(hh, { from: null, to: "QB-600" }), [`update club.households set quickbooks_id = 'QB-600' where id = $1`, [hh]]]);
    expect(failed?.message).toMatch(/quickbooks_id/);
  });
});

describe.skipIf(!ADMIN_URL)("charges", () => {
  const { q, change, household } = useDatabase();
  const insert = (hh: string, o: { member?: string | null; day?: string; category?: string; adjustment?: boolean; amount?: number; description?: string; label?: string } = {}) =>
    [
      `insert into club.charges (household_id, member_id, day, category, adjustment, amount_cents, description, created_at, created_by_kind, created_by_label)
       values ($1, $2, $3, $4, $5, $6, $7, '2026-09-10T20:00:00Z', 'staff', $8) returning id`,
      [hh, o.member ?? null, o.day ?? "2026-09-10", o.category ?? "bar", o.adjustment ?? false, o.amount ?? 1250, o.description ?? "Two drinks", o.label ?? "Test staff"],
    ] as Step;
  const add = async (hh: string, o: Parameters<typeof insert>[1] = {}): Promise<string> => (await q(...insert(hh, o))).rows[0].id;
  const row = async (id: string) => (await q(`select * from club.charges where id = $1`, [id])).rows[0];
  const closeMonth = (month: string) => q(`insert into club.billing_runs (month, created_at, created_by_kind, created_by_label, invoice_count, total_cents) values ($1, '2026-10-02T20:00:00Z', 'staff', 'Test staff', 0, 0)`, [month]);

  it("accepts a bar sale, a snack-bar sale, and an adjustment that is a credit or goes under any line", async () => {
    const { hh, ada } = await household();
    for (const o of [
      { category: "bar", amount: 850 },
      { category: "snack_bar", amount: 400, member: ada },
      { category: "dues", amount: -2000, adjustment: true, description: "Credit for a double charge" },
      { category: "event_tickets", amount: 4500, adjustment: true, description: "Missed ticket" },
      { category: "bar", amount: -500, adjustment: true, description: "Refund a drink" },
    ]) {
      expect(await change([insert(hh, o)]), JSON.stringify(o)).toBeNull();
    }
  });

  it("refuses a sale that is negative or zero, a sale under dues, and an amount of nothing", async () => {
    const { hh } = await household();
    for (const [label, o] of [
      ["a negative bar sale", { amount: -100 }],
      ["a zero amount", { amount: 0, adjustment: true }],
      ["a sale that is not bar or snack bar", { category: "dues", amount: 100 }],
      ["a sale of a ticket", { category: "event_tickets", amount: 100 }],
      ["an enormous amount", { amount: 10_000_001, adjustment: true }],
    ] as const) {
      expect((await change([insert(hh, o)]))?.code, label).toBeDefined();
    }
    expect(Number((await q(`select count(*) from club.charges where household_id = $1`, [hh])).rows[0].count)).toBe(0);
  });

  it("refuses a description that is empty, and a charge by anyone but staff or a member (the snack bar iPad has its own tests)", async () => {
    const { hh } = await household();
    expect((await change([insert(hh, { description: "" })]))?.message).toMatch(/charges_description_check/);
    const failed = await change([[`insert into club.charges (household_id, day, category, adjustment, amount_cents, description, created_at, created_by_kind, created_by_label) values ($1, '2026-09-10', 'bar', false, 100, 'x', now(), 'system', 'The system')`, [hh]]]);
    expect(failed?.message).toMatch(/charges_created_by_kind_check/);
  });

  it("can only name someone who is in the household it is charged to", async () => {
    const mine = await household();
    const other = await household();
    const failed = await change([insert(mine.hh, { member: other.ada })]);
    expect(failed?.code).toBe(CHECK_VIOLATION);
    expect(failed?.message).toContain("only name someone in the household");
    expect(await change([insert(mine.hh, { member: mine.ben })])).toBeNull();
  });

  it("cannot be entered already voided", async () => {
    const { hh } = await household();
    const failed = await change([
      [
        `insert into club.charges (household_id, day, category, adjustment, amount_cents, description, created_at, created_by_kind, created_by_label, status, voided_at, voided_by_label, void_reason)
         values ($1, '2026-09-10', 'bar', false, 500, 'Already voided', '2026-09-10T20:00:00Z', 'staff', 'Test staff', 'voided', now(), 'Test staff', 'Why')`,
        [hh],
      ],
    ]);
    expect(failed?.message).toContain("starts open");
  });

  it("can be voided with a reason while its month is open, and a voided charge cannot change again", async () => {
    const { hh } = await household();
    const id = await add(hh);
    expect(await change([[`update club.charges set status = 'voided', voided_at = now(), voided_by_label = 'Test staff', void_reason = 'Rang up twice' where id = $1`, [id]]])).toBeNull();
    expect((await row(id)).status).toBe("voided");
    const again = await change([[`update club.charges set void_reason = 'A different reason' where id = $1`, [id]]]);
    expect(again?.message).toContain("voided charge cannot change again");
  });

  it("cannot be voided without a reason, or half voided", async () => {
    const { hh } = await household();
    const id = await add(hh);
    for (const set of [`status = 'voided'`, `status = 'voided', voided_at = now(), voided_by_label = 'Test staff'`, `voided_at = now(), voided_by_label = 'Test staff', void_reason = 'x'`]) {
      expect((await change([[`update club.charges set ${set} where id = $1`, [id]]]))?.message, set).toMatch(/charges_void_matches_status/);
    }
    expect((await row(id)).status).toBe("open");
  });

  it("can never be changed (only voided) or removed, even by someone with full access", async () => {
    const { hh } = await household();
    const id = await add(hh);
    for (const set of [`amount_cents = 1`, `day = '2026-09-11'`, `description = 'Changed'`, `category = 'snack_bar'`, `household_id = (select id from club.households where id <> $2 limit 1)`, `created_by_label = 'Someone else'`]) {
      const failed = await change([[`update club.charges set ${set} where id = $1`, set.includes("$2") ? [id, hh] : [id]]]);
      expect(failed?.message, set).toContain("cannot be changed");
    }
    expect((await change([[`delete from club.charges where id = $1`, [id]]]))?.message).toContain("never removed");
    expect((await change([[`truncate club.charges`]]))?.message).toContain("never removed");
    expect((await row(id)).amount_cents).toBe(1250);
  });

  it("cannot be dated in a month that was already closed, or voided after its month closed", async () => {
    const { hh } = await household();
    const open = await add(hh, { day: "2026-09-12" });
    const untouched = await add(hh, { day: "2026-10-05" });
    await closeMonth("2026-09");
    const late = await change([insert(hh, { day: "2026-09-30" })]);
    expect(late?.code).toBe(CHECK_VIOLATION);
    expect(late?.message).toContain("already billed");
    const voided = await change([[`update club.charges set status = 'voided', voided_at = now(), voided_by_label = 'Test staff', void_reason = 'Too late' where id = $1`, [open]]]);
    expect(voided?.code).toBe(CHECK_VIOLATION);
    expect(voided?.message).toContain("already billed");
    expect((await row(open)).status).toBe("open");
    // The next month is open, and its charges are untouched by the closing.
    expect(await change([insert(hh, { day: "2026-10-31" })])).toBeNull();
    expect(await change([[`update club.charges set status = 'voided', voided_at = now(), voided_by_label = 'Test staff', void_reason = 'Fine' where id = $1`, [untouched]]])).toBeNull();
  });
});

describe.skipIf(!ADMIN_URL)("visitor entries", () => {
  const { q, change, household } = useDatabase();
  const insert = (member: string, o: { day?: string; visitors?: number; via?: string; byKind?: string; byId?: string | null; label?: string } = {}) =>
    [
      `insert into club.visitor_entries (member_id, day, visitors, created_at, created_by_kind, created_by_id, created_by_label, via)
       values ($1, $2, $3, '2026-09-10T20:00:00Z', $4, $5, $6, $7) returning id`,
      [member, o.day ?? "2026-09-10", o.visitors ?? 3, o.byKind ?? "member", o.byId === undefined ? member : o.byId, o.label ?? "Ada Test", o.via ?? "ipad"],
    ] as Step;
  const add = async (member: string, o: Parameters<typeof insert>[1] = {}): Promise<string> => (await q(...insert(member, o))).rows[0].id;
  const status = async (id: string) => (await q(`select status from club.visitor_entries where id = $1`, [id])).rows[0].status;

  it("accepts a member signing in visitors on the iPad, and staff entering them", async () => {
    const { ada } = await household();
    expect(await change([insert(ada)])).toBeNull();
    expect(await change([insert(ada, { via: "staff", byKind: "staff", byId: null, label: "Test staff", visitors: 2 })])).toBeNull();
  });

  it("refuses who and how that disagree: staff on the iPad, a member entering for staff, or an iPad entry made for someone else", async () => {
    const { ada, ben } = await household();
    for (const [label, o] of [
      ["staff on the iPad", { via: "ipad", byKind: "staff", byId: null }],
      ["a member as the front desk", { via: "staff", byKind: "member" }],
      ["an iPad entry made for someone else", { via: "ipad", byKind: "member", byId: ben }],
      ["an iPad entry with nobody named", { via: "ipad", byKind: "member", byId: null }],
      ["staff on the iPad, even naming the member", { via: "ipad", byKind: "staff", byId: ada }],
    ] as const) {
      expect((await change([insert(ada, o)]))?.message, label).toMatch(/visitor_entries_who_matches_how/);
    }
  });

  it("refuses no visitors, too many in one entry, and someone who has left or whose household ended", async () => {
    const { hh, ada, ben } = await household();
    for (const visitors of [0, -1, 51]) expect((await change([insert(ada, { visitors })]))?.message, String(visitors)).toMatch(/visitors_check/);
    await q(`update club.members set status = 'removed' where id = $1`, [ben]);
    const left = await change([insert(ben)]);
    expect(left?.code).toBe(CHECK_VIOLATION);
    expect(left?.message).toContain("active in an active household");
    const ended = await household({ ended: true });
    expect((await change([insert(ended.ada)]))?.code).toBe(CHECK_VIOLATION);
    expect(hh).toBeTruthy();
  });

  it("cannot be entered already voided", async () => {
    const { ada } = await household();
    const failed = await change([
      [
        `insert into club.visitor_entries (member_id, day, visitors, created_at, created_by_kind, created_by_id, created_by_label, via, status, voided_at, voided_by_label, void_reason)
         values ($1, '2026-09-10', 2, '2026-09-10T20:00:00Z', 'member', $2, 'Ada Test', 'ipad', 'voided', now(), 'Test staff', 'Why')`,
        [ada, ada],
      ],
    ]);
    expect(failed?.message).toContain("starts recorded");
  });

  it("can be voided with a reason while its month is open, never half voided, never changed again", async () => {
    const { ada } = await household();
    const id = await add(ada);
    expect((await change([[`update club.visitor_entries set status = 'voided' where id = $1`, [id]]]))?.message).toMatch(/visitor_entries_void_matches_status/);
    expect(await change([[`update club.visitor_entries set status = 'voided', voided_at = now(), voided_by_label = 'Test staff', void_reason = 'Typed 3, was 2' where id = $1`, [id]]])).toBeNull();
    expect(await status(id)).toBe("voided");
    expect((await change([[`update club.visitor_entries set void_reason = 'Other' where id = $1`, [id]]]))?.message).toContain("cannot change again");
  });

  it("can never be changed (only voided) or removed", async () => {
    const { ada } = await household();
    const id = await add(ada);
    for (const set of [`visitors = 1`, `day = '2026-09-11'`, `via = 'staff'`, `created_by_label = 'Other'`]) {
      expect((await change([[`update club.visitor_entries set ${set} where id = $1`, [id]]]))?.message, set).toContain("cannot be changed");
    }
    expect((await change([[`delete from club.visitor_entries where id = $1`, [id]]]))?.message).toContain("never removed");
    expect((await change([[`truncate club.visitor_entries`]]))?.message).toContain("never removed");
  });

  it("cannot be added to a month that was already closed, or voided after it closed", async () => {
    const { ada } = await household();
    const id = await add(ada, { day: "2026-09-12" });
    await q(`insert into club.billing_runs (month, created_at, created_by_kind, created_by_label, invoice_count, total_cents) values ('2026-09', now(), 'staff', 'Test staff', 0, 0)`);
    const late = await change([insert(ada, { day: "2026-09-20" })]);
    expect(late?.code).toBe(CHECK_VIOLATION);
    expect(late?.message).toContain("already billed");
    const voided = await change([[`update club.visitor_entries set status = 'voided', voided_at = now(), voided_by_label = 'Test staff', void_reason = 'Late' where id = $1`, [id]]]);
    expect(voided?.message).toContain("already billed");
    expect(await status(id)).toBe("recorded");
    expect(await change([insert(ada, { day: "2026-10-01" })])).toBeNull();
  });
});

describe.skipIf(!ADMIN_URL)("closing a month", () => {
  const { q, change, household } = useDatabase();
  const run = (month: string, invoices: number, total: number): Step => [
    `insert into club.billing_runs (id, month, created_at, created_by_kind, created_by_label, invoice_count, total_cents) values ($1, $2, '2026-10-02T20:00:00Z', 'staff', 'Test staff', $3, $4)`,
    [RUN_IDS[month] ?? "00000000-0000-4000-8000-0000000000ff", month, invoices, total],
  ];
  const RUN_IDS: Record<string, string> = {
    "2026-03": "00000000-0000-4000-8000-000000000003",
    "2026-04": "00000000-0000-4000-8000-000000000004",
    "2026-05": "00000000-0000-4000-8000-000000000005",
    "2026-06": "00000000-0000-4000-8000-000000000006",
  };
  const lineOf = (month: string, hh: string, invoiceNo: string, o: { kind?: string; quantity?: number; unit?: number; amount?: number; adjustment?: boolean } = {}): Step => {
    const quantity = o.quantity ?? 1;
    const unit = o.unit ?? 15450;
    return [
      `insert into club.billing_lines (run_id, household_id, invoice_no, kind, description, quantity, unit_cents, amount_cents, taxable, adjustment) values ($1, $2, $3, $4, 'A line', $5, $6, $7, false, $8)`,
      [RUN_IDS[month], hh, invoiceNo, o.kind ?? "dues", quantity, unit, o.amount ?? quantity * unit, o.adjustment ?? false],
    ];
  };

  it("lets the first month be any month, and records it with its invoice lines when they add up", async () => {
    const { hh } = await household();
    const { hh: hh2 } = await household();
    expect(await change([run("2026-03", 2, 15450 + 4500 + 15450), lineOf("2026-03", hh, "2603-0001"), lineOf("2026-03", hh, "2603-0001", { kind: "event_tickets", quantity: 1, unit: 4500 }), lineOf("2026-03", hh2, "2603-0002")])).toBeNull();
    expect(Number((await q(`select count(*) from club.billing_lines where run_id = $1`, [RUN_IDS["2026-03"]])).rows[0].count)).toBe(3);
  });

  it("refuses a run whose invoice count or total does not match its lines, and writes nothing", async () => {
    const { hh } = await household();
    const wrongTotal = await change([run("2026-04", 1, 99999), lineOf("2026-04", hh, "2604-0001")]);
    expect(wrongTotal?.code).toBe(CHECK_VIOLATION);
    expect(wrongTotal?.message).toContain("must add up");
    const wrongCount = await change([run("2026-04", 3, 15450), lineOf("2026-04", hh, "2604-0001")]);
    expect(wrongCount?.message).toContain("must add up");
    const noLines = await change([run("2026-04", 1, 15450)]);
    expect(noLines?.message).toContain("must add up");
    expect(Number((await q(`select count(*) from club.billing_runs where month = '2026-04'`)).rows[0].count)).toBe(0);
  });

  it("refuses an invoice number shared by two households", async () => {
    const { hh } = await household();
    const { hh: other } = await household();
    const failed = await change([run("2026-04", 1, 30900), lineOf("2026-04", hh, "2604-0001"), lineOf("2026-04", other, "2604-0001")]);
    expect(failed?.message).toContain("belongs to one household");
  });

  it("refuses a line whose amount is not quantity times unit, and a credit that is not an adjustment", async () => {
    const { hh } = await household();
    expect((await change([run("2026-04", 1, 1), lineOf("2026-04", hh, "2604-0001", { quantity: 2, unit: 100, amount: 201 })]))?.message).toMatch(/billing_lines_amount_is_quantity_times_unit/);
    expect((await change([run("2026-04", 1, -500), lineOf("2026-04", hh, "2604-0001", { quantity: 1, unit: -500 })]))?.message).toMatch(/billing_lines_credit_is_adjustment/);
    expect(await change([run("2026-04", 1, -500), lineOf("2026-04", hh, "2604-0001", { quantity: 1, unit: -500, adjustment: true })])).toBeNull();
  });

  it("refuses a line with an invoice number too long for QuickBooks, a kind that does not exist, or a quantity of nothing", async () => {
    // 2026-05 is the next month to close (the tests above closed the ones before it); each try is rolled back.
    const { hh } = await household();
    expect((await change([run("2026-05", 1, 15450), lineOf("2026-05", hh, "2605-0001-and-a-very-long-tail")]))?.message).toMatch(/billing_lines_invoice_no_check/);
    expect((await change([run("2026-05", 1, 15450), lineOf("2026-05", hh, "2605-0001", { kind: "rent" })]))?.message).toMatch(/billing_lines_kind_check/);
    expect((await change([run("2026-05", 1, 0), lineOf("2026-05", hh, "2605-0001", { quantity: 0 })]))?.message).toMatch(/billing_lines_quantity_check/);
    expect(Number((await q(`select count(*) from club.billing_runs where month = '2026-05'`)).rows[0].count)).toBe(0);
  });

  it("closes months in order: the month right after the last, never the same one again, never skipping or going back", async () => {
    // 2026-03 and 2026-04 are closed by the tests above.
    for (const month of ["2026-03", "2026-06", "2026-02"]) {
      const failed = await change([run(month, 0, 0)]);
      expect(failed?.message, month).toMatch(/Months are billed in order|billing_runs_month_key/);
    }
    expect(await change([run("2026-05", 0, 0)])).toBeNull();
  });

  it("can never be changed or removed, nor can its lines, and a late line cannot be added to a closed month", async () => {
    const { hh } = await household();
    const lines = (await q(`select id from club.billing_lines limit 1`)).rows[0].id;
    for (const [label, sql] of [
      ["changing a run", `update club.billing_runs set total_cents = 1 where month = '2026-03'`],
      ["removing a run", `delete from club.billing_runs where month = '2026-03'`],
      ["emptying the runs", `truncate club.billing_runs cascade`],
      ["changing a line", `update club.billing_lines set amount_cents = 1, unit_cents = 1 where id = '${lines}'`],
      ["removing a line", `delete from club.billing_lines where id = '${lines}'`],
      ["emptying the lines", `truncate club.billing_lines`],
    ] as const) {
      expect((await change([[sql]]))?.message, label).toContain("can only be added to");
    }
    // A line slipped into an old month later would no longer add up, so the database refuses it.
    const late = await change([lineOf("2026-03", hh, "2603-0099")]);
    expect(late?.code).toBe(CHECK_VIOLATION);
    expect(late?.message).toContain("must add up");
  });
});

describe.skipIf(!ADMIN_URL)("the name of a closed month", () => {
  const { q, change } = useDatabase();

  it("must be a real YYYY-MM, and a bad one is refused without closing anything", async () => {
    for (const month of ["2026-13", "2026-00", "26-06", "2026-6", "June 2026", "2026-06-01", ""]) {
      const failed = await change([[`insert into club.billing_runs (month, created_at, created_by_kind, created_by_label, invoice_count, total_cents) values ($1, now(), 'staff', 'Test staff', 0, 0)`, [month]]]);
      expect(failed?.message, month).toMatch(/billing_runs_month_check/);
    }
    expect(Number((await q(`select count(*) from club.billing_runs`)).rows[0].count)).toBe(0);
  });

  it("is closed by a staff member, and only staff", async () => {
    const failed = await change([[`insert into club.billing_runs (month, created_at, created_by_kind, created_by_label, invoice_count, total_cents) values ('2026-01', now(), 'member', 'Ada', 0, 0)`]]);
    expect(failed?.message).toMatch(/billing_runs_created_by_kind_check/);
    expect(await change([[`insert into club.billing_runs (month, created_at, created_by_kind, created_by_label, invoice_count, total_cents) values ('2026-01', now(), 'staff', 'Test staff', 0, 0)`]])).toBeNull();
  });
});
