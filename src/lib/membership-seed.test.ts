import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MEMBERSHIP_COLUMNS, MEMBERSHIP_CSV_PATH, MEMBERSHIP_SQL_PATH, membershipSeedHeader, membershipSeedRows } from "./membership-seed.testkit";

const sql = readFileSync(MEMBERSHIP_SQL_PATH, "utf8");
const csv = readFileSync(MEMBERSHIP_CSV_PATH, "utf8");

/** The text between "create table ... (" and its closing ");". */
function tableBody(): string {
  const start = sql.indexOf("create table if not exists public.membership_monthly");
  const open = sql.indexOf("(", start);
  const close = sql.indexOf("\n);", open);
  return sql.slice(open + 1, close);
}

/** The column names the create table statement defines, in order (constraints such as "unique (...)" are not columns). */
function tableColumns(): string[] {
  return tableBody()
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter((line) => line && !/^(unique|check|primary|constraint)\b/i.test(line))
    .map((line) => line.split(/\s+/)[0]);
}

describe("the seed file Grant loads (db/membership_monthly.csv)", () => {
  it("has the 18 columns of the extended table, in order", () => {
    expect(membershipSeedHeader()).toEqual([...MEMBERSHIP_COLUMNS]);
    expect(MEMBERSHIP_COLUMNS).toHaveLength(18);
  });

  it("holds 28 months, Jul 2024 to Oct 2026, each once, in order", () => {
    const rows = membershipSeedRows();
    expect(rows).toHaveLength(28);
    expect(rows.map((r) => `${r.year}-${r.month}`)).toEqual(
      Array.from({ length: 28 }, (_, i) => {
        const index = 2024 * 12 + 6 + i;
        return `${Math.floor(index / 12)}-${(index % 12) + 1}`;
      }),
    );
  });

  it("uses plain line endings, like the file it replaced, with a line for every month and a header", () => {
    expect(csv).not.toContain("\r");
    expect(csv.trimEnd().split("\n")).toHaveLength(29);
  });

  it("leaves a cell empty only where the source had no figure: the Jun 2025 split and the May 2026 transferred total", () => {
    const empty: string[] = [];
    for (const r of membershipSeedRows()) {
      for (const [key, value] of Object.entries(r)) if (value === null && key !== "note") empty.push(`${r.year}-${r.month} ${key}`);
    }
    expect(empty).toEqual([
      "2025-6 resignations_moved",
      "2025-6 resignations_not_using",
      "2025-6 resignations_other",
      "2025-6 cat_resident",
      "2025-6 cat_intermediate",
      "2025-6 cat_nonresident",
      "2025-6 cat_suburban",
      "2025-6 cat_honorary",
      "2025-6 total_all_categories",
      "2026-5 transferred",
    ]);
  });

  it("has a note on exactly the months the brief flags: estimates, splits that do not add up, and the Jun 2025 gap", () => {
    const noted = membershipSeedRows()
      .filter((r) => r.note !== null)
      .map((r) => `${r.year}-${r.month}`);
    expect(noted).toEqual(["2024-10", "2024-12", "2025-1", "2025-2", "2025-3", "2025-4", "2025-6", "2025-7", "2025-8", "2026-2", "2026-3", "2026-5", "2026-6"]);
  });

  it("holds the original four figures of the first and last month exactly as the workbooks show them", () => {
    const rows = membershipSeedRows();
    expect(rows[0]).toMatchObject({ previous_total: 497, resignations: 5, applicants_for_approval: 9, with_months_approvals: 501, waitlist: 49 });
    expect(rows[27]).toMatchObject({ previous_total: 506, resignations: 10, applicants_for_approval: 11, transferred: 1, with_months_approvals: 506, waitlist: 16 });
  });

  it("has no applications or sign-ups column, and nothing in it names a person", () => {
    expect(membershipSeedHeader().filter((c) => /sign.?up|signup|name|email/i.test(c))).toEqual([]);
    expect(csv).not.toMatch(/@/);
  });
});

describe("the table definition (db/membership_monthly.sql)", () => {
  it("defines exactly the seed file's 18 columns, plus its own id", () => {
    expect(tableColumns()).toEqual(["id", ...MEMBERSHIP_COLUMNS]);
  });

  it("keeps the original columns as they were and makes the nine new ones optional", () => {
    const body = tableBody();
    for (const column of ["previous_total", "resignations", "applicants_for_approval", "with_months_approvals"]) {
      expect(body).toMatch(new RegExp(`${column} integer not null`));
    }
    expect(body).toMatch(/transferred integer,/);
    expect(body).toMatch(/waitlist integer,/);
    for (const column of [
      "resignations_moved",
      "resignations_not_using",
      "resignations_other",
      "cat_resident",
      "cat_intermediate",
      "cat_nonresident",
      "cat_suburban",
      "cat_honorary",
      "total_all_categories",
    ]) {
      expect(body).toMatch(new RegExp(`${column} integer,`));
      // A table made before the extension gets the same column added to it.
      expect(sql).toMatch(new RegExp(`add column if not exists ${column} integer`));
    }
  });

  it("keeps a month unique and between 1 and 12, and has no applications or sign-ups column", () => {
    expect(tableBody()).toMatch(/unique \(year, month\)/);
    expect(tableBody()).toMatch(/check \(month between 1 and 12\)/);
    expect(tableColumns().filter((c) => /sign.?up|signup/i.test(c))).toEqual([]);
  });

  it("turns row level security on and defines no policy, so only the server's key can read it", () => {
    expect(sql).toMatch(/alter table public\.membership_monthly enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
  });

  it("says in its own words that the two totals are different counts and that a missing split is a gap", () => {
    expect(sql).toMatch(/dues-paying/i);
    expect(sql).toMatch(/all[-_ ]categories/i);
    expect(sql).toMatch(/gap/i);
    expect(sql).toMatch(/deliberately no applications or sign-ups column/i);
  });
});

describe("what is in the repo", () => {
  it("does not hold Grant's extension script: he runs that himself in Supabase, and the page copes until he has", () => {
    expect(existsSync(path.resolve(path.dirname(MEMBERSHIP_SQL_PATH), "membership_monthly_extension.sql"))).toBe(false);
  });
});
