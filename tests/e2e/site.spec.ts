import { expect, test, type Page } from "@playwright/test";

/**
 * The new public website under /site: Home, About, Our Programs, Membership, Request a Tour, Contact, with a Member login link.
 * The words come from src/site/content/site.json (copied from the club's current public pages, plus the design handoff's
 * homepage); these tests check the pages show them, the menu works, and nothing overflows. The homepage's own layout and
 * behaviour are in site-home.spec.ts. Hidden on the live site: see site-hidden.spec.ts.
 */

const PAGES = [
  { menu: "Home", path: "/site", h1: "Your summer evenings, on Lake Union." },
  { menu: "About", path: "/site/about", h1: "About the club" },
  { menu: "Our Programs", path: "/site/programs", h1: "Rowing and fitness" },
  { menu: "Membership", path: "/site/membership", h1: "Join the club" },
  { menu: "Request a Tour", path: "/site/request-a-tour", h1: "Request a tour" },
  { menu: "Contact", path: "/site/contact", h1: "Hours and contact" },
];

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test.describe("every public page", () => {
  for (const { path, h1 } of PAGES) {
    test(`${path} shows its one heading, the preview banner, the footer, and asks search engines to stay away`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      await expect(page.getByTestId("site-preview-banner")).toHaveText("Preview of the new club website. It is not live yet.");
      const footer = page.locator("footer");
      await expect(footer.getByRole("heading", { level: 2 })).toHaveText("Come see it for yourself.");
      await expect(footer).toContainText("11 East Allison Street, Seattle, WA 98102");
      await expect(footer.getByRole("link", { name: "(206) 622-0624" })).toHaveAttribute("href", "tel:2066220624");
      await expect(footer.getByRole("link", { name: "Contact", exact: true })).toHaveAttribute("href", "/site/contact");
      await expect(footer.getByRole("link", { name: "Membership", exact: true })).toHaveAttribute("href", "/site/membership");
      await expect(footer.getByRole("link", { name: /^Member login/ })).toHaveAttribute("href", "/club/sign-in");
      await expect(footer).toContainText("© 2026 College Club Seattle. Member-owned.");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      // It is the public site, not the member area: no test-build banner, no "acting as" line, no member menu.
      await expect(page.getByText("Test build.")).toHaveCount(0);
      await expect(page.getByTestId("acting-as")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "My bookings" })).toHaveCount(0);
    });
  }

  test("line the preview banner, the logo, the heading and the footer up on the same left edge", async ({ page }) => {
    await page.goto("/site/membership");
    const left = async (selector: string) => Math.round((await page.locator(selector).first().boundingBox())!.x);
    const edge = await left("h1");
    // The banner's text sits inside the same padded frame as the page, so its box starts where the page's box starts.
    expect(await left('[data-testid="site-preview-banner"] p')).toBe(await left("main .site-frame"));
    expect(await left(".ds-logo-link")).toBe(edge);
    expect(await left("footer h2")).toBe(edge);
  });

  test("have a tab title that names the page and the club", async ({ page }) => {
    await page.goto("/site/membership");
    await expect(page).toHaveTitle("Membership | College Club Seattle");
    await page.goto("/site");
    await expect(page).toHaveTitle("College Club Seattle");
    await page.goto("/site/programs");
    await expect(page).toHaveTitle("Our Programs | College Club Seattle");
    await page.goto("/site/request-a-tour");
    await expect(page).toHaveTitle("Request a Tour | College Club Seattle");
  });
});

