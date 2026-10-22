import { expect, test } from "@playwright/test";
import { sampleShells, changePct, yearToDate } from "../../src/lib/shells";
import { mockAll } from "./helpers";

const shells = sampleShells();
const ytd = yearToDate(shells.outings, shells.through);
const shellChange = changePct(ytd[ytd.length - 1].outings, ytd[ytd.length - 2].outings)!;

test("the summary leads with one sentence and six headline cards, each linking to its page", async ({ page }) => {
  await mockAll(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "How the club is doing." })).toBeVisible();
  await expect(page.getByTestId("story")).toContainText(`club shell outings are down ${Math.abs(shellChange)}%`);
  await expect(page.locator(".stat-card")).toHaveCount(6);
  await expect(page.getByTestId("card-quiet").locator(".stat-value")).toHaveText("133");
  await expect(page.getByTestId("card-quiet")).toContainText("of 497 members came in less than once a month this year (27%).");
  await expect(page.getByTestId("card-quiet-note")).toHaveText("11 new members haven't started yet (off the waitlist).");
  await expect(page.getByTestId("roster-note")).toHaveText("Roster: QuickBooks member list, Oct 21, 2026.");
  await expect(page.getByTestId("card-shells").locator(".stat-value")).toHaveText(`−${Math.abs(shellChange)}%`);
  await expect(page.getByTestId("card-door").locator(".stat-value")).toHaveText(/^[+−]\d+%$/);
  await expect(page.getByTestId("card-email")).toContainText("The list jumped from");
  await expect(page.locator(".stat-target").first()).toHaveText("Board target: not set yet");
  await expect(page.getByTestId("data-dates")).toContainText("Data through: member visits Sep 27, 2026");
  await expect(page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Summary" })).toHaveAttribute("aria-current", "page");
});

test("each card opens its page, and back again, repeatedly", async ({ page }) => {
  await mockAll(page);
  await page.goto("/");
  const cards: [string, RegExp][] = [
    ["card-quiet", /\/visits$/],
    ["card-shells", /\/shells$/],
    ["card-door", /\/timing$/],
    ["card-bookings", /\/reservations$/],
    ["card-email", /\/email$/],
  ];
  for (let round = 0; round < 2; round++) {
    for (const [id, url] of cards) {
      await page.getByTestId(id).getByRole("link").click();
      await expect(page).toHaveURL(url);
      await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Summary" }).click();
      await expect(page.locator(".stat-card")).toHaveCount(6);
    }
  }
});

test("a source that fails shows a plain message in its own card while the rest still show", async ({ page }) => {
  await mockAll(page);
  await page.unroute("**/api/shells");
  await page.route("**/api/shells", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The shell data could not be loaded." }) }));
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Club shell outings" })).toContainText("The shell data could not be loaded.");
  await expect(page.getByTestId("card-quiet")).toBeVisible();
  await expect(page.getByTestId("story")).toHaveCount(0);
});

test("the cards stack on a phone without sideways scrolling", async ({ page }) => {
  await mockAll(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".stat-card")).toHaveCount(6);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});

test("the rarely-visit note and roster source stay put through repeated visits", async ({ page }) => {
  await mockAll(page);
  await page.goto("/");
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("card-quiet").getByRole("link").click();
    await expect(page.getByTestId("roster-note")).toHaveText("Roster: QuickBooks member list, Oct 21, 2026.");
    await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Summary" }).click();
    await expect(page.getByTestId("card-quiet-note")).toHaveText("11 new members haven't started yet (off the waitlist).");
    await expect(page.getByTestId("roster-note")).toHaveText("Roster: QuickBooks member list, Oct 21, 2026.");
  }
});
