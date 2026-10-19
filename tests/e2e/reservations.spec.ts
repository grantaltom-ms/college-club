import { expect, test, type Page } from "@playwright/test";
import { sampleReservations } from "../../src/lib/reservations";

const sample = sampleReservations();
const grandTotal = sample.cells.reduce((s, c) => s + c[3], 0);
const typeTotal = (type: string) => sample.cells.filter((c) => c[2] === sample.types.indexOf(type)).reduce((s, c) => s + c[3], 0);
const fmt = (n: number) => n.toLocaleString("en-US");

/** Serve invented sample reservations from the endpoint, so no test touches the real database. */
async function mockReservations(page: Page) {
  const body = JSON.stringify(sample);
  await page.route("**/api/reservations", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
  return body;
}

const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const typeButton = (page: Page, type: string) => group(page, "Reservation types").getByRole("button", { name: type, exact: true });

test("the reservations page shows the headline, the type table and every breakdown", async ({ page }) => {
  await mockReservations(page);
  await page.goto("/reservations");
  await expect(page.getByRole("heading", { level: 1, name: "Reservations." })).toBeVisible();
  await expect(page.getByTestId("res-total")).toHaveText(fmt(grandTotal));
  await expect(page.getByTestId("res-summary").getByRole("row")).toHaveCount(sample.types.length + 1);
  await expect(group(page, "Reservations by type, by month")).toBeVisible();
  await expect(group(page, "Reservations by type, week by week")).toHaveCount(0);
  // By default the four busiest types keep their colors and the rest are added up as Other.
  const legend = page.locator(".card", { hasText: "Reservations peak in" }).getByRole("list", { name: "Legend" });
  await expect(legend.getByRole("listitem")).toHaveCount(5);
  await expect(legend.getByRole("listitem").last()).toHaveText("Other");
  await expect(group(page, "Reservation types")).toHaveCount(0);
  await expect(group(page, "Reservations by type, by day of the week")).toBeVisible();
  await expect(group(page, "Reservations by type, by start hour")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Reservations" })).toHaveAttribute("aria-current", "page");
});

test("choosing types changes the headline and the table, and All brings everything back, again and again", async ({ page }) => {
  await mockReservations(page);
  await page.goto("/reservations");
  const total = page.getByTestId("res-total");
  await page.getByRole("button", { name: "Pick types" }).click();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "None" }).click();
    await expect(page.getByText("Pick at least one type above to see it.")).toBeVisible();
    await typeButton(page, "Shell").click();
    await expect(total).toHaveText(fmt(typeTotal("Shell")));
    await expect(page.getByTestId("res-summary").getByRole("row")).toHaveCount(2);
    await typeButton(page, "Kayak").click();
    await expect(total).toHaveText(fmt(typeTotal("Shell") + typeTotal("Kayak")));
    await typeButton(page, "Shell").click(); // switch one off again
    await expect(total).toHaveText(fmt(typeTotal("Kayak")));
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(total).toHaveText(fmt(grandTotal));
  }
  await expect(typeButton(page, "Gym Space")).toHaveAttribute("aria-pressed", "true");
  // Going back to the default view shows every reservation again.
  await page.getByRole("button", { name: "None" }).click();
  await page.getByRole("button", { name: "Top 4 and other" }).click();
  await expect(total).toHaveText(fmt(grandTotal));
  await expect(group(page, "Reservation types")).toHaveCount(0);
});

test("hovering a month lists the types in it, and the mix view turns the axis into percents and back", async ({ page }) => {
  await mockReservations(page);
  await page.goto("/reservations");
  const months = group(page, "Reservations by type, by month");
  for (let i = 0; i < 2; i++) {
    await months.getByRole("img", { name: /Jul 2026/ }).hover();
    const tip = page.getByRole("status").filter({ hasText: "Other:" });
    await expect(tip).toContainText("Jul 2026");
    await page.getByRole("button", { name: /^Mix/ }).click();
    await expect(months).toContainText("100%");
    await page.getByRole("button", { name: "Number of reservations" }).click();
    await expect(months).not.toContainText("100%");
  }
});

test("each breakdown switches to a table that follows the chosen types, and back", async ({ page }) => {
  await mockReservations(page);
  await page.goto("/reservations");
  await page.getByRole("button", { name: "Pick types" }).click();
  await typeButton(page, "Kayak").click();
  await typeButton(page, "Events").click();
  const card = page.locator(".card", { hasText: "Totals over the whole period" });
  for (let i = 0; i < 3; i++) {
    await card.getByRole("button", { name: "View as table" }).click();
    await expect(card.getByRole("columnheader")).toHaveText(["Day", "Gym Space", "Dock Space", "Shell", "Room Space", "Paddle Board", "Work Space", "Fitness", "Total"]);
    await expect(card.getByRole("row")).toHaveCount(8);
    await card.getByRole("button", { name: "View as chart" }).click();
    await expect(card.getByRole("table")).toHaveCount(0);
  }
  const hours = page.locator(".card", { hasText: "By the hour a reservation starts" });
  await hours.getByRole("button", { name: "View as table" }).click();
  await expect(hours.getByRole("columnheader").first()).toHaveText("Start hour");
});

test("the default view's tables show the four busiest types and Other, again and again", async ({ page }) => {
  await mockReservations(page);
  await page.goto("/reservations");
  const card = page.locator(".card", { hasText: "Totals over the whole period" });
  for (let i = 0; i < 3; i++) {
    await card.getByRole("button", { name: "View as table" }).click();
    const headers = await card.getByRole("columnheader").allTextContents();
    expect(headers).toHaveLength(7); // Day, four types, Other, Total
    expect(headers.slice(-2)).toEqual(["Other", "Total"]);
    await card.getByRole("button", { name: "View as chart" }).click();
    await expect(card.getByRole("table")).toHaveCount(0);
  }
});

test("the page never receives names, and the phone layout does not scroll sideways", async ({ page }) => {
  const body = await mockReservations(page);
  expect(body).not.toMatch(/ReservedBy|Rower|rower/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reservations");
  await expect(page.getByTestId("res-total")).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test("shows a plain error and recovers when the reservation data fails to load", async ({ page }) => {
  let fail = true;
  const body = JSON.stringify(sample);
  await page.route("**/api/reservations", (route) =>
    fail
      ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The reservation figures could not be loaded." }) })
      : route.fulfill({ status: 200, contentType: "application/json", body }),
  );
  await page.goto("/reservations");
  await expect(page.locator(".status-error")).toContainText("The reservation figures could not be loaded.");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("res-total")).toBeVisible();
});
