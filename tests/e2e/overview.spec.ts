import { expect, test } from "@playwright/test";
import { mockDashboard } from "./helpers";

test.beforeEach(async ({ page }) => mockDashboard(page));

test("overview shows the headline and all five usage groups", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Member usage." })).toBeVisible();
  await expect(page.locator(".hero-number")).toHaveText("185");
  await expect(page.getByText("of 550 members visited less than once a month.")).toBeVisible();
  await expect(page.locator(".band-row")).toHaveCount(5);
  await expect(page.locator('.band-row[data-band="0 visits"]')).toContainText("63");
  await expect(page.getByRole("note")).toContainText("Sample data");
});

test("navigation moves between all three pages and marks the current one", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Dashboard sections" });
  await nav.getByRole("link", { name: "When people come" }).click();
  await expect(page).toHaveURL(/\/timing$/);
  await expect(nav.getByRole("link", { name: "When people come" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(/\/members$/);
  await nav.getByRole("link", { name: "Overview" }).click();
  await expect(page.locator(".hero-number")).toHaveText("185");
});

test("shows a plain error and recovers when the data fails to load", async ({ page }) => {
  let calls = 0;
  await page.unroute("**/api/dashboard");
  const { sampleData } = await import("../../src/lib/sample");
  await page.route("**/api/dashboard", (route) => {
    calls += 1;
    if (calls === 1) return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Could not reach the database." }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sampleData()) });
  });
  await page.goto("/");
  await expect(page.locator(".status-error")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".hero-number")).toHaveText("185");
});
