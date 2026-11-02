import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Members checking themselves in: on their own phone, and on the front-desk iPad. The test server's clock stands still at
 * 1 pm Pacific on Wednesday Oct 28, 2026, and check-in opens 30 minutes before the start. Today's invented reservations
 * for this (all made yesterday): Amara Okonkwo has the Otter kayak 12:30 to 1:30 pm and Chidi Okonkwo the Skimmer paddle board
 * 12 to 1:30 pm, both open now; Camille and Julien Moreau (partners sharing one email) hold chairs in Lunchtime Mobility at
 * 1:15 pm, open since 12:45; Julien's Drift paddle board at 3 pm opens at 2:30 pm; Walter Pemberton has the club room 12:30 to
 * 1:30 pm, which needs no check-in. All tests share one server, so each uses its own people.
 */

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

const bookingRow = (page: Page, boat: string) => page.getByTestId("booking-row").filter({ hasText: boat });
const classRow = (page: Page, name: string) => page.getByTestId("class-row").filter({ hasText: name });

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
async function ipadMemberId(browser: Browser, baseURL: string, name: string): Promise<string> {
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

test.describe("on a member's own phone", () => {
  test("a boat shows the I'm here button once check-in is open, one press checks in, and the staff record says from their phone", async ({ page, browser, baseURL }) => {
    await actAs(page, "Chidi Okonkwo");
    await page.goto("/club/my-bookings");
    const row = bookingRow(page, "Skimmer");
    await expect(row.getByTestId("booking-status")).toHaveText("Upcoming");
    // Open the page a second time before pressing, to see a stale button refused later.
    const stale = await page.context().newPage();
    await stale.goto("/club/my-bookings");

    await row.getByRole("button", { name: "Check in for Skimmer" }).click();
    await expect(page.getByTestId("checkedin-note")).toContainText("You are checked in for Skimmer");
    await expect(page.getByRole("list", { name: "Upcoming bookings" }).getByTestId("booking-row").filter({ hasText: "Skimmer" }).getByTestId("booking-status")).toHaveText("Checked in");
    await expect(bookingRow(page, "Skimmer").getByRole("button", { name: /Check in/ })).toHaveCount(0);

    // The button on the other copy of the page was already pressed for them: nothing is recorded twice.
    await stale.getByRole("button", { name: "Check in for Skimmer" }).click();
    await expect(stale.locator("p.club-alert")).toHaveText("That is already checked in.");
    await stale.close();

    // Staff see how it was done.
    const staff = await browser.newContext({ baseURL });
    const staffPage = await staff.newPage();
    await actAs(staffPage, "Test staff");
    await staffPage.goto("/club/admin/check-in?q=Chidi");
    const staffRow = staffPage.getByTestId("attendance-row").filter({ hasText: "Skimmer" });
    await expect(staffRow.getByTestId("attendance-status")).toHaveText("Checked in from their phone");
    await staff.close();
  });

  test("a boat that opens later says when, and the club room shows no check-in at all", async ({ page }) => {
    await actAs(page, "Julien Moreau");
    await page.goto("/club/my-bookings");
    const drift = bookingRow(page, "Drift");
    await expect(drift.getByTestId("check-in-opens")).toHaveText("Check-in opens at 2:30 pm.");
    await expect(drift.getByRole("button", { name: /Check in/ })).toHaveCount(0);

    await actAs(page, "Walter Pemberton");
    await page.goto("/club/my-bookings");
    const room = bookingRow(page, "Clubhouse room");
    await expect(room).toBeVisible();
    await expect(room.getByRole("button", { name: /Check in/ })).toHaveCount(0);
    await expect(room.getByTestId("check-in-opens")).toHaveCount(0);
  });

  test("a class chair can be checked in the same way, from My classes", async ({ page }) => {
    await actAs(page, "Camille Moreau");
    await page.goto("/club/my-classes");
    const row = classRow(page, "Lunchtime Mobility");
    await expect(row.getByTestId("class-status")).toHaveText("You have a place");
    await row.getByRole("button", { name: "Check in for Lunchtime Mobility" }).click();
    await expect(page.getByTestId("checkedin-note")).toContainText("You are checked in for Lunchtime Mobility");
    await expect(classRow(page, "Lunchtime Mobility").getByTestId("class-status")).toHaveText("Checked in");
    await expect(classRow(page, "Lunchtime Mobility").getByRole("button", { name: /Check in/ })).toHaveCount(0);
  });

  test("staff have no I'm here button of their own", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/my-bookings");
    await expect(page.getByTestId("check-in-form")).toHaveCount(0);
  });

  test("the button is easy to reach on a small screen", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 700 } });
    const page = await context.newPage();
    await actAs(page, "Chidi Okonkwo");
    await page.goto("/club/my-bookings");
    const row = bookingRow(page, "Skimmer");
    // Chidi may already have checked in (another test); then there is nothing to press and the page must still fit.
    if (await row.getByRole("button", { name: /Check in/ }).count()) {
      const box = await row.getByRole("button", { name: /Check in/ }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    await context.close();
  });
});

