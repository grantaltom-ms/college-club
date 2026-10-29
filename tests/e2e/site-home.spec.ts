import { expect, test, type Page } from "@playwright/test";
import { contrastOf } from "./contrast";

/**
 * The new public homepage (/site) held to the design handoff (Oct 2026): the exact copy, sizes and colours at 390 pixels wide,
 * the wider layout from 768, the menu, the sticky "Request a tour" bar, tap sizes, contrast measured on the page as drawn,
 * and the rules Grant set for public pages (no bar, drinks, access codes, iCrew, or any phone number but the main line).
 */

const SUN = "rgb(242, 193, 78)";
const CYBERSPACE = "rgb(68, 72, 77)";
const OYSTER = "rgb(226, 221, 208)";
const WATERLOO = "rgb(83, 104, 114)";
const INK = "rgb(51, 54, 58)";
const PAPER_ON_DARK = "rgb(245, 243, 236)";

const PUBLIC_PAGES = ["/site", "/site/about", "/site/programs", "/site/membership", "/site/request-a-tour", "/site/contact"];
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const css = (page: Page, selector: string, property: string) => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

test.describe("the homepage at 390 pixels wide", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/site");
  });

  test("has the design's header: 64 pixels tall, Oyster, the Member login pill and the Menu button", async ({ page }) => {
    const header = page.getByTestId("site-header");
    expect(Math.round((await header.boundingBox())!.height)).toBe(64);
    expect(await css(page, '[data-testid="site-header"]', "background-color")).toBe(OYSTER);
    expect(await css(page, '[data-testid="site-header"]', "position")).toBe("sticky");
    const pill = page.getByTestId("member-login-header");
    expect((await pill.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const ring = pill.locator("span");
    expect(Math.round((await ring.boundingBox())!.height)).toBe(40);
    // The rule says 1.5px, as the design does. (This browser draws any border as a whole number of pixels, so the drawn width cannot show it.)
    const declared = await page.evaluate(() => {
      for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) if (rule instanceof CSSStyleRule && rule.selectorText === ".ds-pill-link > span") return rule.style.getPropertyValue("border");
      return null;
    });
    expect(declared).toBe("1.5px solid var(--waterloo)");
    expect(await ring.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(WATERLOO);
    expect(await ring.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("999px");
    expect(await ring.evaluate((el) => getComputedStyle(el).fontSize)).toBe("14px");
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    expect((await page.getByRole("button", { name: "Menu" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("has the hero's copy exactly, in the design's type", async ({ page }) => {
    const hero = page.getByTestId("hero");
    await expect(hero.locator(".ds-eyebrow")).toHaveText("A Seattle institution since 1910");
    await expect(hero.getByRole("heading", { level: 1 })).toHaveText("Your summer evenings, on Lake Union.");
    await expect(hero.locator(".ds-hero-lead")).toHaveText("Rowing, paddling, a private gym and the best deck in town.");
    await expect(page.getByTestId("hero-tour")).toHaveText("Request a tour");
    await expect(page.getByTestId("hero-tour")).toHaveAttribute("href", "/site/request-a-tour");
    await expect(page.getByTestId("hero-join")).toHaveText("How to join →");
    await expect(page.getByTestId("hero-join")).toHaveAttribute("href", "#how-to-join");

    expect(await css(page, ".ds-hero h1", "font-size")).toBe("34px");
    expect(await css(page, ".ds-hero h1", "font-weight")).toBe("600");
    expect(await css(page, ".ds-hero h1", "font-family")).toContain("Cinzel");
    expect(await css(page, ".ds-hero h1", "color")).toBe("rgb(255, 255, 255)");
    expect(await css(page, ".ds-hero .ds-eyebrow", "color")).toBe(SUN);
    expect(await css(page, ".ds-hero .ds-eyebrow", "font-size")).toBe("12px");
    expect(await css(page, ".ds-hero .ds-eyebrow", "font-weight")).toBe("800");
    expect(await css(page, ".ds-hero .ds-eyebrow", "text-transform")).toBe("uppercase");
    expect(await css(page, ".ds-hero .ds-eyebrow", "letter-spacing")).toBe("1.68px"); // 0.14em of 12px
    expect(await css(page, ".ds-hero-lead", "color")).toBe(PAPER_ON_DARK);
    expect(await css(page, ".ds-hero-lead", "font-size")).toBe("16px");
    expect(await css(page, ".ds-hero-lead", "font-family")).toContain("Figtree");
  });

  test("has the hero 460 pixels tall on Cyberspace, a labelled placeholder for the photo, and a full-width Sun button", async ({ page }) => {
    const hero = page.getByTestId("hero");
    expect(Math.round((await hero.boundingBox())!.height)).toBe(460);
    expect(await css(page, '[data-testid="hero"]', "background-color")).toBe(CYBERSPACE);
    const placeholder = page.getByTestId("hero-photo-placeholder");
    await expect(placeholder).toHaveText("Photo: members on the deck at sunset");
    await expect(placeholder).toHaveAttribute("aria-label", "Photo placeholder: members on the deck at sunset, Lake Union");
    expect(await placeholder.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");

    const button = page.getByTestId("hero-tour");
    const box = (await button.boundingBox())!;
    expect(Math.round(box.height)).toBe(52);
    expect(Math.round(box.width)).toBe(350); // 390 minus the 20 pixel margins
    expect(await button.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(SUN);
    expect(await button.evaluate((el) => getComputedStyle(el).color)).toBe(INK);
    expect(await button.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    expect(await button.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("800");
    expect(await button.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("999px");
    expect(await button.evaluate((el) => getComputedStyle(el).textTransform)).toBe("none");
    expect((await page.getByTestId("hero-join").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("shows what you get, then the lane line, then how to join, then the wave, then the footer, in that order", async ({ page }) => {
    await expect(page.getByRole("region", { name: "What you get" }).locator(".ds-eyebrow")).toHaveText("What you get");
    const items = page.locator(".ds-features-list li");
    await expect(items.getByRole("heading", { level: 3 })).toHaveText(["Out on the water", "A lounge with a view", "People worth knowing"]);
    await expect(items.locator("p")).toHaveText([
      "Rowing and paddling for every level, with boats and boards ready to go.",
      "The Members Lounge looks right out over Lake Union.",
      "A full calendar run by members. Come for a class, stay for the friends.",
    ]);
    expect(await css(page, ".ds-features-list h3", "font-size")).toBe("20px");
    expect(await css(page, ".ds-features-list p", "font-size")).toBe("17px");
    expect(await css(page, ".ds-features-list p", "font-family")).toContain("EB Garamond");

    const join = page.locator("#how-to-join");
    await expect(join.locator(".ds-eyebrow")).toHaveText("How to join");
    await expect(join.getByRole("heading", { level: 2 })).toHaveText("Three steps to the dock.");
    expect(await css(page, "#how-to-join h2", "font-size")).toBe("26px");
    await expect(join.locator(".ds-step")).toHaveText(["1Take a tour. Thirty minutes, no pressure.", "2Apply. A short form and two member sponsors. We'll help you find them.", "3Welcome aboard. Row, paddle, train, or just come for the company."]);
    const circle = join.locator(".ds-step-number").first();
    expect(Math.round((await circle.boundingBox())!.width)).toBe(32);
    expect(await circle.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(SUN);
    expect(await circle.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("50%");
    // Steps 1 and 2 are the designer's placeholder wording, and the page says so.
    await expect(join.getByTestId("site-preview-note")).toContainText("Steps 1 and 2 are the designer's draft wording");

    // The order down the page.
    const tops = await page.evaluate(() => {
      const top = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().top + window.scrollY;
      return [top(".ds-hero"), top(".ds-features"), top(".ds-lane"), top("#how-to-join"), top(".ds-wave"), top("footer")];
    });
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  });

  test("draws the two dividers from the approved drawings, hidden from screen readers, 20 pixels tall", async ({ page, request }) => {
    for (const [selector, file] of [[".ds-lane", "divider-lane-line-tile.svg"], [".ds-wave", "divider-wave-swell-tile.svg"]]) {
      const el = page.locator(selector);
      await expect(el.locator("xpath=..")).toHaveAttribute("aria-hidden", "true");
      expect(Math.round((await el.boundingBox())!.height)).toBe(20);
      expect(await el.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain(file);
      expect(await el.evaluate((node) => getComputedStyle(node).backgroundRepeat)).toBe("repeat-x");
      const res = await request.get(`/ds/${file}`);
      expect(res.status(), file).toBe(200);
      expect(res.headers()["content-type"]).toContain("image/svg+xml");
    }
    // The lane line's floats: a 1px Cyberspace line, a Sun float every 36 pixels, every fifth one Waterloo.
    const svg = await (await request.get("/ds/divider-lane-line-tile.svg")).text();
    expect(svg).toContain('stroke="#44484D"');
    expect(svg.match(/fill="#F2C14E"/g)).toHaveLength(1);
    expect(svg.match(/<circle/g)).toHaveLength(5);
    expect(svg).toContain('fill="#536872"');
    expect(svg).toContain('width="180"');
  });

  test("has the footer's copy, Cyberspace background and 44 pixel links", async ({ page }) => {
    const footer = page.locator("footer");
    expect(await footer.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(CYBERSPACE);
    await expect(footer.getByRole("heading", { level: 2 })).toHaveText("Come see it for yourself.");
    expect(await css(page, "footer h2", "font-size")).toBe("24px");
    await expect(footer.locator("address")).toContainText("11 East Allison Street, Seattle, WA 98102");
    await expect(footer.locator("address")).toContainText("(206) 622-0624");
    for (const link of await footer.getByRole("link").all()) {
      expect((await link.boundingBox())!.height, await link.innerText()).toBeGreaterThanOrEqual(44);
    }
    expect(await css(page, "footer .ds-footer-member", "color")).toBe(SUN);
    expect(await css(page, "footer .ds-footer-links a:not(.ds-footer-member)", "color")).toBe(OYSTER);
  });

  test("keeps every piece of text at AA contrast (4.5 to 1) as drawn", async ({ page }) => {
    const places: [string, string][] = [
      ["hero headline", ".ds-hero h1"],
      ["hero eyebrow", ".ds-hero .ds-eyebrow"],
      ["hero lead", ".ds-hero-lead"],
      ["hero Request a tour", '[data-testid="hero-tour"]'],
      ["hero How to join", ".ds-hero-join"],
      ["placeholder label", ".ds-hero-placeholder"],
      ["features eyebrow", ".ds-features .ds-eyebrow"],
      ["feature title", ".ds-features-list h3"],
      ["feature text", ".ds-features-list p"],
      ["steps heading", "#how-to-join h2"],
      ["step text", ".ds-step"],
      ["step lead-in", ".ds-step strong"],
      ["step number", ".ds-step-number"],
      ["preview note", ".site-preview-note"],
      ["header Member login", '[data-testid="member-login-header"] span'],
      ["header Menu", ".ds-menu-button"],
      ["header logo", ".ds-logo-link"],
      ["footer heading", "footer h2"],
      ["footer address", "footer address"],
      ["footer link", "footer .ds-footer-links a"],
      ["footer Member login", "footer .ds-footer-member"],
      ["footer fine print", ".ds-footer-fine"],
    ];
    for (const [what, selector] of places) expect(await contrastOf(page, selector), what).toBeGreaterThanOrEqual(4.5);
  });

  test("scrolls to How to join when 'How to join' is pressed, with the heading clear of the sticky header", async ({ page }) => {
    await page.getByTestId("hero-join").click();
    await expect(page).toHaveURL(/#how-to-join$/);
    await page.waitForFunction(() => document.querySelector("#how-to-join")!.getBoundingClientRect().top < 200);
    const top = await page.locator("#how-to-join h2").evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThan(64);
  });

  test("Request a tour leads to the tour page", async ({ page }) => {
    await page.getByTestId("hero-tour").click();
    await expect(page).toHaveURL(/\/site\/request-a-tour$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Request a tour");
  });
});

test.describe("the sticky Request a tour bar (phones only)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("is out of the way while the headline's own button shows, comes in once it has scrolled off, and goes again when it is back", async ({ page }) => {
    await page.goto("/site");
    const bar = page.getByTestId("sticky-cta");
    await expect(bar).toHaveClass(/is-hidden/);
    await expect(bar).toBeHidden(); // not just moved: out of the tab order and the reading order too
    await page.mouse.wheel(0, 700);
    await expect(bar).not.toHaveClass(/is-hidden/);
    await expect(bar).toBeVisible();
    await page.waitForTimeout(450); // it slides in over a quarter of a second
    const box = (await bar.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(844); // along the bottom edge
    const button = bar.getByRole("link", { name: "Request a tour" });
    expect(Math.round((await button.boundingBox())!.height)).toBe(48);
    expect(await css(page, '[data-testid="sticky-cta"]', "background-color")).toBe("rgb(251, 250, 246)");
    expect(await css(page, '[data-testid="sticky-cta"] a', "background-color")).toBe(SUN);
    await page.mouse.wheel(0, -2000);
    await expect(bar).toHaveClass(/is-hidden/);
  });

  test("never covers the footer's last line", async ({ page }) => {
    await page.goto("/site");
    await page.mouse.wheel(0, 9000);
    await expect(page.getByTestId("sticky-cta")).toBeVisible();
    await page.waitForTimeout(300);
    const [fine, bar] = await Promise.all([page.locator(".ds-footer-fine").boundingBox(), page.getByTestId("sticky-cta").boundingBox()]);
    expect(fine!.y + fine!.height).toBeLessThanOrEqual(bar!.y);
  });

  test("is on every other page too, and takes you to the tour page, but is not on the tour page itself", async ({ page }) => {
    await page.goto("/site/membership");
    const bar = page.getByTestId("sticky-cta");
    await expect(bar).toBeVisible();
    await bar.getByRole("link", { name: "Request a tour" }).click();
    await expect(page).toHaveURL(/\/site\/request-a-tour$/);
    await expect(page.getByTestId("sticky-cta")).toHaveCount(0);
  });

  test("forgets that the headline's button was on screen when you go to another page", async ({ page }) => {
    await page.goto("/site");
    await expect(page.getByTestId("sticky-cta")).toHaveClass(/is-hidden/);
    await page.getByRole("button", { name: "Menu" }).click();
    await nav(page).getByRole("link", { name: "About", exact: true }).click();
    await expect(page.getByTestId("sticky-cta")).toBeVisible();
  });

  test("is not there from 768 pixels up", async ({ page }) => {
    for (const width of [768, 1024, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/site/membership");
      await expect(page.getByTestId("sticky-cta"), String(width)).toBeHidden();
    }
  });
});

test.describe("the menu on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const menuButton = (page: Page) => page.getByRole("button", { name: /^(Menu|Close)$/ });

  test("opens and closes, stops the page behind it from scrolling, and gives Member login a place at the bottom", async ({ page }) => {
    await page.goto("/site");
    await expect(nav(page)).toBeHidden();
    await menuButton(page).click();
    await expect(menuButton(page)).toHaveText("Close");
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(nav(page).getByRole("link")).toHaveText(["Home", "About", "Our Programs", "Membership", "Request a Tour", "Contact", "Member login"]);
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
    // The last item is Member login, at the bottom.
    const links = await nav(page).getByRole("link").all();
    expect(await links[links.length - 1].innerText()).toBe("Member login");
    await expect(links[links.length - 1]).toHaveAttribute("href", "/club/sign-in");
    await menuButton(page).click();
    await expect(nav(page)).toBeHidden();
    await expect(menuButton(page)).toHaveText("Menu");
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  });

  test("starts at the first page link, closes on Escape and gives the focus back to the button", async ({ page }) => {
    await page.goto("/site");
    await menuButton(page).click();
    await expect(nav(page).getByRole("link", { name: "Home", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(nav(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  });

  test("keeps the keyboard inside the header while it is open, going round in both directions", async ({ page }) => {
    await page.goto("/site");
    await menuButton(page).click();
    const reachable = await page.getByTestId("site-header").evaluate((header) => [...header.querySelectorAll<HTMLElement>("a[href], button")].filter((el) => el.offsetParent !== null).length);
    expect(reachable).toBe(1 + 7 + 2); // the logo, seven menu links, then the Member login pill and the Close button
    for (let i = 0; i < reachable * 2 + 3; i += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement!.closest("header") !== null), `tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < reachable + 2; i += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => document.activeElement!.closest("header") !== null), `shift-tab ${i + 1}`).toBe(true);
    }
  });

  test("closes when the dimmed page behind it is tapped, and when you choose a page", async ({ page }) => {
    await page.goto("/site");
    await menuButton(page).click();
    await page.mouse.click(195, 790); // the dimmed page, well below the menu
    await expect(nav(page)).toBeHidden();
    await menuButton(page).click();
    await nav(page).getByRole("link", { name: "Membership", exact: true }).click();
    await expect(page).toHaveURL(/\/site\/membership$/);
    await expect(nav(page)).toBeHidden();
    // Choosing the page you are already on closes it too.
    await menuButton(page).click();
    await nav(page).getByRole("link", { name: "Membership", exact: true }).click();
    await expect(nav(page)).toBeHidden();
  });

  test("closes by itself when the screen is turned wide, and the page can scroll again", async ({ page }) => {
    await page.goto("/site");
    await menuButton(page).click();
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(menuButton(page)).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  });

  test("sits right under the header, whatever the page has scrolled to, without dimming the header itself", async ({ page }) => {
    await page.goto("/site/membership");
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);
    await menuButton(page).click();
    const [header, panel] = await Promise.all([page.getByTestId("site-header").boundingBox(), nav(page).boundingBox()]);
    expect(Math.round(panel!.y)).toBe(Math.round(header!.y + header!.height));
    expect(await page.locator(".ds-scrim").evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(Math.round(header!.y + header!.height));
  });
});

test.describe("the homepage from 768 pixels up", () => {
  test("has a 640 pixel hero with the words in a left column no wider than 560, the buttons side by side, and three columns below", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.goto("/site");
    expect(Math.round((await page.getByTestId("hero").boundingBox())!.height)).toBe(640);
    const column = (await page.locator(".ds-hero-column").boundingBox())!;
    expect(Math.round(column.width)).toBeLessThanOrEqual(560);
    const [tour, join] = await Promise.all([page.getByTestId("hero-tour").boundingBox(), page.getByTestId("hero-join").boundingBox()]);
    expect(Math.abs(tour!.y + tour!.height / 2 - (join!.y + join!.height / 2))).toBeLessThan(6);
    expect(join!.x).toBeGreaterThan(tour!.x + tour!.width);
    expect(tour!.width).toBeLessThan(350);

    const itemTops = await page.locator(".ds-features-list li").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(itemTops).size).toBe(1);
    const stepTops = await page.locator(".ds-step").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(stepTops).size).toBe(1);
    // The content is 980 wide with 20 pixels either side (the container rule).
    const content = (await page.locator(".ds-features").boundingBox())!;
    expect(Math.round(content.width)).toBe(1020);
  });

  test("puts the pages inline in the header from 900 pixels, with Member login as the pill at the far right and no Menu button", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await page.goto("/site");
    await expect(page.getByRole("button", { name: /^(Menu|Close)$/ })).toBeHidden();
    await expect(nav(page).getByRole("link")).toHaveText(["Home", "About", "Our Programs", "Membership", "Request a Tour", "Contact"]);
    const [pill, last] = await Promise.all([page.getByTestId("member-login-header").boundingBox(), nav(page).getByRole("link", { name: "Contact", exact: true }).boundingBox()]);
    expect(pill!.x).toBeGreaterThan(last!.x + last!.width);
    expect(Math.round(pill!.x + pill!.width)).toBe(1180 - 100); // the container's right edge
    // Everything in the header is on one line.
    const tops = await page.getByTestId("site-header").locator("a, button").evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(12);
  });

  test("keeps the pages inline and on one line down to 900 pixels, and the Menu button between 768 and 899", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/site");
    expect(Math.round((await page.getByTestId("site-header").boundingBox())!.height)).toBe(64);
    await expect(nav(page).getByRole("link")).toHaveCount(6);
    await page.setViewportSize({ width: 899, height: 800 });
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
  });
});

test.describe("every public page at every width in the design", () => {
  for (const width of [390, 1024, 1180, 1366, 1600, 1920]) {
    test(`fits ${width} pixels wide with no sideways scrolling, and the content stays 980 wide`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of PUBLIC_PAGES) {
        await page.goto(path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} at ${width}`).toBeLessThanOrEqual(0);
        if (width >= 1024) {
          const widest = await page.locator("main .ds-container, main .site-frame").evaluateAll((els) => Math.max(...els.map((el) => el.getBoundingClientRect().width)));
          expect(Math.round(widest), `${path} at ${width}`).toBeLessThanOrEqual(1020);
        }
      }
    });
  }
});

test.describe("the rules for public pages", () => {
  for (const width of [390, 1180]) {
    test(`never show the bar, Happy Hour, drinks, access codes, iCrew links or any phone number but the main line (${width} pixels wide)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of PUBLIC_PAGES) {
        await page.goto(path);
        const text = await page.locator("body").innerText();
        const html = await page.content();
        expect(text, path).not.toMatch(/\bbars?\b|happy hour|\bdrinks?\b|beverage|\bwine\b|\bbeer\b|cocktail|\bsip\b/i);
        expect(text, path).not.toMatch(/access code|door code|key ?code|passcode|\bPIN\b/i);
        expect(html, path).not.toMatch(/icrew/i);
        const phones = new Set(text.match(/\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4}/g) ?? []);
        for (const found of phones) expect(found, `${path}: a phone number other than the main line`).toBe("(206) 622-0624");
        const callLinks = await page.locator('a[href^="tel:"]').evaluateAll((links) => links.map((a) => a.getAttribute("href")));
        for (const href of callLinks) expect(href, path).toBe("tel:2066220624");
        // No link to another website at all (Member login stays on this site until the club sets the member app's own address).
        const outside = await page.locator("a[href]").evaluateAll((links) => links.map((a) => a.getAttribute("href")!).filter((h) => /^(https?:)?\/\//.test(h)));
        expect(outside, path).toEqual([]);
      }
    });
  }

  test("have one H1 and a text name for every picture, on every page", async ({ page }) => {
    for (const path of PUBLIC_PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }), path).toHaveCount(1);
      const unnamed = await page.locator("img").evaluateAll((imgs) => imgs.filter((img) => !(img.getAttribute("alt") ?? "").trim()).length);
      expect(unnamed, `${path}: pictures with no alt text`).toBe(0);
      const unlabelled = await page.locator('[role="img"]').evaluateAll((els) => els.filter((el) => !(el.getAttribute("aria-label") ?? "").trim()).length);
      expect(unlabelled, `${path}: picture stand-ins with no label`).toBe(0);
    }
  });

  test("keep every link, button and form box big enough to tap (44 pixels) in the header, menu, hero, sticky bar, footer and form", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of PUBLIC_PAGES) {
      await page.goto(path);
      await page.mouse.wheel(0, 500); // so the sticky bar is showing wherever it applies
      await page.waitForTimeout(300);
      if (await page.getByRole("button", { name: "Menu" }).isVisible()) await page.getByRole("button", { name: "Menu" }).click();
      const small = await page.locator(".ds-header a, .ds-header button, .ds-hero a, .ds-sticky-cta a, .ds-footer a, .ds-form button, .ds-input, .ds-textarea").evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === "fixed")
          .map((el) => ({ what: (el.textContent || el.getAttribute("name") || el.tagName).trim().slice(0, 30), box: el.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && (box.height < 44 || box.width < 44))
          .map(({ what, box }) => `${what} (${Math.round(box.width)}x${Math.round(box.height)})`),
      );
      expect(small, `${path}: too small to tap`).toEqual([]);
      if (await page.getByRole("button", { name: "Close" }).isVisible()) await page.keyboard.press("Escape");
    }
  });
});
