import { expect, test, type Page } from "@playwright/test";

const nav = (page: Page) => page.getByRole("navigation", { name: "Dashboard sections" });
const usageButton = (page: Page) => nav(page).getByRole("button", { name: "Usage" });
const usageMenu = (page: Page) => nav(page).getByRole("menu", { name: "Usage" });

// The Usage menu groups Visits, Timing and Reservations; the pages themselves
// and their URLs are unchanged, so each item must land on its old page.
test.describe("the Usage nav menu", () => {
  test("shows one Usage menu instead of three top-level links, in order", async ({ page }) => {
    await page.goto("/");
    await expect(nav(page).getByRole("link")).toHaveText(["Summary", "Shells", "Email", "Membership", "Financials", "Goals"]);
    const button = usageButton(page);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(usageMenu(page)).toHaveCount(0);
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(usageMenu(page).getByRole("menuitem")).toHaveText(["Visits", "Timing", "Reservations"]);
  });

  test("navigates to each Usage page and marks Usage active on each", async ({ page }) => {
    for (const [label, path, heading] of [
      ["Visits", "/visits", "Member visits."],
      ["Timing", "/timing", "When people come."],
      ["Reservations", "/reservations", "Reservations."],
    ] as const) {
      await page.goto("/");
      await usageButton(page).click();
      await usageMenu(page).getByRole("menuitem", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      // Choosing a link closes the menu, but Usage stays marked as the active section.
      await expect(usageMenu(page)).toHaveCount(0);
      await expect(usageButton(page)).toHaveAttribute("aria-current", "page");
      await usageButton(page).click();
      await expect(usageMenu(page).getByRole("menuitem", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });

  test("closes on Escape and on a click outside the menu", async ({ page }) => {
    await page.goto("/");
    await usageButton(page).click();
    await expect(usageMenu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(usageMenu(page)).toHaveCount(0);
    await expect(usageButton(page)).toBeFocused();

    await usageButton(page).click();
    await expect(usageMenu(page)).toBeVisible();
    // Click the heading near its left edge, not its centre: the wider nav
    // (with the Financials link) puts the open Usage menu over the centre
    // of the heading, so a centre click would hit the menu itself.
    await page.getByRole("heading", { level: 1 }).click({ position: { x: 10, y: 10 } });
    await expect(usageMenu(page)).toHaveCount(0);
  });

  test("top-level links still work and Usage is not active on them", async ({ page }) => {
    await page.goto("/shells");
    await expect(usageButton(page)).not.toHaveAttribute("aria-current", "page");
    await nav(page).getByRole("link", { name: "Summary" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(nav(page).getByRole("link", { name: "Summary" })).toHaveAttribute("aria-current", "page");
  });
});
