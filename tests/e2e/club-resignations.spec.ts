import { expect, test, type Page } from "@playwright/test";

/**
 * Move-out day: staff upload a list of households that resigned, check it, and end their memberships. Every test imports its own
 * invented households first (the tests share one server, so the club's sample households are never ended here), with its own
 * QuickBooks IDs, names and addresses, and only invented people.
 */

const ROSTER_HEADER = "QuickBooks ID,Household name,Membership type,Joined,First name,Last name,Email,Phone,Role";
const HEADER = "QuickBooks ID,Household name,Note";
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n") + "\r\n";

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** A household's rows in the roster: `adults` is a list of first names, each adult a row. */
const rosterRows = (t: string, n: number, adults: string[]) =>
  adults.map((first, i) => `QB-${t}-${n},${nameOf(t, n, adults)},Resident,2015-06-01,${first},Family${t}${n},${first.toLowerCase()}.${t}.${n}@example.com,${i === 0 ? "206-555-0142" : ""},`).join("\r\n");
const nameOf = (t: string, n: number, adults: string[]) => `The ${adults[0]}${t}${n} household`;

/** Staff add households through the roster import. */
async function addHouseholds(page: Page, rows: string[]) {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/import");
  await page.locator("#roster-file").setInputFiles({ name: "roster.csv", mimeType: "text/csv", buffer: Buffer.from([ROSTER_HEADER, ...rows].join("\r\n") + "\r\n") });
  await page.getByTestId("import-check").click();
  await page.getByTestId("import-add").click();
  await expect(page.getByTestId("import-done")).toContainText("Added");
}

const choose = (page: Page, text: string, name = "resignations.csv") => page.locator("#resign-file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
const check = async (page: Page, text: string, name?: string) => {
  await choose(page, text, name);
  await page.getByTestId("resign-check").click();
};
const openResignations = async (page: Page) => {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/resignations");
  await expect(page.getByRole("heading", { level: 1, name: "End memberships from a file" })).toBeVisible();
};
const openHousehold = async (page: Page, name: string) => {
  await page.goto("/club");
  await page.getByRole("link", { name, exact: true }).click();
};

test.describe("who can use it", () => {
  test("only staff: a member finds neither the page nor the template, and the staff office links to it", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    await expect(page.getByTestId("tools").getByRole("link", { name: "Resignations", exact: true })).toBeVisible();
    await actAs(page, "Nora Abernathy");
    expect((await page.goto("/club/admin/resignations"))?.status()).toBe(404);
    expect((await page.request.get("/api/club/resignations/template")).status()).toBe(404);
  });

  test("someone not signed in is asked to sign in, and cannot download the template", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto("/club/admin/resignations");
    // The menu has a "Sign in" link on every page, so look for the prompt's own sentence.
    await expect(page.getByText("with your email address to see this page.")).toBeVisible();
    await expect(page.getByTestId("resign-form")).toHaveCount(0);
    expect((await page.request.get("/api/club/resignations/template")).status()).toBe(404);
    await context.close();
  });
});

test.describe("the template", () => {
  test("downloads as a CSV with its columns and two example rows, and the example rows cannot be acted on by accident", async ({ page }) => {
    await openResignations(page);
    const res = await page.request.get("/api/club/resignations/template");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("ccs-resignations-template.csv");
    const body = await res.text();
    expect(body.split("\r\n")[0]).toBe(HEADER);
    expect(body).toContain("EXAMPLE-1");
    await check(page, body, "ccs-resignations-template.csv");
    const problems = page.getByTestId("resign-problems");
    await expect(problems).toContainText("ccs-resignations-template.csv has 2 problems");
    await expect(problems).toContainText("one of the template's example rows");
    await expect(page.getByTestId("resign-end")).toHaveCount(0);
  });
});

