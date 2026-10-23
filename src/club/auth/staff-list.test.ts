import { describe, expect, it } from "vitest";
import { StaffListError, getStaffLogins, parseStaffLogins } from "./staff-list";

describe("the staff list setting", () => {
  it("is empty when nothing is set", () => {
    expect(parseStaffLogins(undefined)).toEqual([]);
    expect(parseStaffLogins("")).toEqual([]);
    expect(parseStaffLogins("  ;\n ; ")).toEqual([]);
  });

  it("reads entries separated by semicolons or new lines, lower-casing addresses and tidying names", () => {
    expect(parseStaffLogins("Alex.Staffer@Example.org = Alex   Staffer; sam@example.org=Sam Deskwell\n  jo@example.org=Jo")).toEqual([
      { email: "alex.staffer@example.org", name: "Alex Staffer" },
      { email: "sam@example.org", name: "Sam Deskwell" },
      { email: "jo@example.org", name: "Jo" },
    ]);
  });

  it("refuses mistakes in words instead of ignoring them", () => {
    expect(() => parseStaffLogins("alex@example.org")).toThrow('"alex@example.org" needs an equals sign');
    expect(() => parseStaffLogins("not-an-address=Alex")).toThrow('"not-an-address" is not an email address');
    expect(() => parseStaffLogins("alex@example.org=")).toThrow("alex@example.org needs a name");
    expect(() => parseStaffLogins("alex@example.org=  ")).toThrow("needs a name");
    expect(() => parseStaffLogins(`alex@example.org=${"x".repeat(81)}`)).toThrow("longer than 80 characters");
    expect(() => parseStaffLogins("alex@example.org=A=B")).toThrow("cannot contain an equals sign");
    expect(() => parseStaffLogins("alex@example.org=A; ALEX@example.org=B")).toThrow("alex@example.org is listed twice");
    expect(() => parseStaffLogins(Array.from({ length: 51 }, (_, i) => `p${i}@example.org=P${i}`).join(";"))).toThrow("the most it allows is 50");
    expect(() => parseStaffLogins("nope")).toThrow(StaffListError);
  });

  it("is read only where the member area exists", () => {
    const entry = "alex@example.org=Alex Staffer";
    expect(getStaffLogins({ NODE_ENV: "development", CLUB_STAFF_LOGINS: entry })).toEqual([{ email: "alex@example.org", name: "Alex Staffer" }]);
    expect(getStaffLogins({ NODE_ENV: "development" })).toEqual([]);
    expect(getStaffLogins({ NODE_ENV: "production", CLUB_STAFF_LOGINS: entry })).toEqual([]);
    expect(getStaffLogins({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1", VERCEL_ENV: "production", CLUB_STAFF_LOGINS: entry })).toEqual([]);
    expect(getStaffLogins({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1", CLUB_STAFF_LOGINS: entry })).toHaveLength(1);
  });
});
