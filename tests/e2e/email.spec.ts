import { expect, test } from "@playwright/test";

test("the email page shows the year chart, the groups and the best and lowest emails", async ({ page }) => {
  await page.goto("/email");
  await expect(page.getByRole("heading", { level: 1, name: "Email." })).toBeVisible();
  await expect(page.getByRole("group", { name: "Click rate by year", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open rates run too high" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Weekly Watercooler against everything else" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Best five by click rate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Most recent twelve" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Loading" })).toHaveCount(0);
});

test("the year table opens and closes repeatedly", async ({ page }) => {
  await page.goto("/email");
  const card = page.locator(".card", { hasText: "Share of delivered emails" });
  for (let i = 0; i < 4; i++) {
    await card.getByRole("button", { name: "View as table" }).click();
    await expect(card.getByRole("columnheader").first()).toHaveText("Year");
    await card.getByRole("button", { name: "View as chart" }).click();
    await expect(card.getByRole("table")).toHaveCount(0);
  }
});

test("the Watercooler trend, season and list size views show and switch to tables", async ({ page }) => {
  await page.goto("/email");
  await expect(page.getByRole("group", { name: "Watercooler click rate by quarter" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Watercooler click rate by month of the year" })).toBeVisible();
  await expect(page.getByRole("group", { name: /^List size, last \d+ Watercoolers$/ })).toBeVisible();

  // The month chart always has twelve columns, one per month, in calendar order.
  const season = page.locator(".card", { hasText: "by month of the year" });
  await expect(season.locator(".col-hit")).toHaveCount(12);
  await season.locator(".col-hit").first().hover();
  await expect(season.getByRole("status")).toContainText("Jan");

  // Table and chart views can be switched repeatedly on the new cards without losing anything.
  const quarterCard = page.locator(".card", { hasText: "by quarter" });
  for (let i = 0; i < 3; i++) {
    await quarterCard.getByRole("button", { name: "View as table" }).click();
    await expect(quarterCard.getByRole("columnheader").first()).toHaveText("Quarter");
    await expect(quarterCard.getByRole("cell", { name: /Q[1-4]$/ }).first()).toBeVisible();
    await quarterCard.getByRole("button", { name: "View as chart" }).click();
    await expect(quarterCard.getByRole("table")).toHaveCount(0);
  }

  // The list size table shows the unsubscribe column so the August jump can be read without hovering.
  const listCard = page.locator(".card", { hasText: "List size, last" });
  await listCard.getByRole("button", { name: "View as table" }).click();
  await expect(listCard.getByRole("columnheader", { name: "Unsubscribed" })).toBeVisible();
  await expect(listCard.getByRole("row")).toHaveCount(31);
});

test("a plain message shows when Mailchimp is not connected, and recovers", async ({ page }) => {
  let fail = true;
  await page.route("**/api/email", (route) =>
    fail
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Mailchimp is not connected yet. Add MAILCHIMP_API_KEY in Vercel, then redeploy." }) })
      : route.continue(),
  );
  await page.goto("/email");
  await expect(page.locator(".status-error")).toContainText("Mailchimp is not connected yet");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Best five by click rate" })).toBeVisible();
});

test("navigation reaches the email page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation").getByRole("link", { name: "Email" }).click();
  await expect(page).toHaveURL(/\/email$/);
});
