import { expect, test, type Page } from "@playwright/test";
import { rowingOutlook, usageOutlook, waitlistOutlook } from "../../src/lib/executive";
import { SEED_PRIORITIES } from "../../src/lib/executive-items";
import { sampleMembership } from "../../src/lib/membership";
import { sampleData } from "../../src/lib/sample";
import { sampleShells } from "../../src/lib/shells";
import { fmtInt } from "../../src/lib/stats";
import { dashboardNav, mockAll } from "./helpers";

// The executive page (Nov 11): priorities for club leadership, with live dashboard figures inside text the executive team can edit,
// reorder, add and remove once it has typed its editing password. The priorities live on the test server, so this file runs in order.
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ page }) => mockAll(page));

const PASSWORD = "playwright-only-executive-0001";
const priorities = (page: Page) => page.getByTestId("priority");

async function unlock(page: Page) {
  await page.goto("/executive");
  await page.getByLabel("Editing password").fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock editing" }).click();
  await expect(page.getByText("You can edit this page on this device.")).toBeVisible();
}

test("anyone can read the three priorities, each with its data, meaning, question and caution, and nothing to edit", async ({ page }) => {
  const res = await page.goto("/executive");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle("CCS: three things to watch");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Three things to watch.");
  await expect(page.locator(".exec-title")).toHaveText(SEED_PRIORITIES.map((p) => p.title));
  for (let i = 0; i < 3; i++) {
    const box = priorities(page).nth(i);
    await expect(box.getByRole("heading", { level: 3, name: "What the data says" })).toBeVisible();
    await expect(box.getByRole("heading", { level: 3, name: "What it means" })).toBeVisible();
    await expect(box.getByText(/^Question for the board:/)).toBeVisible();
    await expect(box.getByText(/^Read with care:/)).toBeVisible();
    await expect(box.getByText(/\(loading\)|unknown figure/)).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: /^(Edit|Move up|Move down|Remove|Add a priority)$/ })).toHaveCount(0);
  await expect(page.getByLabel("Editing password")).toBeVisible();
  await expect(page.getByText("Sample data: the figures are invented")).toBeVisible();
});

test("its live figures are the dashboard's own, worked out the same way", async ({ page }) => {
  await page.goto("/executive");
  const w = waitlistOutlook(sampleMembership().months)!;
  const u = usageOutlook(sampleData().members);
  const shells = sampleShells();
  const r = rowingOutlook(shells.outings, shells.through);
  const fig = (code: string) => page.locator(`[data-figure="${code}"]`).first();
  await expect(fig("waitlist_now")).toHaveText(fmtInt(w.now.waitlist));
  await expect(fig("resignations_12")).toHaveText(fmtInt(w.resignations12));
  await expect(fig("rarely")).toHaveText(fmtInt(u.rarely));
  await expect(fig("regulars")).toHaveText(fmtInt(u.regulars));
  if (r) await expect(fig("rowing_now")).toHaveText(fmtInt(r.now));
});

test("a figure whose source cannot load says so, and the rest of the page still reads", async ({ page }) => {
  await page.route("**/api/membership", (route) => route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"x"}' }));
  await page.goto("/executive");
  await expect(priorities(page).first().getByText("(not available)").first()).toBeVisible();
  await expect(page.locator('[data-figure="rarely"]')).toBeVisible();
  await expect(priorities(page)).toHaveCount(3);
});

test("when the dashboard's own data cannot load, its figures say so instead of loading for ever", async ({ page }) => {
  await page.route("**/api/dashboard", (route) => route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"x"}' }));
  await page.goto("/executive");
  await expect(page.locator("li").filter({ hasText: "came in less than once a month" }).first()).toContainText("(not available) of (not available) member households");
  await expect(page.locator('[data-figure="rarely"]')).toHaveCount(0);
  await expect(page.getByText("(loading)")).toHaveCount(0);
  await expect(priorities(page)).toHaveCount(3);
});

test("a move the server refuses puts the list back in its saved order", async ({ page }) => {
  await unlock(page);
  await page.route("**/api/executive/order", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"The new order could not be saved."}' }));
  await priorities(page).nth(1).getByRole("button", { name: "Move up" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "could not be saved" })).toBeVisible();
  await expect(page.locator(".exec-title")).toHaveText(SEED_PRIORITIES.map((p) => p.title));
  await page.unroute("**/api/executive/order");
  await page.getByRole("button", { name: "Stop editing on this device" }).click();
});

test("the one-line list jumps to each priority", async ({ page }) => {
  await page.goto("/executive");
  const list = page.getByRole("list", { name: "Each priority in one line" }).getByRole("link");
  await expect(list).toHaveCount(3);
  await list.nth(2).click();
  await expect(page).toHaveURL(/#p-/);
  await expect(priorities(page).nth(2)).toBeInViewport();
});

test("has its own plain header, and the dashboard reaches it only from the Board Materials menu (Nov 11)", async ({ page }) => {
  await page.goto("/executive");
  await expect(dashboardNav(page)).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator('a[href="/executive"]')).toHaveCount(0);
  await page.getByRole("navigation").getByRole("button", { name: "Board Materials" }).click();
  await page.getByRole("menu", { name: "Board Materials" }).getByRole("menuitem", { name: "Executive Priorities" }).click();
  await expect(page).toHaveURL(/\/executive$/);
  await expect(page.getByRole("heading", { level: 1, name: "Things to watch." })).toBeVisible();
});

