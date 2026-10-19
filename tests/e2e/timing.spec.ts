import { expect, test, type Page } from "@playwright/test";
import { mockDashboard } from "./helpers";

test.beforeEach(async ({ page }) => mockDashboard(page));

const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test("timing page shows the two charts, each titled with what it shows", async ({ page }) => {
  await page.goto("/timing");
  await expect(page.getByRole("heading", { level: 1, name: "When people come." })).toBeVisible();
  await expect(group(page, "Door entries by month, 2025 and 2026")).toBeVisible();
  await expect(group(page, "Average door entries by day of the week and hour")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Door entries are \d+% (higher|lower) than in 2025$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Busiest on \w+days at \d+ (am|pm); weekends are about \d+% quieter$/ })).toBeVisible();
  // The reservation charts moved to their own page, and the weekday and hour bars repeated the grid.
  await expect(group(page, "Reservations per day, recent")).toHaveCount(0);
  await expect(group(page, "Door entries by hour of the day")).toHaveCount(0);
  await expect(group(page, "Average door entries per day, by day of the week")).toHaveCount(0);
});

test("hovering the day-and-hour grid names the day, hour and average", async ({ page }) => {
  await page.goto("/timing");
  const heat = group(page, "Average door entries by day of the week and hour");
  await heat.getByRole("img", { name: /^Tuesday 5 am:/ }).hover();
  const tip = page.getByRole("status").filter({ hasText: "Tuesday, 5 am" });
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("over 40 days");
});

test("grid tooltips stay fully inside the chart, top rows included, across many hovers", async ({ page }) => {
  await page.goto("/timing");
  const heat = group(page, "Average door entries by day of the week and hour");
  for (const day of ["Monday", "Tuesday", "Saturday", "Sunday"]) {
    for (const hour of ["5 am", "6 am", "7 am"]) {
      await heat.getByRole("img", { name: new RegExp(`^${day} ${hour}:`) }).hover();
      const tip = page.getByRole("status").filter({ hasText: `${day}, ${hour}` });
      await expect(tip).toBeVisible();
      // Wait for the tip to settle (it is hidden while it measures where it fits).
      await expect(tip).toHaveCSS("visibility", "visible");
      // Measure both after hovering, since hovering can scroll the page.
      const frame = (await page.locator(".heat-scroll").first().boundingBox())!;
      const box = (await tip.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(frame.y);
      expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
    }
  }
});

test("switching year changes the grid, and back again, many times", async ({ page }) => {
  await page.goto("/timing");
  const card = page.locator(".card", { hasText: "Darker means busier" });
  const monday = async () => {
    await card.getByRole("button", { name: "View as table" }).click();
    const cells = await card.locator("tbody tr").first().locator("td").allTextContents();
    await card.getByRole("button", { name: "View as chart" }).click();
    return cells.join("|");
  };
  await page.getByRole("button", { name: "2025", exact: true }).click();
  const y2025 = await monday();
  await page.getByRole("button", { name: "2026", exact: true }).click();
  const y2026 = await monday();
  expect(y2025).not.toBe(y2026);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "2025", exact: true }).click();
    await expect(card).toContainText(", 2025.");
    expect(await monday()).toBe(y2025);
    await page.getByRole("button", { name: "2026", exact: true }).click();
    expect(await monday()).toBe(y2026);
  }
  await expect(page.getByRole("button", { name: "2026", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("the grid's table view can be opened and closed again and again", async ({ page }) => {
  await page.goto("/timing");
  const card = page.locator(".card", { hasText: "Darker means busier" });
  for (let i = 0; i < 6; i++) {
    await card.getByRole("button", { name: "View as table" }).click();
    await expect(card.getByRole("table")).toBeVisible();
    await expect(card.getByRole("row")).toHaveCount(8); // header + 7 days
    await expect(card.getByRole("columnheader").nth(1)).toHaveText("Average per day");
    await card.getByRole("button", { name: "View as chart" }).click();
    await expect(card.getByRole("table")).toHaveCount(0);
  }
});

test("the month table lists both years side by side with the change", async ({ page }) => {
  await page.goto("/timing");
  const card = page.locator(".card", { hasText: "Months not finished yet are left blank" });
  await card.getByRole("button", { name: "View as table" }).click();
  await expect(card.getByRole("columnheader")).toHaveText(["Month", "2025", "2026", "Change, 2025 to 2026"]);
  await expect(card.getByRole("row")).toHaveCount(13);
  await expect(card.getByRole("row", { name: /^Mar/ }).locator("td").last()).toHaveText(/^[+-]?\d+%$/);
  // October is not finished in 2026, so there is no fair change figure yet.
  await expect(card.getByRole("row", { name: /^Oct/ })).toContainText("so far");
  await expect(card.getByRole("row", { name: /^Oct/ }).locator("td").last()).toHaveText("—");
  await expect(card.getByRole("row", { name: /^Dec/ })).toContainText("—");
});

test("hovering each month compares both years, again and again", async ({ page }) => {
  await page.goto("/timing");
  const chart = group(page, "Door entries by month, 2025 and 2026");
  await expect(page.locator(".card", { hasText: "Months not finished yet are left blank" }).getByRole("list", { name: "Legend" })).toContainText(
    "2025",
  );
  for (let round = 0; round < 2; round++) {
    for (const month of ["Jan", "Mar", "Jul", "Sep"]) {
      await chart.getByRole("img", { name: new RegExp(`^${month}`) }).hover();
      const tip = page.getByRole("status").filter({ hasText: `2025:` });
      await expect(tip).toContainText(new RegExp(`^${month}: \\d+% (higher|lower) in 2026`));
      await expect(tip).toContainText("2026:");
    }
    await chart.getByRole("img", { name: /^Oct/ }).hover();
    await expect(page.getByRole("status").filter({ hasText: "2025:" })).toContainText("month not finished");
  }
});
