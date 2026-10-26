import { expect, test } from "@playwright/test";
import { sampleData } from "../../src/lib/sample";
import { quietByJoined, visitsByType } from "../../src/lib/stats";
import { mockDashboard } from "./helpers";

const sample = sampleData();
const types = visitsByType(sample.members);
const cohorts = quietByJoined(sample.members, sample.dataThrough);

test.beforeEach(async ({ page }) => mockDashboard(page));

test("the visits page shows the headline and all five usage groups", async ({ page }) => {
  await page.goto("/visits");
  await expect(page.getByRole("heading", { level: 1, name: "Member visits." })).toBeVisible();
  await expect(page.locator(".hero-number")).toHaveText("133");
  await expect(page.getByText("of 497 members visited less than once a month.")).toBeVisible();
  await expect(page.getByText(/11 new members haven.t started yet, so they are not in the 133\./)).toBeVisible();
  await expect(page.getByTestId("roster-note")).toHaveText("Roster: QuickBooks member list, Oct 21, 2026.");
  // Five usage groups, then the members who have not started yet on their own row.
  await expect(page.locator(".band-row")).toHaveCount(6);
  await expect(page.locator('.band-row[data-band="0 visits"]')).toContainText("31");
  await expect(page.locator('.band-row[data-band="Not started yet"]')).toContainText("11 2%");
  await expect(page.getByRole("heading", { name: /^198 regulars make \d+% of all member door entries$/ })).toBeVisible();
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
  await expect(page.locator(".hero-number")).toHaveText("133");
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
    const nav = page.getByRole("navigation", { name: "Dashboard sections" });
    await nav.getByRole("button", { name: "Usage" }).click();
    await nav.getByRole("menuitem", { name: "Timing" }).click();
    await nav.getByRole("button", { name: "Usage" }).click();
    await nav.getByRole("menuitem", { name: "Visits" }).click();
    await expect(page.getByTestId("multi-share")).toHaveText(first);
  }
});

test("the membership-type chart shows a bar for each type with its under-once-a-month share, and switches to a table and back repeatedly", async ({ page }) => {
  await page.goto("/visits");
  const card = page.getByRole("region", { name: /^Under once a month: Resident \d+%, Intermediate \d+%, Non-Resident \d+%$/ });
  await expect(card).toBeVisible();
  for (const t of types) {
    await expect(card.getByTestId(`stack-${t.type}`)).toContainText(`${t.quietShare}% under once a month`);
  }
  for (let i = 0; i < 4; i++) {
    await card.getByRole("button", { name: "View as table" }).click();
    const table = card.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(types.length + 1);
    for (const t of types) await expect(table.getByRole("row", { name: new RegExp(`^${t.type}`) })).toContainText(`${t.quietShare}%`);
    await expect(card.getByTestId("stack-Resident")).toHaveCount(0);
    await card.getByRole("button", { name: "View as chart" }).click();
    await expect(card.getByTestId("stack-Resident")).toBeVisible();
  }
});

test("hovering a bar names the type and its groups", async ({ page }) => {
  await page.goto("/visits");
  const card = page.getByRole("region", { name: /^Under once a month: Resident/ });
  for (let i = 0; i < 3; i++) {
    for (const t of types) {
      await card.getByTestId(`stack-${t.type}`).locator("rect.col-hit").hover();
      await expect(card.getByRole("status")).toContainText(`${t.type}: ${t.quietShare}% under once a month`);
    }
  }
});

test("the joined-when chart shows five groups with this year marked as partial, and switches to a table and back repeatedly", async ({ page }) => {
  await page.goto("/visits");
  const card = page.getByRole("region", { name: /are the quietest/ });
  await expect(card).toBeVisible();
  await expect(card.getByRole("group", { name: /by when they joined/ })).toBeVisible();
  await expect(card.getByText("2026 so far")).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await card.getByRole("button", { name: "View as table" }).click();
    const table = card.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(cohorts.length + 1);
    await expect(table.getByRole("row", { name: /^2026 so far/ })).toContainText(`${cohorts[4].quietShare}%`);
    await expect(table.getByRole("row", { name: /^Before Oct 2019/ })).toContainText(`${cohorts[0].quietShare}%`);
    await card.getByRole("button", { name: "View as chart" }).click();
    await expect(card.getByText("2026 so far")).toBeVisible();
  }
  await card.getByRole("img").last().hover();
  await expect(card.getByRole("status")).toContainText("The year is not over, so this is partial");
});

test("both new charts fit on a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/visits");
  await expect(page.getByTestId("stack-Resident")).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
