import { expect, test, type Page } from "@playwright/test";
import { ipadCode } from "../../src/club/engine/ipad-address";
import { contrastOf } from "./contrast";

/**
 * The member sign-in screen in the new look (design handoff screen 3b), and the member app's manifest and icons (step 6). The
 * sign-in behaviour itself (links, partners, signing out) is in club-signin.spec.ts; this holds the screen to the design: its
 * words, sizes and colours, the home-screen tip, and what it leaves out (no password, no iCrew card). The member area only
 * exists on previews and in tests; on the live site every address below is "page not found" (club-hidden.spec.ts).
 */

const SUN = "rgb(242, 193, 78)";
const CYBERSPACE = "rgb(68, 72, 77)";
const OYSTER = "rgb(226, 221, 208)";
const WATERLOO = "rgb(83, 104, 114)";
const INK = "rgb(51, 54, 58)";
const SENT = "If that address belongs to a member or to club staff, a sign-in link is on its way. It works once, and it stops working in 15 minutes. If it does not arrive, check your spam folder.";

const css = (page: Page, selector: string, property: string) => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.describe("the sign-in screen at 390 pixels wide", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/club/sign-in");
  });

  test("has the dark band: club name, Members in Sun, 'Welcome back.' and the one-line promise", async ({ page }) => {
    const band = page.locator(".ds-app-band");
    expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(CYBERSPACE);
    await expect(band.locator(".ds-eyebrow")).toHaveText("Members");
    expect(await css(page, ".ds-app-band .ds-eyebrow", "color")).toBe(SUN);
    await expect(band.getByRole("heading", { level: 1 })).toHaveText("Welcome back.");
    expect(await css(page, ".ds-app-band h1", "font-size")).toBe("32px");
    expect(await css(page, ".ds-app-band h1", "font-weight")).toBe("600");
    expect(await css(page, ".ds-app-band h1", "font-family")).toContain("Cinzel");
    expect(await css(page, ".ds-app-band h1", "color")).toBe("rgb(255, 255, 255)");
    await expect(band.locator(".ds-app-lead")).toHaveText("Your calendar, classes, account and the Weekly Watercooler, all in one place.");
    expect(await css(page, ".ds-app-lead", "color")).toBe(OYSTER);
    expect(await css(page, ".ds-app-lead", "font-size")).toBe("16px");
    expect(await css(page, ".ds-app-inner", "padding-left")).toBe("24px");
  });

  test("has one H1 and no member menu, no test-build banner and no 'acting as' line (those belong to the pages after signing in)", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByTestId("acting-as")).toHaveCount(0);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByText("Test build. Every household")).toHaveCount(0);
  });

  test("has an Email box and a full-width Sun button, and no password anywhere", async ({ page }) => {
    const label = page.locator('label[for="email"]');
    await expect(label).toHaveText("Email");
    expect(await label.evaluate((el) => getComputedStyle(el).fontSize)).toBe("14px");
    expect(await label.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("600");
    expect(await label.evaluate((el) => getComputedStyle(el).color)).toBe(INK);
    const input = page.getByLabel("Email", { exact: true });
    await expect(input).toHaveAttribute("type", "email");
    await expect(input).toHaveAttribute("autocomplete", "email");
    expect(Math.round((await input.boundingBox())!.height)).toBe(48);
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect(await input.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("12px");
    expect(await input.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    // The field's edge is Waterloo (5.6 to 1), not the handoff's Debonair (2.7 to 1, under the 3 to 1 a field's edge needs).
    expect(await input.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(WATERLOO);
    expect(await input.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("1px");

    const button = page.getByRole("button", { name: "Email me a sign-in link" });
    const box = (await button.boundingBox())!;
    expect(Math.round(box.height)).toBe(52);
    expect(Math.round(box.width)).toBe(342); // 390 minus the 24 pixel margins
    expect(await button.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(SUN);
    expect(await button.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("800");

    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByText(/password/i)).toHaveCount(1); // only the line that says there is none to remember
    await expect(page.getByText("There is no password to remember.")).toBeVisible();
    await expect(page.getByText("Forgot password?")).toHaveCount(0);
  });

  test("turns the button to 'Sending…' and off while the request is on its way, so it cannot ask twice", async ({ page }) => {
    await page.waitForLoadState("networkidle"); // the page's scripts have started
    // A slow connection: the answer takes two and a half seconds, and the screen must show it is working until then.
    await page.route("**/api/club/sign-in/request", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.fulfill({ status: 303, headers: { location: "/club/sign-in?sent=1" } });
    });
    // The page cannot be asked questions while it is moving to the next one, so it reports on itself a moment after the press.
    const reports: string[] = [];
    page.on("console", (message) => reports.push(message.text()));
    await page.evaluate(() => {
      const form = document.querySelector('[data-testid="sign-in-form"]')!;
      form.addEventListener("submit", () => {
        const button = form.querySelector("button")!;
        setTimeout(() => console.log(`pressed|${button.disabled}|${button.textContent}`), 150);
      });
    });
    await page.getByLabel("Email", { exact: true }).fill("nobody@example.com");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    // When the answer comes, the fresh page has the ordinary button again.
    await expect(page.getByTestId("link-sent")).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeEnabled();
    expect(reports).toContain("pressed|true|Sending…");
  });

  test("answers 'First time here?' with how to get set up, using the club's one public email and phone", async ({ page }) => {
    const first = page.getByTestId("first-time");
    await expect(first.locator("summary")).toHaveText("First time here?");
    expect((await first.locator("summary").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(first.getByText("The club office sets up each household")).toBeHidden();
    await first.locator("summary").click();
    await expect(first.getByText("The club office sets up each household, so there is nothing to sign up for.")).toBeVisible();
    await expect(first.getByRole("link", { name: "membership@collegeclubseattle.com" })).toHaveAttribute("href", "mailto:membership@collegeclubseattle.com");
    await expect(first.getByRole("link", { name: "(206) 622-0624" })).toHaveAttribute("href", "tel:2066220624");
  });

  test("has the lane line, the way back to the club's website, and no iCrew card", async ({ page }) => {
    await expect(page.locator(".ds-lane")).toBeVisible();
    expect(Math.round((await page.locator(".ds-lane").boundingBox())!.height)).toBe(20);
    const back = page.getByRole("link", { name: /Back to collegeclubseattle\.com/ });
    await expect(back).toHaveAttribute("href", "https://collegeclubseattle.com");
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await back.evaluate((el) => getComputedStyle(el).fontSize)).toBe("13px");
    // Grant, Oct 29: leave the iCrew card out (this system is replacing iCrew).
    await expect(page.getByText(/icrew/i)).toHaveCount(0);
    await expect(page.getByText("Booking a boat?")).toHaveCount(0);
    expect(await page.content()).not.toMatch(/icrew/i);
  });

  test("fits the screen, has 44 pixel targets, and keeps every piece of text at AA contrast", async ({ page }) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // (Links inside a sentence, such as the email and phone in "First time here?" and the test-build-only links, are left out.)
    for (const target of await page.locator("main a:not(.ds-hint a):not(p a), main button, main summary, main input").all()) {
      const box = (await target.boundingBox())!;
      expect(box.height, await target.evaluate((el) => el.outerHTML.slice(0, 60))).toBeGreaterThanOrEqual(44);
    }
    const places: [string, string][] = [
      ["logo stand-in", ".ds-app-band .ds-wordmark"],
      ["Members eyebrow", ".ds-app-band .ds-eyebrow"],
      ["headline", ".ds-app-band h1"],
      ["lead", ".ds-app-lead"],
      ["intro", ".ds-app-intro"],
      ["label", ".ds-label"],
      ["button", ".ds-button"],
      ["first time here", ".ds-details summary"],
      ["back link", ".ds-back"],
      ["test-build hint", ".ds-hint"],
    ];
    for (const [what, selector] of places) expect(await contrastOf(page, selector), what).toBeGreaterThanOrEqual(4.5);
  });

  test("tells, in the design's colours, what happened after asking for a link", async ({ page }) => {
    await page.getByLabel("Email", { exact: true }).fill(`stranger.${tag()}@example.com`);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    const sent = page.getByTestId("link-sent");
    await expect(sent).toHaveText(SENT);
    expect(await sent.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(251, 235, 194)"); // Sun tint
    await expect(page.getByTestId("test-outbox-note")).toContainText("Test build: no real email is sent.");
    expect(await contrastOf(page, '[data-testid="link-sent"]')).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("the sign-in screen when someone is already signed in", () => {
  test("says who, offers the club, and signs out", async ({ page, browser, baseURL }) => {
    // Make a household with its own address, so nothing else is disturbed, then sign in as its adult.
    const email = `screen.${tag()}@example.com`;
    const staffContext = await browser.newContext({ baseURL });
    const staff = await staffContext.newPage();
    await staff.goto("/club/act-as");
    await staff.getByRole("button", { name: "Act as Test staff", exact: true }).click();
    await staff.goto("/club/admin/households/new");
    await staff.getByLabel("Household name").fill(`The Screen ${tag()} household`);
    await staff.locator("#firstName").fill("Sasha");
    await staff.locator("#lastName").fill("Screen");
    await staff.locator("#email").fill(email);
    await staff.getByRole("button", { name: "Add household" }).click();
    await staffContext.close();

    await page.goto("/club/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByTestId("link-sent")).toHaveText(SENT);
    await page.goto("/club/outbox");
    await page.getByTestId("outbox-message").filter({ hasText: `To ${email}` }).first().getByTestId("outbox-link").click();
    await page.getByRole("button", { name: "Sign in as Sasha Screen", exact: true }).click();

    await page.goto("/club/sign-in");
    await expect(page.getByTestId("already-signed-in")).toHaveText("You are signed in as Sasha Screen.");
    await expect(page.getByTestId("sign-in-form")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go to the club" })).toHaveAttribute("href", "/club");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByTestId("signed-out-note")).toHaveText("You are signed out.");
    await expect(page.getByTestId("sign-in-form")).toBeVisible();
  });
});

test.describe("the home screen tip", () => {
  const card = (page: Page) => page.getByTestId("home-screen-card");

  test("is not there on a desktop browser", async ({ page }) => {
    await page.goto("/club/sign-in");
    await page.waitForTimeout(400);
    await expect(card(page)).toHaveCount(0);
  });

  test.describe("on an iPhone", () => {
    test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", viewport: { width: 390, height: 844 }, hasTouch: true });

    test("says how to add it: the design's card, in Oyster, with the design's words", async ({ page }) => {
      await page.goto("/club/sign-in");
      await expect(card(page)).toBeVisible();
      await expect(card(page).getByRole("heading", { level: 2 })).toHaveText("Keep the club on your home screen");
      await expect(card(page)).toContainText("Tap Share, then Add to Home Screen. It opens like an app, with no download needed.");
      expect(await card(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(OYSTER);
      expect(await card(page).evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("16px");
      expect(await card(page).evaluate((el) => getComputedStyle(el).paddingTop)).toBe("16px");
      await expect(card(page).getByRole("button")).toHaveCount(0);
      expect(await contrastOf(page, '[data-testid="home-screen-card"] h2')).toBeGreaterThanOrEqual(4.5);
      expect(await contrastOf(page, '[data-testid="home-screen-card"] p')).toBeGreaterThanOrEqual(4.5);
    });

    test("is not there once the site is already open from the home screen", async ({ page }) => {
      await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
      await page.goto("/club/sign-in");
      await page.waitForTimeout(400);
      await expect(card(page)).toHaveCount(0);
    });
  });

  test.describe("on Android or Chrome, where the browser offers to install", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("shows an Install button when the browser offers, uses the offer once, and goes away when installed", async ({ page }) => {
      await page.goto("/club/sign-in");
      await expect(card(page)).toHaveCount(0);
      await page.evaluate(() => {
        const offer = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void> };
        (window as unknown as { __prompted: number }).__prompted = 0;
        offer.prompt = async () => {
          (window as unknown as { __prompted: number }).__prompted += 1;
        };
        window.dispatchEvent(offer);
      });
      await expect(card(page)).toBeVisible();
      await expect(card(page)).toContainText("Install it for an icon on your home screen.");
      await card(page).getByRole("button", { name: "Install" }).click();
      await expect(card(page)).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
    });

    test("goes away at once if the site gets installed some other way", async ({ page }) => {
      await page.goto("/club/sign-in");
      await page.evaluate(() => {
        const offer = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void> };
        offer.prompt = async () => undefined;
        window.dispatchEvent(offer);
      });
      await expect(card(page)).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
      await expect(card(page)).toHaveCount(0);
    });
  });
});

test.describe("the sign-in screen on a desktop", () => {
  test("keeps the band full width and the form in one narrow column", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto("/club/sign-in");
    expect(Math.round((await page.locator(".ds-app-band").boundingBox())!.width)).toBe(1366);
    const form = (await page.getByTestId("sign-in-form").boundingBox())!;
    expect(Math.round(form.width)).toBe(432); // 480 minus the 24 pixel margins either side
    expect(Math.round(form.x)).toBe(Math.round((1366 - 432) / 2));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe("the member app's manifest and icons", () => {
  test("the manifest says what the handoff says, and stays inside the member area", async ({ request }) => {
    const res = await request.get("/club/manifest.webmanifest");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/manifest+json");
    expect(await res.json()).toEqual({
      name: "College Club Seattle",
      short_name: "CCS Members",
      description: "Your calendar, classes, account and the Weekly Watercooler.",
      start_url: "/club",
      scope: "/club",
      display: "standalone",
      theme_color: "#44484D",
      background_color: "#FBFAF6",
      icons: [
        { src: "/club/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/club/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/club/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    });
  });

  for (const size of [180, 192, 512]) {
    test(`the ${size} pixel icon is a real PNG exactly that size`, async ({ request }) => {
      const res = await request.get(`/club/pwa-icon/${size}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/png");
      const bytes = await res.body();
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(bytes.readUInt32BE(16)).toBe(size);
      expect(bytes.readUInt32BE(20)).toBe(size);
    });
  }

  test("an icon size that is not one of the three answers 'not found'", async ({ request }) => {
    for (const size of ["100", "1024", "abc", "192.0", "0192"]) expect((await request.get(`/club/pwa-icon/${size}`)).status(), size).toBe(404);
  });

  test("the member pages and the sign-in screen point at the manifest, the home-screen icon, the name and the bar colour", async ({ page }) => {
    for (const path of ["/club/sign-in", "/club", "/club/book"]) {
      await page.goto(path);
      await expect(page.locator('link[rel="manifest"]'), path).toHaveAttribute("href", "/club/manifest.webmanifest");
      await expect(page.locator('link[rel="apple-touch-icon"]'), path).toHaveAttribute("href", "/club/pwa-icon/180");
      await expect(page.locator('meta[name="theme-color"]'), path).toHaveAttribute("content", "#44484D");
      await expect(page.locator('meta[name="apple-mobile-web-app-title"]'), path).toHaveAttribute("content", "CCS Members");
      await expect(page.locator('meta[name="mobile-web-app-capable"]'), path).toHaveAttribute("content", "yes");
    }
  });

  test("the dashboard, the public site and the front-desk iPad do not, so they cannot be installed as the member app", async ({ page }) => {
    for (const path of ["/", "/visits", "/site", "/site/membership", "/site/request-a-tour", `/club/ipad/${ipadCode("playwright-only-ipad-secret-0001")}`]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.locator('link[rel="manifest"]'), path).toHaveCount(0);
      await expect(page.locator('link[rel="apple-touch-icon"]'), path).toHaveCount(0);
      await expect(page.locator('meta[name="theme-color"]'), path).toHaveCount(0);
      await expect(page.locator('meta[name="apple-mobile-web-app-title"]'), path).toHaveCount(0);
    }
  });
});
