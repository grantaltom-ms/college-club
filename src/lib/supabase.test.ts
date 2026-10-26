import { afterEach, describe, expect, it, vi } from "vitest";
import { isHouseholdName, loadLiveData, toCell, toDoorMonth, toMember, toMembershipMonth, toPeriod, toTotal } from "./supabase";

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
