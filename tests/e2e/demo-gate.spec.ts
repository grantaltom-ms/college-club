import { request as httpRequest } from "node:http";
import { expect, test, type Page } from "@playwright/test";

/**
 * The demo keypad (port 3104): a test build with the demo password set. The invented club and the public-site preview are locked
 * behind it, the dashboard is not, and typing the password gives a browser a 30-day pass. The same keypad must not exist on the
 * live site: that is proved in club-hidden.spec.ts and demo-link.spec.ts.
 */
const BASE = "http://localhost:3104";
const PASSWORD = "playwright-only-demo-0001";
const COOKIE = "ccs_demo";

/** Words only the invented club or the public-site preview would show. None may reach someone without the password. */
const CLUB_WORDS = /Test member view|Test staff view|Nora Abernathy|Abernathy|Lindqvist|Act as a test member|Staff office|Request a tour|Seattle institution|Who is checking in|Honor snack bar/i;

async function openKeypad(page: Page, path: string) {
  await page.goto(`${BASE}${path}`);
  await expect(page).toHaveURL(/\/demo\?/);
  await expect(page.getByRole("heading", { level: 1, name: "Try the club system." })).toBeVisible();
}

async function unlock(page: Page, path = "/club/start", password = PASSWORD) {
  await openKeypad(page, path);
  await page.getByLabel("Demo password").fill(password);
  await page.getByRole("button", { name: "Open the demo" }).click();
}

/** A request written exactly as given, which a browser or fetch would tidy first. Follows redirects by hand, a few times. */
function rawGet(rawPath: string): Promise<{ status: number; finalPath: string; body: string }> {
  const hop = (path: string, left: number): Promise<{ status: number; finalPath: string; body: string }> =>
    new Promise((resolve, reject) => {
      const req = httpRequest({ host: "localhost", port: 3104, path, method: "GET" }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          const location = res.headers.location;
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location && left > 0) {
            const next = new URL(location, `http://localhost:3104${path.startsWith("/") ? "" : "/"}`);
            resolve(hop(`${next.pathname}${next.search}`, left - 1));
          } else {
            resolve({ status: res.statusCode ?? 0, finalPath: path, body });
          }
        });
      });
      req.on("error", reject);
      req.end();
    });
  return hop(rawPath, 4);
}

