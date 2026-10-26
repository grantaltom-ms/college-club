import { expect, test, type Page } from "@playwright/test";
import { sampleMembership } from "../../src/lib/membership";

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
  await expect(page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Membership" })).toHaveAttribute("aria-current", "page");
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
