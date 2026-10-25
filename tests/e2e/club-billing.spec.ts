import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Month-end billing: staff enter bar and snack-bar charges and visitors, members sign visitors in on the front-desk iPad,
 * and staff close a month and download the files for QuickBooks. The test server's clock stands still at 1 pm Pacific on
 * Wednesday Oct 28, 2026, so September 2026 is the month that has just finished and October cannot be closed yet. All tests
 * share one server, so each uses its own people and households, and only ONE test group (the last) closes a month: a closed
 * month stays closed. The invented club has a bar charge and a visitor entry in September (Whitcombe and Vandermeer), a
 * credit and more in October, and one household (Nakamura, joined this month) with no QuickBooks ID yet.
 */

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** The iPad's private address, as staff see it on their page. */
async function ipadAddress(browser: Browser, baseURL: string): Promise<string> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await actAs(page, "Test staff");
  await page.goto("/club/admin/ipad");
  const href = await page.getByTestId("ipad-link").getAttribute("href");
  await context.close();
  expect(href).toMatch(/^\/club\/ipad\/[A-Za-z0-9_-]{43}$/);
  return href!;
}

/** A member's ID, read from the test picker. */
async function memberId(browser: Browser, baseURL: string, name: string): Promise<string> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/club/act-as");
  const value = await page.getByRole("button", { name: `Act as ${name}`, exact: true }).getAttribute("value");
  await context.close();
  return value!.replace("member:", "");
}

/** A browser with nobody signed in: the iPad on the front desk. */
async function onTheIpad(browser: Browser, baseURL: string, viewport = { width: 1024, height: 768 }) {
  const context = await browser.newContext({ baseURL, viewport });
  return { context, page: await context.newPage() };
}

const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

/** Fill the charge form and press Add. `kind` is the radio's label. */
async function addCharge(page: Page, f: { household: string; kind?: "Bar" | "Snack bar" | "Adjustment"; amount: string; note?: string; day?: string; under?: string }) {
  const form = page.getByTestId("charge-form");
  await form.getByLabel("Household").selectOption({ label: f.household });
  await form.getByRole("radio", { name: f.kind ?? "Bar", exact: true }).check();
  await form.getByLabel(/^Amount/).fill(f.amount);
  if (f.under) await form.getByLabel("An adjustment goes under").selectOption({ label: f.under });
  // A refused charge leaves the form as it was, so the day is always set: it is never left over from the last try.
  await form.getByLabel("Day").fill(f.day ?? "2026-10-28");
  await form.getByLabel(/^Note/).fill(f.note ?? "");
  await form.getByRole("button", { name: "Add charge" }).click();
}
const chargeRow = (page: Page, text: string) => page.getByTestId("charge-row").filter({ hasText: text });

async function addVisitorsAsStaff(page: Page, who: string, count: string, day?: string) {
  const form = page.getByTestId("visitors-form");
  await form.getByLabel("Member who brought them").selectOption({ label: who });
  await form.getByLabel("How many visitors").fill(count);
  if (day) await form.getByLabel("Day").fill(day);
  await form.getByRole("button", { name: "Record visitors" }).click();
}

test.describe("who can use the billing screens", () => {
  test("only staff: a member finds none of the pages or downloads, and the staff office links to them", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    const tools = page.getByTestId("tools");
    for (const name of ["Bar and snack-bar charges", "Visitors", "Monthly billing"]) await expect(tools.getByRole("link", { name })).toBeVisible();
    await tools.getByRole("link", { name: "Bar and snack-bar charges" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Charges" })).toBeVisible();

    await actAs(page, "Nora Abernathy");
    for (const path of ["/club/admin/charges", "/club/admin/visitors", "/club/admin/billing", "/club/admin/billing?month=2026-09"]) expect((await page.goto(path))?.status(), path).toBe(404);
    for (const path of ["/api/club/billing/2026-09/qbo/1", "/api/club/billing/2026-09/charges"]) expect((await page.request.get(path)).status(), path).toBe(404);
  });

  test("someone not signed in is asked to sign in, and cannot download anything", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    for (const path of ["/club/admin/charges", "/club/admin/visitors", "/club/admin/billing"]) {
      await page.goto(path);
      await expect(page.getByRole("link", { name: "Sign in" }).first(), path).toBeVisible();
      await expect(page.getByTestId("charge-form")).toHaveCount(0);
      await expect(page.getByTestId("visitors-form")).toHaveCount(0);
      await expect(page.getByTestId("close-month-form")).toHaveCount(0);
    }
    for (const path of ["/api/club/billing/2026-09/qbo/1", "/api/club/billing/2026-09/charges"]) expect((await page.request.get(path)).status(), path).toBe(404);
    await context.close();
  });
});

