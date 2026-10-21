import { describe, expect, it } from "vitest";
import { bandFor, buildRoster, monthsObserved, type QbRow } from "./roster";
import type { Member } from "./types";

const THROUGH = "2026-09-27";

function usage(name: string, overrides: Partial<Member> = {}): Member {
  return {
    name,
    band: "1-2/month",
    visitsPerMonth: 1.5,
    visitDays: 13,
    doorEntries: 14,
    bookingDays: 2,
    bookings: 2,
    earlyShare: 0.2,
    weekendShare: 0.1,
    household: false,
    lastVisit: "2026-09-01",
    ownFob: true,
    joined: "2024-01-01",
    memberType: "Int - 1",
    qbCreatedOn: null,
    notStarted: false,
    monthly: [1, 1, 1, 1, 1, 2, 2, 2, 2],
    ...overrides,
  };
}

function qb(name: string, overrides: Partial<QbRow> = {}): QbRow {
  return {
    qb_name: name,
    qb_member_type: "Resident",
    qb_member_number: "1",
    qb_created_on: "2021-06-14",
    link: "matched",
    usage_member_name: name,
    door_entries_if_door_only: null,
    roster_as_of: "2026-10-21",
    ...overrides,
  };
}

const byName = (r: ReturnType<typeof buildRoster>, name: string) => r.members.find((m) => m.name === name) as Member;

describe("months observed", () => {
  it("runs from Jan 1 to the data end for an existing member", () => {
    expect(monthsObserved("2021-06-14", THROUGH)).toBeCloseTo(270 / 30.4375, 5);
    expect(monthsObserved("2019-10-18", THROUGH)).toBeCloseTo(270 / 30.4375, 5);
  });

  it("starts at the QuickBooks date for someone who joined this year", () => {
    // Jun 8 to Sep 27 is 112 days counting both ends.
    expect(monthsObserved("2026-06-08", THROUGH)).toBeCloseTo(112 / 30.4375, 5);
  });

  it("never goes below one day", () => {
    expect(monthsObserved("2026-12-01", THROUGH)).toBeCloseTo(1 / 30.4375, 5);
  });
});

describe("usage groups", () => {
  it("cuts at 1, 2 and 4 visits a month, and 0 visits is its own group", () => {
    expect(bandFor(0, 0)).toBe("0 visits");
    expect(bandFor(0.99, 8)).toBe("Under 1/month");
    expect(bandFor(1, 9)).toBe("1-2/month");
    expect(bandFor(1.99, 17)).toBe("1-2/month");
    expect(bandFor(2, 18)).toBe("2-4/month");
    expect(bandFor(3.99, 35)).toBe("2-4/month");
    expect(bandFor(4, 36)).toBe("4+/month");
  });
});

describe("the QuickBooks list is the roster", () => {
  it("makes one member per QuickBooks record, with the QuickBooks name, type and date", () => {
    const r = buildRoster([qb("Ann Lee", { qb_member_type: "Intermediate", qb_created_on: "2022-02-02" })], [usage("Ann Lee")], THROUGH);
    expect(r.members).toHaveLength(1);
    expect(r.members[0]).toMatchObject({
      name: "Ann Lee",
      memberType: "Intermediate",
      qbCreatedOn: "2022-02-02",
      band: "1-2/month",
      visitDays: 13,
      notStarted: false,
    });
    expect(r.asOf).toBe("2026-10-21");
  });

  it("leaves out people who are only in the usage data, such as the iCrew-only people", () => {
    const r = buildRoster([qb("Ann Lee")], [usage("Ann Lee"), usage("Only OnICrew", { band: "4+/month" })], THROUGH);
    expect(r.members.map((m) => m.name)).toEqual(["Ann Lee"]);
  });

  it("finds a name that differs only in capitals or spacing", () => {
    const r = buildRoster([qb("John Dunmore", { usage_member_name: "JOHN  DUNMORE" })], [usage("john dunmore")], THROUGH);
    expect(r.members[0].visitDays).toBe(13);
    expect(r.missing).toEqual([]);
  });
});

describe("a household uses one set of visits", () => {
  it("lets a household partner or a spelling fix take the linked record's visits", () => {
    const r = buildRoster(
      [
        qb("Gina Alder", { link: "household_partner", usage_member_name: "Tim Alder" }),
        qb("Malyak Birch", { link: "spelling", usage_member_name: "Malyka Birch" }),
      ],
      [usage("Tim Alder", { visitDays: 40, doorEntries: 44 }), usage("Malyka Birch", { visitDays: 5, doorEntries: 5 })],
      THROUGH,
    );
    expect(byName(r, "Gina Alder")).toMatchObject({ visitDays: 40, doorEntries: 44 });
    expect(byName(r, "Malyak Birch")).toMatchObject({ visitDays: 5, doorEntries: 5 });
  });

  it("never counts a usage record twice: the person who matches by name keeps it, the partner gets none", () => {
    const r = buildRoster(
      [
        // The partner is listed first on purpose.
        qb("Amy Cedar", { link: "household_partner", usage_member_name: "Amy Cedar" }),
        qb("Amy Cedar", { qb_member_number: "2", link: "matched" }),
      ],
      [usage("Amy Cedar", { visitDays: 20, doorEntries: 22 })],
      THROUGH,
    );
    const visits = r.members.map((m) => m.visitDays).sort((a, b) => a - b);
    expect(visits).toEqual([0, 20]);
    expect(r.members.reduce((s, m) => s + m.doorEntries, 0)).toBe(22);
  });

  it("totals the same door entries as the usage records it used", () => {
    const records = [usage("A", { doorEntries: 10 }), usage("B", { doorEntries: 7 }), usage("C", { doorEntries: 3 })];
    const r = buildRoster(
      [qb("A"), qb("B2", { link: "household_partner", usage_member_name: "B" }), qb("C")],
      records,
      THROUGH,
    );
    expect(r.members.reduce((s, m) => s + m.doorEntries, 0)).toBe(20);
  });
});

