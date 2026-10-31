import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The honor snack bar iPad: a member finds their name, says how many snacks they took, taps once, and it goes on their household's
 * account for the month; the thank-you shows, then the screen goes back to the start for the next person. Every snack is $1.50.
 * The test server's clock stands still at 1 pm Pacific on Wed Oct 28, 2026. All tests share one server, so each uses its own
 * member: nobody else buys snacks as that person, and the staff screen is searched by that person's name.
 */

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** The two private addresses, as staff see them on their iPad page. */
async function addresses(browser: Browser, baseURL: string): Promise<{ snack: string; checkIn: string }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await actAs(page, "Test staff");
  await page.goto("/club/admin/ipad");
  const snack = await page.getByTestId("snack-link").getAttribute("href");
  const checkIn = await page.getByTestId("ipad-link").getAttribute("href");
  await context.close();
  expect(snack).toMatch(/^\/club\/snacks\/[A-Za-z0-9_-]{43}$/);
  expect(checkIn).toMatch(/^\/club\/ipad\/[A-Za-z0-9_-]{43}$/);
  return { snack: snack!, checkIn: checkIn! };
}

/** A browser with nobody signed in: the iPad by the snack shelf. */
async function onTheIpad(browser: Browser, baseURL: string, viewport = { width: 1024, height: 768 }) {
  const context = await browser.newContext({ baseURL, viewport });
  return { context, page: await context.newPage() };
}

const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const snacks = (n: number) => (n === 1 ? "1 snack" : `${n} snacks`);

/** Type a whole name, press Find me and tap the name. */
async function findMe(page: Page, address: string, name: string) {
  await page.goto(address);
  await page.getByLabel("Type your name, then press Find me").fill(name.toLowerCase());
  await page.getByRole("button", { name: "Find me" }).click();
  await page.getByTestId("snack-names").getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Hi, ${name.split(" ")[0]}` })).toBeVisible();
}

async function pickCount(page: Page, n: number) {
  for (let i = 1; i < n; i++) await page.getByRole("button", { name: "One more snack" }).click();
  await expect(page.getByTestId("snack-count")).toHaveText(String(n));
}

/** The whole walk through, from the start screen to the thank-you. */
async function buy(page: Page, address: string, name: string, n: number) {
  await findMe(page, address, name);
  await pickCount(page, n);
  await expect(page.getByTestId("snack-total")).toHaveText(`${snacks(n)} = ${money(n * 150)}`);
  await page.getByTestId("snack-submit").click();
  await expect(page.getByTestId("snack-done")).toHaveText(`Thanks, ${name.split(" ")[0]}! ${snacks(n)}, ${money(n * 150)}, added to your account for October 2026. Enjoy.`);
}

/** What staff see for one member's iPad purchases, newest last in the list's own order. */
async function purchasesOf(browser: Browser, baseURL: string, name: string): Promise<string[]> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await actAs(page, "Test staff");
  await page.goto("/club/admin/charges");
  const rows = await page.getByTestId("charge-row").filter({ hasText: `${name}'s tab` }).filter({ hasText: "on the snack bar iPad" }).allTextContents();
  await context.close();
  return rows;
}