test.describe("charges", () => {
  test("a bar sale and a snack-bar sale go on a household's account, newest first, with who entered them and whose tab", async ({ page }) => {
    const t = tag();
    await actAs(page, "Test staff");
    await page.goto("/club/admin/charges");
    await expect(page.getByTestId("charge-form").getByLabel("Household")).toBeVisible();
    await addCharge(page, { household: "The Eriksen household", amount: "42.50", note: `Round for the crew ${t}` });
    await expect(page.getByTestId("charge-form").getByTestId("action-ok")).toContainText("Bar: $42.50 added to The Eriksen household");
    await addCharge(page, { household: "The Eriksen household", kind: "Snack bar", amount: "7.25", note: `Chips ${t}` });
    await expect(page.getByTestId("charge-form").getByTestId("action-ok")).toContainText("Snack bar: $7.25 added to The Eriksen household");

    const bar = chargeRow(page, `Round for the crew ${t}`);
    await expect(bar).toHaveCount(1);
    await expect(bar).toContainText("The Eriksen household · $42.50");
    await expect(bar).toContainText("Bar · Oct 28, 2026");
    await expect(bar).toContainText("entered by Test staff");
    await expect(bar.getByRole("button", { name: /^Void/ })).toBeVisible();
    // The form was cleared for the next one, and the newest charge is above the older one.
    await expect(page.getByTestId("charge-form").getByLabel(/^Amount/)).toHaveValue("");
    const rows = await page.getByTestId("charge-row").filter({ hasText: t }).allTextContents();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(`Chips ${t}`);
    expect(rows[1]).toContain(`Round for the crew ${t}`);
  });

  test("a wrong amount, a missing reason and a day in the future are each explained, and nothing is saved", async ({ page }) => {
    const t = tag();
    await actAs(page, "Test staff");
    await page.goto("/club/admin/charges");
    const message = page.getByTestId("charge-form").getByTestId("action-error");

    await addCharge(page, { household: "The Halloran household", amount: "twelve", note: t });
    await expect(message).toHaveText("Enter an amount like 12.50. For a credit, put a minus sign in front.");
    await addCharge(page, { household: "The Halloran household", amount: "0", note: t });
    await expect(message).toHaveText("Enter an amount that is not zero.");
    await addCharge(page, { household: "The Halloran household", amount: "-5", note: t });
    await expect(message).toHaveText("A sale cannot be negative. Use an adjustment for a credit.");
    await addCharge(page, { household: "The Halloran household", kind: "Adjustment", amount: "-5", under: "Dues" });
    await expect(message).toHaveText("Say what the adjustment is for.");
    // The day box itself stops tomorrow being chosen (the server refuses it too, tested apart).
    await expect(page.getByTestId("charge-form").getByLabel("Day")).toHaveAttribute("max", "2026-10-28");
    await addCharge(page, { household: "The Halloran household", amount: "5", note: t, day: "2026-10-29" });
    await expect(message).toHaveText("Say what the adjustment is for.");
    await page.reload();
    await expect(page.getByTestId("charge-row").filter({ hasText: t })).toHaveCount(0);
  });

  test("an adjustment can be a credit under any line, and a wrong charge is voided with a reason and stays on the list", async ({ page }) => {
    const t = tag();
    await actAs(page, "Test staff");
    await page.goto("/club/admin/charges");
    await addCharge(page, { household: "The Abernathy household", kind: "Adjustment", amount: "-20.00", under: "Dues", note: `Dues taken twice ${t}` });
    await expect(page.getByTestId("charge-form").getByTestId("action-ok")).toContainText("Adjustment: -$20.00 added to The Abernathy household");
    const credit = chargeRow(page, `Dues taken twice ${t}`);
    await expect(credit).toContainText("The Abernathy household · -$20.00");
    await expect(credit).toContainText("Adjustment, dues");

    await addCharge(page, { household: "The Abernathy household", amount: "99.00", note: `Typed wrong ${t}` });
    const wrong = chargeRow(page, `Typed wrong ${t}`);
    await wrong.getByRole("button", { name: /^Void/ }).click();
    await expect(wrong.getByTestId("action-error")).toHaveCount(0);
    // A reason is required by the browser itself; type one and press again.
    await wrong.getByPlaceholder("Why void it?").fill("Meant 9.90");
    await wrong.getByRole("button", { name: /^Void/ }).click();
    await expect(wrong.getByTestId("charge-voided")).toHaveText("Voided: Meant 9.90");
    await expect(wrong.getByRole("button", { name: /^Void/ })).toHaveCount(0);
    await page.reload();
    await expect(chargeRow(page, `Typed wrong ${t}`).getByTestId("charge-voided")).toBeVisible();
  });

  test("many charges in a row all land, each household's list stays right, and the page works on a phone", async ({ page }) => {
    const t = tag();
    await page.setViewportSize({ width: 375, height: 667 });
    await actAs(page, "Test staff");
    await page.goto("/club/admin/charges");
    for (let i = 1; i <= 8; i += 1) {
      await addCharge(page, { household: i % 2 ? "The Tanaka-Brooks household" : "The Bellweather household", kind: i % 3 ? "Bar" : "Snack bar", amount: `${i}.50`, note: `Tab ${i} ${t}` });
      await expect(page.getByTestId("charge-form").getByTestId("action-ok")).toContainText(`$${i}.50`);
    }
    await page.reload();
    await expect(page.getByTestId("charge-row").filter({ hasText: t })).toHaveCount(8);
    await expect(chargeRow(page, `Tab 1 ${t}`)).toContainText("The Tanaka-Brooks household");
    await expect(chargeRow(page, `Tab 8 ${t}`)).toContainText("The Bellweather household");
    await noSideScroll(page);
  });
});

