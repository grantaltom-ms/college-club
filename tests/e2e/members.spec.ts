import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openMembers } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openMembers(page);
});

const status = (page: import("@playwright/test").Page) => page.getByRole("status").filter({ hasText: /members|No members/ });

test("pages through every member, 22 pages", async ({ page }) => {
  const next = page.getByRole("button", { name: "Next" });
  for (let p = 1; p < 22; p++) {
    await expect(page.getByText(`Page ${p} of 22`)).toBeVisible();
    await next.click();
  }
  await expect(page.getByText("Page 22 of 22")).toBeVisible();
  await expect(status(page)).toContainText("Showing 526–550 of 550");
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByText("Page 21 of 22")).toBeVisible();
});

test("group buttons filter the list and go back to page one", async ({ page }) => {
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /^No visits/ }).click();
  await expect(status(page)).toContainText("Showing 1–25 of 63 members");
  await page.getByRole("button", { name: /^Under 1 a month/ }).click();
  await expect(status(page)).toContainText("of 122 members");
  await page.getByRole("button", { name: /^Everyone/ }).click();
  await expect(status(page)).toContainText("of 550 members");
});

test("search narrows the list and says so when nothing matches", async ({ page }) => {
  const search = page.getByRole("searchbox", { name: "Search by name" });
  await search.fill("zzzzzz-nobody");
  await expect(status(page)).toHaveText("No members match");
  await expect(page.getByRole("button", { name: "Download list (CSV)" })).toBeDisabled();
  await search.fill("");
  await expect(status(page)).toContainText("of 550 members");
});

test("sorting by name flips direction on a second click", async ({ page }) => {
  const names = async () => page.locator("tbody tr td:first-child").allTextContents();
  const asc = await names();
  expect([...asc].sort((a, b) => a.localeCompare(b))).toEqual(asc);
  await page.getByRole("button", { name: /^Name/ }).click();
  const desc = await names();
  expect(desc[0].localeCompare(asc[0])).toBeGreaterThan(0);
  await expect(page.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "descending");
});

test("downloads the chosen group as a CSV", async ({ page }) => {
  await page.getByRole("button", { name: /^No visits/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download list (CSV)" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("ccs-members-no-visits.csv");
  const text = await readFile((await download.path())!, "utf8");
  const lines = text.trim().split("\r\n");
  expect(lines[0]).toBe("Name,Usage level,Visits per month,Last visit,Joined,Own door fob");
  expect(lines).toHaveLength(64); // header + 63 members with no visits
  expect(lines.slice(1).every((l) => l.includes("No visits"))).toBe(true);
});

test("holds up under repeated use: cycling groups, searches and sorts many times", async ({ page }) => {
  const groups = [/^No visits/, /^Under 1 a month/, /^Gone quiet/, /^New/, /^No fob/, /^Everyone/];
  const search = page.getByRole("searchbox", { name: "Search by name" });
  for (let round = 0; round < 5; round++) {
    for (const g of groups) {
      await page.getByRole("button", { name: g }).click();
      await page.getByRole("button", { name: /^Last visit/ }).click();
      await search.fill("a");
      await search.fill("");
    }
  }
  await expect(status(page)).toContainText("of 550 members");
  await expect(page.locator("tbody tr")).toHaveCount(25);
});
