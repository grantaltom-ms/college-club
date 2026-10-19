import { expect, test } from "@playwright/test";

test("the email page leads with list size and the jump, then the comparisons", async ({ page }) => {
  await page.goto("/email");
  await expect(page.getByRole("heading", { level: 1, name: "Email." })).toBeVisible();
  await expect(page.getByTestId("email-reach")).toHaveText(/^[\d,]+$/);
  await expect(page.getByTestId("email-jump")).toContainText("The list jumped from");
  await expect(page.getByRole("group", { name: /^List size, last \d+ Watercoolers$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /(One-off emails get more clicks than the Watercooler|The Watercooler gets more clicks than one-off emails)/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Watercooler clicks: [\d.]+% in \d{4} Q\d/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Best five by click rate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Most recent twelve" })).toBeVisible();
  // The open-rate warning moved to the notes at the end; the flat charts and the lowest five are gone.
  await expect(page.getByRole("complementary", { name: "Limits of this data" })).toContainText("Open rates run too high");
  await expect(page.getByRole("group", { name: "Click rate by year", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Watercooler click rate by month of the year" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Lowest five by click rate" })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Loading" })).toHaveCount(0);
});

test("the quarter and list size views switch to tables and back repeatedly", async ({ page }) => {
  await page.goto("/email");
  const quarterCard = page.locator(".card", { hasText: "Only the weekly newsletter" });
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
