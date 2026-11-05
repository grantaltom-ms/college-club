import { afterEach, describe, expect, it, vi } from "vitest";
import { isHouseholdName, loadLiveData, loadShells, toCell, toDoorMonth, toFinanceMonth, toMember, toMembershipMonth, toPeriod, toShellData, toTotal, type ShellRow } from "./supabase";

describe("database rows to dashboard data", () => {
  it("maps a members row, turning blanks into zeros and keeping dates", () => {
    const m = toMember({
      member_name: "Test Person",
      usage_band: "4+/month",
      visits_per_month: "4.07",
      visit_days: 36,
      door_entries: 41,
      icrew_booking_days_jul_sep: null,
      last_visit: "2026-09-26",
      own_brivo_fob: true,
      joined: null,
      icrew_member_type: "Resident",
      data_through: "2026-09-27",
      visit_days_2026_01: 0,
      visit_days_2026_02: null,
      visit_days_2026_03: 1,
      visit_days_2026_04: 0,
      visit_days_2026_05: 2,
      visit_days_2026_06: 4,
      visit_days_2026_07: 20,
      visit_days_2026_08: 5,
      visit_days_2026_09: 4,
    });
    expect(m.name).toBe("Test Person");
    expect(m.visitsPerMonth).toBeCloseTo(4.07);
    expect(m.bookingDays).toBe(0);
    expect(m.bookings).toBe(0);
    expect(m.earlyShare).toBeNull();
    expect(m.weekendShare).toBeNull();
    expect(m.household).toBe(false);
    expect(m.monthly).toEqual([0, 0, 1, 0, 2, 4, 20, 5, 4]);
    expect(m.lastVisit).toBe("2026-09-26");
  });

  it("falls back to 'No visits' for a band it does not know", () => {
    const m = toMember({ member_name: "X", usage_band: "???", visits_per_month: 0, visit_days: 0, door_entries: 0, icrew_booking_days_jul_sep: 0, last_visit: null, own_brivo_fob: false, joined: null, icrew_member_type: null, data_through: "2026-09-27", visit_days_2026_01: 0, visit_days_2026_02: 0, visit_days_2026_03: 0, visit_days_2026_04: 0, visit_days_2026_05: 0, visit_days_2026_06: 0, visit_days_2026_07: 0, visit_days_2026_08: 0, visit_days_2026_09: 0 });
    expect(m.band).toBe("0 visits");
  });

  it("maps a club totals row", () => {
    expect(toTotal({ measure: "door_by_hour", period_key: "5", all_entries: 2402, member_entries: 1918 })).toEqual({
      measure: "door_by_hour",
      key: "5",
      allEntries: 2402,
      memberEntries: 1918,
    });
  });

  it("maps the door pattern rows", () => {
    expect(toPeriod({ year: 2026, first_day: "2026-01-01", last_day: "2026-10-12" })).toEqual({
      year: 2026,
      firstDay: "2026-01-01",
      lastDay: "2026-10-12",
    });
    expect(toCell({ year: 2026, weekday: 1, hour: 5, all_entries: 435, member_entries: 404 })).toEqual({
      year: 2026,
      weekday: 1,
      hour: 5,
      allEntries: 435,
      memberEntries: 404,
    });
    expect(toDoorMonth({ year: 2025, month: 7, all_entries: 2590, member_entries: 2404, people: 325 })).toEqual({
      year: 2025,
      month: 7,
      allEntries: 2590,
      memberEntries: 2404,
      people: 325,
    });
  });
});

describe("multi-booking fields", () => {
  const base = {
    member_name: "Trevor & Tia Dyer",
    usage_band: "4+/month",
    visits_per_month: 5,
    visit_days: 40,
    door_entries: 40,
    icrew_booking_days_jul_sep: 10,
    icrew_bookings_jul_sep: 18,
    door_share_early_4to8am: "0.25",
    door_share_weekend: 0.1,
    last_visit: null,
    own_brivo_fob: true,
    joined: null,
    icrew_member_type: null,
    data_through: "2026-09-27",
    visit_days_2026_01: 0, visit_days_2026_02: 0, visit_days_2026_03: 0, visit_days_2026_04: 0, visit_days_2026_05: 0,
    visit_days_2026_06: 0, visit_days_2026_07: 0, visit_days_2026_08: 0, visit_days_2026_09: 0,
  };
  it("reads bookings, door shares and household flag", () => {
    const m = toMember(base);
    expect(m.bookings).toBe(18);
    expect(m.earlyShare).toBe(0.25);
    expect(m.weekendShare).toBe(0.1);
    expect(m.household).toBe(true);
  });
  it("spots shared account names only", () => {
    expect(isHouseholdName("Chris/Bridget Backschies")).toBe(true);
    expect(isHouseholdName("Eva and John Dougherty")).toBe(true);
    expect(isHouseholdName("Alexander Anderson")).toBe(false);
  });
  it("falls back to booking days when the bookings column is missing", () => {
    const { icrew_bookings_jul_sep, ...rest } = base;
    void icrew_bookings_jul_sep;
    expect(toMember(rest).bookings).toBe(10);
  });
});

