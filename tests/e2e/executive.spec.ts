import { expect, test } from "@playwright/test";
import { rowingOutlook, usageOutlook, waitlistOutlook } from "../../src/lib/executive";
import { sampleMembership } from "../../src/lib/membership";
import { sampleData } from "../../src/lib/sample";
import { sampleShells } from "../../src/lib/shells";
import { fmtInt } from "../../src/lib/stats";
import { dashboardNav, mockAll } from "./helpers";

// The executive page (Nov 11): three things for club leadership to watch, with live dashboard figures behind them.
test.beforeEach(async ({ page }) => mockAll(page));

const IDS = ["waitlist", "direction", "building"];

test("shows the three priorities in order, each with its data, meaning, a question and a caution", async ({ page }) => {
  const res = await page.goto("/executive");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle("CCS: three things to watch");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Three things to watch.");
  await expect(page.locator(".exec-title")).toHaveText([
    "The waitlist that refills the club is almost gone.",
    "Members use the club for more than rowing, and rowing use is falling.",
    "The building plan has large bills coming and almost none of them has a price.",
  ]);
  for (const id of IDS) {
    const box = page.getByTestId(`priority-${id}`);
    await expect(box.getByRole("heading", { level: 3, name: "What the data says" })).toBeVisible();
    await expect(box.getByRole("heading", { level: 3, name: "What it means" })).toBeVisible();
    await expect(box.getByText(/^Question for the board:/)).toBeVisible();
    await expect(box.getByText(/^Read with care:/)).toBeVisible();
    await expect(box.getByText(/loading|could not be loaded/)).toHaveCount(0);
  }
  await expect(page.getByRole("heading", { name: "What all three are missing" })).toBeVisible();
  await expect(page.getByText("Sample data: these are invented figures")).toBeVisible();
});

test("its live figures are the dashboard's own, worked out the same way", async ({ page }) => {
  await page.goto("/executive");
  const w = waitlistOutlook(sampleMembership().months)!;
  const u = usageOutlook(sampleData().members);
  const shells = sampleShells();
  const r = rowingOutlook(shells.outings, shells.through);
  await expect(page.getByTestId("waitlist-now")).toHaveText(fmtInt(w.now.waitlist));
  await expect(page.getByTestId("resignations-12")).toHaveText(fmtInt(w.resignations12));
  await expect(page.getByTestId("rarely")).toHaveText(fmtInt(u.rarely));
  await expect(page.getByTestId("regulars")).toHaveText(fmtInt(u.regulars));
  if (r) await expect(page.getByTestId("rowing-now")).toHaveText(fmtInt(r.now));
});

test("the one-line list jumps to each priority", async ({ page }) => {
  await page.goto("/executive");
  const list = page.getByRole("list", { name: "The three in one line each" }).getByRole("link");
  await expect(list).toHaveCount(3);
  await list.nth(2).click();
  await expect(page).toHaveURL(/#building$/);
  await expect(page.getByTestId("priority-building")).toBeInViewport();
});

test("a figure that cannot load says so, and the rest of the page still reads", async ({ page }) => {
  await page.route("**/api/membership", (route) => route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"x"}' }));
  await page.goto("/executive");
  await expect(page.getByTestId("priority-waitlist").getByText("(this figure could not be loaded)").first()).toBeVisible();
  await expect(page.getByTestId("rarely")).toBeVisible();
  await expect(page.getByTestId("priority-building")).toBeVisible();
});

test("stands apart from the dashboard: no dashboard menu, and the dashboard does not link to it", async ({ page }) => {
  await page.goto("/executive");
  await expect(dashboardNav(page)).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator('a[href="/executive"]')).toHaveCount(0);
});

test("reads on a phone with nothing scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/executive");
  await expect(page.getByTestId("priority-waitlist")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