test("a wrong password is refused and nothing becomes editable", async ({ page }) => {
  await page.goto("/executive");
  await page.getByLabel("Editing password").fill("not-the-password");
  await page.getByRole("button", { name: "Unlock editing" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "That password was not right." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a priority" })).toHaveCount(0);
});

test("without the password every change is refused by the server too", async ({ request }) => {
  const list = await (await request.get("/api/executive")).json();
  const id = list.items[0].id;
  expect((await request.post("/api/executive/items", { data: { title: "T", summary: "S" } })).status()).toBe(401);
  expect((await request.put(`/api/executive/items/${id}`, { data: { title: "T", summary: "S" } })).status()).toBe(401);
  expect((await request.delete(`/api/executive/items/${id}`)).status()).toBe(401);
  expect((await request.post("/api/executive/order", { data: { ids: [id] } })).status()).toBe(401);
});

test("the executive team adds, edits, moves and removes a priority, with live figures in its text", async ({ page }) => {
  await unlock(page);
  // Clear anything an earlier, interrupted run left behind.
  const before = await (await page.request.get("/api/executive")).json();
  for (const p of before.items.filter((x: { title: string }) => x.title.startsWith("Playwright"))) await page.request.delete(`/api/executive/items/${p.id}`);
  await page.reload();

  // Add.
  await page.getByRole("button", { name: "Add a priority" }).click();
  const form = page.getByRole("form", { name: "New priority" });
  await form.getByLabel("Heading").fill("Playwright priority");
  await form.getByLabel(/One-line summary/).fill("Playwright summary line");
  await form.getByLabel(/What the data says/).fill("The waitlist is {{waitlist_now}}.\n\nSecond point.");
  await form.getByLabel("Question for the board").fill("Is this a test?");
  await form.getByText("Live figures you can put in the text").click();
  await expect(form.getByRole("cell", { name: "{{waitlist_now}}" })).toBeVisible();
  await form.getByRole("button", { name: "Add to the page" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Four things to watch.");
  const added = priorities(page).nth(3);
  await expect(added.getByRole("heading", { level: 2 })).toHaveText("Playwright priority");
  const w = waitlistOutlook(sampleMembership().months)!;
  await expect(added.locator('[data-figure="waitlist_now"]')).toHaveText(fmtInt(w.now.waitlist));
  await expect(added.locator(".exec-facts li")).toHaveText([`The waitlist is ${fmtInt(w.now.waitlist)}.`, "Second point."]);
  await expect(page.getByRole("list", { name: "Each priority in one line" }).getByRole("link").nth(3)).toHaveText("Playwright summary line");

  // A mistake is explained, and nothing is lost.
  await added.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("form", { name: "Edit priority" });
  await edit.getByLabel(/One-line summary/).fill("   ");
  await edit.getByLabel("Heading").fill("Playwright priority, edited");
  await edit.evaluate((f: HTMLFormElement) => (f.noValidate = true));
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "one-line summary" })).toBeVisible();
  await edit.getByLabel(/One-line summary/).fill("Playwright summary, edited");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(priorities(page).nth(3).getByRole("heading", { level: 2 })).toHaveText("Playwright priority, edited");

  // Move it up twice; the first stays first and the order survives a reload.
  await priorities(page).nth(3).getByRole("button", { name: "Move up" }).click();
  await expect(priorities(page).nth(2).getByRole("heading", { level: 2 })).toHaveText("Playwright priority, edited");
  await priorities(page).nth(2).getByRole("button", { name: "Move up" }).click();
  await expect(priorities(page).nth(1).getByRole("heading", { level: 2 })).toHaveText("Playwright priority, edited");
  await expect(priorities(page).first().getByRole("button", { name: "Move up" })).toBeDisabled();
  await expect(priorities(page).last().getByRole("button", { name: "Move down" })).toBeDisabled();
  await page.reload();
  await expect(page.locator(".exec-title")).toHaveText([SEED_PRIORITIES[0].title, "Playwright priority, edited", SEED_PRIORITIES[1].title, SEED_PRIORITIES[2].title]);

  // Remove it, after saying yes.
  page.once("dialog", (d) => d.dismiss());
  await priorities(page).nth(1).getByRole("button", { name: "Remove" }).click();
  await expect(priorities(page)).toHaveCount(4);
  page.once("dialog", (d) => d.accept());
  await priorities(page).nth(1).getByRole("button", { name: "Remove" }).click();
  await expect(priorities(page)).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Three things to watch.");
  await expect(page.locator(".exec-title")).toHaveText(SEED_PRIORITIES.map((p) => p.title));

  // Stop editing on this device.
  await page.getByRole("button", { name: "Stop editing on this device" }).click();
  await expect(page.getByLabel("Editing password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
});

test("reads and edits on a phone with nothing scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  await priorities(page).first().getByRole("button", { name: "Edit" }).click();
  await page.getByText("Live figures you can put in the text").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Stop editing on this device" }).click();
});
