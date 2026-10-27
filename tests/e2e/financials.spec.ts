import { expect, test, type Page } from "@playwright/test";
import { sampleFinancials } from "../../src/lib/financials";
import { unlockFinancials } from "./helpers";

/** Serve invented finance figures from the financials endpoint, so no test touches the real database. */
async function mockFinancials(page: Page) {
  const body = JSON.stringify(sampleFinancials());
  await page.route("**/api/financials", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
}

test("the financials page shows the summary strip, one chart, the 5-column table, and the Ask panel", async ({ page }) => {
  await mockFinancials(page);
  await unlockFinancials(page);
  await expect(page.getByRole("heading", { level: 1, name: "Financials." })).toBeVisible();
  await expect(page.locator(".sample-banner")).toContainText("Sample data. These are made-up numbers for testing, not the real club.");
  // No giant hero any more: the summary strip carries the latest month instead.
  await expect(page.locator(".hero-number")).toHaveCount(0);
  await expect(page.getByTestId("summary-latest")).toContainText("Mar 2024");
  await expect(page.getByTestId("summary-latest")).toContainText("-$1,700.00");
  // The invented sample has no 12-month club year, so the full-year tile says so.
  await expect(page.getByTestId("summary-full-year")).toContainText("No 12-month club year");
  // Loss tile: Mar 2024 is the invented sample's only loss month.
  await expect(page.getByTestId("summary-losses")).toContainText("Mar 2024");
  // One chart, net income by default, with no "View as table" copy of the rows.
  await expect(page.getByRole("group", { name: "Net income by month" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View as table" })).toHaveCount(0);
  // The only filter is the club-year dropdown: no From/To, Metric, or View controls.
  await expect(page.locator("#finance-year")).toBeVisible();
  await expect(page.locator("#finance-end")).toHaveCount(0);
  await expect(page.locator("#finance-metric")).toHaveCount(0);
  await expect(page.locator("#finance-view")).toHaveCount(0);
  // Default table: 5 columns, one row per invented month plus one subtotal row.
  const table = page.getByTestId("finance-table");
  await expect(table.locator("thead th")).toHaveCount(5);
  await expect(table.locator("thead")).toContainText("Net margin");
  await expect(table.locator("thead")).not.toContainText("Cost of goods");
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await expect(table).toContainText("Mar 2024");
  await expect(table).toContainText("$13,400.00");
  // Subtotal row for the invented sample's club year: months and labeled figures agree.
  await expect(page.getByTestId("subtotal-2023–24")).toContainText("$300,000.00");
  await expect(page.getByTestId("subtotal-2023–24")).toContainText("$21,200.00");
  await expect(page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Financials" })).toHaveAttribute("aria-current", "page");
  // Ask the numbers, with no model: the default question names Feb 2024 and highlights its row.
  await expect(page.getByTestId("ask-answer")).toContainText("Feb 2024");
  await expect(page.getByTestId("ask-answer")).toContainText("$13,400.00");
  await expect(page.locator('[data-month="2024-2"]')).toHaveAttribute("data-highlighted", "true");
});

test("the full P&L toggle, chart switch, and club-year filter work", async ({ page }) => {
  await mockFinancials(page);
  await unlockFinancials(page);
  // Full P&L lines expand the same table to all 12 columns.
  await page.locator("#finance-full").check();
  const table = page.getByTestId("finance-table");
  await expect(table.locator("thead th")).toHaveCount(12);
  await expect(table.locator("thead")).toContainText("Cost of goods");
  await expect(table.locator("thead")).toContainText("Depreciation");
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await page.locator("#finance-full").uncheck();
  await expect(table.locator("thead th")).toHaveCount(5);
  // Chart switch swaps the single chart area to income vs expenses.
  await page.selectOption("#finance-chart", "incomeExpenses");
  await expect(page.getByRole("group", { name: "Income and expenses by month" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Net income by month" })).toHaveCount(0);
  // Club-year filter keeps the invented sample's one club year intact.
  await page.selectOption("#finance-year", "2023–24");
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await expect(table).toContainText("Mar 2024");
});

test("Ask highlights a month outside the filtered view with a note instead of silently highlighting nothing", async ({ page }) => {
  const sample = sampleFinancials();
  const extraMonth = {
    year: 2024,
    month: 7,
    income: 50000,
    cogs: 5000,
    grossProfit: 45000,
    expenses: 40000,
    netOperatingIncome: 5000,
    otherIncome: 0,
    otherExpenses: 0,
    netOtherIncome: 0,
    netIncome: 5000,
    depreciation: 8000,
    labeledYtdIncome: 50000,
    labeledYtdNetIncome: 5000,
    sourceFile: "Sample Board Reporting Package.xlsx",
    note: null,
  };
  const body = JSON.stringify({ source: "sample", months: [...sample.months, extraMonth] });
  await page.route("**/api/financials", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
  await unlockFinancials(page);
  await page.selectOption("#ask-question", "loss-months");
  await expect(page.getByTestId("ask-answer")).toContainText("Mar 2024");
  await expect(page.locator('[data-month="2024-3"]')).toHaveAttribute("data-highlighted", "true");
  // Narrowing to the other club year removes Mar 2024 from the table: the Ask
  // answer still names it, but the panel says the highlight is not on screen.
  await page.selectOption("#finance-year", "2024–25");
  await expect(page.getByTestId("finance-table").locator("tbody tr")).toHaveCount(2);
  await expect(page.getByTestId("finance-table")).toContainText("Jul 2024");
  await expect(page.getByTestId("ask-hidden-note")).toContainText("not in the current club-year view");
  await page.selectOption("#finance-year", "all");
  await expect(page.getByTestId("ask-hidden-note")).toHaveCount(0);
});

test("a financials source that fails shows a plain message and a way to try again", async ({ page }) => {
  await page.route("**/api/financials", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The finance figures could not be loaded." }) }),
  );
  await unlockFinancials(page);
  await expect(page.locator(".status-error")).toContainText("The finance figures could not be loaded.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // The rest of the site is unaffected: the summary page still opens.
  await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Summary" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "How the club is doing." })).toBeVisible();
});