test.describe("checking and ending", () => {
  test("shows who would end and what it cancels, saves nothing until the red button, then ends them, blocks them, and leaves everyone else alone", async ({ page, browser, baseURL }) => {
    const t = tag();
    await addHouseholds(page, [rosterRows(t, 1, ["Una", "Vic"]), rosterRows(t, 2, ["Wes"]), rosterRows(t, 3, ["Xia"])]);

    // Una has an RSVP to a sample event, which ending her household will cancel.
    await actAs(page, `Una Family${t}1`);
    await page.goto("/club/events");
    await page.getByTestId("event-card").filter({ hasText: "Boathouse Work Party" }).getByRole("link", { name: "Boathouse Work Party" }).click();
    await page.getByTestId("party-submit").click();
    await expect(page.getByTestId("your-place")).toHaveText("You are going.");

    const text = csv(`QB-${t}-1,${nameOf(t, 1, ["Una"])},Moved away`, `QB-${t}-2,${nameOf(t, 2, ["Wes"])},`);
    await openResignations(page);
    await check(page, text);

    await expect(page.getByTestId("resign-summary")).toContainText("This would end 2 households today, Oct 28, 2026, and block 3 adults from booking.");
    const cards = page.getByTestId("resign-household");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText(nameOf(t, 1, ["Una"]));
    await expect(cards.nth(0)).toContainText(`QuickBooks ID QB-${t}-1`);
    await expect(cards.nth(0)).toContainText(`Una Family${t}1, Vic Family${t}1`);
    await expect(cards.nth(0)).toContainText("Note: Moved away");
    await expect(cards.nth(1)).toContainText(`Wes Family${t}2`);
    await expect(page.getByTestId("resign-cancels")).toContainText("1 thing will change");
    await expect(page.getByTestId("preview-events")).toContainText(`Boathouse Work Party`);
    await expect(page.getByTestId("preview-events")).toContainText(`Una Family${t}1 (going, party of 1)`);
    const notices = page.getByTestId("resign-notices");
    await expect(notices).toContainText("The file's dates are not used: these households end today, Oct 28, 2026.");
    await expect(notices).toContainText("no dues are billed from November 2026 on");

    // Looking changes nothing: the households are still active.
    await page.goto("/club");
    await page.getByRole("link", { name: nameOf(t, 1, ["Una"]), exact: true }).click();
    await expect(page.getByRole("list", { name: "Household history" })).not.toContainText("Membership ended");

    await page.goto("/club/admin/resignations");
    await check(page, text);
    await page.getByTestId("resign-end").click();
    await expect(page.getByTestId("resign-done")).toContainText("Ended 2 memberships and blocked 3 adults.");
    await expect(page.getByTestId("resign-done")).toContainText("Cancelled 0 bookings, 0 class places and 1 event RSVP.");
    await expect(page.getByTestId("resign-end")).toHaveCount(0);

    // The household's file says what happened and why; the household nobody named is untouched.
    await openHousehold(page, nameOf(t, 1, ["Una"]));
    await expect(page.getByRole("list", { name: "Household history" })).toContainText("Membership ended on Oct 28, 2026, from a resignations file. 2 adults can no longer book. Note: Moved away");
    await expect(page.getByRole("list", { name: "Household history" })).toContainText("1 future event RSVP cancelled because the membership ended.");
    await openHousehold(page, nameOf(t, 3, ["Xia"]));
    await expect(page.getByRole("list", { name: "Household history" })).not.toContainText("Membership ended");

    // An ended adult's address opens nothing: asking for a link sends none.
    const gone = await browser.newContext({ baseURL });
    const g = await gone.newPage();
    const email = `una.${t}.1@example.com`;
    await g.goto("/club/sign-in");
    await g.getByLabel("Your email address").fill(email);
    await g.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(g.getByTestId("link-sent")).toBeVisible();
    await g.goto("/club/outbox");
    await expect(g.getByTestId("outbox-message").filter({ hasText: `To ${email}` })).toHaveCount(0);
    // While the household nobody named still can.
    await g.goto("/club/sign-in");
    await g.getByLabel("Your email address").fill(`xia.${t}.3@example.com`);
    await g.getByRole("button", { name: "Email me a sign-in link" }).click();
    await g.goto("/club/outbox");
    await expect(g.getByTestId("outbox-message").filter({ hasText: `To xia.${t}.3@example.com` })).toHaveCount(1);
    await gone.close();
  });

  test("lists every problem with its row number, ends nothing, and the fixed file goes through", async ({ page }) => {
    const t = tag();
    await addHouseholds(page, [rosterRows(t, 1, ["Una"]), rosterRows(t, 2, ["Vic"])]);
    const bad = csv(`QB-${t}-1,The Wrong household,`, `QB-${t}-99,${nameOf(t, 2, ["Vic"])},`, `QB-${t}-2,${nameOf(t, 2, ["Vic"])},`, `QB-${t}-2,,`);
    await openResignations(page);
    await check(page, bad, "bad.csv");
    const problems = page.getByTestId("resign-problems");
    await expect(problems).toContainText("bad.csv has 3 problems");
    await expect(problems).toContainText("Nothing can be ended until the file is fixed.");
    await expect(problems.getByRole("listitem")).toHaveText([
      `Row 2: QuickBooks ID QB-${t}-1 is "${nameOf(t, 1, ["Una"])}" in the club, but the file calls it "The Wrong household". Fix the ID or the name, so the wrong household is never ended.`,
      `Row 3: no household in the club has QuickBooks ID QB-${t}-99. Check the ID in QuickBooks (a spreadsheet can drop a leading zero). A household with no QuickBooks ID cannot be named in a file; end it in the household desk.`,
      `Row 5: QuickBooks ID QB-${t}-2 is already on row 4. List each household once.`,
    ]);
    await expect(page.getByTestId("resign-end")).toHaveCount(0);
    await expect(page.getByTestId("resign-household")).toHaveCount(0);

    await check(page, csv(`QB-${t}-1,${nameOf(t, 1, ["Una"])},`, `QB-${t}-2,${nameOf(t, 2, ["Vic"])},`), "fixed.csv");
    await expect(page.getByTestId("resign-problems")).toHaveCount(0);
    await expect(page.getByTestId("resign-summary")).toContainText("This would end 2 households");
    await page.getByTestId("resign-end").click();
    await expect(page.getByTestId("resign-done")).toContainText("Ended 2 memberships and blocked 2 adults.");
  });

  test("says what is wrong when the file is not a resignations list at all: an Excel file, a missing column, nothing in it", async ({ page }) => {
    await openResignations(page);
    await check(page, "PK\u0003\u0004 pretend this is an Excel workbook", "list.xlsx");
    await expect(page.getByTestId("resign-problems")).toContainText("That looks like an Excel file, not a CSV.");
    await check(page, "Customer,Balance\r\nThe Smith household,$0\r\n");
    await expect(page.getByTestId("resign-problems")).toContainText('The file has no column for "QuickBooks ID"');
    await check(page, "\r\n");
    await expect(page.getByTestId("resign-problems")).toContainText("The file is empty.");
  });

  test("a household that has already ended is skipped, and a file of only those has nothing to end", async ({ page }) => {
    const t = tag();
    await addHouseholds(page, [rosterRows(t, 1, ["Una"]), rosterRows(t, 2, ["Vic"])]);
    await openResignations(page);
    await check(page, csv(`QB-${t}-1,${nameOf(t, 1, ["Una"])},`));
    await page.getByTestId("resign-end").click();
    await expect(page.getByTestId("resign-done")).toContainText("Ended 1 membership and blocked 1 adult.");
    // Nothing was booked for them, and the page says so instead of listing zeros.
    await expect(page.getByTestId("resign-done")).toContainText("Nothing was booked, signed up for or RSVPed to from now on, so nothing was cancelled.");

    await page.goto("/club/admin/resignations");
    await check(page, csv(`QB-${t}-1,${nameOf(t, 1, ["Una"])},`));
    await expect(page.getByTestId("resign-summary")).toHaveText("There is nothing to end: every household in the file has already ended.");
    await expect(page.getByTestId("resign-already-ended")).toContainText("1 household already ended, skipped");
    await expect(page.getByTestId("resign-already-ended")).toContainText(`${nameOf(t, 1, ["Una"])} (QuickBooks ID QB-${t}-1), ended Oct 28, 2026`);
    await expect(page.getByTestId("resign-end")).toHaveCount(0);

    // One ended and one still here: only the one still here is ended.
    await check(page, csv(`QB-${t}-1,${nameOf(t, 1, ["Una"])},`, `QB-${t}-2,${nameOf(t, 2, ["Vic"])},`));
    await expect(page.getByTestId("resign-summary")).toContainText("This would end 1 household");
    await page.getByTestId("resign-end").click();
    await expect(page.getByTestId("resign-done")).toContainText("Ended 1 membership and blocked 1 adult.");
    await expect(page.getByTestId("resign-done")).toContainText("1 household in the file had already ended and was skipped.");
  });

  test("choosing a different file after a check clears the old preview, so only a file that was checked can be acted on", async ({ page }) => {
    const t = tag();
    await addHouseholds(page, [rosterRows(t, 1, ["Una"]), rosterRows(t, 2, ["Vic"])]);
    await openResignations(page);
    await check(page, csv(`QB-${t}-1,${nameOf(t, 1, ["Una"])},`), "first.csv");
    await expect(page.getByTestId("resign-end")).toBeVisible();
    await choose(page, csv(`QB-${t}-2,${nameOf(t, 2, ["Vic"])},`), "second.csv");
    await expect(page.getByTestId("resign-preview")).toHaveCount(0);
    await expect(page.getByTestId("resign-end")).toHaveCount(0);
    await expect(page.getByTestId("resign-check")).toBeEnabled();
  });

  test("refuses when the club changed after the check: a household ended by hand in the meantime", async ({ page }) => {
    const t = tag();
    await addHouseholds(page, [rosterRows(t, 1, ["Una"]), rosterRows(t, 2, ["Vic"])]);
    await openResignations(page);
    await check(page, csv(`QB-${t}-1,${nameOf(t, 1, ["Una"])},`, `QB-${t}-2,${nameOf(t, 2, ["Vic"])},`));
    await expect(page.getByTestId("resign-summary")).toContainText("This would end 2 households");

    // Someone else ends the first household at the household desk.
    const other = await page.context().newPage();
    await openHousehold(other, nameOf(t, 1, ["Una"]));
    await other.waitForURL(/\/club\/household\/[^/]+$/);
    const id = other.url().split("/").pop();
    await other.goto(`/club/admin/households/${id}/end`);
    await other.getByRole("button", { name: "Yes, end this membership" }).click();
    await other.close();

    await page.getByTestId("resign-end").click();
    await expect(page.getByTestId("resign-error")).toHaveText("The file, or the club's records, changed since you checked it, so nothing was ended. Check the file again.");
    // The other household is still active, and a fresh check goes through for just the one left.
    await check(page, csv(`QB-${t}-1,${nameOf(t, 1, ["Una"])},`, `QB-${t}-2,${nameOf(t, 2, ["Vic"])},`));
    await expect(page.getByTestId("resign-summary")).toContainText("This would end 1 household");
    await page.getByTestId("resign-end").click();
    await expect(page.getByTestId("resign-done")).toContainText("Ended 1 membership and blocked 1 adult.");
  });

  test("works again and again: three files in a row, each checked and ended, nothing doubled", async ({ page }) => {
    const t = tag();
    await addHouseholds(page, Array.from({ length: 6 }, (_, i) => rosterRows(t, i + 1, ["Una", "Vic"])));
    await openResignations(page);
    for (let round = 1; round <= 3; round++) {
      await page.goto("/club/admin/resignations");
      const rows = [round * 2 - 1, round * 2].map((n) => `QB-${t}-${n},${nameOf(t, n, ["Una", "Vic"])},`);
      await check(page, csv(...rows));
      await expect(page.getByTestId("resign-summary")).toContainText("This would end 2 households");
      await page.getByTestId("resign-end").click();
      await expect(page.getByTestId("resign-done")).toContainText("Ended 2 memberships and blocked 4 adults.");
    }
    await page.goto("/club/admin/resignations");
    await check(page, csv(...Array.from({ length: 6 }, (_, i) => `QB-${t}-${i + 1},${nameOf(t, i + 1, ["Una", "Vic"])},`)));
    await expect(page.getByTestId("resign-summary")).toHaveText("There is nothing to end: every household in the file has already ended.");
  });

  test("a file that would end more households than one file may is stopped; a file of exactly that many goes through, and a long list of problems is cut off with a count", async ({ page }) => {
    const t = tag();
    await addHouseholds(page, Array.from({ length: 52 }, (_, i) => rosterRows(t, i + 1, ["Una"])));
    await openResignations(page);
    const all = Array.from({ length: 52 }, (_, i) => `QB-${t}-${i + 1},${nameOf(t, i + 1, ["Una"])},`);
    await check(page, csv(...all));
    await expect(page.getByTestId("resign-problems")).toContainText("The file would end 52 households, and one file can end at most 50.");
    await expect(page.getByTestId("resign-end")).toHaveCount(0);

    await check(page, csv(...all.slice(0, 50)));
    await expect(page.getByTestId("resign-summary")).toContainText("This would end 50 households");
    await expect(page.getByTestId("resign-household")).toHaveCount(50);
    await expect(page.getByTestId("resign-notices")).toContainText("The file's dates are not used");
    await page.getByTestId("resign-end").click();
    await expect(page.getByTestId("resign-done")).toContainText("Ended 50 memberships and blocked 50 adults.");

    // Sixty IDs nobody has: fifty problems are listed and the rest are counted.
    await check(page, csv(...Array.from({ length: 60 }, (_, i) => `NOBODY-${t}-${i}`)));
    await expect(page.getByTestId("resign-problems")).toContainText("has 60 problems");
    await expect(page.getByTestId("resign-problems").getByRole("listitem")).toHaveCount(50);
    await expect(page.getByText("…and 10 more.")).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test("the page and a read-back fit the screen, and the red button is big enough to tap", async ({ browser, baseURL }) => {
    const t = tag();
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 700 } });
    const page = await context.newPage();
    await addHouseholds(page, [rosterRows(t, 1, ["Una", "Vic"]), rosterRows(t, 2, ["Wes"])]);
    await openResignations(page);
    await check(page, csv(`QB-${t}-1,${nameOf(t, 1, ["Una"])},Moved away`, `QB-${t}-2,${nameOf(t, 2, ["Wes"])},`));
    await expect(page.getByTestId("resign-summary")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByTestId("resign-end").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
    await context.close();
  });
});
