import { expect, test, type Page } from "@playwright/test";
import { sampleMembership } from "../../src/lib/membership";
import { membershipSeedData, membershipSeedRows, oldShapeRows } from "../../src/lib/membership-seed.testkit";
import { toMembershipMonth, type MembershipRow } from "../../src/lib/supabase";
import { dashboardNav, openNavMenu } from "./helpers";

/** Serve invented membership counts from the membership endpoint, so no test touches the real database. */
async function mockMembership(page: Page) {
  const body = JSON.stringify(sampleMembership());
  await page.route("**/api/membership", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
}

test("the membership page shows the monthly table, the charts and the sample banner", async ({ page }) => {
  await mockMembership(page);
  await page.goto("/membership");
  await expect(page.getByRole("heading", { level: 1, name: "Membership." })).toBeVisible();
  await expect(page.locator(".sample-banner")).toContainText("Sample data. These are made-up numbers for testing, not the real club.");
  // The invented sample months add up cleanly, so the flags section says so.
  await expect(page.getByTestId("membership-flags")).toContainText("Every month adds up, and each month starts where the last one ended.");
  // Monthly table: header plus one row per invented month.
  await expect(page.getByTestId("membership-table").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByTestId("membership-table")).toContainText("Mar 2024");
  await expect(page.getByTestId("membership-table")).toContainText("403");
  // Both charts, with their table views carrying the same figures.
  await expect(page.getByRole("group", { name: "Paying members by month" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Resignations and applicants by month" })).toBeVisible();
  // Membership lives in the Board Materials menu, which is marked as the active section.
  await expect(dashboardNav(page).getByRole("button", { name: "Board Materials" })).toHaveAttribute("aria-current", "page");
  await expect((await openNavMenu(page, "Board Materials")).getByRole("menuitem", { name: "Membership" })).toHaveAttribute("aria-current", "page");
});

test("a membership source that fails shows a plain message and a way to try again", async ({ page }) => {
  await page.route("**/api/membership", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The membership figures could not be loaded." }) }),
  );
  await page.goto("/membership");
  await expect(page.locator(".status-error")).toContainText("The membership figures could not be loaded.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // The rest of the site is unaffected: the summary page still opens.
  await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Summary" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "How the club is doing." })).toBeVisible();
});

// ---- The extended data: Jul 2024 to Oct 2026, reasons for leaving, the category mix and the waitlist ----

/** Serve the 28-month seed from the membership endpoint, as it answers once Grant has run the extension and loaded the table. */
async function mockSeed(page: Page) {
  const body = JSON.stringify(membershipSeedData());
  await page.route("**/api/membership", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
}

const section = (page: Page, testId: string) => page.getByTestId(testId);

/** Opens a chart card's "View as table" and returns the table's rows as lists of cell text. */
async function tableOf(card: ReturnType<Page["locator"]>) {
  await card.getByRole("button", { name: "View as table" }).click();
  const rows = card.getByRole("table").locator("tbody tr");
  return rows.evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim())));
}

const HEADINGS = [
  "Each club year",
  "Paying members over time",
  "Leavers and applicants each month",
  "Why members leave",
  "Membership mix",
  "Waitlist over time",
  "Month by month",
  "Figures that don't add up",
];

test.describe("the membership page with the 28-month data", () => {
  test.beforeEach(async ({ page }) => {
    await mockSeed(page);
    await page.goto("/membership");
    await expect(page.getByRole("heading", { level: 1, name: "Membership." })).toBeVisible();
  });

  test("runs from Jul 2024 to Oct 2026 and keeps the sections in the order the brief gives", async ({ page }) => {
    await expect(page.locator(".sample-banner")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(HEADINGS);
    const rows = page.getByTestId("membership-table").locator("tbody tr");
    await expect(rows).toHaveCount(28);
    await expect(rows.first()).toContainText("Jul 2024");
    await expect(rows.last()).toContainText("Oct 2026");
    // Three club years now, the first of them whole.
    await expect(page.locator('[data-testid^="period-"]')).toHaveCount(3);
    await expect(page.locator('[data-testid^="period-"]').first()).toContainText("2024–25: 497 → 503 paying members");
    // The headline is the dues-paying figure, not the all-categories total.
    await expect(page.getByLabel("Headline")).toContainText("506");
    await expect(page.getByLabel("Headline")).not.toContainText("516");
  });

  test("Why members leave: a summary of the last 12 months, Jun 2025 as a gap, and the notes that belong to it", async ({ page }) => {
    const reasons = section(page, "reasons-section");
    await expect(reasons.getByRole("heading", { level: 2, name: "Why members leave" })).toBeVisible();
    await expect(reasons.getByRole("group", { name: "Reasons members left, by month" })).toBeVisible();
    await expect(reasons.getByLabel("Legend").getByRole("listitem")).toHaveText(["Moved", "Not using it / too busy", "Other / unknown"]);
    await expect(reasons.getByTestId("reasons-summary")).toContainText("Last 12 months (Nov ’25 to Oct ’26): 16 moved, 31 not using it, 24 other.");
    // The reasons are not forced to balance: the summary says what the monthly sheets record beside them.
    await expect(reasons.getByTestId("reasons-summary")).toContainText("The reasons add up to 71; the monthly sheets record 71 resignations in the same months.");
    await expect(reasons.getByTestId("reasons-gaps")).toContainText("No reason split for Jun 2025: shown as a gap, not as zero.");
    // Notes sit next to the chart: the ones that talk about reasons or resignations, with Jun 2025's explanation.
    const notes = reasons.getByTestId("reasons-notes").getByRole("listitem");
    await expect(notes).toHaveCount(7);
    await expect(notes.first()).toHaveText("Oct 2024: Resignation-reason split (Berg workbook) covers 7 of the 8 resignations on the monthly sheet.");
    await expect(reasons.getByTestId("reasons-notes")).toContainText("Jun 2025: Not in the Berg workbook");
    await expect(reasons.getByTestId("reasons-notes")).toContainText("Mar 2026: Resignation-reason split in the Berg workbook sums to 7; the monthly sheet records 6 resignations.");
  });

  test("Why members leave: Jun 2025 shows dashes in the table, never zeroes, and a month that is one over is shown as stored", async ({ page }) => {
    const card = section(page, "reasons-section").locator("section.card");
    const rows = await tableOf(card);
    expect(rows).toHaveLength(28);
    expect(rows.find((r) => r[0] === "Jun 2025")).toEqual(["Jun 2025", "—", "—", "—", "3"]);
    // Mar 2026: 0 + 4 + 3 = 7 while the sheet says 6. Both numbers are shown as stored.
    expect(rows.find((r) => r[0] === "Mar 2026")).toEqual(["Mar 2026", "0", "4", "3", "6"]);
    expect(rows.find((r) => r[0] === "Jul 2024")).toEqual(["Jul 2024", "3", "2", "0", "5"]);
    // Dashes are only in the gap month.
    expect(rows.filter((r) => r.includes("—")).map((r) => r[0])).toEqual(["Jun 2025"]);
    await expect(card.getByRole("table").getByRole("columnheader")).toHaveText([
      "Month",
      "Moved",
      "Not using it / too busy",
      "Other / unknown",
      "Resignations on the monthly sheet",
    ]);
  });

  test("Why members leave: the Jun 2025 column draws nothing and says so, and another month names both totals", async ({ page }) => {
    const chart = section(page, "reasons-section").getByRole("group", { name: "Reasons members left, by month" });
    const jun = chart.getByRole("img", { name: "No reason split, Jun 2025, Not in the committee workbook" });
    await expect(jun).toHaveCount(1);
    await jun.focus();
    await expect(section(page, "reasons-section").locator(".chart-tip")).toContainText("No reason split");
    await expect(section(page, "reasons-section").locator(".chart-tip")).not.toContainText("0 moved");
    await chart.getByRole("img", { name: /^7 left, by reason, Mar 2026/ }).focus();
    await expect(section(page, "reasons-section").locator(".chart-tip")).toContainText("The monthly sheet shows 6 resignations");
    // One drawn part for every part of every month that has a count: 27 months have a split, and Jun 2025 has none.
    const parts = membershipSeedRows().flatMap((r) => [r.resignations_moved, r.resignations_not_using, r.resignations_other]).filter((n) => (n ?? 0) > 0).length;
    await expect(chart.locator("path[fill], rect[fill]:not(.col-hit)")).toHaveCount(parts);
  });

  test("Membership mix: five categories over time, with the all-categories total named and kept apart from the dues-paying total", async ({ page }) => {
    const mix = section(page, "mix-section");
    await expect(mix.getByRole("heading", { level: 2, name: "Membership mix" })).toBeVisible();
    await expect(mix.getByRole("group", { name: "Members by category, by month" })).toBeVisible();
    await expect(mix.getByLabel("Legend").getByRole("listitem")).toHaveText(["Resident", "Intermediate", "Non-Resident", "Suburban", "Honorary"]);
    await expect(mix).toContainText("All categories (incl. Suburban and Honorary)");
    await expect(mix).toContainText("Dues-paying");
    await expect(mix.getByTestId("mix-gaps")).toContainText("No category split for Jun 2025: shown as a gap, not as zero.");
    await expect(mix.getByTestId("mix-notes")).toContainText("Suburban count flagged as estimate in source");

    const rows = await tableOf(mix.locator("section.card"));
    await expect(mix.getByRole("table").getByRole("columnheader")).toHaveText([
      "Month",
      "Resident",
      "Intermediate",
      "Non-Resident",
      "Suburban",
      "Honorary",
      "All categories (incl. Suburban and Honorary)",
    ]);
    expect(rows.find((r) => r[0] === "Oct 2026")).toEqual(["Oct 2026", "437", "29", "39", "1", "10", "516"]);
    expect(rows.find((r) => r[0] === "Jun 2025")).toEqual(["Jun 2025", "—", "—", "—", "—", "—", "—"]);
    expect(rows.filter((r) => r.includes("—")).map((r) => r[0])).toEqual(["Jun 2025"]);
  });

  test("the two totals are never one series: each chart carries only its own", async ({ page }) => {
    const duesPaying = new Set(membershipSeedRows().map((r) => String(r.with_months_approvals)));
    const allCategories = new Set(membershipSeedRows().flatMap((r) => (r.total_all_categories === null ? [] : [String(r.total_all_categories)])));
    // No month's two totals are the same number, so a table holding both would show the overlap.
    expect([...duesPaying].filter((n) => allCategories.has(n))).toEqual([]);

    const paying = page.locator("section.card", { has: page.getByRole("heading", { level: 2, name: "Paying members over time" }) });
    const payingRows = await tableOf(paying);
    await expect(paying.getByRole("table").getByRole("columnheader")).toHaveText(["Month", "Dues-paying members"]);
    expect(payingRows).toHaveLength(28);
    expect(payingRows.every((r) => duesPaying.has(r[1]) && !allCategories.has(r[1]))).toBe(true);

    const mixRows = await tableOf(section(page, "mix-section").locator("section.card"));
    const mixTotals = mixRows.map((r) => r[6]).filter((c) => c !== "—");
    expect(mixTotals.every((c) => allCategories.has(c) && !duesPaying.has(c))).toBe(true);
    // The mix chart's own legend has five categories and no "Dues-paying" series.
    await section(page, "mix-section").getByRole("button", { name: "View as chart" }).click();
    await expect(section(page, "mix-section").getByLabel("Legend")).not.toContainText("Dues-paying");
    // The chart cards that show the dues-paying total say so, and none of them is named as the all-categories total.
    await expect(page.getByTestId("membership-table")).toContainText("Dues-paying, with approvals");
    await expect(page.getByTestId("membership-table")).not.toContainText("All categories");
  });

  test("the waitlist runs from Jul 2024 with no gap, and the flagged estimates have their notes beside the chart", async ({ page }) => {
    const waitlist = section(page, "waitlist-section");
    await expect(waitlist.getByRole("heading", { level: 2, name: "Waitlist over time" })).toBeVisible();
    await expect(waitlist.getByRole("group", { name: "Waitlist by month" })).toBeVisible();
    const notes = waitlist.getByTestId("waitlist-notes");
    await expect(notes).toContainText("Dec 2024: Waitlist 45 is a placeholder estimate in the Berg workbook; the club's Dec 2024 sheet shows no waitlist figure.");
    await expect(notes).toContainText("Jan 2025: Waitlist 44 is a placeholder estimate in the Berg workbook; the club's Jan 2025 sheet shows no waitlist figure.");
    await expect(notes).toContainText("Aug 2025: Waitlist 45 is a placeholder estimate");
    await expect(notes).toContainText("Feb 2026: Waitlist 33 is a placeholder estimate");

    const rows = await tableOf(waitlist.locator("section.card"));
    expect(rows).toHaveLength(28);
    expect(rows[0]).toEqual(["Jul 2024", "49"]);
    expect(rows[27]).toEqual(["Oct 2026", "16"]);
    // No month is missing a waitlist figure now.
    expect(rows.filter((r) => r[1] === "—")).toEqual([]);
    expect(rows.find((r) => r[0] === "Dec 2024")).toEqual(["Dec 2024", "45"]);
    expect(rows.find((r) => r[0] === "Jan 2025")).toEqual(["Jan 2025", "44"]);
    // The notes stay beside the table view too.
    await expect(notes).toBeVisible();
  });

  test("the table keeps the notes of every month that has one, and the flags list the sheets that do not add up", async ({ page }) => {
    const notes = page.getByTestId("membership-notes").getByRole("listitem");
    await expect(notes).toHaveCount(13);
    await expect(page.getByTestId("membership-flags")).toContainText("Aug 2024: 501 − 5 + 9 + 0 = 505, but the sheet shows 507.");
    await expect(page.getByTestId("membership-flags").getByRole("listitem")).toHaveCount(12);
  });

  test("month labels never overlap on a wide screen or a phone, and the last month is always labelled", async ({ page }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.getByRole("group", { name: "Waitlist by month" })).toBeVisible();
      for (const name of ["Paying members by month", "Resignations and applicants by month", "Reasons members left, by month", "Members by category, by month", "Waitlist by month"]) {
        const labels = page.getByRole("group", { name }).locator("text", { hasText: /^[A-Z][a-z]{2} ’\d\d$/ });
        const boxes = await labels.evaluateAll((els) =>
          els.map((el) => {
            const b = el.getBoundingClientRect();
            return { text: el.textContent ?? "", left: b.left, right: b.right };
          }),
        );
        expect(boxes.length, `${name} at ${width}px has labels`).toBeGreaterThan(2);
        expect(boxes.length, `${name} at ${width}px does not label all 28 months when they cannot fit`).toBeLessThanOrEqual(28);
        expect(boxes[boxes.length - 1].text, `${name} at ${width}px ends on the latest month`).toBe("Oct ’26");
        for (let i = 1; i < boxes.length; i++) {
          expect(boxes[i].left, `${name} at ${width}px: "${boxes[i - 1].text}" and "${boxes[i].text}" overlap`).toBeGreaterThanOrEqual(boxes[i - 1].right);
        }
      }
      // Nothing makes the page scroll sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});

test.describe("the membership page before Grant has run the extension", () => {
  /** The table as it was: only the original columns come back, so every new field is empty. */
  async function mockOldShape(page: Page) {
    const body = JSON.stringify({ source: "live", months: (oldShapeRows() as unknown as MembershipRow[]).map(toMembershipMonth) });
    await page.route("**/api/membership", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
  }

  test("says plainly that the reasons and categories are not loaded yet, draws no empty charts, and the rest still works", async ({ page }) => {
    await mockOldShape(page);
    await page.goto("/membership");
    await expect(page.getByRole("heading", { level: 1, name: "Membership." })).toBeVisible();
    await expect(page.getByTestId("reasons-none")).toContainText("The reasons members left have not been loaded yet. See db/membership_monthly.sql.");
    await expect(page.getByTestId("mix-none")).toContainText("The membership categories have not been loaded yet. See db/membership_monthly.sql.");
    await expect(page.getByRole("group", { name: "Reasons members left, by month" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Members by category, by month" })).toHaveCount(0);
    await expect(page.getByTestId("reasons-summary")).toHaveCount(0);
    // The existing charts, the waitlist and the table are unaffected.
    await expect(page.getByRole("group", { name: "Paying members by month" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Waitlist by month" })).toBeVisible();
    await expect(page.getByTestId("membership-table").locator("tbody tr")).toHaveCount(28);
  });
});

test.describe("the membership page with sample data", () => {
  test("shows one invented month with no split as a gap, with its sample note, and says it covers only 3 months", async ({ page }) => {
    await mockMembership(page);
    await page.goto("/membership");
    await expect(page.locator(".sample-banner")).toContainText("Sample data.");
    await expect(page.getByTestId("reasons-gaps")).toContainText("No reason split for Feb 2024: shown as a gap, not as zero.");
    await expect(page.getByTestId("mix-gaps")).toContainText("No category split for Feb 2024");
    await expect(page.getByTestId("reasons-notes")).toContainText("Sample note: no reason or category split for this made-up month.");
    await expect(page.getByTestId("reasons-summary")).toContainText("Last 3 months (Jan ’24 to Mar ’24): 2 moved, 2 not using it, 1 other.");
    await expect(page.getByTestId("reasons-summary")).toContainText("Counted over 2 of 3 months: the rest have no split.");
  });
});
