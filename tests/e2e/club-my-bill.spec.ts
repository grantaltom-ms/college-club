import { expect, test, type Page } from "@playwright/test";

/**
 * My bill: a member sees their household's charges for the open month and any closed invoices. The test server's clock
 * stands still at 1 pm Pacific on Wednesday Oct 28, 2026. The invented Lindqvist household has bar, snack-bar and visitor
 * charges in October; every household also has monthly dues on the open bill. Read only — nothing on this screen changes
 * a charge. Hidden on the live site (club-hidden.spec.ts).
 */

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** October so far for the Lindqvist household on the frozen clock: dues, both adults' dinner tickets, bar, snack bar, visitors. */
const LINDQVIST_OCTOBER = "$385.25";

test.describe("My bill", () => {
  test("a member opens it from the menu and sees this month's running lines for their household only", async ({ page }) => {
    await actAs(page, "Erik Lindqvist");
    const menu = page.getByRole("navigation", { name: "Member area" });
    await expect(menu.getByRole("link", { name: "My bill", exact: true })).toBeVisible();
    await menu.getByRole("link", { name: "My bill", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My bill" })).toBeVisible();
    await expect(page.getByTestId("placeholder-note")).toContainText("Placeholder numbers");
    await expect(page.getByTestId("current-month-heading")).toHaveText("October 2026 · so far");
    await expect(page.getByTestId("open-bill-note")).toBeVisible();

    const lines = page.getByTestId("bill-line");
    await expect(lines.filter({ hasText: "October 2026 dues (Resident)" })).toBeVisible();
    await expect(lines.filter({ hasText: "Members' Dinner" })).toHaveCount(2);
    await expect(page.locator('[data-testid="bill-line"][data-kind="bar"]')).toContainText("$38.50");
    await expect(page.locator('[data-testid="bill-line"][data-kind="snack_bar"]')).toContainText("$7.25");
    await expect(page.locator('[data-testid="bill-line"][data-kind="visitor_fees"]')).toContainText("$50.00");
    // Someone else's September snack charge (Whitcombe) and Reed-style tabs never appear.
    await expect(page.getByTestId("bill-lines")).not.toContainText("Whitcombe");
    await expect(page.getByTestId("bill-lines")).not.toContainText("Someone else");
    // Dues $154.50 + dinner tickets $90+$45 + bar $38.50 + snack $7.25 + 5 visitors at $10 = $50 → $385.25
    await expect(page.getByTestId("bill-total")).toHaveText(LINDQVIST_OCTOBER);
  });

  test("partners in the same household see the same bill; another household's address is page not found", async ({ page, browser, baseURL }) => {
    await actAs(page, "Maren Lindqvist");
    await page.goto("/club/my-bill");
    await expect(page.getByTestId("bill-total")).toContainText(LINDQVIST_OCTOBER);
    await expect(page.getByTestId("current-month-heading")).toHaveText("October 2026 · so far");

    // A forged household id on a member session looks like a missing page.
    const stranger = await page.goto("/club/my-bill?household=00000000-0000-4000-8000-000000000099");
    expect(stranger?.status()).toBe(404);

    // A signed-out browser is asked to sign in, and never sees the lines.
    const guest = await browser.newContext({ baseURL });
    const guestPage = await guest.newPage();
    await guestPage.goto("/club/my-bill");
    await expect(guestPage.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await expect(guestPage.getByTestId("bill-lines")).toHaveCount(0);
    await guest.close();
  });

  test("staff without a household get a short explanation; from the desk they can open one household's bill", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/my-bill");
    await expect(page.getByRole("heading", { level: 1, name: "My bill" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Monthly billing" })).toBeVisible();
    await expect(page.getByTestId("bill-lines")).toHaveCount(0);

    await page.goto("/club");
    await page.getByTestId("household-row").filter({ hasText: "Lindqvist" }).getByRole("link").first().click();
    await expect(page.getByTestId("household-name")).toContainText("Lindqvist");
    await page.getByTestId("household-bill-link").click();
    await expect(page.getByRole("heading", { level: 1, name: "My bill" })).toBeVisible();
    await expect(page.getByTestId("bill-total")).toContainText(LINDQVIST_OCTOBER);
    await expect(page.getByRole("link", { name: "Back to the household" })).toBeVisible();
  });

  test("an earlier unbilled month opens as its own page with the same line kinds", async ({ page }) => {
    await actAs(page, "Erik Lindqvist");
    await page.goto("/club/my-bill");
    // Until staff close September, every resident household has at least September dues waiting.
    const awaiting = page.getByTestId("awaiting-bill");
    if ((await awaiting.count()) === 0) {
      // September was already closed on this shared test server (the staff billing suite does that).
      await expect(page.getByTestId("closed-bills").getByTestId("closed-bill").first()).toBeVisible();
      await page.getByTestId("closed-bill").filter({ hasText: "September 2026" }).getByRole("link").click();
      await expect(page.getByTestId("bill-month-heading")).toContainText("September 2026");
      await expect(page.getByTestId("closed-bill-meta")).toContainText("Invoice");
      await expect(page.getByTestId("bill-line").filter({ hasText: "dues" })).toBeVisible();
    } else {
      await expect(awaiting.filter({ hasText: "September 2026" })).toBeVisible();
      await awaiting.filter({ hasText: "September 2026" }).getByRole("link").click();
      await expect(page.getByTestId("bill-month-heading")).toHaveText("September 2026 · so far");
      await expect(page.getByTestId("awaiting-bill-note")).toBeVisible();
      await expect(page.getByTestId("bill-line").filter({ hasText: "September 2026 dues (Resident)" })).toBeVisible();
      await expect(page.getByTestId("bill-back")).toBeVisible();
      await page.getByTestId("bill-back").click();
      await expect(page.getByTestId("current-month-heading")).toBeVisible();
    }
  });

  test("a made-up month and a phone-sized screen", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    expect((await page.goto("/club/my-bill?month=2020-01"))?.status()).toBe(404);
    expect((await page.goto("/club/my-bill?month=not-a-month"))?.status()).toBe(404);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/club/my-bill");
    await expect(page.getByRole("heading", { level: 1, name: "My bill" })).toBeVisible();
    // data-kind, not the word "dues": Nora's household can also have an adjustment whose note says "Dues".
    await expect(page.locator('[data-testid="bill-line"][data-kind="dues"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