test.describe("the menu", () => {
  test("lists the six pages, in the design's order, and every link goes where it says", async ({ page }) => {
    await page.goto("/site");
    await expect(nav(page).getByRole("link")).toHaveText(PAGES.map((p) => p.menu));
    for (const { menu, path, h1 } of PAGES) {
      await nav(page).getByRole("link", { name: menu, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      await expect(nav(page).getByRole("link", { name: menu, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
    }
  });

  test("the logo takes you home, and Member login goes to the member sign-in screen", async ({ page }) => {
    await page.goto("/site/contact");
    await page.getByTestId("site-header").getByRole("link", { name: "College Club Seattle", exact: true }).first().click();
    await expect(page).toHaveURL(/\/site$/);
    await page.getByTestId("member-login-header").click();
    await expect(page).toHaveURL(/\/club\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back." })).toBeVisible();
  });

  test("Member login is the same address in the header and the footer on every page", async ({ page }) => {
    for (const { path } of PAGES) {
      await page.goto(path);
      const hrefs = await page.locator("a", { hasText: /Member login/ }).evaluateAll((links) => links.map((a) => a.getAttribute("href")));
      expect(hrefs.length, path).toBeGreaterThanOrEqual(2);
      expect(new Set(hrefs), path).toEqual(new Set(["/club/sign-in"]));
    }
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
    await expect(page.getByText("Email membership@collegeclubseattle.com or call (206) 622-0624.")).toBeVisible();
    // Honest about what is not here yet.
    await expect(page.getByTestId("site-preview-note")).toContainText("This preview has no apply form yet");
    await expect(page.getByTestId("site-preview-note")).toContainText("Tours can be requested on the Request a Tour page");
  });

  test("Contact gives the address, phone, membership email, hours and the directors' names, with working phone and email links", async ({ page }) => {
    await page.goto("/site/contact");
    const details = page.getByTestId("contact-details");
    await expect(details.getByRole("link", { name: "membership@collegeclubseattle.com" })).toHaveAttribute("href", "mailto:membership@collegeclubseattle.com");
    await expect(details.getByRole("link", { name: "(206) 622-0624" })).toHaveAttribute("href", "tel:2066220624");
    await expect(details).toContainText("Club: 5am-8pm daily, 24/7 fob access");
    await expect(details).toContainText("Office: Mon-Fri 8am-4pm, Sat by appointment");
    await expect(details).toContainText("Caitlin Sogn (Admin)");
    await expect(details).toContainText("Julia Gamache (Operations)");
    // The directors are named, but their own email addresses are not shown (Grant, Oct 23).
    await expect(details.getByRole("link", { name: /caitlin|julia/i })).toHaveCount(0);
    await expect(page.getByTestId("site-preview-note")).toContainText("left out on purpose");
    await expect(details).toContainText("11 East Allison Street");
    await expect(details).toContainText("Seattle, WA 98102");
  });

  test("About and Our Programs say plainly that they are placeholders built only from public sentences", async ({ page }) => {
    for (const path of ["/site/about", "/site/programs"]) {
      await page.goto(path);
      const note = page.getByTestId("site-preview-note");
      await expect(note, path).toContainText("Preview note, not part of the page.");
      await expect(note, path).toContainText("Placeholder.");
      await expect(note, path).toContainText("for members only");
    }
    await page.goto("/site/programs");
    await expect(page.getByRole("listitem").filter({ hasText: "Rowing (experienced)" })).toBeVisible();
  });

  test("show one public email address, the membership one, on every page, and nobody's own address", async ({ page }) => {
    for (const { path } of PAGES) {
      await page.goto(path);
      const hrefs = await page.locator('a[href^="mailto:"]').evaluateAll((links) => links.map((a) => a.getAttribute("href")));
      for (const href of hrefs) expect(href, path).toBe("mailto:membership@collegeclubseattle.com");
      const text = await page.locator("body").innerText();
      for (const found of text.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? []) expect(found, path).toBe("membership@collegeclubseattle.com");
      expect(text, path).not.toMatch(/caitlin\.sogn@|julia@/i);
    }
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
    for (const path of ["/site/nope", "/site/membership/extra", "/site/about/team", "/site/request-a-tour/thanks"]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("every page fits the screen without sideways scrolling, and the Menu button opens a list of all six pages", async ({ page }) => {
    for (const { path, h1, menu } of PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: "Menu" }).click();
      await expect(nav(page).getByRole("link")).toHaveText([...PAGES.map((p) => p.menu), "Member login"]);
      for (const link of await nav(page).getByRole("link").all()) {
        const box = await link.boundingBox();
        expect(box!.height, `${path} ${await link.innerText()}`).toBeGreaterThanOrEqual(44);
        expect(box!.x + box!.width, path).toBeLessThanOrEqual(390);
      }
      await expect(nav(page).getByRole("link", { name: menu, exact: true })).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
      await expect(nav(page)).toBeHidden();
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
