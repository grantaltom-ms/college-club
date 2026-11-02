import { expect, test, type Page } from "@playwright/test";

/**
 * Damage reports: anyone signed in files one (what is wrong, where, how it happened, major or minor); everyone who books the boat reads
 * what is wrong and where but never who filed it or how it happened; staff triage it, can take the boat out of service from it, and
 * close it as repaired or dismissed. Every test uploads its own uniquely named boat through the equipment upload (the tests share one
 * server, and a damage report is never removed), and uses only invented members. The test server's clock stands still at 1 pm Pacific
 * on Wednesday Oct 28, 2026. The people used here: Jordan Bellweather files, Britta Eriksen reads, and Declan Halloran and Hollis Whitcombe book (each test its own, so nobody is asked to be in two boats at once when the tests run side by side).
 */

const HEADER = "Name,Type,Seats,Skill level needed,Owned by,In service,Places,Notes,Owner emails";
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** Staff load a club single that anyone may book (no skill level), through the upload, as a real staff member would. */
async function uploadBoat(page: Page, name: string) {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/equipment-import");
  const csv = [HEADER, `${name},Shell,1,None,Club,,,,`].join("\r\n") + "\r\n";
  await page.locator("#equip-file").setInputFiles({ name: "boats.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByTestId("equip-check").click();
  await page.getByTestId("equip-add").click();
  await expect(page.getByTestId("equip-done")).toContainText(/Added \d+ items?/);
}

/** Waits for the page's scripts to have started, so a button pressed next is handled by the page and not sent as a plain form. */
const settled = (page: Page) => page.waitForLoadState("networkidle");

const slot = (page: Page, item: string, range: string, state: string) => page.locator(`[aria-label="${item}, ${range}, ${state}"]`);
const card = (page: Page, boat: string) => page.locator(`[data-testid="item-card"][data-item="${boat}"]`);

/** A member files a report through the form, as a person would. */
async function file(page: Page, boat: string, what: string, opts: { where?: string; how?: string; major?: boolean } = {}) {
  await page.goto("/club/damage");
  await settled(page);
  await page.getByLabel("Which boat or space?").selectOption({ label: boat });
  await page.getByLabel("What is wrong?").fill(what);
  if (opts.where) await page.getByLabel("Where on the boat? (optional)").fill(opts.where);
  if (opts.how) await page.getByLabel("How did it happen? (optional)").fill(opts.how);
  if (opts.major) await page.getByLabel("Major: it should not be used until someone has looked at it").check();
  await page.getByTestId("damage-submit").click();
  await expect(page.getByTestId("action-ok")).toContainText(`Your report on ${boat} is filed.`);
}

/** The member books the 30-minute slot at the given time, from the day view, and ends on My bookings. */
async function book(page: Page, boat: string, day: string, range: string) {
  await page.goto(`/club/book?day=${day}&type=Shell`);
  await slot(page, boat, range, "free").click();
  await expect(page.getByRole("heading", { level: 1, name: `Book ${boat}` })).toBeVisible();
  await expect(page.getByTestId("check-ok")).toBeVisible();
  await page.getByRole("button", { name: `Book ${boat}`, exact: true }).click();
  await expect(page.getByTestId("booked-note")).toBeVisible();
}

test.describe("filing and reading a report", () => {
  test("a member reports damage from a boat's card; everyone booking it reads what is wrong, never who filed it or how it happened; staff read all of it", async ({ page }) => {
    const boat = `Skiff${tag()}`;
    const what = `Seat sticks ${tag()}`;
    await uploadBoat(page, boat);

    await actAs(page, "Jordan Bellweather");
    await page.goto("/club/book?day=2026-10-30&type=Shell");
    await card(page, boat).getByTestId("report-damage-link").click();
    await expect(page).toHaveURL(/\/club\/damage\?item=/);
    await settled(page);
    await expect(page.locator("#damage-item option:checked")).toHaveText(boat);
    await page.getByLabel("What is wrong?").fill(what);
    await page.getByLabel("Where on the boat? (optional)").fill("Bow seat");
    await page.getByLabel("How did it happen? (optional)").fill("Jordan caught the dock.");
    await page.getByTestId("damage-submit").click();
    await expect(page.getByTestId("action-ok")).toHaveText(`Thank you. Your report on ${boat} is filed. Club staff will see it.`);
    // The form clears, so the same report cannot be filed twice by a second press.
    await expect(page.getByLabel("What is wrong?")).toHaveValue("");
    const mine = page.locator(`[data-testid="my-damage-report"][data-item="${boat}"]`);
    await expect(mine).toContainText(what);
    await expect(mine.getByTestId("damage-status")).toHaveText("Open");

    await actAs(page, "Britta Eriksen");
    await page.goto("/club/book?day=2026-10-30&type=Shell");
    const notice = card(page, boat).getByTestId("damage-notice");
    await expect(notice).toHaveText(`Minor damage reported on Oct 28, 2026: "${what}" (Bow seat). You can still use it.`);
    await expect(card(page, boat)).not.toContainText(/Jordan|caught the dock/);
    // Britta did not file it, so it is not in her list of reports.
    await page.goto("/club/damage");
    await expect(page.getByTestId("no-damage-reports")).toBeVisible();

    await actAs(page, "Test staff");
    await page.goto("/club/admin/damage");
    const row = page.locator(`[data-testid="damage-row"][data-item="${boat}"]`);
    await expect(row).toContainText(what);
    await expect(row).toContainText("reported Oct 28, 2026 by Jordan Bellweather");
    await expect(row).toContainText("priority 3 (normal)");
    await row.getByRole("link", { name: boat }).click();
    await settled(page);
    await expect(page.getByTestId("damage-how")).toContainText("Jordan caught the dock.");
    await expect(page.getByTestId("damage-log")).toContainText("Reported by Jordan Bellweather as minor damage.");
  });

  test("a major report starts as urgent, warns the booker on My bookings, and goes away from every screen once staff dismiss it", async ({ page }) => {
    const boat = `Skiff${tag()}`;
    const what = `Rigger bent ${tag()}`;
    await uploadBoat(page, boat);
    await actAs(page, "Declan Halloran");
    await book(page, boat, "2026-10-31", "5:00 to 5:30 am");

    await actAs(page, "Jordan Bellweather");
    await page.goto("/club/damage");
    await settled(page);
    await page.getByLabel("Which boat or space?").selectOption({ label: boat });
    await page.getByLabel("What is wrong?").fill(what);
    await page.getByLabel("Major: it should not be used until someone has looked at it").check();
    await page.getByTestId("damage-submit").click();
    await expect(page.getByTestId("action-ok")).toHaveText(`Thank you. Your report on ${boat} is filed. You marked it major, so club staff will look at it first.`);

    await actAs(page, "Declan Halloran");
    await page.goto("/club/my-bookings");
    const outing = page.locator(`[data-testid="booking-row"][data-item="${boat}"]`);
    await expect(outing.getByTestId("booking-damage-notice")).toHaveText(`Major damage reported on Oct 28, 2026: "${what}". Check with club staff before you use it.`);
    await page.goto("/club/book?day=2026-10-31&type=Shell");
    await expect(card(page, boat).getByTestId("damage-notice")).toContainText("Major damage reported");

    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    // The board shows only the few most pressing reports, and other tests are filing major ones at the same time, so only its counts are checked.
    await expect(page.getByTestId("damage-board")).toContainText("waiting to be fixed");
    await expect(page.getByTestId("damage-board")).toContainText("marked major");
    await page.goto("/club/admin/damage");
    const row = page.locator(`[data-testid="damage-row"][data-item="${boat}"]`);
    await expect(row).toContainText("priority 1 (urgent)");
    await row.getByRole("link", { name: boat }).click();
    await settled(page);
    await page.getByLabel("Why is it being dismissed? (a duplicate, or nothing was wrong)").fill("Looked at it: nothing wrong.");
    await page.getByRole("button", { name: "Dismiss the report" }).click();
    await expect(page.getByTestId("damage-status")).toHaveText("Dismissed");
    await expect(page.getByTestId("damage-dismissed")).toContainText("Looked at it: nothing wrong.");

    await actAs(page, "Declan Halloran");
    await page.goto("/club/my-bookings");
    await expect(outing).toBeVisible();
    await expect(outing.getByTestId("booking-damage-notice")).toHaveCount(0);
    await page.goto("/club/book?day=2026-10-31&type=Shell");
    await expect(card(page, boat).getByTestId("damage-notice")).toHaveCount(0);
    await actAs(page, "Jordan Bellweather");
    await page.goto("/club/damage");
    const mine = page.locator(`[data-testid="my-damage-report"][data-item="${boat}"]`);
    await expect(mine.getByTestId("damage-status")).toHaveText("Dismissed");
    await expect(mine).toContainText("dismissed: Looked at it: nothing wrong.");
    await actAs(page, "Declan Halloran");
    await page.goto("/club/my-bookings");
    await outing.getByRole("button", { name: /^Cancel / }).click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  });

  test("the person who filed a report can add to it while it is open; nobody else can see it", async ({ page }) => {
    const boat = `Skiff${tag()}`;
    const what = `Oarlock loose ${tag()}`;
    await uploadBoat(page, boat);
    await actAs(page, "Jordan Bellweather");
    await file(page, boat, what);
    const mine = page.locator(`[data-testid="my-damage-report"][data-item="${boat}"]`);
    await mine.getByLabel("Add something to this report").fill("It is worse on the left side.");
    await mine.getByRole("button", { name: "Add note" }).click();
    await expect(mine).toContainText("It is worse on the left side.");
    await actAs(page, "Test staff");
    await page.goto("/club/admin/damage");
    await page.locator(`[data-testid="damage-row"][data-item="${boat}"]`).getByRole("link", { name: boat }).click();
    await settled(page);
    await expect(page.getByTestId("damage-log")).toContainText("It is worse on the left side.");
    await expect(page.getByTestId("damage-log")).toContainText("Jordan Bellweather");
    await page.getByLabel("A note for the log").fill("Ordered a new oarlock.");
    await page.getByRole("button", { name: "Add note" }).last().click();
    await expect(page.getByTestId("damage-log")).toContainText("Ordered a new oarlock.");
    // Staff's own notes are not shown to the filer.
    await actAs(page, "Jordan Bellweather");
    await page.goto("/club/damage");
    await expect(mine).toContainText("It is worse on the left side.");
    await expect(mine).not.toContainText("Ordered a new oarlock.");
  });
});

test.describe("staff work a report", () => {
  test("triage it, take the boat out of service, then close it as repaired and bring the boat back", async ({ page }) => {
    const boat = `Skiff${tag()}`;
    const what = `Slide cracked ${tag()}`;
    await uploadBoat(page, boat);
    await actAs(page, "Hollis Whitcombe");
    // A booking is 90 minutes by default, so this one runs from 5:00 to 6:30 and the 7:00 slot is the first one after it.
    await book(page, boat, "2026-11-02", "5:00 to 5:30 am");
    await actAs(page, "Jordan Bellweather");
    await file(page, boat, what, { where: "Slide", how: "Old age.", major: true });

    await actAs(page, "Test staff");
    await page.goto("/club/admin/damage");
    await page.locator(`[data-testid="damage-row"][data-item="${boat}"]`).getByRole("link", { name: boat }).click();
    await settled(page);
    await expect(page.getByTestId("damage-status")).toHaveText("Open");

    await page.getByLabel("Who is fixing it? (leave empty for nobody)").fill("Sam Shop");
    await page.getByRole("button", { name: "Save who is fixing it" }).click();
    await expect(page.getByTestId("assign-form").getByTestId("action-ok")).toHaveText("Assigned to Sam Shop.");
    await page.getByLabel("Priority", { exact: true }).selectOption("2");
    await page.getByRole("button", { name: "Save priority" }).click();
    await expect(page.getByTestId("priority-form").getByTestId("action-ok")).toHaveText("Priority is now 2.");
    await page.getByRole("button", { name: "Mark as being fixed" }).click();
    await expect(page.getByTestId("damage-status")).toHaveText("Being fixed");
    await expect(page.getByTestId("damage-report")).toContainText("priority 2 (high)");
    await expect(page.getByTestId("damage-report")).toContainText("Sam Shop is on it");

    // The boat is still in service until staff say so.
    await expect(page.getByTestId("boat-out-of-service")).toHaveCount(0);
    await page.getByRole("button", { name: `Take ${boat} out of service` }).click();
    await expect(page.getByTestId("boat-out-of-service")).toContainText(`${boat} is out of service: Damage reported: ${what}`);
    await expect(page.getByTestId("damage-log")).toContainText(`${boat} taken out of service by Test staff. 1 upcoming booking stays`);
    // The page links straight to the list of people who have the boat booked, so they can be told.
    await page.getByTestId("boat-out-of-service").getByRole("link", { name: "See who has it booked, to tell them" }).click();
    await expect(page).toHaveURL(/\/club\/equipment\?affected=/);
    await expect(page.getByTestId("affected")).toContainText("Nothing was cancelled; please contact");
    await page.goBack();
    await page.goto("/club/book?day=2026-11-02&type=Shell");
    await expect(slot(page, boat, "7:00 to 7:30 am", "out of service")).toHaveAttribute("data-state", "out_of_service");
    // The outing Declan already booked stays.
    await actAs(page, "Hollis Whitcombe");
    await page.goto("/club/my-bookings");
    await expect(page.locator(`[data-testid="booking-row"][data-item="${boat}"]`)).toBeVisible();

    await actAs(page, "Test staff");
    await page.goto("/club/admin/damage");
    const row = page.locator(`[data-testid="damage-row"][data-item="${boat}"]`);
    await expect(row).toContainText("Out of service");
    await row.getByRole("link", { name: boat }).click();
    await settled(page);
    await page.getByLabel("Repaired by").fill("Sam Shop");
    await page.getByLabel("Hours spent (optional)").fill("1.5");
    await page.getByLabel("Cost in dollars (optional)").fill("12.50");
    await page.getByLabel("What was done (optional)").fill("Glued and clamped the slide.");
    // With no other major report open on it, bringing the boat back is ticked for staff.
    await expect(page.getByLabel("Also return the boat to service")).toBeChecked();
    await page.getByRole("button", { name: "Mark as repaired" }).click();
    await expect(page.getByTestId("damage-status")).toHaveText("Repaired");
    await expect(page.getByTestId("damage-repair")).toHaveText("Repaired on Oct 28, 2026 by Sam Shop · 1 hour 30 minutes spent · cost $12.50. Glued and clamped the slide.");
    await expect(page.getByTestId("damage-log")).toContainText(`${boat} returned to service by Test staff.`);
    await expect(page.getByTestId("boat-out-of-service")).toHaveCount(0);
    await page.goto("/club/book?day=2026-11-02&type=Shell");
    await expect(slot(page, boat, "7:00 to 7:30 am", "free")).toBeVisible();
    await expect(card(page, boat).getByTestId("damage-notice")).toHaveCount(0);

    // The filer sees that it is repaired and when, and none of what it cost.
    await actAs(page, "Jordan Bellweather");
    await page.goto("/club/damage");
    const mine = page.locator(`[data-testid="my-damage-report"][data-item="${boat}"]`);
    await expect(mine.getByTestId("damage-status")).toHaveText("Repaired");
    await expect(mine).toContainText("repaired Oct 28, 2026");
    await expect(mine).not.toContainText(/12\.50|Sam Shop|Glued/);
    await actAs(page, "Hollis Whitcombe");
    await page.goto("/club/my-bookings");
    await page.locator(`[data-testid="booking-row"][data-item="${boat}"]`).getByRole("button", { name: /^Cancel / }).click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  });

  test("a second major report keeps the boat out of service: the tick to bring it back is left off, and says why", async ({ page }) => {
    const boat = `Skiff${tag()}`;
    const first = `First problem ${tag()}`;
    const second = `Second problem ${tag()}`;
    await uploadBoat(page, boat);
    await actAs(page, "Jordan Bellweather");
    await file(page, boat, first, { major: true });
    await file(page, boat, second, { major: true });
    await actAs(page, "Test staff");
    await page.goto("/club/admin/damage");
    await page.locator(`[data-testid="damage-row"][data-item="${boat}"]`).filter({ hasText: first }).getByRole("link", { name: boat }).click();
    await settled(page);
    await expect(page.getByTestId("other-open")).toContainText(second);
    await page.getByRole("button", { name: `Take ${boat} out of service` }).click();
    await expect(page.getByTestId("boat-out-of-service")).toBeVisible();
    await expect(page.getByLabel("Also return the boat to service")).not.toBeChecked();
    await expect(page.getByTestId("other-major-note")).toContainText("1 other major report is still open on it");
    await page.getByLabel("Repaired by").fill("Sam Shop");
    await page.getByRole("button", { name: "Mark as repaired" }).click();
    await expect(page.getByTestId("damage-status")).toHaveText("Repaired");
    await expect(page.getByTestId("boat-out-of-service")).toBeVisible();
    // The boat stays out of service because the second report is still open; closing that one and returning it finishes the job.
    await page.getByTestId("other-open").getByRole("link", { name: second }).click();
    await settled(page);
    await page.getByLabel("Repaired by").fill("Sam Shop");
    await expect(page.getByLabel("Also return the boat to service")).toBeChecked();
    await page.getByRole("button", { name: "Mark as repaired" }).click();
    await expect(page.getByTestId("damage-status")).toHaveText("Repaired");
    await expect(page.getByTestId("boat-out-of-service")).toHaveCount(0);
  });
});

test.describe("who can open what", () => {
  test("a member cannot open the staff screens, and someone signed out is asked to sign in", async ({ page, context }) => {
    await actAs(page, "Jordan Bellweather");
    expect((await page.goto("/club/admin/damage"))?.status()).toBe(404);
    expect((await page.goto("/club/admin/damage/00000000-0000-4000-8000-0000000000ff"))?.status()).toBe(404);
    await actAs(page, "Test staff");
    expect((await page.goto("/club/admin/damage/00000000-0000-4000-8000-0000000000ff"))?.status()).toBe(404);
    expect((await page.goto("/club/admin/damage"))?.status()).toBe(200);
    await context.clearCookies();
    await page.goto("/club/damage");
    await expect(page.getByText("with your email address to see this page.")).toBeVisible();
    await page.goto("/club/admin/damage");
    await expect(page.getByText("with your email address to see this page.")).toBeVisible();
  });

  test("the sample club's reports are there: a major one being fixed on the boat that is out of service, and staff see it first", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin/damage");
    await expect(page.getByTestId("damage-summary")).toContainText("waiting to be fixed");
    const rigger = page.locator('[data-testid="damage-row"][data-item="Merganser"]');
    await expect(rigger).toContainText("The bow side rigger is bent");
    await expect(rigger).toContainText("Being fixed");
    await expect(rigger).toContainText("Boat shop volunteer is on it");
    await page.goto("/club/admin/damage?show=closed");
    await expect(page.locator('[data-testid="damage-row"][data-item="Loon"]')).toContainText("Repaired");
    await expect(page.locator('[data-testid="damage-row"][data-item="Tern"]')).toContainText("Dismissed");
  });
});

test.describe("on a phone", () => {
  test("the report form and the staff report fit the screen and the buttons can be tapped", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await actAs(page, "Jordan Bellweather");
    await page.goto("/club/damage");
    expect(await fits()).toBe(true);
    expect((await page.getByTestId("damage-submit").boundingBox())!.height).toBeGreaterThanOrEqual(36);
    await actAs(page, "Test staff");
    await page.goto("/club/admin/damage");
    expect(await fits()).toBe(true);
    await page.locator('[data-testid="damage-row"][data-item="Merganser"]').getByRole("link", { name: "Merganser" }).click();
    expect(await fits()).toBe(true);
    expect((await page.getByRole("button", { name: "Save priority" }).boundingBox())!.height).toBeGreaterThanOrEqual(36);
  });
});
