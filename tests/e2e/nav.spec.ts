import { expect, test, type Page } from "@playwright/test";
import { dashboardNav as nav, mockAll, openNavMenu } from "./helpers";

const usageButton = (page: Page) => nav(page).getByRole("button", { name: "Usage" });
const usageMenu = (page: Page) => nav(page).getByRole("menu", { name: "Usage" });
const boardButton = (page: Page) => nav(page).getByRole("button", { name: "Board Materials" });
const boardMenu = (page: Page) => nav(page).getByRole("menu", { name: "Board Materials" });

// The menu bar is: CCS System (test builds only), Summary, the Usage menu, the Board Materials menu, Goals. The pages
// themselves and their URLs are unchanged, so each menu item must land on its old page.
test.describe("the dashboard menu bar", () => {
  test("is CCS System, Summary, Usage, Board Materials and Goals, in that order", async ({ page }) => {
    await page.goto("/");
    // CCS System is asked for when the page opens (test builds only), so wait for it to arrive.
    await expect(nav(page).getByRole("link")).toHaveText(["CCS System", "Summary", "Goals"]);
    await expect(nav(page).getByRole("button")).toHaveText(["Usage", "Board Materials"]);
    // Email, Membership, Financials and Shells are no longer top-level links.
    for (const gone of ["Shells", "Email", "Membership", "Financials", "Visits", "Timing", "Reservations"]) {
      await expect(nav(page).getByRole("link", { name: gone, exact: true })).toHaveCount(0);
    }
    for (const button of [usageButton(page), boardButton(page)]) {
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("aria-haspopup", "menu");
      await expect(button).toHaveAttribute("aria-expanded", "false");
    }
    await expect(usageMenu(page)).toHaveCount(0);
    await expect(boardMenu(page)).toHaveCount(0);
  });

  test("Usage holds Visits, Timing, Reservations and Shells, and Board Materials holds Email, Membership and Financials", async ({ page }) => {
    await page.goto("/");
    await usageButton(page).click();
    await expect(usageButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(usageMenu(page).getByRole("menuitem")).toHaveText(["Visits", "Timing", "Reservations", "Shells"]);
    // Opening the other menu closes this one: only one is ever open.
    await boardButton(page).click();
    await expect(usageMenu(page)).toHaveCount(0);
    await expect(boardButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(boardMenu(page).getByRole("menuitem")).toHaveText(["Email", "Membership", "Financials"]);
  });

  test("navigates to each Usage page and marks Usage active on each", async ({ page }) => {
    await mockAll(page);
    for (const [label, path, heading] of [
      ["Visits", "/visits", "Member visits."],
      ["Timing", "/timing", "When people come."],
      ["Reservations", "/reservations", "Reservations."],
      ["Shells", "/shells", "Shells."],
    ] as const) {
      await page.goto("/");
      await (await openNavMenu(page, "Usage")).getByRole("menuitem", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      // Choosing a link closes the menu, but Usage stays marked as the active section (and Board Materials does not).
      await expect(usageMenu(page)).toHaveCount(0);
      await expect(usageButton(page)).toHaveAttribute("aria-current", "page");
      await expect(boardButton(page)).not.toHaveAttribute("aria-current", "page");
      await usageButton(page).click();
      await expect(usageMenu(page).getByRole("menuitem", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });

  test("navigates to each Board Materials page and marks Board Materials active on each", async ({ page }) => {
    await mockAll(page);
    for (const [label, path, heading] of [
      ["Email", "/email", "Email."],
      ["Membership", "/membership", "Membership."],
      ["Financials", "/financials", "Financials."],
    ] as const) {
      await page.goto("/");
      await (await openNavMenu(page, "Board Materials")).getByRole("menuitem", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(boardMenu(page)).toHaveCount(0);
      await expect(boardButton(page)).toHaveAttribute("aria-current", "page");
      await expect(usageButton(page)).not.toHaveAttribute("aria-current", "page");
      await boardButton(page).click();
      await expect(boardMenu(page).getByRole("menuitem", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });

  test("each menu closes on Escape and on a click outside it", async ({ page }) => {
    await page.goto("/");
    for (const [button, menu] of [
      [usageButton(page), usageMenu(page)],
      [boardButton(page), boardMenu(page)],
    ] as const) {
      await button.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(button).toBeFocused();

      await button.click();
      await expect(menu).toBeVisible();
      // Click the heading near its left edge, not its centre: an open menu can sit over the middle of the heading,
      // so a centre click would hit the menu itself.
      await page.getByRole("heading", { level: 1 }).click({ position: { x: 10, y: 10 } });
      await expect(menu).toHaveCount(0);
    }
  });

  test("top-level links still work and neither menu is active on them", async ({ page }) => {
    await page.goto("/goals");
    await expect(usageButton(page)).not.toHaveAttribute("aria-current", "page");
    await expect(boardButton(page)).not.toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "Goals" })).toHaveAttribute("aria-current", "page");
    await nav(page).getByRole("link", { name: "Summary" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(nav(page).getByRole("link", { name: "Summary" })).toHaveAttribute("aria-current", "page");
  });

  test("the menu bar fits a phone without scrolling sideways, with both menus open in turn", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(nav(page).getByRole("link", { name: "CCS System" })).toBeVisible();
    for (const label of ["Usage", "Board Materials"] as const) {
      const menu = await openNavMenu(page, label);
      await expect(menu).toBeVisible();
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(fits, `${label} menu open at 390 px`).toBe(true);
    }
  });
});