test.describe("the demo keypad", () => {
  test("a page of the member area asks for the demo password first, and says nothing about the club", async ({ page }) => {
    const first = await page.goto(`${BASE}/club/start`);
    expect(first?.ok()).toBe(true);
    await expect(page).toHaveURL(`${BASE}/demo?next=%2Fclub%2Fstart`);
    await expect(page.getByRole("heading", { level: 1, name: "Try the club system." })).toBeVisible();
    await expect(page.getByLabel("Demo password")).toBeVisible();
    await expect(page.getByLabel("Demo password")).toHaveAttribute("type", "password");
    expect(await page.content()).not.toMatch(CLUB_WORDS);
    // Not for search engines.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(await page.title()).toContain("demo");
  });

  test("every part of the covered area is locked without the password", async () => {
    const pages = ["/club", "/club/act-as", "/club/book", "/club/admin", "/club/admin/charges", "/club/sign-in", "/club/manifest.webmanifest", "/club/pwa-icon/192", "/club/ipad/anything", "/club/snacks/anything", "/club/rsvp/a/b/c", "/site", "/site/about", "/site/request-a-tour", "/api/club/events/x/links", "/api/club/import/template"];
    for (const path of pages) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      expect(res.status, path).toBe(307);
      const to = new URL(res.headers.get("location")!, BASE);
      expect(to.pathname, path).toBe("/demo");
      // A page is remembered; a data address is not somewhere to send a person, so it goes to the landing page.
      expect(to.searchParams.get("next"), path).toBe(path.startsWith("/api/") ? "/club/start" : path);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      expect(await res.text(), path).not.toMatch(CLUB_WORDS);
    }
  });

  test("buttons, forms and data requests are refused outright without the password", async () => {
    for (const path of ["/api/club/act-as", "/api/club/snacks", "/api/club/ipad/check-in", "/api/club/sign-in/request", "/club/admin/import", "/site/request-a-tour"]) {
      const res = await fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", "Next-Action": "00" }, body: new URLSearchParams({ actor: "staff" }) });
      expect(res.status, path).toBe(401);
      expect(res.headers.get("set-cookie"), path).toBeNull();
      expect(await res.text(), path).not.toMatch(CLUB_WORDS);
    }
  });

  test("an address written strangely is locked too, never opened by looking different", async () => {
    const sneaky = ["/%63lub/start", "/%2563lub/start", "/Club/start", "/CLUB", "/SITE/request-a-tour", "//club/start", "/club//start", "/./club/start", "/%2e%2e/club/start", "/club/%2e%2e/club/start", "/club%2fstart", "/api/%63lub/act-as", "/API/CLUB/act-as"];
    for (const path of sneaky) {
      const res = await rawGet(path);
      // Either there is nothing at that address, or it ends at the keypad. Never the club's own page.
      const lockedOut = res.status === 404 || (res.finalPath.startsWith("/demo") && res.status === 200);
      expect(lockedOut, `${path} -> ${res.status} ${res.finalPath}`).toBe(true);
      expect(res.body, path).not.toMatch(CLUB_WORDS);
    }
  });

  test("the dashboard, its data and the menu's question stay open without the password", async ({ page }) => {
    for (const path of ["/", "/goals", "/api/dashboard", "/api/nav-extras"]) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      expect(res.status, path).toBe(200);
    }
    expect(await (await fetch(`${BASE}/api/nav-extras`)).json()).toEqual({ extras: ["system"] });
    await page.goto(`${BASE}/`);
    await expect(page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "CCS System" })).toBeVisible();
  });

  test("the dashboard's CCS System link leads to the keypad, and the password then leads to the landing page", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "CCS System" }).click();
    await expect(page).toHaveURL(/\/demo\?next=%2Fclub%2Fstart$/);
    await page.getByLabel("Demo password").fill(PASSWORD);
    await page.getByRole("button", { name: "Open the demo" }).click();
    await expect(page).toHaveURL(`${BASE}/club/start`);
    await expect(page.getByRole("heading", { level: 1, name: "CCS System" })).toBeVisible();
  });

  test("a wrong password stays at the keypad with a message and gives no pass", async ({ page }) => {
    await unlock(page, "/club/admin", "not-the-password");
    await expect(page).toHaveURL(/\/demo\?wrong=1&next=%2Fclub%2Fadmin$/);
    await expect(page.getByTestId("demo-wrong")).toHaveText("That password is not right. Check it and try again.");
    await expect(page.getByTestId("demo-wrong")).toHaveAttribute("role", "alert");
    expect((await page.context().cookies(BASE)).map((c) => c.name)).not.toContain(COOKIE);
    // Still locked afterwards, and the page asked for is still remembered.
    await page.goto(`${BASE}/club/admin`);
    await expect(page).toHaveURL(/\/demo\?next=%2Fclub%2Fadmin$/);
  });

  test("the right password opens the page asked for, and the pass is a private cookie that lasts 30 days", async ({ page }) => {
    await unlock(page, "/club/admin");
    await expect(page).toHaveURL(`${BASE}/club/admin`);
    expect(await page.content()).not.toMatch(/Try the club system/);
    const cookie = (await page.context().cookies(BASE)).find((c) => c.name === COOKIE)!;
    expect(cookie).toBeTruthy();
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(cookie.secure).toBe(false); // plain http on this test server
    const days = (cookie.expires - Date.now() / 1000) / 86400;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30.01);
    // Scripts on the page cannot read it.
    expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);
  });

  test("with the pass, the whole demo works: member, staff and both iPad screens in new tabs", async ({ page }) => {
    await unlock(page);
    await expect(page).toHaveURL(`${BASE}/club/start`);
    await page.getByTestId("start-member-open").click();
    await expect(page.getByTestId("acting-as")).toHaveText("Acting as Nora Abernathy.");
    await page.goto(`${BASE}/club/start`);
    await page.getByTestId("start-staff-open").click();
    await expect(page.getByTestId("acting-as")).toHaveText("Acting as Test staff.");
    await page.goto(`${BASE}/club/start`);
    for (const [testId, heading] of [
      ["start-snacks-open", "Honor snack bar"],
      ["start-checkin-open", "Who is checking in?"],
    ] as const) {
      const [tab] = await Promise.all([page.context().waitForEvent("page"), page.getByTestId(testId).click()]);
      await expect(tab.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await tab.close();
    }
    // The public-site preview is behind the same pass.
    await page.goto(`${BASE}/site/request-a-tour`);
    await expect(page).toHaveURL(`${BASE}/site/request-a-tour`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a browser that already has the pass goes straight past the keypad", async ({ page }) => {
    await unlock(page);
    await page.goto(`${BASE}/demo?next=%2Fclub%2Fadmin`);
    await expect(page).toHaveURL(`${BASE}/club/admin`);
  });

  test("locking the demo on this device brings the keypad back", async ({ page }) => {
    await unlock(page);
    await page.getByTestId("start-lock").click();
    await expect(page).toHaveURL(`${BASE}/demo?locked=1`);
    await expect(page.getByTestId("demo-locked")).toHaveText("The demo is locked on this device.");
    expect((await page.context().cookies(BASE)).map((c) => c.name)).not.toContain(COOKIE);
    await page.goto(`${BASE}/club/start`);
    await expect(page).toHaveURL(/\/demo\?next=%2Fclub%2Fstart$/);
    // And the keypad does not wave a just-locked browser straight through.
    await page.goto(`${BASE}/demo?locked=1`);
    await expect(page.getByLabel("Demo password")).toBeVisible();
  });

  test("the keypad only sends someone on to a page of the club or the preview site", async ({ request }) => {
    const send = (next?: string) => request.post(`${BASE}/api/demo/unlock`, { form: next === undefined ? { password: PASSWORD } : { password: PASSWORD, next }, maxRedirects: 0 });
    const inside = await send("/club/admin?x=1");
    expect(inside.status()).toBe(303);
    expect(new URL(inside.headers()["location"])).toMatchObject({ origin: BASE, pathname: "/club/admin", search: "?x=1" });
    expect(inside.headers()["set-cookie"]).toContain(`${COOKIE}=`);
    for (const next of [undefined, "", "https://evil.example/x", "//evil.example/x", "/dashboard", "/clubhouse", "club/admin", "/club/../demo"]) {
      const res = await send(next);
      expect(res.status(), String(next)).toBe(303);
      expect(new URL(res.headers()["location"]), String(next)).toMatchObject({ origin: BASE, pathname: "/club/start" });
    }
  });

  test("a post from another website cannot unlock or lock", async ({ request }) => {
    for (const path of ["/api/demo/unlock", "/api/demo/lock"]) {
      const res = await request.post(`${BASE}${path}`, { form: { password: PASSWORD }, headers: { Origin: "https://evil.example" }, maxRedirects: 0 });
      expect(res.status(), path).toBe(403);
      expect(res.headers()["set-cookie"], path).toBeUndefined();
    }
  });

  test("a pass the server did not make is refused", async ({ page, context }) => {
    await context.addCookies([{ name: COOKIE, value: `${Date.now() + 86400000}.${"0".repeat(64)}`, url: BASE }]);
    await page.goto(`${BASE}/club/start`);
    await expect(page).toHaveURL(/\/demo\?next=/);
    await context.addCookies([{ name: COOKIE, value: "garbage", url: BASE }]);
    await page.goto(`${BASE}/club/start`);
    await expect(page).toHaveURL(/\/demo\?next=/);
  });

  test("it can be used from the keyboard alone", async ({ page }) => {
    await openKeypad(page, "/club/start");
    await page.getByLabel("Demo password").focus();
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${BASE}/club/start`);
  });

  test("on a phone nothing scrolls sideways and the box and button are big enough to tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openKeypad(page, "/club/start");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const target of [page.getByLabel("Demo password"), page.getByRole("button", { name: "Open the demo" }), page.getByTestId("demo-back")]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.getByLabel("Demo password").fill("x".repeat(60));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
