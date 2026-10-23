import { expect, test, type Page } from "@playwright/test";

/**
 * The new public website under /site: Home, About, Membership, Rowing and fitness, Contact, and a Sign in link to the member
 * sign-in. The words come from src/site/content/site.json (copied from the club's current public pages); these tests check
 * the pages show them, the menu works, and nothing overflows on a phone. Hidden on the live site: see site-hidden.spec.ts.
 */

const PAGES = [
  { menu: "Home", path: "/site", h1: "Welcome to the club." },
  { menu: "About", path: "/site/about", h1: "About the club" },
  { menu: "Membership", path: "/site/membership", h1: "Join the club" },
  { menu: "Rowing and fitness", path: "/site/programs", h1: "Rowing and fitness" },
  { menu: "Contact", path: "/site/contact", h1: "Hours and contact" },
];

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test.describe("every public page", () => {
  for (const { path, h1 } of PAGES) {
    test(`${path} shows its heading, the preview banner, the footer, and asks search engines to stay away`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      await expect(page.getByTestId("site-preview-banner")).toHaveText("Preview of the new club website. It is not live yet.");
      await expect(page.locator("footer")).toContainText("11 East Allison Street");
      await expect(page.locator("footer")).toContainText("Seattle, WA 98102");
      await expect(page.locator("footer").getByRole("link", { name: "206-622-0624" })).toHaveAttribute("href", "tel:2066220624");
      await expect(page.locator("footer").getByRole("link", { name: "membership@collegeclubseattle.com" })).toHaveAttribute("href", "mailto:membership@collegeclubseattle.com");
      await expect(page.locator("footer")).toContainText("Club: 5am-8pm daily, 24/7 fob access");
      await expect(page.locator("footer")).toContainText("Office: Mon-Fri 8am-4pm, Sat by appointment");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      // It is the public site, not the member area: no test-build banner, no "acting as" line, no member menu.
      await expect(page.getByText("Test build.")).toHaveCount(0);
      await expect(page.getByTestId("acting-as")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "My bookings" })).toHaveCount(0);
    });
  }

  test("line the preview banner, the menu, the heading and the footer up on the same left edge", async ({ page }) => {
    await page.goto("/site/membership");
    const left = async (selector: string) => Math.round((await page.locator(selector).first().boundingBox())!.x);
    const edge = await left("h1");
    // The banner's text sits inside the same padded frame as the page, so its box starts where the page's box starts.
    expect(await left('[data-testid="site-preview-banner"] p')).toBe(await left("main"));
    expect(await left(".site-wordmark")).toBe(edge);
    expect(await left("footer strong")).toBe(edge);
  });

  test("have a tab title that names the page and the club", async ({ page }) => {
    await page.goto("/site/membership");
    await expect(page).toHaveTitle("Membership | College Club Seattle");
    await page.goto("/site");
    await expect(page).toHaveTitle("College Club Seattle");
    await page.goto("/site/programs");
    await expect(page).toHaveTitle("Rowing and fitness | College Club Seattle");
  });
});

