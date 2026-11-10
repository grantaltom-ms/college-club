import { expect, test, type Page } from "@playwright/test";
import { COMMITTEES } from "../../src/lib/committees";
import { dashboardNav, mockAll, openNavMenu } from "./helpers";

// The committee pages (Nov 9): one page each for the Boathouse, Membership and Social committees, built from the dashboard's own
// sections, at their own addresses, with their own header and no link from the dashboard's menu.
test.beforeEach(async ({ page }) => mockAll(page));

const section = (page: Page, key: string) => page.getByTestId(`section-${key}`);

for (const c of COMMITTEES) {
  test(`${c.name}: its heading, its own sections first, then the shared ones, each with why it matters`, async ({ page }) => {
    const res = await page.goto(`/committees/${c.slug}`);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(`CCS ${c.name}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${c.name}.`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByText(c.covers)).toBeVisible();

    // The contents list and the sections are in the agreed order.
    const contents = page.getByRole("navigation", { name: "On this page" }).getByRole("link");
    await expect(contents).toHaveText(c.sections.map((s) => s.heading));
    await expect(page.locator(".committee-section-title")).toHaveText(c.sections.map((s) => s.heading));

    for (const s of c.sections) {
      const box = section(page, s.key);
      await expect(box.getByRole("heading", { level: 2, name: s.heading, exact: true })).toBeVisible();
      await expect(box.locator(".committee-kicker")).toHaveText(s.shared ? "Shared with another committee" : "Yours");
      await expect(box.locator(".committee-why")).toHaveText(`Why this matters to you: ${s.why}`);
      // The dashboard's section really loaded inside it: no loading line left and no error.
      await expect(box.getByRole("status").filter({ hasText: /^Loading/ })).toHaveCount(0);
      await expect(box.getByRole("alert")).toHaveCount(0);
    }
  });
}

test("each page shows the dashboard's own charts and figures", async ({ page }) => {
  await page.goto("/committees/boathouse");
  await expect(section(page, "shells").getByRole("group", { name: "Boat ownership" })).toBeVisible();
  await expect(section(page, "timing").getByRole("group", { name: "Door entries by month, 2025 and 2026" })).toBeVisible();

  await page.goto("/committees/membership");
  await expect(section(page, "summary").getByText(/\d/).first()).toBeVisible();
  await expect(section(page, "membership").getByRole("heading", { name: "Waitlist over time" })).toBeVisible();

  await page.goto("/committees/social");
  await expect(section(page, "events").getByRole("heading", { name: "Event scoreboard" })).toBeVisible();
});

test("a contents link jumps to its section", async ({ page }) => {
  await page.goto("/committees/social");
  await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "When people come" }).click();
  await expect(page).toHaveURL(/#timing$/);
  await expect(section(page, "timing").getByRole("heading", { level: 2, name: "When people come" })).toBeInViewport();
});

test("the committee pages have their own header, with no dashboard menu, and link to each other", async ({ page }) => {
  await page.goto("/committees/membership");
  await expect(dashboardNav(page)).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Committee pages" });
  await expect(nav.getByRole("link")).toHaveText(["Boathouse", "Membership", "Social"]);
  await expect(nav.getByRole("link", { name: "Membership" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Boathouse" })).not.toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Social" }).click();
  await expect(page).toHaveURL(/\/committees\/social$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Social Committee.");
  // Nothing on a committee page names Financials or Goals.
  await expect(page.getByRole("link", { name: /Financials|Goals/ })).toHaveCount(0);
});

test("the dashboard's menu does not link to the committee pages", async ({ page }) => {
  await page.goto("/");
  await expect(dashboardNav(page).locator('a[href*="/committees"]')).toHaveCount(0);
  for (const label of ["Usage", "Board Materials"] as const) {
    const menu = await openNavMenu(page, label);
    await expect(menu.getByRole("menuitem", { name: /Committee|Boathouse|Social/ })).toHaveCount(0);
  }
  await expect(page.locator('a[href*="/committees"]')).toHaveCount(0);
});

test("on a phone nothing scrolls sideways and the committee links are big enough to tap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const c of COMMITTEES) {
    await page.goto(`/committees/${c.slug}`);
    await expect(page.locator(".committee-section-title").last()).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, c.slug).toBeLessThanOrEqual(390);
    for (const link of await page.getByRole("navigation", { name: "Committee pages" }).getByRole("link").all()) {
      const box = await link.boundingBox();
      expect(box!.height, c.slug).toBeGreaterThanOrEqual(44);
    }
  }
});

test("an unknown committee is page not found", async ({ page }) => {
  const res = await page.goto("/committees/house");
  expect(res?.status()).toBe(404);
});
