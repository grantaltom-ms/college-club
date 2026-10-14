import { expect, test, type Page } from "@playwright/test";
import { mockDashboard } from "./helpers";

test.beforeEach(async ({ page }) => mockDashboard(page));

const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test("timing page shows every chart and the weekend note", async ({ page }) => {
  await page.goto("/timing");
  await expect(page.getByRole("heading", { level: 1, name: "When people come." })).toBeVisible();
  await expect(group(page, "Average door entries per day, by day of the week")).toBeVisible();
  await expect(group(page, "Average door entries by day of the week and hour")).toBeVisible();
  await expect(group(page, "Door entries by hour of the day")).toBeVisible();
  await expect(group(page, "Door entries by month, 2025 and 2026")).toBeVisible();
  await expect(group(page, "Reservations per day, recent")).toBeVisible();
  await expect(group(page, "Reservations by month, 2025")).toBeVisible();
  await expect(group(page, "Reservations by month, 2026")).toBeVisible();
  await expect(group(page, "Average reservations per day, by day of the week")).toBeVisible();
  await expect(page.getByText("Reservations compared with last year")).toBeVisible();
  await expect(page.getByText("Weekends are the quiet days")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Compared with last year", exact: true })).toBeVisible();
});

test("hovering a weekday bar shows its tooltip", async ({ page }) => {
  await page.goto("/timing");
  const box = await group(page, "Average door entries per day, by day of the week").boundingBox();
  expect(box).not.toBeNull();
  // Sunday is the last of seven columns.
  await page.mouse.move(box!.x + box!.width - 30, box!.y + box!.height - 60);
  await expect(page.getByRole("status").filter({ hasText: "entries" }).first()).toBeVisible();
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

test("switching year changes the day counts, and back again, many times", async ({ page }) => {
  await page.goto("/timing");
  const card = page.locator(".card", { hasText: "Door entries on an average day" });
  const days = async () => {
    await card.getByRole("button", { name: "View as table" }).click();
    const cells = await card.locator("tbody tr").first().locator("td").allTextContents();
    await card.getByRole("button", { name: "View as chart" }).click();
    return cells[3]; // Monday's "days counted"
  };
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "2025", exact: true }).click();
    expect(await days()).toBe("52");
    await page.getByRole("button", { name: "2026", exact: true }).click();
    expect(await days()).toBe("41");
  }
  await expect(page.getByRole("button", { name: "2026", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("the table view can be opened and closed again and again", async ({ page }) => {
  await page.goto("/timing");
  const card = page.locator(".card", { hasText: "Door entries on an average day" });
  for (let i = 0; i < 6; i++) {
    await card.getByRole("button", { name: "View as table" }).click();
    await expect(card.getByRole("table")).toBeVisible();
    await expect(card.getByRole("row")).toHaveCount(8); // header + 7 days
    await card.getByRole("button", { name: "View as chart" }).click();
    await expect(card.getByRole("table")).toHaveCount(0);
    await expect(card.getByRole("group")).toBeVisible();
  }
});

test("the month table lists both years side by side with the change", async ({ page }) => {
  await page.goto("/timing");
  const card = page.locator(".card", { hasText: "side by side, on the same scale" });
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
  await expect(page.locator(".card", { hasText: "side by side, on the same scale" }).getByRole("list", { name: "Legend" })).toContainText(
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

test("reservation charts switch to tables and back repeatedly", async ({ page }) => {
  await page.goto("/timing");
  const card = page.locator(".card", { hasText: "All iCrew bookings" });
  for (let i = 0; i < 4; i++) {
    await card.getByRole("button", { name: "View as table" }).click();
    await expect(card.getByRole("columnheader")).toHaveText(["Month", "2025", "2026"]);
    await expect(card.getByRole("row")).toHaveCount(13);
    await card.getByRole("button", { name: "View as chart" }).click();
    await expect(card.getByRole("table")).toHaveCount(0);
  }
});