test.describe("visitors, entered by staff", () => {
  test("three is free, five costs ten dollars each, and voiding one puts the day back", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin/visitors");
    await expect(page.getByTestId("visitor-rule")).toHaveText("A member can bring up to 4 visitors a day for free. With more than that, every visitor that day costs $10.00.");
    await expect(page.getByTestId("placeholder-note")).toBeVisible();
    const message = page.getByTestId("visitors-form").getByTestId("action-ok");

    await addVisitorsAsStaff(page, "Kenji Tanaka", "3");
    await expect(message).toContainText("3 visitors recorded for Kenji Tanaka on Oct 28, 2026");
    await expect(message).toContainText("That makes 3 visitors that day, with no fee. 1 more visitor would still be free.");
    await addVisitorsAsStaff(page, "Kenji Tanaka", "2");
    await expect(message).toContainText("2 visitors recorded for Kenji Tanaka");
    await expect(message).toContainText("That makes 5 visitors that day. That is over 4, so each costs $10.00: $50.00");

    const rows = page.getByTestId("visitor-row").filter({ hasText: "Kenji Tanaka" });
    await expect(rows).toHaveCount(2);
    await expect(rows.first().getByTestId("visitor-day")).toHaveText("5 that day, so the fee is $50.00.");
    await rows.first().getByPlaceholder("Why void it?").fill("Counted the same group twice");
    await rows.first().getByRole("button", { name: /^Void/ }).click();
    await expect(rows.first().getByTestId("visitor-voided")).toHaveText("Voided: Counted the same group twice");
    await expect(rows.nth(1).getByTestId("visitor-day")).toHaveText("3 that day, no fee.");
  });

  test("a wrong number is explained, and a day's most is held", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin/visitors");
    const error = page.getByTestId("visitors-form").getByTestId("action-error");
    await addVisitorsAsStaff(page, "Ines Castellanos", "lots");
    await expect(error).toHaveText("Enter how many visitors, as a whole number.");
    await addVisitorsAsStaff(page, "Ines Castellanos", "13");
    await expect(error).toHaveText("Enter between 1 and 12 visitors.");
    await addVisitorsAsStaff(page, "Ines Castellanos", "0");
    await expect(error).toHaveText("Enter between 1 and 12 visitors.");
    const rows = page.getByTestId("visitor-row").filter({ hasText: "Ines Castellanos" });
    for (const [i, n] of ["12", "12"].entries()) {
      await addVisitorsAsStaff(page, "Ines Castellanos", n);
      // Wait for the list itself to show the new entry: the form clears itself once the page has refreshed.
      await expect(rows).toHaveCount(i + 1);
      await expect(page.getByTestId("visitors-form").getByLabel("How many visitors")).toHaveValue("");
    }
    await addVisitorsAsStaff(page, "Ines Castellanos", "12");
    await expect(error).toContainText("The most that can be recorded is 30");
    await expect(rows).toHaveCount(2);
  });
});

