import { expect, test, type Page } from "@playwright/test";

/**
 * Real logins: an email link, then a signed-in browser. In a test build no real email is sent; the "email" appears on the test
 * outbox page. The test server's clock stands still, so a person can ask for at most 5 links in "an hour" for the whole run:
 * each test below uses its own addresses and asks only a few times. Tests run side by side and each opens the newest email to
 * its own address, so no two tests that run at the same time share an address. Staff are invented: Alex Staffer
 * (alex.staffer@example.org) and Sam Deskwell (sam.deskwell@example.org). The Moreau partners share moreau.family@example.com.
 */

const SENT = "If that address belongs to a member or to club staff, a sign-in link is on its way. It works once, and it stops working in 15 minutes. If it does not arrive, check your spam folder.";

const asPicker = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** Types an address into the sign-in form and presses the button. */
async function askForLink(page: Page, email: string) {
  await page.goto("/club/sign-in");
  await page.getByLabel("Your email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
}

/** The newest test email to an address, and the link inside it. */
async function openLinkFor(page: Page, email: string) {
  await page.goto("/club/outbox");
  const mail = page.getByTestId("outbox-message").filter({ hasText: `To ${email}` }).first();
  await mail.getByTestId("outbox-link").click();
}

/** Asks for a link, opens it and presses the one button: signed in as the only person that address opens. */
async function signInAs(page: Page, email: string, button: string) {
  await askForLink(page, email);
  await expect(page.getByTestId("link-sent")).toHaveText(SENT);
  await openLinkFor(page, email);
  await page.getByRole("button", { name: button, exact: true }).click();
}

const cookieNamed = async (page: Page, name: string) => (await page.context().cookies()).find((c) => c.name === name);

test.describe("a member signing in", () => {
  test("asks for a link, opens it, signs in, stays signed in, and signing out really ends it", async ({ page }) => {
    await askForLink(page, "  Nora.Abernathy@Example.com ");
    await expect(page.getByTestId("link-sent")).toHaveText(SENT);
    // The address typed is not put in the web address, where history, logs and shared screens would keep it.
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/club/sign-in?sent=1");
    await expect(page.getByTestId("test-outbox-note")).toContainText("Test build: no real email is sent.");

    // The "email" says nothing about who the member is, and carries a one-time link.
    await page.getByRole("link", { name: "Open the test outbox" }).click();
    const mail = page.getByTestId("outbox-message").filter({ hasText: "To nora.abernathy@example.com" }).first();
    await expect(mail.getByRole("heading", { level: 3 })).toHaveText("Your College Club Seattle sign-in link");
    await expect(mail).toContainText("It works once, and it stops working in 15 minutes.");
    await expect(mail).not.toContainText(/Nora|Abernathy/);
    await mail.getByTestId("outbox-link").click();

    // Opening the link signs nobody in: that takes the button.
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByText("This link is for")).toContainText("nora.abernathy@example.com");
    await expect(page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
    await page.reload();
    await expect(page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
    expect(await cookieNamed(page, "ccs_session")).toBeUndefined();

    await page.getByRole("button", { name: "Sign in as Nora Abernathy", exact: true }).click();
    await expect(page).toHaveURL("/club");
    await expect(page.getByTestId("acting-as")).toHaveText("Signed in as Nora Abernathy.");
    await expect(page.getByTestId("household-name")).toHaveText("The Abernathy household");
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);

    // The browser holds a long random secret in a cookie the page's own scripts cannot read, and nothing is left of the test picker.
    const session = await cookieNamed(page, "ccs_session");
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(session!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await cookieNamed(page, "ccs_test_actor")).toBeUndefined();
    expect(await page.evaluate(() => document.cookie)).not.toContain("ccs_session");

    // It is a real member: their own pages work, and they stay signed in across visits.
    await page.goto("/club/my-bookings");
    await expect(page.getByRole("heading", { level: 1, name: "My bookings" })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("acting-as")).toHaveText("Signed in as Nora Abernathy.");

    // Signing out forgets the key on the server, not just in the browser: the old cookie opens nothing.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByTestId("signed-out-note")).toHaveText("You are signed out.");
    await expect(page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
    await page.goto("/club/my-bookings");
    await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toBeVisible();
    await page.context().addCookies([{ name: "ccs_session", value: session!.value, url: page.url() }]);
    await page.goto("/club/my-bookings");
    await expect(page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
  });

  test("a link works once: looking at it records nothing, one press signs in, and the same link is dead afterwards", async ({ page }) => {
    await askForLink(page, "hollis.whitcombe@example.com");
    await openLinkFor(page, "hollis.whitcombe@example.com");
    const link = page.url();
    await page.goto("/club");
    await expect(page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
    await page.goto(link); // looked at again: still good
    await page.getByRole("button", { name: "Sign in as Hollis Whitcombe", exact: true }).click();
    await expect(page.getByTestId("acting-as")).toHaveText("Signed in as Hollis Whitcombe.");

    await page.goto(link);
    await expect(page.getByTestId("link-problem")).toHaveText("That sign-in link has expired or was already used. Ask for a new one.");
    await expect(page.getByRole("button", { name: /Sign in as/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Get a new link" })).toBeVisible();
  });

  test("a made-up, mangled or empty link says the same plain thing and shows no one's name", async ({ page }) => {
    for (const bad of ["A".repeat(43), "short", "not-a-link", `${"A".repeat(42)}!`]) {
      const res = await page.goto(`/club/sign-in/${bad}`);
      expect(res!.status(), bad).toBe(200);
      await expect(page.getByTestId("link-problem"), bad).toHaveText("That sign-in link has expired or was already used. Ask for a new one.");
      await expect(page.locator("body"), bad).not.toContainText(/Quill|Lindqvist|Abernathy|Moreau/);
    }
  });

  test("a real sign-in replaces the test picker, and signing out clears both", async ({ page }) => {
    await asPicker(page, "Erik Lindqvist");
    await signInAs(page, "declan.halloran@example.com", "Sign in as Declan Halloran");
    await expect(page.getByTestId("acting-as")).toHaveText("Signed in as Declan Halloran.");
    expect(await cookieNamed(page, "ccs_test_actor")).toBeUndefined();
    // Even if a test-picker cookie turns up afterwards, the real sign-in wins.
    await page.context().addCookies([{ name: "ccs_test_actor", value: "staff", url: page.url() }]);
    await page.goto("/club");
    await expect(page.getByTestId("acting-as")).toHaveText("Signed in as Declan Halloran.");
    await expect(page.getByRole("link", { name: "Staff office" })).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
  });

  test("staff see that a member has signed in", async ({ page }) => {
    await asPicker(page, "Test staff");
    await page.getByRole("link", { name: "The Abernathy household" }).click();
    // Nora signed in during the first test (they share one server), so her login slot is filled; Lars never signed in.
    await expect(page.getByTestId("member-row").filter({ hasText: "Nora Abernathy" }).getByTestId("login-state")).toHaveText(/has signed in|has not signed in yet/);
    await page.goto("/club");
    await page.getByRole("link", { name: "The Eriksen household" }).click();
    await expect(page.getByTestId("member-row").filter({ hasText: "Britta Eriksen" }).getByTestId("login-state")).toHaveText("has not signed in yet");
  });
});

test.describe("partners sharing one email address", () => {
  // Both tests use the one shared address, and each opens the newest email to it: they must not overlap.
  test.describe.configure({ mode: "serial" });

  test("are asked which of them it is, and the device remembers the answer next time", async ({ page }) => {
    const email = "moreau.family@example.com";
    await askForLink(page, email);
    await openLinkFor(page, email);
    await expect(page.getByRole("heading", { level: 1, name: "Which of you?" })).toBeVisible();
    await expect(page.getByTestId("which-of-you")).toContainText("More than one person is signed up with this address");
    await expect(page.getByRole("button", { name: "I am Camille Moreau", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "I am Julien Moreau", exact: true }).click();
    await expect(page.getByTestId("acting-as")).toHaveText("Signed in as Julien Moreau.");
    await expect(page.getByTestId("member-row")).toHaveCount(2);
    await page.getByRole("button", { name: "Sign out" }).click();

    // Same device, next time: Julien is offered first, and Camille is one tap away.
    await askForLink(page, email);
    await openLinkFor(page, email);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in as Julien Moreau", exact: true })).toBeVisible();
    await expect(page.getByText("Not Julien Moreau?")).toBeVisible();
    await page.getByRole("button", { name: "I am Camille Moreau", exact: true }).click();
    await expect(page.getByTestId("acting-as")).toHaveText("Signed in as Camille Moreau.");
  });

  test("on a different device are asked again, and the choice is only ever someone the address opens", async ({ browser, baseURL }) => {
    const email = "moreau.family@example.com";
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await askForLink(page, email);
    await openLinkFor(page, email);
    await expect(page.getByRole("heading", { level: 1, name: "Which of you?" })).toBeVisible();

    // A forged choice (someone this address does not open) is refused and leaves the link usable.
    const token = page.url().split("/").pop()!;
    const forged = await page.request.post("/api/club/sign-in/confirm", { form: { token, identity: "staff:alex.staffer@example.org" }, maxRedirects: 0 });
    expect(forged.status()).toBe(303);
    expect(forged.headers()["location"]).toContain("/club/sign-in?notice=signin_link");
    expect(forged.headers()["set-cookie"]).toBeUndefined();
    await page.reload();
    await expect(page.getByRole("button", { name: "I am Julien Moreau", exact: true })).toBeVisible();
    await context.close();
  });
});

test.describe("addresses that cannot sign in", () => {
  test("get exactly the same answer as addresses that can, and nothing is sent", async ({ page }) => {
    for (const email of ["stranger.nobody@example.com", "colm.fitzgerald@example.com"]) {
      // The second is a real adult whose household has ended: they can no longer sign in.
      await askForLink(page, email);
      await expect(page.getByTestId("link-sent"), email).toHaveText(SENT);
      await page.goto("/club/outbox");
      await expect(page.getByTestId("outbox-message").filter({ hasText: `To ${email}` }), email).toHaveCount(0);
    }
  });

  test("a malformed address is told so, without looking anything up", async ({ page }) => {
    await page.goto("/club/sign-in");
    // Switch off the browser's own "this is not an email address" check, so the club's own wording is what shows.
    await page.getByTestId("sign-in-form").evaluate((form: HTMLFormElement) => {
      form.noValidate = true;
    });
    await page.getByLabel("Your email address").fill("nope");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "does not look like an email address" })).toBeVisible();
    await expect(page.getByTestId("link-sent")).toHaveCount(0);
  });

  test("a post from another site is refused, and makes no link", async ({ page }) => {
    const refused = await page.request.post("/api/club/sign-in/request", { form: { email: "lars.eriksen@example.com" }, headers: { Origin: "https://evil.example" }, maxRedirects: 0 });
    expect(refused.status()).toBe(403);
    const crossSite = await page.request.post("/api/club/sign-in/request", { form: { email: "lars.eriksen@example.com" }, headers: { "Sec-Fetch-Site": "cross-site" }, maxRedirects: 0 });
    expect(crossSite.status()).toBe(403);
    const confirm = await page.request.post("/api/club/sign-in/confirm", { form: { token: "A".repeat(43), identity: "staff:alex.staffer@example.org" }, headers: { Origin: "https://evil.example" }, maxRedirects: 0 });
    expect(confirm.status()).toBe(403);
    const out = await page.request.post("/api/club/sign-out", { headers: { Origin: "https://evil.example" }, maxRedirects: 0 });
    expect(out.status()).toBe(403);
    await page.goto("/club/outbox");
    await expect(page.getByTestId("outbox-message").filter({ hasText: "To lars.eriksen@example.com" })).toHaveCount(0);
  });

  test("a forged or leftover session cookie opens nothing", async ({ page }) => {
    await page.context().addCookies([{ name: "ccs_session", value: "A".repeat(43), url: "http://localhost" }]);
    await page.goto("/club");
    await expect(page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
    await page.context().addCookies([{ name: "ccs_session", value: "garbage", url: "http://localhost" }]);
    await page.goto("/club/my-bookings");
    await expect(page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
  });
});

test.describe("staff signing in", () => {
  test("sign in with the staff address, under their own name, and the record says who did what", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await signInAs(page, "alex.staffer@example.org", "Sign in as Alex Staffer (club staff)");
    await expect(page.getByTestId("acting-as")).toHaveText("Signed in as Alex Staffer.");
    await expect(page.getByRole("link", { name: "Staff office" })).toBeVisible();

    // A change made now carries the staff member's own name on the household's file, not "Test staff".
    const name = `The Signin ${Date.now().toString(36)} household`;
    await page.goto("/club/admin/households/new");
    await page.getByLabel("Household name").fill(name);
    await page.locator("#firstName").fill("Quinn");
    await page.locator("#lastName").fill("Signin");
    await page.locator("#email").fill("quinn.signin@example.com");
    await page.getByRole("button", { name: "Add household" }).click();
    await expect(page.getByTestId("household-name")).toHaveText(name);
    await expect(page.getByRole("list", { name: "Household history" })).toContainText("by Alex Staffer");
    await expect(page.getByRole("list", { name: "Household history" })).not.toContainText("by Test staff");

    // And the new household's adult can now sign in with their own address (a different person, a different browser).
    const other = await browser.newContext({ baseURL });
    const quinn = await other.newPage();
    await signInAs(quinn, "quinn.signin@example.com", "Sign in as Quinn Signin");
    await expect(quinn.getByTestId("household-name")).toHaveText(name);
    // A member is not staff: no staff office, and the staff pages do not exist for them.
    await expect(quinn.getByRole("link", { name: "Staff office" })).toHaveCount(0);
    expect((await quinn.goto("/club/admin"))!.status()).toBe(404);
    await other.close();
    await context.close();
  });

  test("an address that is not on the staff list is not staff, even with a staff-looking name", async ({ page }) => {
    await askForLink(page, "alex.staffer@example.com"); // wrong domain: not on the list, and nobody's address
    await expect(page.getByTestId("link-sent")).toHaveText(SENT);
    await page.goto("/club/outbox");
    await expect(page.getByTestId("outbox-message").filter({ hasText: "To alex.staffer@example.com" })).toHaveCount(0);
  });
});

test.describe("the test outbox and the picker", () => {
  test("the test outbox says plainly that it is a test", async ({ page }) => {
    await page.goto("/club/outbox");
    await expect(page.getByTestId("outbox-warning")).toContainText("No real email is sent");
  });

  test("not signed in, the pages point to signing in first, and the test picker is still offered", async ({ page }) => {
    await page.goto("/club/my-bookings");
    await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose a test member" })).toBeVisible();
    await page.goto("/club");
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test("the sign-in page and a link's page fit the screen, with big buttons", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 700 } });
    const page = await context.newPage();
    await page.goto("/club/sign-in");
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await fits()).toBe(true);
    await page.getByLabel("Your email address").fill("tomas.vandermeer@example.com");
    const send = page.getByRole("button", { name: "Email me a sign-in link" });
    expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await send.click();
    await openLinkFor(page, "tomas.vandermeer@example.com");
    expect(await fits()).toBe(true);
    const go = page.getByRole("button", { name: "Sign in as Tomas Vandermeer", exact: true });
    const box = (await go.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    await context.close();
  });
});