describe("door-only members", () => {
  it("use door entries as visit days, spread over the months since Jan 1", () => {
    const r = buildRoster(
      [qb("Door Only", { link: "door_only_no_icrew", usage_member_name: null, door_entries_if_door_only: 47 })],
      [],
      THROUGH,
    );
    const m = r.members[0];
    expect(m.visitDays).toBe(47);
    expect(m.doorEntries).toBe(47);
    expect(m.visitsPerMonth).toBeCloseTo(47 / (270 / 30.4375), 1);
    expect(m.band).toBe("4+/month");
    expect(m.ownFob).toBe(true);
    expect(m.bookingDays).toBe(0);
    expect(m.notStarted).toBe(false);
  });

  it("count only the months since joining when they joined this year", () => {
    const r = buildRoster(
      [qb("New Door", { link: "door_only_no_icrew", usage_member_name: null, door_entries_if_door_only: 4, qb_created_on: "2026-06-08" })],
      [],
      THROUGH,
    );
    expect(r.members[0].visitsPerMonth).toBeCloseTo(4 / (112 / 30.4375), 1);
    expect(r.members[0].band).toBe("1-2/month");
  });
});

describe("members with no record", () => {
  it("count as zero visits, and are not reported as a data problem", () => {
    const r = buildRoster([qb("Ghost", { link: "no_record", usage_member_name: null, qb_created_on: "2021-01-01" })], [], THROUGH);
    expect(r.members[0]).toMatchObject({ band: "0 visits", visitDays: 0, doorEntries: 0, ownFob: false, notStarted: false });
    expect(r.missing).toEqual([]);
  });

  it("reports a link that names a usage record the database does not have, and counts it as zero visits", () => {
    const r = buildRoster([qb("Lost Link", { usage_member_name: "Nobody Here" })], [usage("Someone Else")], THROUGH);
    expect(r.members[0].visitDays).toBe(0);
    expect(r.missing).toEqual(["Lost Link"]);
  });
});

describe("not started yet", () => {
  it("marks members created this year with no visits", () => {
    const r = buildRoster(
      [
        qb("Waitlist One", { link: "no_record", usage_member_name: null, qb_created_on: "2026-05-11" }),
        qb("Waitlist Two", { usage_member_name: "Waitlist Two", qb_created_on: "2026-04-10" }),
      ],
      [usage("Waitlist Two", { band: "0 visits", visitDays: 0, doorEntries: 0, bookingDays: 0, bookings: 0 })],
      THROUGH,
    );
    expect(r.members.every((m) => m.notStarted)).toBe(true);
  });

  it("does not mark an old member with no visits, a new member who has visited, or a door-only newcomer", () => {
    const r = buildRoster(
      [
        qb("Old Quiet", { link: "no_record", usage_member_name: null, qb_created_on: "2019-10-18" }),
        qb("New Active", { qb_created_on: "2026-03-01" }),
        qb("New Door", { link: "door_only_no_icrew", usage_member_name: null, door_entries_if_door_only: 6, qb_created_on: "2026-04-02" }),
      ],
      [usage("New Active")],
      THROUGH,
    );
    expect(r.members.map((m) => m.notStarted)).toEqual([false, false, false]);
  });
});

describe("the roster as a whole", () => {
  it("sorts by name and takes the latest list date", () => {
    const r = buildRoster(
      [qb("Zed", { roster_as_of: "2026-10-01" }), qb("Abe", { roster_as_of: "2026-10-21" })],
      [usage("Zed"), usage("Abe")],
      THROUGH,
    );
    expect(r.members.map((m) => m.name)).toEqual(["Abe", "Zed"]);
    expect(r.asOf).toBe("2026-10-21");
  });

  it("gives the same answer when run again and does not change the usage records it reads", () => {
    const records = [usage("A"), usage("B", { visitDays: 0, band: "0 visits" })];
    const before = JSON.stringify(records);
    const list = [qb("A"), qb("B", { qb_created_on: "2026-02-02" })];
    const first = buildRoster(list, records, THROUGH);
    for (let i = 0; i < 5; i++) expect(buildRoster(list, records, THROUGH)).toEqual(first);
    expect(JSON.stringify(records)).toBe(before);
  });
});
