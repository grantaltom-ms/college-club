import { expect, test, type Page } from "@playwright/test";

/**
 * Move-in day: staff upload the club's roster, check it, and add it. Every test uses its own QuickBooks IDs, household names and
 * addresses (the tests share one server), and only invented people. The sign-in test goes all the way: an imported adult asks
 * for a link and signs in.
 */

const HEADER = "QuickBooks ID,Household name,Membership type,Joined,First name,Last name,Email,Phone,Role";
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n") + "\r\n";
const SENT = "If that address belongs to a member or to club staff, a sign-in link is on its way. It works once, and it stops working in 15 minutes. If it does not arrive, check your spam folder.";

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

const choose = (page: Page, text: string, name = "roster.csv") => page.locator("#roster-file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
const check = async (page: Page, text: string, name?: string) => {
  await choose(page, text, name);
  await page.getByTestId("import-check").click();
};
const openImport = async (page: Page) => {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/import");
  await expect(page.getByRole("heading", { level: 1, name: "Import households" })).toBeVisible();
};

/** A household's rows in the file: `adults` is a list of first names, each adult a row. */
const household = (t: string, n: number, adults: string[], extra: { type?: string; joined?: string } = {}) =>
  adults.map((first, i) => `QB-${t}-${n},The ${adults[0]}${t}${n} household,${extra.type ?? "Resident"},${extra.joined ?? "2015-06-01"},${first},Family${t}${n},${first.toLowerCase()}.${t}.${n}@example.com,${i === 0 ? "206-555-0142" : ""},`).join("\r\n");

test.describe("who can import", () => {
  test("only staff: a member finds neither the page nor the template, and the staff office links to it", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    await expect(page.getByTestId("tools").getByRole("link", { name: "Import households" })).toBeVisible();
    await actAs(page, "Nora Abernathy");
    expect((await page.goto("/club/admin/import"))?.status()).toBe(404);
    expect((await page.request.get("/api/club/import/template")).status()).toBe(404);
  });

  test("someone not signed in is asked to sign in, and cannot download the template", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto("/club/admin/import");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await expect(page.getByTestId("import-form")).toHaveCount(0);
    expect((await page.request.get("/api/club/import/template")).status()).toBe(404);
    await context.close();
  });
});

test.describe("the template", () => {
  test("downloads as a CSV with every column and three example rows, and the example rows cannot be added by accident", async ({ page }) => {
    await openImport(page);
    const res = await page.request.get("/api/club/import/template");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("ccs-roster-template.csv");
    const body = await res.text();
    expect(body.split("\r\n")[0]).toBe(HEADER);
    expect(body).toContain("EXAMPLE-1");
    await check(page, body, "ccs-roster-template.csv");
    const problems = page.getByTestId("import-problems");
    await expect(problems).toContainText("ccs-roster-template.csv has 3 problems");
    await expect(problems).toContainText("Row 2:");
    await expect(problems).toContainText("one of the template's example rows");
    await expect(page.getByTestId("import-add")).toHaveCount(0);
  });
});