test.describe("visitors, signed in on the front-desk iPad", () => {
  test("a member finds their name, says how many, and is told what it costs; the staff screen shows it as signed in on the iPad", async ({ browser, baseURL }) => {
    const address = await ipadAddress(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!);
    await page.goto(address);
    await expect(page.getByTestId("ipad-visitors-link")).toHaveText("I'm bringing visitors");
    await page.getByTestId("ipad-visitors-link").click();
    await expect(page.getByRole("heading", { level: 1, name: "Bringing visitors?" })).toBeVisible();
    // The iPad shows no menu or staff links, and nothing is listed until a few letters are typed.
    await expect(page.getByRole("link", { name: "Staff office" })).toHaveCount(0);
    await expect(page.getByTestId("ipad-hosts")).toHaveCount(0);
    await page.getByLabel("Type your name, then press Find me").fill("er");
    await page.getByRole("button", { name: "Find me" }).click();
    await expect(page.getByTestId("ipad-host-short")).toHaveText("Type at least 3 letters of your name.");
    await expect(page.getByTestId("ipad-hosts")).toHaveCount(0);
    await page.getByLabel("Type your name, then press Find me").fill("eriksen");
    await page.getByRole("button", { name: "Find me" }).click();
    await expect(page.getByTestId("ipad-hosts").getByRole("link")).toHaveText(["Britta Eriksen", "Lars Eriksen"]);

    await page.getByRole("link", { name: "Lars Eriksen" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Lars" })).toBeVisible();
    await expect(page.getByTestId("ipad-visitor-rule")).toHaveText("A member can bring up to 4 visitors a day for free. With more than that, every visitor that day costs $10.00.");
    await expect(page.getByTestId("ipad-visitors-sofar")).toHaveCount(0);
    // Nothing is chosen until the member chooses; pressing the button with no number does nothing.
    await expect(page.locator('input[name="visitors"]:checked')).toHaveCount(0);
    const before = page.url();
    await page.getByRole("button", { name: "Sign in my visitors" }).click();
    // The browser itself stops the press: no request goes out, so the address is unchanged and nothing is said.
    expect(page.url()).toBe(before);
    await expect(page.getByTestId("ipad-visitors-done")).toHaveCount(0);
    await expect(page.getByTestId("ipad-notice")).toHaveCount(0);

    await page.getByText("3", { exact: true }).click();
    await page.getByRole("button", { name: "Sign in my visitors" }).click();
    await expect(page.getByTestId("ipad-visitors-done")).toHaveText("3 visitors are signed in. That makes 3 visitors today, with no fee. 1 more visitor would still be free.");
    await page.getByText("2", { exact: true }).click();
    await page.getByRole("button", { name: "Sign in my visitors" }).click();
    await expect(page.getByTestId("ipad-visitors-done")).toHaveText("2 visitors are signed in. That makes 5 visitors today. That is over 4, so each costs $10.00: $50.00, added to the household's bill.");
    await context.close();

    const staff = await browser.newContext({ baseURL });
    const staffPage = await staff.newPage();
    await actAs(staffPage, "Test staff");
    await staffPage.goto("/club/admin/visitors");
    const rows = staffPage.getByTestId("visitor-row").filter({ hasText: "Lars Eriksen" });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("signed in on the iPad");
    await expect(rows.first().getByTestId("visitor-day")).toHaveText("5 that day, so the fee is $50.00.");
    await staff.close();
  });

  test("it goes back to the start by itself, and a member with a membership that ended is not found", async ({ browser, baseURL }) => {
    const address = await ipadAddress(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!);
    await page.clock.install();
    await page.goto(`${address}/visitors?q=Fitzgerald`);
    await expect(page.getByTestId("ipad-host-none")).toHaveText("No member found with that name. Check the spelling, or ask club staff.");
    // The search screen goes back to the start by itself too, so the next person never sees what was typed.
    await expect(page.getByTestId("auto-return")).toContainText("goes back to the start after 30 seconds");
    await page.clock.fastForward("00:31");
    await expect(page.getByRole("heading", { level: 1, name: "Who is checking in?" })).toBeVisible();
    // Someone whose membership ended is not found by name, and their own screen sends the visitor back to the search.
    const colm = await memberId(browser, baseURL!, "Colm Fitzgerald");
    await page.goto(`${address}/visitors/${colm}`);
    await expect(page.getByRole("heading", { level: 1, name: "Bringing visitors?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in my visitors" })).toHaveCount(0);
    await page.goto(`${address}/visitors?q=Halloran`);
    await page.getByRole("link", { name: "Declan Halloran" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Declan" })).toBeVisible();
    await expect(page.getByTestId("auto-return")).toContainText("goes back to the start after 30 seconds");
    await page.clock.fastForward("00:31");
    await expect(page.getByRole("heading", { level: 1, name: "Who is checking in?" })).toBeVisible();
    await context.close();
  });

  test("a wrong address, a forged button and a nonsense number all find nothing or are refused in words", async ({ browser, baseURL }) => {
    const address = await ipadAddress(browser, baseURL!);
    const code = address.split("/").pop()!;
    const id = await memberId(browser, baseURL!, "Britta Eriksen");
    const { context, page } = await onTheIpad(browser, baseURL!);
    expect((await page.goto(`/club/ipad/${"x".repeat(43)}/visitors`))?.status()).toBe(404);
    expect((await page.goto(`/club/ipad/${"x".repeat(43)}/visitors/${id}`))?.status()).toBe(404);
    expect((await page.goto(`${address}/visitors/not-a-member`))?.status()).toBe(404);
    // A member who does not exist sends the visitor back to the search.
    await page.goto(`${address}/visitors/00000000-0000-4000-8000-000000000001`);
    await expect(page.getByRole("heading", { level: 1, name: "Bringing visitors?" })).toBeVisible();

    const post = (form: Record<string, string>) => page.request.post("/api/club/ipad/visitors", { form, maxRedirects: 0 });
    expect((await post({ code: "x".repeat(43), member: id, visitors: "1" })).status()).toBe(404);
    expect((await post({ member: id, visitors: "1" })).status()).toBe(404);
    expect((await post({ code, member: "00000000-0000-4000-8000-000000000001", visitors: "1" })).status()).toBe(404);
    for (const visitors of ["", "0", "13", "-1", "two", "1.5", "99999"]) {
      const res = await post({ code, member: id, visitors });
      expect(res.status(), visitors).toBe(303);
      expect(res.headers().location, visitors).toContain("notice=visitors");
    }
    await page.goto(`${address}/visitors/${id}?notice=visitors`);
    await expect(page.getByTestId("ipad-notice")).toHaveText("Those visitors could not be signed in. Check the number, or ask club staff for help.");
    // Nothing was recorded for her by any of that.
    const staff = await browser.newContext({ baseURL });
    const staffPage = await staff.newPage();
    await actAs(staffPage, "Test staff");
    await staffPage.goto("/club/admin/visitors");
    await expect(staffPage.getByTestId("visitor-row").filter({ hasText: "Britta Eriksen" })).toHaveCount(0);
    await staff.close();
    await context.close();
  });

  test("the most for one entry and for one day is held, and a fresh start works again for the next person", async ({ browser, baseURL }) => {
    const address = await ipadAddress(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!);
    await page.goto(`${address}/visitors?q=Rafael`);
    await page.getByRole("link", { name: "Rafael Castellanos" }).click();
    const pick = async (n: string) => {
      await page.locator(`input[name="visitors"][value="${n}"]`).check({ force: true });
      await page.getByRole("button", { name: "Sign in my visitors" }).click();
    };
    await expect(page.locator('input[name="visitors"]')).toHaveCount(12);
    await pick("12");
    await expect(page.getByTestId("ipad-visitors-done")).toContainText("12 visitors are signed in");
    await expect(page.getByTestId("ipad-visitors-done")).toContainText("each costs $10.00: $120.00");
    await pick("12");
    await expect(page.getByTestId("ipad-visitors-done")).toContainText("That makes 24 visitors today");
    // 24 + 12 would be 36, over the most of 30 a day: refused in words, nothing recorded.
    await pick("12");
    await expect(page.getByTestId("ipad-notice")).toHaveText("Those visitors could not be signed in. Check the number, or ask club staff for help.");
    await expect(page.getByTestId("ipad-visitors-sofar")).toHaveText("You have signed in 24 visitors today.");
    await pick("6");
    await expect(page.getByTestId("ipad-visitors-done")).toContainText("That makes 30 visitors today");
    await context.close();
  });

  test("the visitor screens fit a phone-sized screen and their buttons are big enough to tap", async ({ browser, baseURL }) => {
    const address = await ipadAddress(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!, { width: 375, height: 667 });
    await page.goto(`${address}/visitors?q=Pemberton`);
    await noSideScroll(page);
    await page.getByRole("link", { name: "Walter Pemberton" }).click();
    await noSideScroll(page);
    for (const label of await page.locator(".ipad-count").all()) {
      const box = await label.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const button = await page.getByRole("button", { name: "Sign in my visitors" }).boundingBox();
    expect(button!.height).toBeGreaterThanOrEqual(44);
    await context.close();
  });
});

test.describe("a household's QuickBooks ID", () => {
  test("is set and corrected on the household's page, written to its file, and never given to two households", async ({ page }) => {
    const t = tag();
    const name = `The Quince ${t} household`;
    await actAs(page, "Test staff");
    await page.goto("/club/admin/households/new");
    await page.getByLabel("Household name").fill(name);
    await page.locator("#firstName").fill("Quin");
    await page.locator("#lastName").fill("Quince");
    await page.locator("#email").fill(`quin.${t}@example.com`);
    await page.getByRole("button", { name: "Add household" }).click();
    await expect(page.getByTestId("changed")).toHaveText("Household added.");

    const records = page.getByLabel("Household records");
    await expect(records).toContainText("QuickBooks ID");
    await expect(records).toContainText("not linked yet");
    const form = page.getByTestId("quickbooks-form");
    await expect(form.getByRole("button", { name: "Save QuickBooks ID" })).toBeVisible();
    await form.getByLabel("QuickBooks ID").fill(`QB-${t}`);
    await form.getByRole("button", { name: "Save QuickBooks ID" }).click();
    await expect(form.getByTestId("action-ok")).toHaveText(`QuickBooks ID saved: QB-${t}. The change is in the household's file.`);
    await expect(records).toContainText(`QB-${t}`);
    await expect(page.getByRole("list", { name: "Household history" })).toContainText(`QuickBooks ID set to QB-${t}.`);
    await expect(form.getByRole("button", { name: "Correct QuickBooks ID" })).toBeVisible();

    await form.getByRole("button", { name: "Correct QuickBooks ID" }).click();
    await expect(form.getByTestId("action-error")).toHaveText(`${name} already has QuickBooks ID QB-${t}.`);
    await form.getByLabel("QuickBooks ID").fill("SAMPLE-1001");
    await form.getByRole("button", { name: "Correct QuickBooks ID" }).click();
    await expect(form.getByTestId("action-error")).toHaveText("QuickBooks ID SAMPLE-1001 already belongs to The Lindqvist household.");
    await form.getByLabel("QuickBooks ID").fill(`QB-${t}-fixed`);
    await form.getByRole("button", { name: "Correct QuickBooks ID" }).click();
    await expect(form.getByTestId("action-ok")).toContainText(`QB-${t}-fixed`);
    await expect(page.getByRole("list", { name: "Household history" })).toContainText(`QuickBooks ID changed from QB-${t} to QB-${t}-fixed.`);

    // After the membership ends the last bill still needs the ID, so it can still be corrected.
    await page.getByTestId("end-link").click();
    await page.getByRole("button", { name: "Yes, end this membership" }).click();
    await expect(page.getByTestId("changed")).toContainText("Membership ended.");
    const ended = page.getByTestId("quickbooks-form");
    await ended.getByLabel("QuickBooks ID").fill(`QB-${t}-last`);
    await ended.getByRole("button", { name: "Correct QuickBooks ID" }).click();
    await expect(ended.getByTestId("action-ok")).toContainText(`QB-${t}-last`);
  });

  test("a member does not see the QuickBooks card at all", async ({ page }) => {
    await actAs(page, "Erik Lindqvist");
    await page.goto("/club");
    await expect(page.getByTestId("quickbooks-form")).toHaveCount(0);
    await expect(page.getByLabel("Household records")).toHaveCount(0);
  });
});

/**
 * Closing a month is permanent for a server, so every step is in one group, run in order, and this is the only group that
 * does it. September 2026 has finished (October has not). If September was already closed on this server (the tests were run
 * twice without restarting it), the group is skipped.
 */
test.describe("closing a month", () => {
  test.describe.configure({ mode: "serial" });
  const t = tag();
  const NEW = `The Basil ${t} household`;
  const ID = `QB-BASIL-${t}`;
  let open = true;

  const preview = (page: Page) => page.goto("/club/admin/billing?month=2026-09");
  const invoiceFor = (page: Page, household: string) => page.getByTestId("invoice").filter({ hasText: household });

  test("a household that owes something and has no QuickBooks ID stops the month, and the screen says exactly which", async ({ page }) => {
    await actAs(page, "Test staff");
    await preview(page);
    if ((await page.getByTestId("closed-summary").count()) > 0) {
      open = false;
      test.skip(true, "September 2026 was already closed on this server. Restart the test server to run this group again.");
    }
    // A household that has been a member since 2015 owes September dues.
    await page.goto("/club/admin/households/new");
    await page.getByLabel("Household name").fill(NEW);
    await page.getByLabel("Joined").fill("2015-01-01");
    await page.locator("#firstName").fill("Basil");
    await page.locator("#lastName").fill(`Basil${t}`);
    await page.locator("#email").fill(`basil.${t}@example.com`);
    await page.getByRole("button", { name: "Add household" }).click();
    await expect(page.getByTestId("changed")).toHaveText("Household added.");
    await page.goto("/club/admin/charges");
    await addCharge(page, { household: NEW, amount: "31.00", note: `September drinks ${t}`, day: "2026-09-14" });
    await expect(page.getByTestId("charge-form").getByTestId("action-ok")).toContainText("Bar: $31.00");
    await addCharge(page, { household: NEW, kind: "Adjustment", amount: "-20.00", under: "Dues", note: `Dues credit ${t}`, day: "2026-09-10" });
    await expect(page.getByTestId("charge-form").getByTestId("action-ok")).toContainText("Adjustment: -$20.00");
    await addCharge(page, { household: "The Bellweather household", kind: "Snack bar", amount: "9.75", note: `September snacks ${t}`, day: "2026-09-20" });
    await expect(page.getByTestId("charge-form").getByTestId("action-ok")).toContainText("Snack bar: $9.75");

    await preview(page);
    await expect(page.getByRole("heading", { level: 2, name: "September 2026: what closing it would do" })).toBeVisible();
    const problems = page.getByTestId("billing-problems");
    await expect(problems).toContainText(`${NEW} has charges but no QuickBooks ID. Add it on the household's page.`);
    await expect(page.getByTestId("close-month")).toHaveCount(0);
    // The invoice is still shown, so it can be checked.
    await expect(invoiceFor(page, NEW)).toContainText("QuickBooks ID none yet");
  });

  test("with the ID added, the preview shows every line of the invoice and the close button appears; looking changes nothing", async ({ page }) => {
    test.skip(!open, "September 2026 was already closed on this server.");
    await actAs(page, "Test staff");
    await page.goto("/club");
    await page.getByRole("link", { name: NEW }).click();
    const form = page.getByTestId("quickbooks-form");
    await form.getByLabel("QuickBooks ID").fill(ID);
    await form.getByRole("button", { name: "Save QuickBooks ID" }).click();
    await expect(form.getByTestId("action-ok")).toContainText(ID);

    for (let look = 0; look < 3; look += 1) {
      await preview(page);
      await expect(page.getByTestId("billing-problems")).toHaveCount(0);
      const invoice = invoiceFor(page, NEW);
      await expect(invoice).toContainText(`QuickBooks ID ${ID}`);
      const lines = invoice.getByTestId("invoice-line");
      await expect(lines).toHaveCount(3);
      await expect(lines.nth(0)).toContainText("September 2026 dues (Resident)");
      await expect(lines.nth(0)).toContainText("$154.50");
      await expect(lines.nth(1)).toContainText(`Adjustment: Dues credit ${t}`);
      await expect(lines.nth(1)).toContainText("-$20.00");
      await expect(lines.nth(1)).toContainText("credit");
      await expect(lines.nth(2)).toContainText("Bar: 1 charge in September 2026");
      await expect(lines.nth(2)).toContainText("$31.00");
      await expect(lines.nth(2)).not.toContainText("taxable");
      await expect(invoice).toContainText("$165.50");
      await expect(invoiceFor(page, "The Bellweather household")).toContainText("Snack bar: 1 charge in September 2026");
    }
    await expect(page.getByTestId("billing-summary")).toContainText("credit line");
    await expect(page.getByTestId("billing-notices")).toContainText("cannot go in QuickBooks' invoice file");
    await expect(page.getByTestId("billing-notices")).toContainText("placeholders");
    await expect(page.getByTestId("close-month")).toHaveText("Close September 2026 and create the files");
    await expect(page.getByTestId("no-closed-months")).toBeVisible();
    // Next month cannot be closed yet.
    await page.goto("/club/admin/billing?month=2026-10");
    await expect(page.getByTestId("billing-problems")).toContainText("October 2026 has not finished yet. It can be billed from");
    await expect(page.getByTestId("close-month")).toHaveCount(0);
  });

  test("closing freezes the month, lists it, and makes the files; a changed month is caught, so it is looked at again until it holds", async ({ page }) => {
    test.skip(!open, "September 2026 was already closed on this server.");
    await actAs(page, "Test staff");
    // Another test may add a household in the meantime (they share this server): if the preview went stale, look again.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await preview(page);
      if ((await page.getByTestId("closed-summary").count()) > 0) break;
      await page.getByTestId("close-month").click();
      const outcome = page.getByTestId("closed-summary").or(page.getByTestId("close-month-form").getByTestId("action-error"));
      await expect(outcome).toBeVisible();
      if ((await page.getByTestId("closed-summary").count()) > 0) break;
      await expect(page.getByTestId("close-month-form").getByTestId("action-error")).toContainText("changed since you previewed it, so nothing was billed");
    }
    await expect(page.getByRole("heading", { level: 2, name: "September 2026 is closed" })).toBeVisible();
    await expect(page.getByTestId("closed-summary")).toContainText("Closed by Test staff on");
    await expect(page.getByTestId("closed-summary")).toContainText("These lines are frozen.");
    await expect(page.getByTestId("close-month")).toHaveCount(0);
    await expect(page.getByTestId("credits-note")).toContainText("not in the QuickBooks files, because QuickBooks does not import negative amounts");
    await expect(page.getByTestId("qbo-steps")).toContainText("MM/DD/YYYY");
    await expect(page.getByTestId("qbo-steps")).toContainText("Membership Dues, Event Tickets, Guest Fees, Bar Sales, Snack Bar Sales");
    await expect(page.getByTestId("billing-tax-note")).toContainText("These files charge no sales tax on any line.");
    await expect(invoiceFor(page, NEW).getByTestId("invoice-line")).toHaveCount(3);
    const closed = page.getByTestId("closed-month");
    await expect(closed).toHaveCount(1);
    await expect(closed).toContainText("September 2026");
    await expect(closed).toContainText("closed by Test staff");
    // Closed once: the page does not offer to close it again, however often it is opened.
    for (let i = 0; i < 3; i += 1) {
      await preview(page);
      await expect(page.getByTestId("close-month")).toHaveCount(0);
      await expect(page.getByTestId("closed-month")).toHaveCount(1);
    }
  });

  test("the QuickBooks file has what QuickBooks asks for and no negative amounts, and the plain file has everything; downloading again gives the same bytes", async ({ page }) => {
    test.skip(!open, "September 2026 was already closed on this server.");
    await actAs(page, "Test staff");
    await preview(page);
    const links = page.getByTestId("qbo-part");
    const parts = await links.count();
    expect(parts).toBeGreaterThanOrEqual(1);
    await expect(links.first()).toContainText(`part 1 of ${parts}`);

    const first = await page.request.get("/api/club/billing/2026-09/qbo/1");
    expect(first.status()).toBe(200);
    expect(first.headers()["content-type"]).toContain("text/csv");
    expect(first.headers()["content-disposition"]).toBe(`attachment; filename="ccs-quickbooks-invoices-2026-09-part-1-of-${parts}.csv"`);
    expect(first.headers()["cache-control"]).toBe("no-store");
    const body = await first.text();
    const rows = body.split("\r\n").filter(Boolean);
    expect(rows[0]).toBe("InvoiceNo,Customer,InvoiceDate,DueDate,Memo,Item(Product/Service),ItemDescription,ItemQuantity,ItemRate,ItemAmount");
    expect(rows.length - 1).toBeLessThanOrEqual(999);
    expect(body).not.toMatch(/,-\d/);
    // Dates are written the way QuickBooks is told to read them: month, day, year.
    const mine = (await (async () => {
      const all: string[] = [];
      for (let n = 1; n <= parts; n += 1) all.push(...(await (await page.request.get(`/api/club/billing/2026-09/qbo/${n}`)).text()).split("\r\n").filter((r) => r.includes(NEW)));
      return all;
    })());
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatch(/^\d{4}-\d{4},"?The Basil .* household"?,09\/30\/2026,10\/15\/2026,College Club Seattle September 2026,Membership Dues,/);
    expect(mine[0]).toContain(",154.50,154.50");
    expect(mine[1]).toContain(",Bar Sales,");
    expect(mine[1]).toContain(",31.00,31.00");
    expect(mine.join("")).not.toContain("-20.00");

    const again = await page.request.get("/api/club/billing/2026-09/qbo/1");
    expect(await again.text()).toBe(body);
    expect((await page.request.get(`/api/club/billing/2026-09/qbo/${parts + 1}`)).status()).toBe(404);
    for (const path of ["/api/club/billing/2026-09/qbo/0", "/api/club/billing/2026-09/qbo/abc", "/api/club/billing/2026-10/qbo/1", "/api/club/billing/2026-13/qbo/1", "/api/club/billing/september/charges", "/api/club/billing/2026-10/charges"]) {
      expect((await page.request.get(path)).status(), path).toBe(404);
    }

    const plain = await page.request.get("/api/club/billing/2026-09/charges");
    expect(plain.status()).toBe(200);
    expect(plain.headers()["content-type"]).toContain("text/csv");
    expect(plain.headers()["content-disposition"]).toBe('attachment; filename="ccs-charges-2026-09.csv"');
    const text = await plain.text();
    expect(text.split("\r\n")[0]).toBe("Month,Invoice no,QuickBooks ID,Household,Line,QuickBooks item,Description,Quantity,Unit price,Amount,Taxable,Adjustment");
    const mineRows = text.split("\r\n").filter((r) => r.includes(NEW));
    expect(mineRows).toHaveLength(3);
    expect(mineRows.find((r) => r.includes("-20.00"))).toContain(`${ID}`);
    expect(mineRows.find((r) => r.includes("Bar Sales"))).toMatch(/,31\.00,31\.00,No,No$/);
    expect(mineRows.find((r) => r.includes("Membership Dues"))).toMatch(/,154\.50,154\.50,No,No$/);
    expect(mineRows.find((r) => r.includes("-20.00"))).toMatch(/,No,Yes$/);

    // The files do not exist for a member, even one who knows the address.
    await actAs(page, "Nora Abernathy");
    expect((await page.request.get("/api/club/billing/2026-09/qbo/1")).status()).toBe(404);
    expect((await page.request.get("/api/club/billing/2026-09/charges")).status()).toBe(404);
  });

  test("once a month is closed nothing more can be dated in it, here or on the visitor screen, and its charges can no longer be voided", async ({ page }) => {
    test.skip(!open, "September 2026 was already closed on this server.");
    await actAs(page, "Test staff");
    await page.goto("/club/admin/charges");
    const drinks = chargeRow(page, `September drinks ${t}`);
    await expect(drinks.getByTestId("charge-billed")).toHaveText("Billed in September 2026. It can no longer be voided: add an adjustment instead.");
    await expect(drinks.getByRole("button", { name: /^Void/ })).toHaveCount(0);
    await addCharge(page, { household: NEW, amount: "5.00", note: `Late September ${t}`, day: "2026-09-30" });
    await expect(page.getByTestId("charge-form").getByTestId("action-error")).toHaveText("September 2026 was already billed, so nothing can be dated in it. Date it today instead, as an adjustment.");
    await expect(chargeRow(page, `Late September ${t}`)).toHaveCount(0);
    // The fix is an adjustment dated today, which goes on the next bill.
    await addCharge(page, { household: NEW, kind: "Adjustment", amount: "-5.00", under: "Bar", note: `Fix for September ${t}` });
    await expect(page.getByTestId("charge-form").getByTestId("action-ok")).toContainText("Adjustment: -$5.00");

    await page.goto("/club/admin/visitors");
    await addVisitorsAsStaff(page, "Hollis Whitcombe", "1", "2026-09-30");
    await expect(page.getByTestId("visitors-form").getByTestId("action-error")).toContainText("September 2026 was already billed");
    await expect(page.getByTestId("visitor-billed").first()).toContainText("Billed in September 2026");
    const billedRows = page.getByTestId("visitor-row").filter({ has: page.getByTestId("visitor-billed") });
    expect(await billedRows.count()).toBeGreaterThanOrEqual(1);
    await expect(billedRows.getByRole("button", { name: /^Void/ })).toHaveCount(0);
  });

  test("the billing screens fit a phone-sized screen", async ({ page }) => {
    test.skip(!open, "September 2026 was already closed on this server.");
    await page.setViewportSize({ width: 375, height: 667 });
    await actAs(page, "Test staff");
    for (const path of ["/club/admin/billing?month=2026-09", "/club/admin/billing?month=2026-10", "/club/admin/charges", "/club/admin/visitors"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await noSideScroll(page);
    }
  });
});
