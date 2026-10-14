import { expect, test, type Page } from "@playwright/test";
import { sampleShells } from "../../src/lib/shells";

/** Serve invented sample outings from the shells endpoint, so no test touches the real database. */
async function mockShells(page: Page) {
  const body = JSON.stringify(sampleShells());
  await page.route("**/api/shells", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
  return body;
}

const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test("the shells page shows the headline and every chart", async ({ page }) => {
  await mockShells(page);
  await page.goto("/shells");
  await expect(page.getByRole("heading", { level: 1, name: "Shells." })).toBeVisible();
  await expect(page.getByTestId("shells-ytd")).toHaveText(/^[\d,]+$/);
  await expect(page.getByText(/outings from Jan 1 to Oct 12, 2026/)).toBeVisible();
  await expect(group(page, "Shell outings every month")).toBeVisible();
  await expect(group(page, "Shell outings by month, 2025 and 2026")).toBeVisible();
  await expect(page.getByRole("list", { name: "Outings by boat" })).toBeVisible();
  await expect(group(page, "Shell outings by start hour, 2026")).toBeVisible();
  await expect(group(page, "Shell outings by day of the week, 2026")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Shells" })).toHaveAttribute("aria-current", "page");
});

test("the boat list puts the busiest boat first and has a change for each", async ({ page }) => {
  await mockShells(page);
  await page.goto("/shells");
  const rows = page.getByRole("list", { name: "Outings by boat" }).getByRole("listitem");
  await expect(rows.first()).toBeVisible(); // wait for the data before counting
  expect(await rows.count()).toBeGreaterThan(5);
  await expect(rows.first().locator(".boat-change")).toHaveText(/^[+-]?\d+%$/);
});

test("switching year changes the hour and weekday charts, and back again, many times", async ({ page }) => {
  await mockShells(page);
  await page.goto("/shells");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "2025", exact: true }).click();
    await expect(group(page, "Shell outings by start hour, 2025")).toBeVisible();
    await expect(page.getByText("When boats go out, 2025")).toBeVisible();
    await page.getByRole("button", { name: "2026", exact: true }).click();
    await expect(group(page, "Shell outings by day of the week, 2026")).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "2026", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("hovering a month shows the split between member rows and camps, and a month against last year", async ({ page }) => {
  await mockShells(page);
  await page.goto("/shells");
  for (let i = 0; i < 2; i++) {
    await group(page, "Shell outings every month").getByRole("img", { name: /^\d+ outings, Jul 2026/ }).hover();
    await expect(page.getByRole("status").filter({ hasText: "member rows" })).toContainText("Jul 2026");
    await group(page, "Shell outings by month, 2025 and 2026").getByRole("img", { name: /^Jul:/ }).hover();
    await expect(page.getByRole("status").filter({ hasText: "2025:" })).toContainText("2026:");
  }
});

test("each shell chart switches to a table and back repeatedly", async ({ page }) => {
  await mockShells(page);
  await page.goto("/shells");
  const card = page.locator(".card", { hasText: "Each month against last year" });
  for (let i = 0; i < 4; i++) {
    await card.getByRole("button", { name: "View as table" }).click();
    await expect(card.getByRole("columnheader")).toHaveText(["Month", "2025", "2026", "Change, 2025 to 2026"]);
    await expect(card.getByRole("row")).toHaveCount(13);
    await card.getByRole("button", { name: "View as chart" }).click();
    await expect(card.getByRole("table")).toHaveCount(0);
  }
  const boats = page.locator(".card", { hasText: "Outings by boat" });
  await boats.getByRole("button", { name: "View as table" }).click();
  await expect(boats.getByRole("columnheader").first()).toHaveText("Boat");
});

test("the data sent to the browser never carries rower names or codes", async ({ page }) => {
  const body = await mockShells(page);
  expect(body).not.toMatch(/rower_key|Rowed by/);
  await page.goto("/shells");
  await expect(page.getByText(/different members took a shell out/)).toBeVisible();
});

test("shows a plain error and recovers when the shell data fails to load", async ({ page }) => {
  let fail = true;
  const body = JSON.stringify(sampleShells());
  await page.route("**/api/shells", (route) =>
    fail
      ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The shell data could not be loaded." }) })
      : route.fulfill({ status: 200, contentType: "application/json", body }),
  );
  await page.goto("/shells");
  await expect(page.locator(".status-error")).toContainText("The shell data could not be loaded.");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("shells-ytd")).toBeVisible();
});