test.describe("the honor snack bar iPad", () => {
  test("a member finds their name, chooses how many, taps once, and sees the thank-you; the screen then goes back to the start for the next person", async ({ browser, baseURL }) => {
    const { snack } = await addresses(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!);
    await page.goto(snack);
    await expect(page.getByRole("heading", { level: 1, name: "Honor snack bar" })).toBeVisible();
    await expect(page.getByTestId("snack-price")).toHaveText("Every snack is $1.50.");
    // A plain screen: no menu, no staff links, and nothing is listed until a few letters are typed.
    await expect(page.getByRole("link", { name: "Staff office" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Charges" })).toHaveCount(0);
    await expect(page.getByTestId("snack-names")).toHaveCount(0);
    await page.getByLabel("Type your name, then press Find me").fill("pe");
    await page.getByRole("button", { name: "Find me" }).click();
    await expect(page.getByTestId("snack-name-short")).toHaveText("Type at least 3 letters of your name.");
    await expect(page.getByTestId("snack-names")).toHaveCount(0);
    await page.getByLabel("Type your name, then press Find me").fill("pemberton");
    await page.getByRole("button", { name: "Find me" }).click();
    await expect(page.getByTestId("snack-names").getByRole("link")).toHaveText(["Walter Pemberton"]);

    await page.getByRole("link", { name: "Walter Pemberton" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Walter" })).toBeVisible();
    await expect(page.getByTestId("snack-price")).toHaveText("Every snack is $1.50.");
    // It starts at one snack, and the button says exactly what it will do. Minus cannot go below one.
    await expect(page.getByTestId("snack-count")).toHaveText("1");
    await expect(page.getByTestId("snack-total")).toHaveText("1 snack = $1.50");
    await expect(page.getByTestId("snack-submit")).toHaveText("Add 1 snack, $1.50, to my account");
    await expect(page.getByRole("button", { name: "One fewer snack" })).toBeDisabled();
    await page.getByRole("button", { name: "One more snack" }).click();
    await page.getByRole("button", { name: "One more snack" }).click();
    await expect(page.getByTestId("snack-total")).toHaveText("3 snacks = $4.50");
    await expect(page.getByTestId("snack-submit")).toHaveText("Add 3 snacks, $4.50, to my account");
    await page.getByRole("button", { name: "One fewer snack" }).click();
    await expect(page.getByTestId("snack-total")).toHaveText("2 snacks = $3.00");
    await page.getByRole("button", { name: "One more snack" }).click();
    await page.getByTestId("snack-submit").click();

    // The thank-you says what it came to and which month it is billed in, and offers nothing else to press.
    await expect(page.getByRole("heading", { level: 1, name: "Thank you" })).toBeVisible();
    await expect(page.getByTestId("snack-done")).toHaveText("Thanks, Walter! 3 snacks, $4.50, added to your account for October 2026. Enjoy.");
    await expect(page.getByTestId("snack-form")).toHaveCount(0);
    await expect(page.getByTestId("auto-return")).toHaveText("This screen goes back to the start after 8 seconds.");
    // A few seconds later it is back on the start screen, with nothing left of the last person.
    await page.waitForURL((u) => u.pathname === snack, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Honor snack bar" })).toBeVisible();
    await expect(page.getByLabel("Type your name, then press Find me")).toHaveValue("");
    await expect(page.getByTestId("snack-done")).toHaveCount(0);
    await expect(page.getByText("Walter")).toHaveCount(0);
    await context.close();

    // Staff see it on the household's account, marked as entered on the snack bar iPad, and can void it with a reason.
    const staff = await browser.newContext({ baseURL });
    const sp = await staff.newPage();
    await actAs(sp, "Test staff");
    await sp.goto("/club/admin/charges");
    await expect(sp.getByTestId("snack-month")).toContainText("Snack bar iPad, October 2026:");
    const row = sp.getByTestId("charge-row").filter({ hasText: "Walter Pemberton's tab" }).filter({ hasText: "on the snack bar iPad" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("$4.50");
    await expect(row).toContainText("Snack bar · Oct 28, 2026 · Walter Pemberton's tab · entered by Walter Pemberton on the snack bar iPad");
    await expect(row).toContainText("3 snacks at $1.50");
    await row.getByPlaceholder("Why void it?").fill("Tapped the wrong name");
    await row.getByRole("button", { name: /^Void/ }).click();
    await expect(row.getByTestId("charge-voided")).toHaveText("Voided: Tapped the wrong name");
    await staff.close();
  });

  test("tapping twice is one purchase, and pressing the same screen again later never adds a second", async ({ browser, baseURL }) => {
    const { snack } = await addresses(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!);
    await findMe(page, snack, "Hollis Whitcombe");
    await pickCount(page, 2);
    const token = await page.locator('input[name="token"]').inputValue();
    const member = page.url().split("/").pop()!.split("?")[0];
    const code = snack.split("/").pop()!;
    await page.getByTestId("snack-submit").dblclick();
    await expect(page.getByTestId("snack-done")).toHaveText("Thanks, Hollis! 2 snacks, $3.00, added to your account for October 2026. Enjoy.");
    expect(await purchasesOf(browser, baseURL!, "Hollis Whitcombe")).toHaveLength(1);

    // The same screen sent again (the browser's back button, a second finger) gets the first answer and adds nothing.
    const again = await page.request.post("/api/club/snacks", { form: { code, member, items: "2", token }, maxRedirects: 0 });
    expect(again.status()).toBe(303);
    expect(again.headers().location).toContain(`/club/snacks/${code}/${member}?done=`);
    expect(await purchasesOf(browser, baseURL!, "Hollis Whitcombe")).toHaveLength(1);
    // The same token with a different number is refused, and still nothing is added.
    const other = await page.request.post("/api/club/snacks", { form: { code, member, items: "5", token }, maxRedirects: 0 });
    expect(other.headers().location).toContain("?notice=snacks");
    expect(await purchasesOf(browser, baseURL!, "Hollis Whitcombe")).toHaveLength(1);
    await context.close();
  });

  test("the same member can buy again and again on fresh screens, the same number twice too, and every purchase lands once", async ({ browser, baseURL }) => {
    const { snack } = await addresses(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!);
    const rounds = [1, 2, 2, 3, 4, 3];
    for (const n of rounds) await buy(page, snack, "Amara Okonkwo", n);
    await context.close();
    const rows = await purchasesOf(browser, baseURL!, "Amara Okonkwo");
    expect(rows).toHaveLength(rounds.length);
    for (const n of new Set(rounds)) expect(rows.filter((r) => r.includes(`${snacks(n)} at $1.50`) && r.includes(money(n * 150)))).toHaveLength(rounds.filter((x) => x === n).length);
    const total = rows.reduce((sum, r) => sum + Number(/·\s*\$(\d+\.\d\d)/.exec(r)![1]) * 100, 0);
    expect(Math.round(total)).toBe(rounds.reduce((a, b) => a + b, 0) * 150);
  });

  test("a day's limit is held: the count stops at the most for one purchase, and a purchase over the day's limit is refused in words with nothing added", async ({ browser, baseURL }) => {
    const { snack } = await addresses(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!);
    await findMe(page, snack, "Chidi Okonkwo");
    for (let i = 0; i < 25; i++) if (await page.getByRole("button", { name: "One more snack" }).isEnabled()) await page.getByRole("button", { name: "One more snack" }).click();
    await expect(page.getByTestId("snack-count")).toHaveText("20");
    await expect(page.getByRole("button", { name: "One more snack" })).toBeDisabled();
    await expect(page.getByTestId("snack-total")).toHaveText("20 snacks = $30.00");
    await page.getByTestId("snack-submit").click();
    await expect(page.getByTestId("snack-done")).toContainText("20 snacks, $30.00");
    await buy(page, snack, "Chidi Okonkwo", 20);
    // Forty is the most in a day, so one more is refused and says so, and nothing is recorded.
    await findMe(page, snack, "Chidi Okonkwo");
    await page.getByTestId("snack-submit").click();
    await expect(page.getByTestId("ipad-notice")).toHaveText("Those snacks could not be added. Check the number, or ask club staff for help.");
    await expect(page.getByTestId("snack-done")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Chidi" })).toBeVisible();
    await context.close();
    expect(await purchasesOf(browser, baseURL!, "Chidi Okonkwo")).toHaveLength(2);
  });

  test("a wrong address, the check-in iPad's address, a forged number or a forged screen finds nothing or is refused, and nothing is added", async ({ browser, baseURL }) => {
    const { snack, checkIn } = await addresses(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!);
    const bad = "x".repeat(43);
    const code = snack.split("/").pop()!;
    const checkInCode = checkIn.split("/").pop()!;
    // Each iPad's address opens only its own screens.
    for (const path of [`/club/snacks/${bad}`, `/club/snacks/${checkInCode}`, `/club/ipad/${code}`, `/club/ipad/${code}/visitors`]) expect((await page.goto(path))?.status(), path).toBe(404);

    await findMe(page, snack, "Sasha Bellweather");
    const member = page.url().split("/").pop()!.split("?")[0];
    expect((await page.goto(`/club/snacks/${bad}/${member}`))?.status()).toBe(404);
    expect((await page.goto(`/club/snacks/${checkInCode}/${member}`))?.status()).toBe(404);
    const post = (form: Record<string, string>) => page.request.post("/api/club/snacks", { form, maxRedirects: 0 });
    const token = () => `forged-${Math.random().toString(36).slice(2)}-0123456789`;
    expect((await post({ code: bad, member, items: "2", token: token() })).status()).toBe(404);
    expect((await post({ code: checkInCode, member, items: "2", token: token() })).status()).toBe(404);
    expect((await post({ code, member: "00000000-0000-4000-8000-0000000000ff", items: "2", token: token() })).status()).toBe(404);
    expect((await post({ code, member: "not-an-id", items: "2", token: token() })).status()).toBe(404);
    // A real address and member, but a nonsense number or token: sent back with the notice, nothing recorded.
    for (const items of ["0", "21", "abc", "-1", "1.5", "", "1000"]) {
      const res = await post({ code, member, items, token: token() });
      expect(res.status(), items).toBe(303);
      expect(res.headers().location, items).toContain("?notice=snacks");
    }
    for (const bad of ["", "short", "has spaces in the token 123", "x".repeat(65)]) {
      const res = await post({ code, member, items: "2", token: bad });
      expect(res.headers().location, bad).toContain("?notice=snacks");
    }
    await page.goto(`/club/snacks/${code}/${member}?notice=snacks`);
    await expect(page.getByTestId("ipad-notice")).toHaveText("Those snacks could not be added. Check the number, or ask club staff for help.");
    // Someone who has left the club is not found, and a made-up member is sent back to the start.
    await page.goto(snack);
    await page.getByLabel("Type your name, then press Find me").fill("fitzgerald");
    await page.getByRole("button", { name: "Find me" }).click();
    await expect(page.getByTestId("snack-name-none")).toHaveText("No member found with that name. Check the spelling, or ask club staff.");
    await page.goto(`/club/snacks/${code}/00000000-0000-4000-8000-0000000000ff`);
    await expect(page.getByRole("heading", { level: 1, name: "Honor snack bar" })).toBeVisible();
    await context.close();
    expect(await purchasesOf(browser, baseURL!, "Sasha Bellweather")).toEqual([]);
  });

  test("the screens fit an iPad either way up and a phone, with buttons big enough to tap", async ({ browser, baseURL }) => {
    const { snack } = await addresses(browser, baseURL!);
    for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      const { context, page } = await onTheIpad(browser, baseURL!, viewport);
      const label = `${viewport.width}x${viewport.height}`;
      await page.goto(snack);
      await noSideScroll(page);
      await findMe(page, snack, "Ines Castellanos");
      await noSideScroll(page);
      for (const name of ["One fewer snack", "One more snack"]) {
        const box = (await page.getByRole("button", { name }).boundingBox())!;
        expect(Math.min(box.width, box.height), `${label} ${name}`).toBeGreaterThanOrEqual(44);
      }
      const submit = (await page.getByTestId("snack-submit").boundingBox())!;
      expect(submit.height, label).toBeGreaterThanOrEqual(44);
      await page.getByRole("button", { name: "One more snack" }).click();
      await page.getByTestId("snack-submit").click();
      await expect(page.getByTestId("snack-done")).toBeVisible();
      await noSideScroll(page);
      await context.close();
    }
  });

  test("the staff iPad page shows the snack bar's own address, different from the check-in iPad's, and only to staff", async ({ browser, baseURL, page }) => {
    const { snack, checkIn } = await addresses(browser, baseURL!);
    expect(snack).not.toBe(checkIn);
    await actAs(page, "Test staff");
    await page.goto("/club/admin/ipad");
    await expect(page.getByRole("heading", { level: 2, name: "The honor snack bar iPad" })).toBeVisible();
    await expect(page.getByTestId("snack-address")).toContainText(snack);
    await expect(page.getByTestId("snack-address")).not.toContainText(checkIn);
    await expect(page.getByTestId("ipad-address")).not.toContainText(snack);
    await actAs(page, "Priya Rao");
    expect((await page.goto("/club/admin/ipad"))?.status()).toBe(404);
  });
});