test.describe("the menu", () => {
  test("lists the five pages and a Sign in link, and every link goes where it says", async ({ page }) => {
    await page.goto("/site");
    await expect(nav(page).getByRole("link")).toHaveText([...PAGES.map((p) => p.menu), "Sign in"]);
    for (const { menu, path, h1 } of PAGES) {
      await nav(page).getByRole("link", { name: menu, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
    }
  });

  test("the club's name takes you home, and Sign in goes to the member sign-in page", async ({ page }) => {
    await page.goto("/site/contact");
    await page.getByRole("link", { name: "College Club Seattle", exact: true }).first().click();
    await expect(page).toHaveURL(/\/site$/);
    await page.getByTestId("site-signin").click();
    await expect(page).toHaveURL(/\/club\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("keeps working after going round the whole site many times", async ({ page }) => {
    await page.goto("/site");
    for (let lap = 0; lap < 4; lap++) {
      for (const { menu, h1 } of PAGES) {
        await nav(page).getByRole("link", { name: menu, exact: true }).click();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      }
    }
  });
});

test.describe("what the pages say", () => {
  test("Home welcomes people, offers three things to discover, and a button to sign in and reserve", async ({ page }) => {
    await page.goto("/site");
    await expect(page.getByText("A member-owned waterfront club on Lake Union since 2013. A Seattle institution since 1910.").first()).toBeVisible();
    await expect(page.getByTestId("site-card").getByRole("heading")).toHaveText(["Fitness", "Water sports", "Member events"]);
    await expect(page.getByTestId("site-card").nth(0)).toContainText("RP3 and Concept 2 ergs");
    await expect(page.getByTestId("site-card").nth(1)).toContainText("Rowing shells, kayaks, and paddle boards for your whole family.");
    await expect(page.getByTestId("site-card").nth(2)).toContainText("dock concerts, trivia, wine tastings");
    await expect(page.getByTestId("site-cta")).toHaveText("Sign in to reserve a boat or class");
    await expect(page.getByTestId("site-cta")).toHaveAttribute("href", "/club/sign-in");
    await expect(page.getByTestId("site-preview-note")).toHaveCount(0);
  });

  test("Membership shows what every membership includes, both membership types with their prices, and how to ask", async ({ page }) => {
    await page.goto("/site/membership");
    await expect(page.getByText("Club hours: 5am-8pm, seven days a week.")).toBeVisible();
    await expect(page.getByText("Access to quality rowing classes and equipment.")).toBeVisible();
    const cards = page.getByTestId("site-card");
    await expect(cards.getByRole("heading")).toHaveText(["Intermediate", "Resident"]);
    await expect(cards.nth(0)).toContainText("Discounted for those between the ages of 21 and 32.");
    await expect(cards.nth(0)).toContainText("$103/month");
    await expect(cards.nth(0)).toContainText("$350 one time initiation fee");
    await expect(cards.nth(1)).toContainText("$154.50/month");
    await expect(cards.nth(1)).toContainText("$600 one time initiation fee");
    await expect(page.getByText("Rates subject to change.")).toBeVisible();
    await expect(page.getByText("Ask about our non-resident membership rates for non-King County members.")).toBeVisible();
    await expect(page.getByText("Email membership@collegeclubseattle.com or call 206-622-0624.")).toBeVisible();
    // Honest about what is not here yet.
    await expect(page.getByTestId("site-preview-note")).toContainText("This preview has no forms yet");
  });

  test("Contact gives the address, phone, email, hours and the directors, with working phone and email links", async ({ page }) => {
    await page.goto("/site/contact");
    const details = page.getByTestId("contact-details");
    await expect(details.getByRole("link", { name: "membership@collegeclubseattle.com" })).toHaveAttribute("href", "mailto:membership@collegeclubseattle.com");
    await expect(details.getByRole("link", { name: "206-622-0624" })).toHaveAttribute("href", "tel:2066220624");
    await expect(details).toContainText("Club: 5am-8pm daily, 24/7 fob access");
    await expect(details).toContainText("Office: Mon-Fri 8am-4pm, Sat by appointment");
    await expect(details).toContainText("Caitlin Sogn (Admin)");
    await expect(details).toContainText("Julia Gamache (Operations)");
    await expect(details.getByRole("link", { name: "caitlin.sogn@collegeclubseattle.com" })).toHaveAttribute("href", "mailto:caitlin.sogn@collegeclubseattle.com");
    await expect(details).toContainText("11 East Allison Street");
    await expect(details).toContainText("Seattle, WA 98102");
  });

  test("About and Rowing and fitness say plainly that they are drafts built only from public sentences", async ({ page }) => {
    for (const path of ["/site/about", "/site/programs"]) {
      await page.goto(path);
      const note = page.getByTestId("site-preview-note");
      await expect(note, path).toContainText("Preview note, not part of the page.");
      await expect(note, path).toContainText("Draft.");
      await expect(note, path).toContainText("for members only");
    }
    await page.goto("/site/programs");
    await expect(page.getByRole("listitem").filter({ hasText: "Rowing (experienced)" })).toBeVisible();
  });

  test("shows no member, household or booking information from the club's records", async ({ page }) => {
    for (const { path } of PAGES) {
      await page.goto(path);
      const text = await page.locator("body").innerText();
      expect(text, path).not.toMatch(/Lindqvist|Abernathy|Okonkwo|Heron|Osprey|Members' Dinner|Test staff|invented/i);
    }
  });
});

test.describe("pages that do not exist", () => {
  test("answer 'page not found'", async ({ page }) => {
    for (const path of ["/site/nope", "/site/membership/extra", "/site/about/team"]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test("every page fits the screen without sideways scrolling, and the menu and Sign in button can be tapped", async ({ page }) => {
    for (const { path, h1 } of PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
      for (const link of await nav(page).getByRole("link").all()) {
        const box = await link.boundingBox();
        expect(box!.height, `${path} ${await link.innerText()}`).toBeGreaterThanOrEqual(36);
        expect(box!.x + box!.width, path).toBeLessThanOrEqual(375);
      }
    }
  });

  test("the membership cards stack and stay readable", async ({ page }) => {
    await page.goto("/site/membership");
    const [a, b] = await page.getByTestId("site-card").all();
    const boxA = (await a.boundingBox())!;
    const boxB = (await b.boundingBox())!;
    expect(boxB.y).toBeGreaterThan(boxA.y + boxA.height - 1);
    expect(boxA.width).toBeGreaterThan(300);
  });
});
