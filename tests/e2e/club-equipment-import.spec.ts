import { expect, test, type Page } from "@playwright/test";

/**
 * The unit list: staff upload the sheet of the club's boats, kayaks, paddle boards and work rooms, check it, and add it. Every
 * test uses its own item names (the tests share one server), and only invented equipment. The first test goes all the way: the
 * items appear in the club, an out-of-service one is marked, and a member can book (or is refused) according to the skill level.
 */

const HEADER = "Name,Type,Seats,Skill level needed,Owned by,In service,Places,Notes";
const SHEET_HEADER = `${HEADER},Hint: times booked in 2026,Hint: last booked,Hint: name looks like a private boat,Hint: most people listed on one booking`;
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n") + "\r\n";
/** A row in the column order: Name, Type, Seats, Skill level needed, Owned by, In service, Places, Notes. */
const row = (name: string, type: string, seats = "", skill = "", owned = "Club", service = "", places = "", notes = "") => [name, type, seats, skill, owned, service, places, notes].join(",");

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

const choose = (page: Page, text: string, name = "equipment.csv") => page.locator("#equip-file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
const check = async (page: Page, text: string, name?: string) => {
  await choose(page, text, name);
  await page.getByTestId("equip-check").click();
};
const openUpload = async (page: Page) => {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/equipment-import");
  await expect(page.getByRole("heading", { level: 1, name: "Load the equipment list" })).toBeVisible();
};
const equipmentRow = (page: Page, name: string) => page.locator(`[data-testid="equipment-row"][data-item="${name}"]`);
const slot = (page: Page, item: string, range: string, state: string) => page.locator(`[aria-label="${item}, ${range}, ${state}"]`);

test.describe("who can load equipment", () => {
  test("only staff: a member finds neither the page nor the template, and the staff office links to it", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    await expect(page.getByTestId("tools").getByRole("link", { name: "Load the equipment list" })).toBeVisible();
    await actAs(page, "Nora Abernathy");
    expect((await page.goto("/club/admin/equipment-import"))?.status()).toBe(404);
    expect((await page.request.get("/api/club/equipment/template")).status()).toBe(404);
  });

  test("someone not signed in is asked to sign in, and cannot download the template", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto("/club/admin/equipment-import");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await expect(page.getByTestId("equip-form")).toHaveCount(0);
    expect((await page.request.get("/api/club/equipment/template")).status()).toBe(404);
    await context.close();
  });
});

test.describe("the template", () => {
  test("downloads as a CSV with every column and three example rows, and the example rows cannot be loaded by accident", async ({ page }) => {
    await openUpload(page);
    const res = await page.request.get("/api/club/equipment/template");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("ccs-equipment-template.csv");
    const body = await res.text();
    expect(body.split("\r\n")[0]).toBe(HEADER);
    expect(body).toContain("EXAMPLE-1");
    await check(page, body, "ccs-equipment-template.csv");
    const problems = page.getByTestId("equip-problems");
    await expect(problems).toContainText("ccs-equipment-template.csv has 3 problems");
    await expect(problems).toContainText("Row 2:");
    await expect(problems).toContainText("one of the template's example rows");
    await expect(page.getByTestId("equip-add")).toHaveCount(0);
  });
});

