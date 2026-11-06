import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The ready-to-switch-on checklist (Grant, Nov 6, 2026): a staff screen that reads this server's private settings and a few counts
 * from its records and says, in words, what is ready, what is not and what only a person can confirm. It changes nothing.
 *
 * These servers are test versions (invented data is allowed, no real email is sent), so several lines read "not ready" here on
 * purpose. The tests hold what is certain on both servers: which lines are ready or not because of how the servers are set up, that
 * no secret ever reaches the page, and that the screen is for staff and reads without changing anything. The records lines that other
 * specs change as they run (how many households lack a QuickBooks ID, whether any real boat or old booking has been loaded) are held
 * only to what cannot change.
 */

const actAsStaff = async (page: Page) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: "Act as Test staff", exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText("Acting as Test staff.");
};

const row = (page: Page, id: string) => page.getByTestId(`check-${id}`);
const statusOf = (page: Page, id: string) => row(page, id).getByTestId("check-status");
const detailOf = (page: Page, id: string) => row(page, id).getByTestId("check-detail");

const PEOPLE = ["domain_records", "tracking_off", "mail_test", "sales_tax", "quickbooks_names", "equipment_confirmed", "future_bookings", "icrew_freeze", "switch_date"];

/** How many rules files still mark their numbers as placeholders, read from the files themselves. */
const placeholderCount = () => {
  const folder = join(process.cwd(), "src/club/settings");
  return readdirSync(folder)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => (JSON.parse(readFileSync(join(folder, f), "utf8")) as { placeholder?: unknown }).placeholder !== false).length;
};