test.describe("checking and adding", () => {
  test("shows what a file would do, saves nothing until Add is pressed, then the households are there and their adults can sign in", async ({ page, browser, baseURL }) => {
    const t = tag();
    const text = csv(household(t, 1, ["Una", "Vic"]), household(t, 2, ["Wes"], { type: "Intermediate", joined: "3/14/2022" }));
    await openImport(page);
    await check(page, text);

    const summary = page.getByTestId("import-summary");
    await expect(summary).toHaveText("This would add 2 households with 3 adults.");
    const cards = page.getByTestId("import-household");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText(`The Una${t}1 household`);
    await expect(cards.nth(0)).toContainText("Resident · joined 2015-06-01 · QuickBooks ID QB-" + t + "-1");
    await expect(cards.nth(0)).toContainText(`Una Family${t}1 (primary adult) · una.${t}.1@example.com`);
    await expect(cards.nth(0)).toContainText(`Vic Family${t}1 (additional adult)`);
    await expect(cards.nth(1)).toContainText("Intermediate · joined 2022-03-14");

    // Nothing is saved by checking.
    await page.goto("/club");
    await expect(page.getByText(`The Una${t}1 household`)).toHaveCount(0);

    await page.goto("/club/admin/import");
    await check(page, text);
    await page.getByTestId("import-add").click();
    await expect(page.getByTestId("import-done")).toContainText("Added 2 households with 3 adults.");
    await expect(page.getByTestId("import-add")).toHaveCount(0);

    // They are in the club now, with their details and a note in the household's file.
    await page.getByRole("link", { name: "See the households" }).click();
    await page.getByRole("link", { name: `The Una${t}1 household` }).click();
    await expect(page.getByTestId("household-facts")).toContainText("Resident");
    await expect(page.getByTestId("member-row")).toHaveCount(2);
    await expect(page.getByTestId("member-row").first()).toContainText(`una.${t}.1@example.com · 206-555-0142`);
    await expect(page.getByRole("list", { name: "Household history" })).toContainText(`The Una${t}1 household joined as Resident. Added from a roster file; join date Jun 1, 2015.`);
    await expect(page.getByText(`QB-${t}-1`).first()).toBeVisible();

    // An imported adult can ask for a sign-in link and sign in.
    const member = await browser.newContext({ baseURL });
    const m = await member.newPage();
    const email = `una.${t}.1@example.com`;
    await m.goto("/club/sign-in");
    await m.getByLabel("Your email address").fill(email);
    await m.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(m.getByTestId("link-sent")).toHaveText(SENT);
    await m.goto("/club/outbox");
    await m.getByTestId("outbox-message").filter({ hasText: `To ${email}` }).first().getByTestId("outbox-link").click();
    await m.getByRole("button", { name: `Sign in as Una Family${t}1`, exact: true }).click();
    await expect(m.getByTestId("acting-as")).toHaveText(`Signed in as Una Family${t}1.`);
    await member.close();
  });

  test("lists every problem with its row number, adds nothing, and the fixed file goes through", async ({ page }) => {
    const t = tag();
    const bad = csv(
      household(t, 1, ["Una"]).replace(",Resident,", ",Residnt,"),
      household(t, 2, ["Vic"]).replace(`vic.${t}.2@example.com`, "vic-at-example"),
      household(t, 3, ["Wes"]).replace("2015-06-01", "June 2015"),
    );
    await openImport(page);
    await check(page, bad, "bad.csv");
    const problems = page.getByTestId("import-problems");
    await expect(problems).toContainText("bad.csv has 3 problems");
    await expect(problems).toContainText("Nothing can be added until the file is fixed.");
    await expect(problems.getByRole("listitem")).toHaveText([
      'Row 2: Membership type "Residnt" is not Resident, Intermediate or Non-Resident.',
      'Row 3: "vic-at-example" does not look like an email address.',
      'Row 4: Joined "June 2015" is not a date. Write it like 2020-01-15 or 1/15/2020.',
    ]);
    await expect(page.getByTestId("import-add")).toHaveCount(0);
    await expect(page.getByTestId("import-household")).toHaveCount(0);

    await check(page, csv(household(t, 1, ["Una"]), household(t, 2, ["Vic"]), household(t, 3, ["Wes"])), "fixed.csv");
    await expect(page.getByTestId("import-problems")).toHaveCount(0);
    await expect(page.getByTestId("import-summary")).toHaveText("This would add 3 households with 3 adults.");
    await page.getByTestId("import-add").click();
    await expect(page.getByTestId("import-done")).toContainText("Added 3 households with 3 adults.");
  });

  test("says what is wrong when the file is not a roster at all: an Excel file, a missing column, nothing in it", async ({ page }) => {
    await openImport(page);
    await check(page, "PK\u0003\u0004 pretend this is an Excel workbook", "roster.xlsx");
    await expect(page.getByTestId("import-problems")).toContainText("That looks like an Excel file, not a CSV.");
    await check(page, "Customer,Balance\r\nThe Smith household,$0\r\n");
    await expect(page.getByTestId("import-problems")).toContainText('The file has no column for "QuickBooks ID"');
    await check(page, "\r\n");
    await expect(page.getByTestId("import-problems")).toContainText("The file is empty.");
  });

  test("a second upload adds only the new households and leaves the ones already here alone", async ({ page }) => {
    const t = tag();
    await openImport(page);
    await check(page, csv(household(t, 1, ["Una"]), household(t, 2, ["Vic"])));
    await page.getByTestId("import-add").click();
    await expect(page.getByTestId("import-done")).toContainText("Added 2 households with 2 adults.");

    // The same file again: everything is already here.
    await page.goto("/club/admin/import");
    await check(page, csv(household(t, 1, ["Una"]), household(t, 2, ["Vic"])));
    await expect(page.getByTestId("import-summary")).toHaveText("There is nothing to add: every household in the file is already here.");
    await expect(page.getByTestId("import-already-here")).toContainText("2 households already here, left alone");
    await expect(page.getByTestId("import-already-here")).toContainText(`The Una${t}1 household (QuickBooks ID QB-${t}-1)`);
    await expect(page.getByTestId("import-add")).toHaveCount(0);

    // One old household with different details, and one new one.
    await check(page, csv(household(t, 1, ["Una"]).replace("Resident", "Non-Resident"), household(t, 3, ["Wes"])));
    await expect(page.getByTestId("import-summary")).toHaveText("This would add 1 household with 1 adult.");
    await expect(page.getByTestId("import-already-here")).toContainText("1 household already here, left alone");
    await page.getByTestId("import-add").click();
    await expect(page.getByTestId("import-done")).toContainText("Added 1 household with 1 adult. 1 household in the file was already here and left alone.");

    // The household that was already here kept its original type.
    await page.goto("/club");
    await page.getByRole("link", { name: `The Una${t}1 household` }).click();
    await expect(page.getByTestId("household-facts")).toContainText("Resident");
    await expect(page.getByTestId("household-facts")).not.toContainText("Non-Resident");
  });

  test("shows things worth a look without stopping the import", async ({ page }) => {
    const t = tag();
    const text = [HEADER + ",Balance", `${household(t, 1, ["Una"])},$0`, `${household(t, 2, ["Vic"]).replace(`vic.${t}.2@example.com`, `una.${t}.1@example.com`)},$0`].join("\r\n");
    await openImport(page);
    await check(page, text);
    const notices = page.getByTestId("import-notices");
    await expect(notices).toContainText('they are ignored: "Balance"');
    await expect(notices).toContainText(`The address una.${t}.1@example.com is used in more than one household in the file`);
    await expect(page.getByTestId("import-add")).toBeVisible();
  });

  test("choosing a different file after a check clears the old preview, so only a file that was checked can be added", async ({ page }) => {
    const t = tag();
    await openImport(page);
    await check(page, csv(household(t, 1, ["Una"])), "first.csv");
    await expect(page.getByTestId("import-add")).toBeVisible();
    await choose(page, csv(household(t, 2, ["Vic"])), "second.csv");
    await expect(page.getByTestId("import-preview")).toHaveCount(0);
    await expect(page.getByTestId("import-add")).toHaveCount(0);
    await expect(page.getByTestId("import-check")).toBeEnabled();
  });

  test("works again and again: three files in a row, each checked and added, nothing doubled", async ({ page }) => {
    const t = tag();
    await openImport(page);
    for (let round = 1; round <= 3; round++) {
      await page.goto("/club/admin/import");
      await check(page, csv(...Array.from({ length: round }, (_, i) => household(t, i + 1, ["Una", "Vic"]))));
      await expect(page.getByTestId("import-summary")).toHaveText(`This would add 1 household with 2 adults.`.replace("1 household", "1 household"));
      await page.getByTestId("import-add").click();
      await expect(page.getByTestId("import-done")).toContainText("Added 1 household with 2 adults.");
    }
    await page.goto("/club");
    for (let n = 1; n <= 3; n++) await expect(page.getByRole("link", { name: `The Una${t}${n} household` })).toHaveCount(1);
  });

  test("a bigger file lists the first fifty households and says how many more, then adds them all", async ({ page }) => {
    const t = tag();
    await openImport(page);
    await check(page, csv(...Array.from({ length: 60 }, (_, i) => household(t, i + 1, ["Una", "Vic"]))));
    await expect(page.getByTestId("import-summary")).toHaveText("This would add 60 households with 120 adults.");
    await expect(page.getByTestId("import-household")).toHaveCount(50);
    await expect(page.getByText("…and 10 more households.")).toBeVisible();
    await page.getByTestId("import-add").click();
    await expect(page.getByTestId("import-done")).toContainText("Added 60 households with 120 adults.");
    await page.goto("/club");
    await expect(page.getByRole("link", { name: `The Una${t}60 household` })).toHaveCount(1);
  });
});

test.describe("on a phone", () => {
  test("the import page and a preview fit the screen", async ({ browser, baseURL }) => {
    const t = tag();
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 700 } });
    const page = await context.newPage();
    await openImport(page);
    await check(page, csv(household(t, 1, ["Una", "Vic"]), household(t, 2, ["Wes"])));
    await expect(page.getByTestId("import-summary")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByTestId("import-add").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
    await context.close();
  });
});
