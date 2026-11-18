import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openNavMenu } from "./helpers";

/** Every tile on the Email page starts folded (Grant, Nov 18). Opens them all, the way a reader clicks each bar. */
async function openAllFolds(page: Page) {
  const summaries = page.locator(".fold-summary");
  await expect(summaries.first()).toBeVisible();
  const n = await summaries.count();
  for (let i = 0; i < n; i++) {
    if (!(await page.locator("details.fold").nth(i).evaluate((d) => (d as HTMLDetailsElement).open))) await summaries.nth(i).click();
  }
}

test("the email page leads with list size and the jump, then the comparisons", async ({ page }) => {
  await page.goto("/email");
  await expect(page.getByRole("heading", { level: 1, name: "Email." })).toBeVisible();
  await openAllFolds(page);
  await expect(page.getByTestId("email-reach")).toHaveText(/^[\d,]+$/);
  await expect(page.getByTestId("email-jump")).toContainText("The list jumped from");
  await expect(page.getByRole("group", { name: /^List size, last \d+ Watercoolers$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /(One-off emails get more clicks than the Watercooler|The Watercooler gets more clicks than one-off emails)/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Watercooler clicks: [\d.]+% in \d{4} Q\d/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Best five by click rate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Most recent twelve" })).toBeVisible();
  // The open-rate warning moved to the notes at the end; the flat charts and the lowest five are gone.
  await expect(page.getByText("Dates are the Pacific day each email went out.")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Limits of this data" })).toContainText("Open rates run too high");
  await expect(page.getByRole("complementary", { name: "Limits of this data" })).toContainText("Tuesday at about 5:30 pm Pacific");
  await expect(page.getByRole("group", { name: "Click rate by year", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Watercooler click rate by month of the year" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Lowest five by click rate" })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Loading" })).toHaveCount(0);
});

test("the quarter and list size views switch to tables and back repeatedly", async ({ page }) => {
  await page.goto("/email");
  await openAllFolds(page);
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
  await expect(page.locator(".status-error", { hasText: "Mailchimp" })).toContainText("Mailchimp is not connected yet");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await openAllFolds(page);
  await expect(page.getByRole("heading", { name: "Best five by click rate" })).toBeVisible();
});

test("navigation reaches the email page", async ({ page }) => {
  await page.goto("/");
  await (await openNavMenu(page, "Board Materials")).getByRole("menuitem", { name: "Email" }).click();
  await expect(page).toHaveURL(/\/email$/);
});

test("the tiles start folded and open and close like dropdowns, again and again", async ({ page }) => {
  await page.goto("/email");
  const summaries = page.locator(".fold-summary");
  await expect(summaries).toHaveText([
    /^Latest Watercooler: [\d,]+ people$/,
    /^List size, last \d+ Watercoolers$/,
    "Weekly Watercooler against everything else",
    "Watercooler click rate by quarter",
    "Best five by click rate",
    "Most recent twelve",
    "Limits of this data",
  ]);
  await expect(page.getByTestId("email-reach")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Most recent twelve" })).toBeHidden();
  const best = page.locator("details.fold", { has: page.locator(".fold-summary", { hasText: "Best five by click rate" }) });
  for (let i = 0; i < 3; i++) {
    await best.locator(".fold-summary").click();
    await expect(best.locator(".fold-body")).toBeVisible();
    await expect(best.getByRole("table")).toBeVisible();
    await expect(page.getByTestId("email-reach")).toBeHidden();
    await best.locator(".fold-summary").click();
    await expect(best.locator(".fold-body")).toBeHidden();
  }
  // Keyboard works too: a summary is a button to a screen reader.
  await best.locator(".fold-summary").focus();
  await page.keyboard.press("Enter");
  await expect(best).toHaveAttribute("open", "");
});