describe("loading the live roster", () => {
  const cfg = { url: "https://example.supabase.co", key: "k" };
  const usageRow = (name: string) => ({
    member_name: name,
    usage_band: "4+/month",
    visits_per_month: 5,
    visit_days: 44,
    door_entries: 50,
    icrew_booking_days_jul_sep: 3,
    last_visit: "2026-09-01",
    own_brivo_fob: true,
    joined: null,
    icrew_member_type: "Int - 1",
    data_through: "2026-09-27",
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`visit_days_2026_0${i + 1}`, 4])),
  });
  const qbRow = (name: string, extra = {}) => ({
    qb_name: name,
    qb_member_type: "Non-Resident",
    qb_member_number: "12000",
    qb_created_on: "2021-06-14",
    link: "matched",
    usage_member_name: name,
    door_entries_if_door_only: null,
    roster_as_of: "2026-10-21",
    ...extra,
  });

  function serve(tables: Record<string, unknown[]>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const table = new URL(url).pathname.split("/").pop() as string;
        return new Response(JSON.stringify(tables[table] ?? []), { status: 200 });
      }),
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it("builds the member list from QuickBooks, taking type and visits from the right places", async () => {
    serve({ members: [usageRow("Ann Lee"), usageRow("Only OnICrew")], qb_members: [qbRow("Ann Lee")] });
    const data = await loadLiveData(cfg);
    expect(data.members).toHaveLength(1);
    expect(data.members[0]).toMatchObject({ name: "Ann Lee", memberType: "Non-Resident", visitDays: 44, qbCreatedOn: "2021-06-14" });
    expect(data.roster).toEqual({ source: "QuickBooks member list", asOf: "2026-10-21" });
  });

  it("fails rather than quietly showing the iCrew list when the QuickBooks list is empty", async () => {
    serve({ members: [usageRow("Ann Lee")], qb_members: [] });
    await expect(loadLiveData(cfg)).rejects.toThrow(/qb_members is empty/);
  });
});

describe("finance_monthly rows", () => {
  it("maps a row, keeping blanks as zeros and the source file and note", () => {
    expect(
      toFinanceMonth({
        year: 2024,
        month: 1,
        income: 50000,
        cogs: 2000,
        gross_profit: 48000,
        expenses: 40000,
        net_operating_income: 8000,
        other_income: 100,
        other_expenses: 2000,
        net_other_income: -1900,
        net_income: 6100,
        depreciation: 3000,
        labeled_ytd_income: 50000,
        labeled_ytd_net_income: 6100,
        source_file: "Sample Board Reporting Package.xlsx",
        note: "Sample note.",
      }),
    ).toEqual({
      year: 2024,
      month: 1,
      income: 50000,
      cogs: 2000,
      grossProfit: 48000,
      expenses: 40000,
      netOperatingIncome: 8000,
      otherIncome: 100,
      otherExpenses: 2000,
      netOtherIncome: -1900,
      netIncome: 6100,
      depreciation: 3000,
      labeledYtdIncome: 50000,
      labeledYtdNetIncome: 6100,
      sourceFile: "Sample Board Reporting Package.xlsx",
      note: "Sample note.",
    });
  });
});

