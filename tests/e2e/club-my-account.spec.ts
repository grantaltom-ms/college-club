import { expect, test, type Page } from "@playwright/test";

/**
 * My account (Grant, Nov 5, 2026): a member's own pages (My household, My bookings, My classes, My bill, My boats) are one dropdown in
 * the top bar, so the bar is less busy. On a phone the same links are listed under a "My account" label in the Menu panel. Staff, whose
 * bar is a desk and not an account, are unchanged. The sample club's Nora Abernathy owns a private boat (so she has My boats), Dev Rao
 * has none, and Kenji Tanaka is a coach (so he has Report an incident).
 */

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

const nav = (page: Page) => page.getByRole("navigation", { name: "Member area" });
const accountButton = (page: Page) => nav(page).getByRole("button", { name: "My account" });
const accountList = (page: Page) => page.locator("#club-account-menu");
const OWN_PAGES = ["My household", "My bookings", "My classes", "My bill"];

test.describe("My account, on a wide screen", () => {
  test.use({ viewport: { width: 1180, height: 800 } });

  test("the bar shows one My account button, not the five pages, and the pages open from it in order", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    await expect(accountButton(page)).toBeVisible();
    await expect(accountButton(page)).toHaveAttribute("aria-expanded", "false");
    for (const name of [...OWN_PAGES, "My boats"]) await expect(nav(page).getByRole("link", { name, exact: true })).toBeHidden();
    // The other links stay in the bar.
    for (const name of ["Book", "Classes", "Events"]) await expect(nav(page).getByRole("link", { name, exact: true })).toBeVisible();

    await accountButton(page).click();
    await expect(accountButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(accountList(page).getByRole("link")).toHaveText([...OWN_PAGES, "My boats"]);
    const hrefs = await accountList(page).getByRole("link").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    expect(hrefs).toEqual(["/club", "/club/my-bookings", "/club/my-classes", "/club/my-bill", "/club/my-boats"]);
  });

  test("a member with no private boat gets four pages, and a coach keeps Report an incident in the bar", async ({ page }) => {
    await actAs(page, "Dev Rao");
    await page.goto("/club");
    await accountButton(page).click();
    await expect(accountList(page).getByRole("link")).toHaveText(OWN_PAGES);
    await expect(accountList(page).getByRole("link", { name: "My boats" })).toHaveCount(0);

    await actAs(page, "Kenji Tanaka");
    await page.goto("/club");
    // The coach's tool is not one of the member's own pages: it is a link in the bar, with the dropdown closed.
    await expect(nav(page).getByRole("link", { name: "Report an incident", exact: true })).toBeVisible();
    await accountButton(page).click();
    await expect(accountList(page).getByRole("link", { name: "Report an incident" })).toHaveCount(0);
  });

  test("choosing a page goes there and closes the menu, and the button carries the line while you are on one of its pages", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await page.goto("/club/book");
    await expect(accountButton(page)).not.toHaveAttribute("data-active", "");
    await accountButton(page).click();
    await accountList(page).getByRole("link", { name: "My bookings", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My bookings" })).toBeVisible();
    await expect(accountList(page)).toBeHidden();
    await expect(accountButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(accountButton(page)).toHaveAttribute("data-active", "");
    // Choosing the page you are already on also closes it.
    await accountButton(page).click();
    await accountList(page).getByRole("link", { name: "My bookings", exact: true }).click();
    await expect(accountList(page)).toBeHidden();
  });

  test("Escape closes it and puts the focus back on the button; a click elsewhere closes it too", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    await accountButton(page).click();
    await expect(accountList(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(accountList(page)).toBeHidden();
    await expect(accountButton(page)).toBeFocused();

    await accountButton(page).click();
    await expect(accountList(page)).toBeVisible();
    await page.locator("main").click({ position: { x: 5, y: 300 } });
    await expect(accountList(page)).toBeHidden();

    // Pressing the button again while it is open closes it.
    await accountButton(page).click();
    await accountButton(page).click();
    await expect(accountList(page)).toBeHidden();
  });

  test("it can be used from the keyboard alone: Tab to the button, Enter opens, Tab goes through the pages, Tab away closes", async ({ page }) => {
    await actAs(page, "Dev Rao");
    await page.goto("/club");
    await accountButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(accountList(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(accountList(page).getByRole("link", { name: "My household", exact: true })).toBeFocused();
    for (let n = 0; n < 3; n++) await page.keyboard.press("Tab");
    await expect(accountList(page).getByRole("link", { name: "My bill", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(accountList(page)).toBeHidden();
  });

  test("the button and every page in the list are at least 44 pixels tall, the list is white and under the button, and nothing scrolls sideways", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    const button = (await accountButton(page).boundingBox())!;
    expect(button.height).toBeGreaterThanOrEqual(44);
    await accountButton(page).click();
    const panel = (await accountList(page).boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(button.y + button.height - 2);
    expect(Math.abs(panel.x - button.x)).toBeLessThan(2);
    for (const box of await accountList(page).getByRole("link").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    expect(await accountList(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("the bar is less busy: a member's bar shows only Book, Classes and Events across (and the test build's picker link)", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    const shown = await nav(page).locator("a").evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => el.textContent));
    // The five own pages are behind the button. (A coach would also have Practices and Report an incident; "Switch test member" is the
    // test build's picker and is not on the live site.)
    expect(shown).toEqual(["Book", "Classes", "Events", "Switch test member"]);
  });

  test("staff have no My account menu: their bar is unchanged", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    await expect(accountButton(page)).toHaveCount(0);
    for (const name of ["Households", "All bookings", "Staff office", "Equipment"]) await expect(nav(page).getByRole("link", { name, exact: true })).toBeVisible();
  });

  test("someone not signed in sees no My account menu", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/club/book");
    await expect(accountButton(page)).toHaveCount(0);
  });
});

test.describe("My account, on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the button is not shown; the Menu panel lists the same pages under a My account label", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    await expect(accountButton(page)).toBeHidden();
    await page.getByRole("button", { name: "Menu" }).click();
    const group = page.locator('.club-nav-group[data-group="me"]');
    await expect(group.locator(".club-nav-group-label")).toHaveText("My account");
    await expect(group.getByRole("link")).toHaveText([...OWN_PAGES, "My boats"]);
    for (const box of await group.getByRole("link").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    await group.getByRole("link", { name: "My bill", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My bill" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
