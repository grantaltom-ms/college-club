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
  await expect(group(page, "Shell outings by month, 2025 and 2026")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^(Fewer|More) outings than 2025 in \d+ of \d+ finished months$/ })).toBeVisible();
  await expect(page.getByTestId("boat-changes")).toContainText("Biggest drops");
  await expect(page.getByRole("list", { name: "Outings by boat" })).toBeVisible();
  await expect(group(page, "Shell outings by start hour, 2026")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^\d+% of outings in 2026 started before 9 am$/ })).toBeVisible();
  // The monthly timeline and the weekday chart repeated other views and are gone.
  await expect(group(page, "Shell outings every month")).toHaveCount(0);
  await expect(group(page, "Shell outings by day of the week, 2026")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Shells" })).toHaveAttribute("aria-current", "page");
});

test("the boat list shows the busiest ten, and every boat on request, again and again", async ({ page }) => {
  await mockShells(page);
  await page.goto("/shells");
  const rows = page.getByRole("list", { name: "Outings by boat" }).getByRole("listitem");
  await expect(rows.first()).toBeVisible(); // wait for the data before counting
  await expect(rows.first().locator(".boat-change")).toHaveText(/^[+-]?\d+%$/);
  const total = (await import("../../src/lib/shells")).byBoat(sampleShells().outings, sampleShells().through).rows.length;
  const shown = Math.min(10, total);
  await expect(rows).toHaveCount(shown);
  if (total > 10) {
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: `Show all ${total} boats` }).click();
      await expect(rows).toHaveCount(total);
      await expect(page.getByRole("heading", { name: `All ${total} boats` })).toBeVisible();
      await page.getByRole("button", { name: "Show the top 10" }).click();
      await expect(rows).toHaveCount(10);
    }
  }
});

test("switching year changes the start-hour chart, and back again, many times", async ({ page }) => {
  await mockShells(page);
  await page.goto("/shells");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "2025", exact: true }).click();
    await expect(group(page, "Shell outings by start hour, 2025")).toBeVisible();
    await expect(page.getByRole("heading", { name: /of outings in 2025 started before 9 am$/ })).toBeVisible();
    await page.getByRole("button", { name: "2026", exact: true }).click();
    await expect(group(page, "Shell outings by start hour, 2026")).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "2026", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("hovering a month compares it with last year, split between member rows and camps", async ({ page }) => {
  await mockShells(page);
  await page.goto("/shells");
  for (let i = 0; i < 2; i++) {
    await group(page, "Shell outings by month, 2025 and 2026").getByRole("img", { name: /^Jul:/ }).hover();
    await expect(page.getByRole("status").filter({ hasText: "2025:" })).toContainText("camp/team");
    await expect(page.getByRole("status").filter({ hasText: "2025:" })).toContainText("2026:");
  }
});

test("each shell chart switches to a table and back repeatedly", async ({ page }) => {
  await mockShells(page);
  await page.goto("/shells");
  const card = page.locator(".card", { hasText: "side by side on one scale" });
  for (let i = 0; i < 4; i++) {
    await card.getByRole("button", { name: "View as table" }).click();
    await expect(card.getByRole("columnheader")).toHaveText(["Month", "2025", "2026", "Change, 2025 to 2026"]);
    await expect(card.getByRole("row")).toHaveCount(13);
    await card.getByRole("button", { name: "View as chart" }).click();
    await expect(card.getByRole("table")).toHaveCount(0);
  }
  const boats = page.locator(".card", { hasText: "busiest boats" });
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