test.describe("the switch-on checklist", () => {
  test("is a staff screen with its one heading, a note on what it is looking at, and a sentence on where things stand", async ({ page }) => {
    await actAsStaff(page);
    await page.goto("/club/admin/switch-on");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ready to switch on?");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    // This is a test version, and the screen says so.
    await expect(page.getByTestId("switch-on-scope")).toContainText("You are looking at a test version");
    const verdict = page.getByTestId("switch-on-verdict");
    await expect(verdict).toHaveAttribute("role", "status");
    await expect(verdict).toHaveText(/^\d+ things? to fix before switch-on, and 9 things only a person can confirm\.$/);
    // The counts line adds up to every row.
    const counts = (await page.getByTestId("switch-on-counts").textContent())!.match(/^(\d+) ready, (\d+) not ready, (\d+) for a person\.$/);
    expect(counts).not.toBeNull();
    const [ready, notReady, person] = [Number(counts![1]), Number(counts![2]), Number(counts![3])];
    expect(person).toBe(9);
    expect(notReady).toBeGreaterThan(0);
    await expect(page.locator("[data-testid^='check-'][data-status]")).toHaveCount(ready + notReady + person);
    await expect(page.locator("[data-status='ready']")).toHaveCount(ready);
    await expect(page.locator("[data-status='not_ready']")).toHaveCount(notReady);
    await expect(page.locator("[data-status='person']")).toHaveCount(person);
  });

  test("groups the lines, and gives the lines only people can confirm a name for who does them and never calls them ready", async ({ page }) => {
    await actAsStaff(page);
    await page.goto("/club/admin/switch-on");
    for (const group of ["settings", "records", "people"]) await expect(page.getByTestId(`group-${group}`)).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Only people can confirm" })).toBeVisible();
    for (const id of PEOPLE) {
      await expect(page.getByTestId("group-people").getByTestId(`check-${id}`), id).toBeVisible();
      await expect(statusOf(page, id)).toHaveText("Needs a person");
      await expect(row(page, id).getByTestId("check-fix")).toContainText("Who:");
    }
    // A line that is ready says nothing to do, and one that is not says what to do.
    await expect(row(page, "link_secret").getByTestId("check-fix")).toHaveCount(0);
    await expect(row(page, "site_address").getByTestId("check-fix")).toContainText("To do:");
  });

  test("reads this server's settings: what is set up here is ready, and what is not is not", async ({ page }, testInfo) => {
    await actAsStaff(page);
    await page.goto("/club/admin/switch-on");
    // Both test servers have two staff, a link secret, an iPad secret and the (fake) email sender set, and no demo link.
    await expect(statusOf(page, "staff_list")).toHaveText("Ready");
    await expect(detailOf(page, "staff_list")).toHaveText("2 people are on the staff list: Alex Staffer, Sam Deskwell.");
    await expect(statusOf(page, "link_secret")).toHaveText("Ready");
    await expect(statusOf(page, "ipad_secret")).toHaveText("Ready");
    await expect(statusOf(page, "demo_link_removed")).toHaveText("Ready");
    await expect(statusOf(page, "email_sender")).toHaveText("Ready");
    await expect(detailOf(page, "email_sender")).toContainText("Playwright Club <no-reply@example.org>");
    await expect(detailOf(page, "email_sender")).toContainText("test outbox");
    // Neither has a site address, and both allow invented data and hold the invented club.
    await expect(statusOf(page, "site_address")).toHaveText("Not ready");
    await expect(detailOf(page, "site_address")).toContainText("CLUB_SITE_URL is not set");
    await expect(statusOf(page, "invented_data_off")).toHaveText("Not ready");
    await expect(statusOf(page, "no_sample_data")).toHaveText("Not ready");
    await expect(detailOf(page, "no_sample_data")).toContainText("households with invented IDs");
    await expect(detailOf(page, "no_sample_data")).toContainText("invented boats and spaces");
    // The invented club has a household with no QuickBooks ID, by design.
    await expect(statusOf(page, "quickbooks_ids")).toHaveText("Not ready");
    await expect(detailOf(page, "quickbooks_ids")).toContainText("The Nakamura household");
    await expect(statusOf(page, "households_loaded")).toHaveText("Ready");
    await expect(detailOf(page, "households_loaded")).toHaveText(/^\d+ active households with \d+ adults\.$/);
    // The one setting that differs between the two servers: where the records are kept.
    if (testInfo.project.name === "postgres") {
      await expect(statusOf(page, "database")).toHaveText("Ready");
      await expect(detailOf(page, "database")).toContainText("club_e2e");
    } else {
      await expect(statusOf(page, "database")).toHaveText("Not ready");
      await expect(detailOf(page, "database")).toContainText("memory");
    }
  });

  test("lists the rules files whose numbers are still placeholders, as many as the files themselves say", async ({ page }) => {
    await actAsStaff(page);
    await page.goto("/club/admin/switch-on");
    const count = placeholderCount();
    if (count === 0) {
      await expect(statusOf(page, "rules_confirmed")).toHaveText("Ready");
    } else {
      await expect(statusOf(page, "rules_confirmed")).toHaveText("Not ready");
      await expect(detailOf(page, "rules_confirmed")).toContainText(`${count} rules file${count === 1 ? "" : "s"} still ${count === 1 ? "marks its numbers" : "mark their numbers"} as placeholders`);
    }
  });

  test("never shows a secret, the email key or a staff member's address", async ({ page }) => {
    await actAsStaff(page);
    await page.goto("/club/admin/switch-on");
    const text = await page.locator("main").innerText();
    const html = await page.content();
    for (const secret of ["playwright-only-link-secret", "playwright-only-ipad-secret", "re_playwright_only_fake_key", "alex.staffer@example.org", "sam.deskwell@example.org", "postgres@"]) {
      expect(text, secret).not.toContain(secret);
      expect(html, secret).not.toContain(secret);
    }
  });

  test("only reads: nothing on it can be pressed or sent, and opening it again changes nothing", async ({ page }) => {
    await actAsStaff(page);
    await page.goto("/club/admin/switch-on");
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.locator("main button")).toHaveCount(0);
    await expect(page.locator("main input, main select, main textarea")).toHaveCount(0);
    const first = await page.getByTestId("switch-on-counts").textContent();
    await page.reload();
    await page.goto("/club/admin/switch-on");
    expect(await page.getByTestId("switch-on-counts").textContent()).toBe(first);
  });

  test("is reached from the Staff office, in the Front desk tools", async ({ page }) => {
    await actAsStaff(page);
    await page.goto("/club/admin");
    await page.getByTestId("tools").getByRole("link", { name: "Ready to switch on?", exact: true }).click();
    await expect(page).toHaveURL(/\/club\/admin\/switch-on$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ready to switch on?");
  });

  test("is for staff: a member gets 'page not found', and someone not signed in is asked to sign in", async ({ page }) => {
    await page.goto("/club/admin/switch-on");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose a test member");
    await expect(page.getByTestId("switch-on-verdict")).toHaveCount(0);
    await expect(page.getByTestId("check-staff_list")).toHaveCount(0);

    await page.goto("/club/act-as");
    await page.getByRole("button", { name: /^Act as (?!Test staff)/ }).first().click();
    expect((await page.goto("/club/admin/switch-on"))!.status()).toBe(404);
    await expect(page.getByTestId("check-staff_list")).toHaveCount(0);
  });
});

test.describe("the switch-on checklist, on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("fits the screen: nothing scrolls sideways, even for the longest lines", async ({ page }) => {
    await actAsStaff(page);
    await page.goto("/club/admin/switch-on");
    await expect(page.getByTestId("switch-on-verdict")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    for (const id of ["rules_confirmed", "no_sample_data", "email_sender", "domain_records"]) {
      const box = await row(page, id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.x + box!.width, `${id} stays inside the screen`).toBeLessThanOrEqual(390);
    }
  });
});
