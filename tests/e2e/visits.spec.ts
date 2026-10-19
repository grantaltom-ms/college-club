import { expect, test } from "@playwright/test";
import { mockDashboard } from "./helpers";

test.beforeEach(async ({ page }) => mockDashboard(page));

test("the visits page shows the headline and all five usage groups", async ({ page }) => {
  await page.goto("/visits");
  await expect(page.getByRole("heading", { level: 1, name: "Member visits." })).toBeVisible();
  await expect(page.locator(".hero-number")).toHaveText("185");
  await expect(page.getByText("of 550 members visited less than once a month.")).toBeVisible();
  await expect(page.locator(".band-row")).toHaveCount(5);
  await expect(page.locator('.band-row[data-band="0 visits"]')).toContainText("63");
  await expect(page.getByRole("heading", { name: /^188 regulars make \d+% of all member door entries$/ })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Sample data");
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
  await page.goto("/visits");
  await expect(page.locator(".status-error")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".hero-number")).toHaveText("185");
});

test("the work-from-the-club card leads with the count and keeps its method one click away, across repeated visits", async ({ page }) => {
  await page.goto("/visits");
  const tile = page.getByTestId("multi-booking");
  await expect(tile.getByRole("heading", { name: /^\d+ members seem to use the club as a place to work$/ })).toBeVisible();
  const first = await page.getByTestId("multi-share").innerText();
  expect(first).toMatch(/^\d+%$/);
  const how = tile.getByText("The reservation export has no start times");
  await expect(how).toBeHidden();
  for (let i = 0; i < 3; i++) {
    await tile.getByText("How we tell").click();
    await expect(how).toBeVisible();
    await tile.getByText("How we tell").click();
    await expect(how).toBeHidden();
  }
  for (let i = 0; i < 4; i++) {
    await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Timing" }).click();
    await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Visits" }).click();
    await expect(page.getByTestId("multi-share")).toHaveText(first);
  }
});
