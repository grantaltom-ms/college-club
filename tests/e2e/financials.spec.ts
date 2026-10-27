import { expect, test, type Page } from "@playwright/test";
import { sampleFinancials } from "../../src/lib/financials";

/** Serve invented finance figures from the financials endpoint, so no test touches the real database. */
async function mockFinancials(page: Page) {
  const body = JSON.stringify(sampleFinancials());
  await page.route("**/api/financials", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
}

test("the financials page shows the monthly table, the charts, the sample banner and the Ask panel", async ({ page }) => {
  await mockFinancials(page);
  await page.goto("/financials");
  await expect(page.getByRole("heading", { level: 1, name: "Financials." })).toBeVisible();
  await expect(page.locator(".sample-banner")).toContainText("Sample data. These are made-up numbers for testing, not the real club.");
  // Headline is the latest month in the invented sample: Mar 2024 lost money.
  await expect(page.locator(".hero-number")).toContainText("-$1,700.00");
  // The invented sample months add up cleanly, so the flags section says so.
  await expect(page.getByTestId("finance-flags")).toContainText("Every club year's monthly sheets add up to its labeled fiscal year-to-date figures.");
  // Monthly table: header plus one row per invented month.
  await expect(page.getByTestId("finance-table").locator("tbody tr")).toHaveCount(3);
  await expect(page.getByTestId("finance-table")).toContainText("Mar 2024");
  await expect(page.getByTestId("finance-table")).toContainText("$13,400.00");
  // Both charts, with their table views carrying the same figures.
  await expect(page.getByRole("group", { name: "Income and expenses by month" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Net income by month" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Financials" })).toHaveAttribute("aria-current", "page");
  // Ask the numbers, with no model: the default question names Feb 2024 and highlights its row.
  await expect(page.getByTestId("ask-answer")).toContainText("Feb 2024");
  await expect(page.getByTestId("ask-answer")).toContainText("$13,400.00");
  await expect(page.locator('[data-month="2024-2"]')).toHaveAttribute("data-highlighted", "true");
});

test("the Ask panel answers the loss-months question and the filters narrow the table", async ({ page }) => {
  await mockFinancials(page);
  await page.goto("/financials");
  await page.selectOption("#ask-question", "loss-months");
  await expect(page.getByTestId("ask-answer")).toContainText("Mar 2024");
  await expect(page.locator('[data-month="2024-3"]')).toHaveAttribute("data-highlighted", "true");
  // Narrowing the end month to Feb 2024 drops Mar 2024 from the table and moves the headline to Feb 2024.
  await page.selectOption("#finance-end", "2024-2");
  await expect(page.getByTestId("finance-table").locator("tbody tr")).toHaveCount(2);
  await expect(page.locator(".hero-number")).toContainText("$13,400.00");
});

test("a financials source that fails shows a plain message and a way to try again", async ({ page }) => {
  await page.route("**/api/financials", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The finance figures could not be loaded." }) }),
  );
  await page.goto("/financials");
  await expect(page.locator(".status-error")).toContainText("The finance figures could not be loaded.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // The rest of the site is unaffected: the summary page still opens.
  await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Summary" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "How the club is doing." })).toBeVisible();
});