test.describe("checking and adding", () => {
  test("shows what a file would do, saves nothing until Add is pressed, then the items are in the club and behave: refused or allowed by skill level, marked out of service", async ({ page }) => {
    const t = tag();
    const single = `Playwright Single ${t}`;
    const anyone = `Playwright Anyone ${t}`;
    const twin = `Playwright Twin ${t}`;
    const privateBoat = `Playwright Private ${t}`;
    const docks = `Playwright Docks ${t}`;
    // The sheet has the starter sheet's shape: the Hint columns come along and are not used (one says the "Club" boat looks private).
    const sheet = [
      SHEET_HEADER,
      `${row(single, "Shell", "1")},40,2026-10-20,No,1`,
      `${row(anyone, "Shell", "1", "None")},12,2026-10-02,Yes,1`,
      `${row(twin, "Kayak", "2", "", "Club", "No", "", "Paddle needs mending")},9,2026-09-30,No,`,
      `${row(privateBoat, "Shell", "1", "", "Private")},80,2026-10-26,Yes,1`,
      `${row(docks, "Dock Space", "", "", "Club", "", "60", "One pool of 60 places")},300,2026-10-27,No,`,
    ].join("\r\n");

    await openUpload(page);
    await check(page, sheet, "starter.csv");
    await expect(page.getByTestId("equip-summary")).toHaveText("This would add 3 items to the club (2 singles, 1 double kayak).");
    await expect(page.getByTestId("equip-item")).toHaveCount(3);
    await expect(page.getByTestId("equip-item").filter({ hasText: single })).toContainText("Skill level: the usual level for this class (Sculling level 1 (placeholder))");
    await expect(page.getByTestId("equip-item").filter({ hasText: anyone })).toContainText("Skill level: none needed");
    await expect(page.getByTestId("equip-item").filter({ hasText: twin })).toContainText("Added out of service: Paddle needs mending");
    await expect(page.getByTestId("equip-private")).toContainText(`1 private boat, not loaded yet`);
    await expect(page.getByTestId("equip-private")).toContainText(privateBoat);
    await expect(page.getByTestId("equip-pools")).toContainText(`${docks} (Dock Space, 60 places)`);
    const notices = page.getByTestId("equip-notices");
    await expect(notices).toContainText("marked Private and is not loaded now");
    await expect(notices).toContainText("Pools are a later step");
    await expect(notices).toContainText("looks like a private boat in the sheet's hint column");
    await expect(notices).toContainText("1 item will be added out of service");
    // Looking saved nothing.
    await page.goto("/club/equipment");
    await expect(equipmentRow(page, single)).toHaveCount(0);

    await page.goto("/club/admin/equipment-import");
    await check(page, sheet, "starter.csv");
    await page.getByTestId("equip-add").click();
    await expect(page.getByTestId("equip-done")).toContainText("Added 3 items. 1 item was added out of service. 2 rows (private boats and pools) are waiting for a later step.");

    // The staff equipment page lists them; the out-of-service one says why; the private boat and the pool are not there.
    await page.goto("/club/equipment");
    await expect(equipmentRow(page, single)).toContainText("In service");
    await expect(equipmentRow(page, anyone)).toContainText("In service");
    await expect(equipmentRow(page, twin).getByTestId("equipment-status")).toContainText("Paddle needs mending");
    await expect(equipmentRow(page, privateBoat)).toHaveCount(0);
    await expect(equipmentRow(page, docks)).toHaveCount(0);

    // A member with no qualification is refused the single with the usual level, and can book the one that needs none.
    await actAs(page, "Ines Castellanos");
    const day = "/club/book?day=2026-11-03&type=Shell";
    await page.goto(day);
    const singleHref = (await slot(page, single, "7:00 to 7:30 am", "free").getAttribute("href"))!;
    await page.goto(singleHref);
    await expect(page.getByTestId("refusal-reasons").getByRole("listitem")).toHaveText([`You need Sculling level 1 (placeholder) to use ${single}.`]);
    await expect(page.getByRole("button", { name: `Book ${single}` })).toHaveCount(0);
    await page.goto(day);
    await slot(page, anyone, "7:00 to 7:30 am", "free").click();
    await expect(page.getByTestId("check-ok")).toBeVisible();
    await page.getByRole("button", { name: `Book ${anyone}`, exact: true }).click();
    await expect(page.getByTestId("booked-note")).toBeVisible();
    // Leave the member's limits as they were, for the next run on this server.
    await page.getByRole("button", { name: /^Cancel / }).first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  });

  test("lists every problem with its row number, adds nothing, and the fixed file goes through", async ({ page }) => {
    const t = tag();
    const bad = csv(row(`Playwright A ${t}`, "Shell", "3"), row(`Playwright B ${t}`, "Canoe", "1"), row(`Playwright C ${t}`, "Kayak", "2", "level 9"), row(`Playwright D ${t}`, "Shell", "1", "", ""));
    await openUpload(page);
    await check(page, bad, "bad.csv");
    const problems = page.getByTestId("equip-problems");
    await expect(problems).toContainText("bad.csv has 4 problems");
    await expect(problems).toContainText("Nothing can be added until the file is fixed.");
    await expect(problems.getByRole("listitem")).toHaveText([
      "Row 2: Seats 3 does not fit a shell: use 1 (single), 2 (double) or 4 (quad or four).",
      'Row 3: Type "Canoe" is not one of: Shell, Kayak, Paddle Board, Work Space, Dock Space, Room Space, Gym Space.',
      /^Row 4: Skill level needed "level 9" is not one the system knows\./,
      "Row 5: Owned by is empty. Write Club or Private.",
    ]);
    await expect(page.getByTestId("equip-add")).toHaveCount(0);
    await expect(page.getByTestId("equip-item")).toHaveCount(0);

    await check(page, csv(row(`Playwright A ${t}`, "Shell", "2"), row(`Playwright B ${t}`, "Kayak", "1"), row(`Playwright C ${t}`, "Kayak", "2", "None"), row(`Playwright D ${t}`, "Paddle Board")), "fixed.csv");
    await expect(page.getByTestId("equip-problems")).toHaveCount(0);
    await expect(page.getByTestId("equip-summary")).toHaveText("This would add 4 items to the club (1 double, 1 kayak, 1 double kayak, 1 paddle board).");
    await page.getByTestId("equip-add").click();
    await expect(page.getByTestId("equip-done")).toContainText("Added 4 items.");
  });

  test("says what is wrong when the file is not an equipment sheet at all: an Excel file, a missing column, nothing in it", async ({ page }) => {
    await openUpload(page);
    await check(page, "PK\u0003\u0004 not really a spreadsheet", "sheet.xlsx");
    await expect(page.getByTestId("equip-problems")).toContainText("That looks like an Excel file, not a CSV");
    await check(page, "Name,Type\r\nBoat,Shell\r\n", "short.csv");
    await expect(page.getByTestId("equip-problems")).toContainText('The file has no column for "Seats", "Owned by"');
    await check(page, "\r\n\r\n", "empty.csv");
    await expect(page.getByTestId("equip-problems")).toContainText("The file is empty.");
  });

  test("a second upload adds only the new items and leaves the ones already here alone", async ({ page }) => {
    const t = tag();
    const first = `Playwright First ${t}`;
    const second = `Playwright Second ${t}`;
    await openUpload(page);
    await check(page, csv(row(first, "Shell", "1")));
    await page.getByTestId("equip-add").click();
    await expect(page.getByTestId("equip-done")).toContainText("Added 1 item.");
    await page.goto("/club/admin/equipment-import");
    // The new file says the first boat is now a quad and out of service: none of that is applied.
    await check(page, csv(row(first.toLowerCase(), "Shell", "4", "", "Club", "No", "", "changed"), row(second, "Paddle Board")));
    await expect(page.getByTestId("equip-summary")).toHaveText("This would add 1 item to the club (1 paddle board).");
    await expect(page.getByTestId("equip-already-here")).toContainText("1 item already here, left alone");
    await page.getByTestId("equip-add").click();
    await expect(page.getByTestId("equip-done")).toContainText("Added 1 item. 1 item in the file was already here and left alone.");
    await page.goto("/club/equipment");
    await expect(equipmentRow(page, first)).toContainText("In service");
    await expect(equipmentRow(page, second)).toHaveCount(1);
    await expect(equipmentRow(page, first.toLowerCase())).toHaveCount(0);
  });

  test("choosing a different file after a check clears the old preview, so only a file that was checked can be added", async ({ page }) => {
    const t = tag();
    await openUpload(page);
    await check(page, csv(row(`Playwright One ${t}`, "Shell", "1")), "first.csv");
    await expect(page.getByTestId("equip-add")).toBeVisible();
    await choose(page, csv(row(`Playwright Two ${t}`, "Shell", "1")), "second.csv");
    await expect(page.getByTestId("equip-preview")).toHaveCount(0);
    await expect(page.getByTestId("equip-add")).toHaveCount(0);
    await expect(page.getByTestId("equip-check")).toBeEnabled();
  });

  test("a bigger file lists the first fifty items and says how many more, then adds them all", async ({ page }) => {
    const t = tag();
    await openUpload(page);
    await check(page, csv(...Array.from({ length: 55 }, (_, i) => row(`Playwright Room ${t} ${String(i + 1).padStart(2, "0")}`, "Work Space"))));
    await expect(page.getByTestId("equip-summary")).toHaveText("This would add 55 items to the club (55 work spaces).");
    await expect(page.getByTestId("equip-item")).toHaveCount(50);
    await expect(page.getByText("…and 5 more items.")).toBeVisible();
    await page.getByTestId("equip-add").click();
    await expect(page.getByTestId("equip-done")).toContainText("Added 55 items.");
    await page.goto("/club/equipment");
    await expect(equipmentRow(page, `Playwright Room ${t} 55`)).toHaveCount(1);
  });
});

test.describe("on a phone", () => {
  test("the page and a preview fit the screen", async ({ browser, baseURL }) => {
    const t = tag();
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 700 } });
    const page = await context.newPage();
    await openUpload(page);
    await check(page, csv(row(`Playwright Phone Single ${t}`, "Shell", "1"), row(`Playwright Phone Kayak ${t}`, "Kayak", "2", "", "Club", "No", "", "Paddle needs mending")));
    await expect(page.getByTestId("equip-summary")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByTestId("equip-add").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
    await context.close();
  });
});