test.describe("on the front-desk iPad", () => {
  test("staff find the private address and how to set it up", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.getByRole("link", { name: "Staff office" }).click();
    await page.getByRole("link", { name: "Front-desk iPad" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Front-desk iPad" })).toBeVisible();
    await expect(page.getByTestId("ipad-address")).toContainText("/club/ipad/");
    await expect(page.getByTestId("ipad-facts")).toContainText("Only people who have a boat, space or class they can check in for right now");
    await expect(page.getByText("If the address gets out")).toBeVisible();

    // A member cannot see it.
    await actAs(page, "Nora Abernathy");
    const res = await page.goto("/club/admin/ipad");
    expect(res!.status()).toBe(404);
  });

  test("lists only people with something open now, narrows as someone types, and has no menu", async ({ browser, baseURL }) => {
    const address = await ipadAddress(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!);
    await page.goto(address);
    await expect(page.getByRole("heading", { level: 1, name: "Who is checking in?" })).toBeVisible();
    const names = page.getByTestId("ipad-names");
    await expect(names.getByRole("link", { name: "Amara Okonkwo" })).toBeVisible();
    await expect(names.getByRole("link", { name: "Julien Moreau" })).toBeVisible(); // a class chair is open, though his boat is not
    // Not the whole membership: nothing today, a club room (no check-in needed), a finished outing, an event only.
    for (const absent of ["Nora Abernathy", "Walter Pemberton", "Yuki Nakamura", "Alex Brooks", "Rafael Castellanos", "Erik Lindqvist"]) {
      await expect(names.getByRole("link", { name: absent })).toHaveCount(0);
    }
    // No menu, no test-member picker, no banner naming anyone.
    await expect(page.getByRole("navigation", { name: "Member area" })).toHaveCount(0);
    await expect(page.getByTestId("acting-as")).toHaveCount(0);
    await expect(page.getByText("Switch test member")).toHaveCount(0);
    await expect(page.getByText("Test build.")).toHaveCount(0);

    await page.getByLabel("Type the first letters of your name").fill("ama");
    await expect(names.getByRole("link")).toHaveCount(1);
    await expect(names.getByRole("link", { name: "Amara Okonkwo" })).toBeVisible();
    await page.getByLabel("Type the first letters of your name").fill("okon");
    await expect(names.getByRole("link", { name: "Amara Okonkwo" })).toBeVisible();
    await page.getByLabel("Type the first letters of your name").fill("zzz");
    await expect(page.getByTestId("ipad-no-match")).toContainText("No one with that name has a check-in open right now");
    await page.getByLabel("Type the first letters of your name").fill("");
    await expect(names.getByRole("link", { name: "Amara Okonkwo" })).toBeVisible();
    await context.close();
  });

  test("two people in a row: a boat, then a class chair; each goes back to the start and drops off the list", async ({ browser, baseURL }) => {
    const address = await ipadAddress(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!);
    await page.clock.install();
    await page.goto(address);

    // Amara: pick the name, see only her own reservation, press the one big button.
    await page.getByRole("link", { name: "Amara Okonkwo" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Hi, Amara" })).toBeVisible();
    const choice = page.getByTestId("ipad-choice");
    await expect(choice).toHaveCount(1);
    await expect(choice).toContainText("Otter");
    await expect(choice).toContainText("12:30 to 1:30 pm");
    // Someone else at the iPad cannot press Amara's button: the same form with Julien's name on it is refused in words.
    const otterId = await choice.locator('input[name="id"]').inputValue();
    const amaraId = await choice.locator('input[name="member"]').inputValue();
    const julienHref = await (async () => {
      const other = await context.newPage();
      await other.goto(address);
      const href = await other.getByRole("link", { name: "Julien Moreau" }).getAttribute("href");
      await other.close();
      return href!;
    })();
    const forged = await page.request.post("/api/club/ipad/check-in", { form: { code: address.split("/").pop()!, member: julienHref.split("/").pop()!, kind: "booking", id: otterId }, maxRedirects: 0 });
    expect(forged.status()).toBe(303);
    expect(forged.headers().location).toContain("notice=forbidden");
    expect(amaraId).not.toBe(julienHref.split("/").pop());
    await choice.getByRole("button", { name: "Check in for Otter" }).click();
    await expect(page.getByTestId("ipad-checked-in")).toContainText("You are checked in for Otter");
    await expect(page.getByTestId("ipad-done")).toHaveText("Checked in");
    await expect(page.getByRole("button", { name: /Check in for/ })).toHaveCount(0);

    // Left alone, the screen goes back to the start (so the next person never sees hers), and she is no longer listed.
    await expect(page.getByTestId("auto-return")).toContainText("goes back to the start after 20 seconds");
    await page.clock.fastForward("00:21");
    await expect(page.getByRole("heading", { level: 1, name: "Who is checking in?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Amara Okonkwo" })).toHaveCount(0);

    // Julien: his class chair is open; his paddle board at 3 pm is not offered yet.
    await page.getByRole("link", { name: "Julien Moreau" }).click();
    await expect(page.getByTestId("ipad-choice")).toHaveCount(1);
    await expect(page.getByTestId("ipad-choice")).toContainText("Lunchtime Mobility");
    await expect(page.getByTestId("ipad-choice")).not.toContainText("Drift");
    await page.getByRole("button", { name: "Check in for Lunchtime Mobility" }).click();
    await expect(page.getByTestId("ipad-checked-in")).toContainText("You are checked in for Lunchtime Mobility");
    await page.clock.fastForward("00:21");
    await expect(page.getByRole("heading", { level: 1, name: "Who is checking in?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Julien Moreau" })).toHaveCount(0);
    await context.close();

    // Staff see both on the record, and how.
    const staff = await browser.newContext({ baseURL });
    const staffPage = await staff.newPage();
    await actAs(staffPage, "Test staff");
    await staffPage.goto("/club/admin/check-in?q=Amara");
    await expect(staffPage.getByTestId("attendance-row").filter({ hasText: "Otter" }).getByTestId("attendance-status")).toHaveText("Checked in on the iPad");
    await staffPage.goto("/club/admin/check-in?q=Julien");
    await expect(staffPage.getByTestId("attendance-row").filter({ hasText: "Lunchtime Mobility" }).getByTestId("attendance-status")).toHaveText("Checked in on the iPad");
    await staff.close();
  });

  test("a wrong address looks like a page that does not exist, and so does a forged button", async ({ browser, baseURL }) => {
    const address = await ipadAddress(browser, baseURL!);
    const { context, page } = await onTheIpad(browser, baseURL!);
    const code = address.split("/").pop()!;
    const flipped = `${code.slice(0, -1)}${code.endsWith("A") ? "B" : "A"}`;
    const someone = "00000000-0000-4000-8000-000000000001";
    for (const bad of [`/club/ipad/${flipped}`, `/club/ipad/${"A".repeat(43)}`, "/club/ipad/short", `/club/ipad/${flipped}/${someone}`]) {
      const res = await page.goto(bad);
      expect(res!.status(), bad).toBe(404);
      await expect(page.locator("body"), bad).not.toContainText(/Okonkwo|Moreau|Otter|Lunchtime/);
    }
    // A button with the wrong address, or the right address and nobody real, does nothing and sets no cookie.
    const forms: Record<string, string>[] = [
      { code: flipped, member: someone, kind: "booking", id: someone },
      { code, member: someone, kind: "booking", id: someone },
      { code: "x", member: someone, kind: "booking", id: someone },
      { member: someone, kind: "booking", id: someone },
    ];
    for (const form of forms) {
      const res = await page.request.post("/api/club/ipad/check-in", { form, maxRedirects: 0 });
      expect(res.status(), JSON.stringify(form)).toBe(404);
      expect(res.headers()["set-cookie"]).toBeUndefined();
    }
    // A real person and a real-looking reservation, but the wrong address: still nothing there, and nothing is recorded.
    const noraId = await ipadMemberId(browser, baseURL!, "Nora Abernathy");
    for (const wrong of [flipped, "A".repeat(43)]) {
      const res = await page.request.post("/api/club/ipad/check-in", { form: { code: wrong, member: noraId, kind: "booking", id: someone }, maxRedirects: 0 });
      expect(res.status(), wrong).toBe(404);
      expect(res.headers().location).toBeUndefined();
    }
    // Someone with nothing open (Nora has no booking today) is sent to the start, and nothing about them is said.
    await page.goto(`${address}/${noraId}`);
    expect(new URL(page.url()).pathname).toBe(address);
    await expect(page.getByRole("heading", { level: 1, name: "Who is checking in?" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Nora");
    await context.close();
  });
});
