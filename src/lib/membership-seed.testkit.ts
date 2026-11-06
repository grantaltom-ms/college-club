import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSeedCsv } from "./events-seed.testkit";
import type { MembershipRow } from "./supabase";
import { toMembershipMonth } from "./supabase";
import type { MembershipData } from "./types";

/** The seed files Grant loads into Supabase, read straight from the repo so a test can hold them to what he sent. */
export const MEMBERSHIP_CSV_PATH = path.resolve(__dirname, "..", "..", "db", "membership_monthly.csv");
export const MEMBERSHIP_SQL_PATH = path.resolve(__dirname, "..", "..", "db", "membership_monthly.sql");

/** The 18 columns of the seed file, in the order the file has them. */
export const MEMBERSHIP_COLUMNS = [
  "year",
  "month",
  "previous_total",
  "resignations",
  "applicants_for_approval",
  "transferred",
  "with_months_approvals",
  "waitlist",
  "resignations_moved",
  "resignations_not_using",
  "resignations_other",
  "cat_resident",
  "cat_intermediate",
  "cat_nonresident",
  "cat_suburban",
  "cat_honorary",
  "total_all_categories",
  "note",
] as const;

/** The seed header as it is in the file. */
export function membershipSeedHeader(): string[] {
  return parseSeedCsv(readFileSync(MEMBERSHIP_CSV_PATH, "utf8"))[0];
}

/** The seed rows as Supabase would return them: an empty cell is null, every column but the note is a number. */
export function membershipSeedRows(): MembershipRow[] {
  const [header, ...rows] = parseSeedCsv(readFileSync(MEMBERSHIP_CSV_PATH, "utf8"));
  return rows.map((cells) => {
    const row: Record<string, string | number | null> = {};
    header.forEach((name, i) => {
      const cell = cells[i] ?? "";
      row[name] = cell === "" ? null : name === "note" ? cell : Number(cell);
    });
    return row as unknown as MembershipRow;
  });
}

/** The seed as the membership endpoint answers when the table is loaded: live, oldest month first. */
export function membershipSeedData(): MembershipData {
  return { source: "live", months: membershipSeedRows().map(toMembershipMonth) };
}

/** The same months as the table looked before the extension: only the original columns, which is what an un-upgraded table returns. */
export function oldShapeRows(): Record<string, string | number | null>[] {
  const original = new Set(["year", "month", "previous_total", "resignations", "applicants_for_approval", "transferred", "with_months_approvals", "waitlist", "note"]);
  return membershipSeedRows().map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => original.has(key))));
}