describe("shell ownership load", () => {
  const cfg = { url: "https://example.supabase.co", key: "k" };
  const row = (day: string, boat: string, ownership: string, rower: string): ShellRow => ({
    boat,
    seats: 1,
    day,
    kind: "member",
    minutes: 60,
    start_time: "07:00:00",
    rower_key: rower,
    ownership,
  });
  const clubTable = [
    row("2025-06-01", "Heron", "club", "rower-2025"),
    row("2026-06-01", "Heron", "club", "rower-club-2026"),
    row("2026-07-01", "OnlyInClubTable", "club", "rower-only-club"),
  ];
  const allTable = [
    row("2025-08-01", "ShouldNotAppear", "member", "rower-invented-2025"),
    row("2026-06-01", "Heron", "club", "rower-club-2026"),
    row("2026-06-02", "Puffin", "member", "rower-member-2026"),
  ];

  function serve() {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const parsed = new URL(url);
        const table = parsed.pathname.split("/").pop() as string;
        let rows = table === "shell_outings" ? clubTable : table === "shell_outings_all" ? allTable : [];
        const day = parsed.searchParams.get("day");
        const ownership = parsed.searchParams.get("ownership");
        if (day?.startsWith("lt.")) rows = rows.filter((r) => r.day < day.slice(3));
        if (day?.startsWith("gte.")) rows = rows.filter((r) => r.day >= day.slice(4));
        if (ownership?.startsWith("eq.")) rows = rows.filter((r) => r.ownership === ownership.slice(3));
        if (ownership?.startsWith("in.")) {
          const list = ownership.slice(3).replace(/[()]/g, "").split(",");
          rows = rows.filter((r) => list.includes(r.ownership ?? ""));
        }
        return new Response(JSON.stringify(rows), { status: 200 });
      }),
    );
    return urls;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("club only reads shell_outings, including 2025 and 2026, and never the full table", async () => {
    const urls = serve();
    const data = await loadShells(cfg, "2026-11-04");
    expect(urls).toEqual(["https://example.supabase.co/rest/v1/shell_outings?select=*&order=day.asc,id.asc&limit=1000&offset=0"]);
    expect(data.ownership).toEqual(["club"]);
    expect(data.memberFrom).toBeUndefined();
    expect(data.outings.map((o) => `${o.day} ${o.boat}`)).toEqual(["2025-06-01 Heron", "2026-06-01 Heron", "2026-07-01 OnlyInClubTable"]);
    expect(JSON.stringify(data)).not.toMatch(/rower-/);
  });

  it("member reads 2026 rows from shell_outings_all and does not invent a 2025 member year", async () => {
    const urls = serve();
    const data = await loadShells(cfg, "2026-11-04", "member");
    expect(urls).toEqual([
      "https://example.supabase.co/rest/v1/shell_outings_all?select=*&order=day.asc,id.asc&limit=1000&offset=0&ownership=eq.member&day=gte.2026-01-01",
    ]);
    expect(data.ownership).toEqual(["member"]);
    expect(data.memberFrom).toBe("2026-01-01");
    expect(data.outings.map((o) => o.boat)).toEqual(["Puffin"]);
    expect(data.outings.every((o) => o.day >= "2026-01-01")).toBe(true);
    expect(JSON.stringify(data)).not.toContain("rower-member-2026");
    expect(JSON.stringify(data)).not.toContain("ShouldNotAppear");
  });

  it("club plus member keeps 2025 from the club table and 2026 from the full table, without double counting", async () => {
    const urls = serve();
    const data = await loadShells(cfg, "2026-11-04", ["club", "member"]);
    expect(urls).toEqual([
      "https://example.supabase.co/rest/v1/shell_outings?select=*&order=day.asc,id.asc&limit=1000&offset=0&day=lt.2026-01-01",
      "https://example.supabase.co/rest/v1/shell_outings_all?select=*&order=day.asc,id.asc&limit=1000&offset=0&ownership=in.(club,member)&day=gte.2026-01-01",
    ]);
    expect(data.outings.map((o) => `${o.day} ${o.boat}`)).toEqual(["2025-06-01 Heron", "2026-06-01 Heron", "2026-06-02 Puffin"]);
    expect(data.ownership).toEqual(["club", "member"]);
    expect(data.memberFrom).toBe("2026-01-01");
    expect(JSON.stringify(data)).not.toContain("OnlyInClubTable");
    expect(JSON.stringify(data)).not.toContain("ShouldNotAppear");
  });

  it("an unknown fleet falls back to the club series", async () => {
    const urls = serve();
    const data = await loadShells(cfg, "2026-11-04", "all");
    expect(urls[0]).toContain("/shell_outings?");
    expect(urls.some((url) => url.includes("shell_outings_all"))).toBe(false);
    expect(data.ownership).toEqual(["club"]);
    expect(toShellData([row("2026-03-02", "Puffin", "member", "secret")], "2026-11-04", ["member"]).outings).toEqual([
      { boat: "Puffin", seats: 1, day: "2026-03-02", team: false, minutes: 60, startHour: 7 },
    ]);
  });
});

describe("membership_monthly rows", () => {
  it("maps a row, keeping blank transferred and waitlist cells as null", () => {
    expect(
      toMembershipMonth({
        year: 2026,
        month: 5,
        previous_total: 501,
        resignations: 3,
        applicants_for_approval: 5,
        transferred: null,
        with_months_approvals: 502,
        waitlist: 20,
        note: "Total transferred cell blank in source.",
      }),
    ).toEqual({
      year: 2026,
      month: 5,
      previousTotal: 501,
      resignations: 3,
      applicants: 5,
      transferred: null,
      withApprovals: 502,
      waitlist: 20,
      note: "Total transferred cell blank in source.",
    });
  });
});
