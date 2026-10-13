import { describe, expect, it } from "vitest";
import { toCell, toDoorMonth, toMember, toPeriod, toTotal } from "./supabase";

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
