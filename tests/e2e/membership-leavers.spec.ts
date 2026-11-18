import { expect, test, type Page } from "@playwright/test";
import { sampleLeavers } from "../../src/lib/leavers";
import { membershipSeedData } from "../../src/lib/membership-seed.testkit";

/** The real 28-month counts and the invented resignation analysis, so no test touches the real database. */
async function mock(page: Page, leavers: { status: number; body: unknown } = { status: 200, body: sampleLeavers() }) {
  await page.route("**/api/membership", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(membershipSeedData()) }));
  await page.route("**/api/membership/leavers", (route) =>
    route.fulfill({ status: leavers.status, contentType: "application/json", body: JSON.stringify(leavers.body) }),
  );
}

const leavers = (page: Page) => page.getByTestId("leavers-section");

test("the resignation section sits after Why members leave and shows its insights, both charts and the comparison", async ({ page }) => {
  await mock(page);
  await page.goto("/membership");
  const section = leavers(page);
  await expect(section.getByRole("heading", { name: "Who resigns for not using it" })).toBeVisible();

  // It follows the reasons chart and comes before the membership mix.
  const order = await page.locator("[data-testid=reasons-section], [data-testid=leavers-section], [data-testid=mix-section]").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-testid")),
  );
  expect(order).toEqual(["reasons-section", "leavers-section", "mix-section"]);

  const data = sampleLeavers();
  await expect(section.getByTestId("leavers-insight-list").locator("li").first()).toHaveText(data.insights[0]);
  // The seed's monthly sheets have reason splits, so the season line shows.
  await expect(section.getByTestId("leavers-season")).toContainText("from October to March");
  await expect(section.locator(".sample-banner")).toBeVisible();

  await expect(section.getByRole("group", { name: "Average visit days in the months before resigning" })).toBeVisible();
  await expect(section.getByRole("group", { name: "Resignations by usage group" })).toBeVisible();
  const traits = section.getByTestId("leavers-traits");
  await expect(traits.locator("tbody tr")).toHaveCount(data.traits.length);
  await expect(traits).toContainText("Came only in summer (June to August)");
});

test("each chart's table carries the same figures, and switching back and forth keeps working", async ({ page }) => {
  await mock(page);
  await page.goto("/membership");
  const data = sampleLeavers();
  const card = leavers(page).locator("section.card", { hasText: "Resignations by how often members came" });
  for (let round = 0; round < 3; round++) {
    await card.getByRole("button", { name: "View as table" }).click();
    const rows = card.getByRole("table").locator("tbody tr");
    await expect(rows).toHaveCount(data.bands.length);
    await expect(rows.first()).toContainText(`${data.bands[0].rate}%`);
    await card.getByRole("button", { name: "View as chart" }).click();
    await expect(card.getByRole("group", { name: "Resignations by usage group" })).toBeVisible();
  }
  const before = leavers(page).locator("section.card", { hasText: "Visits in the months before resigning" });
  await before.getByRole("button", { name: "View as table" }).click();
  await expect(before.getByRole("table").locator("tbody tr")).toHaveCount(6);
  await expect(before.getByRole("table").locator("tbody tr").last()).toContainText("1 month before");
});

test("a small group is labelled as early hints; a big enough one is not", async ({ page }) => {
  const small = { ...sampleLeavers(), enough: false };
  await mock(page, { status: 200, body: small });
  await page.goto("/membership");
  await expect(leavers(page).getByTestId("leavers-caution")).toContainText("Read the comparisons as early hints");

  await page.unrouteAll();
  await mock(page, { status: 200, body: { ...sampleLeavers(), enough: true } });
  await page.reload();
  await expect(leavers(page).getByRole("heading", { name: "Who resigns for not using it" })).toBeVisible();
  await expect(leavers(page).getByTestId("leavers-caution")).toHaveCount(0);
});

test("a failed resignation source blanks only this section, and Try again recovers it", async ({ page }) => {
  let fail = true;
  await page.route("**/api/membership", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(membershipSeedData()) }));
  await page.route("**/api/membership/leavers", (route) =>
    fail
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "No named resignations are loaded yet." }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sampleLeavers()) }),
  );
  await page.goto("/membership");
  await expect(leavers(page).locator(".status-error")).toContainText("No named resignations are loaded yet.");
  // The rest of the page is unaffected.
  await expect(page.getByRole("group", { name: "Paying members by month" })).toBeVisible();
  await expect(page.getByTestId("mix-section")).toBeVisible();
  fail = false;
  await leavers(page).getByRole("button", { name: "Try again" }).click();
  await expect(leavers(page).getByRole("group", { name: "Resignations by usage group" })).toBeVisible();
});

test("on a phone the section fits without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto("/membership");
  await expect(leavers(page).getByRole("group", { name: "Resignations by usage group" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
