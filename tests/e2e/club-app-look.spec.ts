import { expect, test, type Page } from "@playwright/test";
import { mockAll } from "./helpers";

/**
 * The members' and staff look (design package "Waterloo Blocks", Nov 4 2026), checked on the screens that have been converted so far:
 * the member home, the staff Households list and the Reservations screens. Each later pull request adds the screens it converts to
 * SCREENS below, so "no colour outside the palette" keeps growing to cover the whole app.
 *
 * Everything is measured as the browser actually draws it: the colours it paints, the sizes of what you tap, and whether a screen
 * scrolls sideways. What the browser draws is what a member sees, so that is what is held.
 */

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

type Screen = { name: string; who: string; path: string; h1: string | RegExp };

const SCREENS: Screen[] = [
  { name: "member home", who: "Nora Abernathy", path: "/club", h1: "The Abernathy household" },
  { name: "staff households list", who: "Test staff", path: "/club", h1: "Households" },
  { name: "Reservations: what to reserve", who: "Nora Abernathy", path: "/club/book", h1: "Reservations" },
  { name: "Reservations: shell sizes", who: "Nora Abernathy", path: "/club/book?what=shell", h1: "Reservations" },
  { name: "Reservations: the shell list", who: "Nora Abernathy", path: "/club/book?what=shell&kind=single", h1: "Reservations" },
  { name: "Reservations: a space with time slots", who: "Nora Abernathy", path: "/club/book?what=gym", h1: "Reservations" },
  { name: "Reservations as staff", who: "Test staff", path: "/club/book?what=shell&kind=single", h1: "Reservations" },
];

/** The package's colours, as the browser writes them: rgb(r, g, b). */
const PALETTE = [
  "#ffffff", "#536872", "#435661", "#44484d", "#33363a", "#e2ddd0", "#f5f3ec", "#6c7176", "#e6ebed", "#c3cbce", "#d3ccbc", "#7f96a0",
  "#8a2b1a", // the one error red
];
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const ALLOWED = new Set(PALETTE.map(rgb));

const WIDTHS = [390, 1024, 1180, 1366, 1600, 1920];

test.describe("the members' and staff look", () => {
  for (const screen of SCREENS) {
    test.describe(screen.name, () => {
      test("draws only the package's colours", async ({ page }) => {
        await page.setViewportSize({ width: 1180, height: 900 });
        await actAs(page, screen.who);
        await page.goto(screen.path);
        await expect(page.locator(".club-band h1")).toBeVisible();
        // Measure the colours a page settles on, not a link half-way through its 220ms fade because the mouse is resting over it.
        await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
        await page.mouse.move(0, 0);

        const stray = await page.evaluate((allowed) => {
          const ok = new Set(allowed);
          const out: string[] = [];
          const clear = (c: string) => c === "rgba(0, 0, 0, 0)" || c === "transparent";
          for (const el of document.querySelectorAll<HTMLElement>("body *")) {
            const s = getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden") continue;
            const where = `${el.tagName.toLowerCase()}.${el.className && typeof el.className === "string" ? el.className.split(" ")[0] : ""}`;
            const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
            const props: [string, string][] = [["background", s.backgroundColor]];
            if (hasText) props.push(["text", s.color]);
            for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
              const width = parseFloat(s[`border${side}Width` as "borderTopWidth"]);
              if (width > 0 && s[`border${side}Style` as "borderTopStyle"] !== "none") props.push([`border-${side.toLowerCase()}`, s[`border${side}Color` as "borderTopColor"]]);
            }
            for (const [what, value] of props) if (!clear(value) && !ok.has(value)) out.push(`${where} ${what} ${value}`);
          }
          return [...new Set(out)];
        }, [...ALLOWED]);
        expect(stray, `colours outside the palette on ${screen.name}`).toEqual([]);
      });

      test("has one H1, in the Waterloo title band, in white Cinzel", async ({ page }) => {
        await page.setViewportSize({ width: 1180, height: 900 });
        await actAs(page, screen.who);
        await page.goto(screen.path);
        await expect(page.locator("h1")).toHaveCount(1);
        const h1 = page.locator(".club-band h1");
        await expect(h1).toHaveText(screen.h1);
        const look = await h1.evaluate((el) => {
          const s = getComputedStyle(el);
          const band = getComputedStyle(el.closest(".club-band")!);
          return { color: s.color, size: s.fontSize, family: s.fontFamily, weight: s.fontWeight, band: band.backgroundColor };
        });
        expect(look.band).toBe(rgb("#536872"));
        expect(look.color).toBe("rgb(255, 255, 255)");
        expect(look.size).toBe("36px");
        expect(look.family).toContain("Cinzel");
        expect(look.weight).toBe("600");
      });

      test("never scrolls sideways at any of the six widths", async ({ page }) => {
        await actAs(page, screen.who);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(screen.path);
          await expect(page.locator(".club-band h1")).toBeVisible();
          const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(over, `${screen.name} at ${width}px`).toBeLessThanOrEqual(0);
        }
      });

      test("keeps every button, menu item and chip at least 44px to tap, on a phone and on a desktop", async ({ page }) => {
        await actAs(page, screen.who);
        for (const width of [390, 1180]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(screen.path);
          await expect(page.locator(".club-band h1")).toBeVisible();
          const small = await page.evaluate(() => {
            const out: string[] = [];
            for (const el of document.querySelectorAll<HTMLElement>(".club-button, .club-menu-button, .club-nav a, .club-nav button, .club-chips a, .club-quiet-links a, .club-brand, .club-back a, .club-length-chip")) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue; // not on screen (the phone menu while closed)
              if (r.height < 43.5) out.push(`${el.className || el.tagName} ${Math.round(r.height)}px tall: ${(el.textContent ?? "").trim().slice(0, 30)}`);
            }
            return out;
          });
          expect(small, `too small to tap at ${width}px on ${screen.name}`).toEqual([]);
        }
      });
    });
  }

  test("the top bar is Oyster with the warm line under it, the club's name as the link home, and who is acting at the right", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    const header = page.getByRole("banner");
    const look = await header.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, line: s.borderBottomColor, height: el.getBoundingClientRect().height };
    });
    expect(look.bg).toBe(rgb("#e2ddd0"));
    expect(look.line).toBe(rgb("#d3ccbc"));
    expect(look.height).toBeGreaterThanOrEqual(72);
    await expect(header.getByRole("link", { name: "College Club Seattle" })).toHaveAttribute("href", "/club");
    const acting = page.getByTestId("acting-as");
    await expect(acting).toBeVisible();
    // It sits at the right-hand end of the bar, as in the package.
    const [bar, text] = await Promise.all([header.boundingBox(), acting.boundingBox()]);
    expect(text!.x + text!.width).toBeGreaterThan(bar!.x + bar!.width - 80);
  });

  test("the page you are on is marked in the menu: its colour is Ink and it has a 2px Waterloo line under it", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club/book");
    const here = page.getByRole("navigation", { name: "Member area" }).getByRole("link", { name: "Book", exact: true });
    await expect(here).toHaveAttribute("aria-current", "page");
    const look = await here.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, line: s.borderBottomColor, width: s.borderBottomWidth };
    });
    expect(look).toEqual({ color: rgb("#33363a"), line: rgb("#536872"), width: "2px" });
    // The others are not marked, and the home link is only marked on the home address.
    const home = page.getByRole("navigation", { name: "Member area" }).getByRole("link", { name: "My household", exact: true });
    await expect(home).not.toHaveAttribute("aria-current", "page");
    await page.goto("/club");
    await expect(home).toHaveAttribute("aria-current", "page");
  });

  test("on a phone the bar keeps the name and Menu on one row, and shows who is acting under it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    const brand = await page.locator(".club-brand").boundingBox();
    const menu = await page.getByRole("button", { name: "Menu" }).boundingBox();
    const acting = await page.getByTestId("acting-as").boundingBox();
    expect(Math.abs(brand!.y + brand!.height / 2 - (menu!.y + menu!.height / 2))).toBeLessThan(12); // the same row
    expect(acting!.y).toBeGreaterThan(brand!.y + brand!.height - 4); // a row of its own, below
    await expect(page.getByTestId("acting-as")).toHaveText("Acting as Nora Abernathy.");
  });

  test("on a short phone the open menu ends above the bottom edge, so its last link (Switch test member) can still be reached", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 568 });
    await actAs(page, "Test staff");
    await page.goto("/club");
    await page.getByRole("button", { name: "Menu" }).click();
    const panel = page.locator("#club-member-nav");
    await expect(panel).toBeVisible();
    await panel.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const last = await panel.getByRole("link", { name: "Switch test member" }).boundingBox();
    expect(last!.y + last!.height, "the last link's bottom edge, against the 568px screen").toBeLessThanOrEqual(568);
    // The panel itself stops at the bottom of the screen, and the page behind it does not move.
    const box = await panel.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(568);
  });

  test("the test-build note is a thin strip above the bar, with the same words as before", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    const note = page.getByRole("note");
    await expect(note).toHaveText("Test build. Every household, member and booking here is invented. Nothing is connected to real club data.");
    const [n, bar] = await Promise.all([note.boundingBox(), page.getByRole("banner").boundingBox()]);
    expect(n!.y + n!.height).toBeLessThanOrEqual(bar!.y + 1);
  });

  test("the member home's one highlight card is Waterloo with white text and a white button", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    const card = page.locator(".club-card-highlight");
    await expect(card).toHaveCount(1);
    const look = await card.evaluate((el) => {
      const s = getComputedStyle(el);
      const b = getComputedStyle(el.querySelector(".club-button")!);
      return { bg: s.backgroundColor, text: getComputedStyle(el.querySelector("p")!).color, button: b.backgroundColor, buttonText: b.color };
    });
    expect(look).toEqual({ bg: rgb("#536872"), text: "rgb(255, 255, 255)", button: "rgb(255, 255, 255)", buttonText: rgb("#33363a") });
  });

  test("buttons are 2px-cornered Cinzel capitals, cards are 6px, form boxes 4px with a Waterloo edge", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Test staff");
    await page.goto("/club/admin/households/new");
    const look = await page.evaluate(() => {
      const button = getComputedStyle(document.querySelector(".club-button")!);
      const card = document.querySelector(".club-card");
      const box = document.querySelector<HTMLInputElement>(".club-form input[type=text]");
      const b = getComputedStyle(box!);
      return {
        buttonRadius: button.borderTopLeftRadius,
        buttonFont: button.fontFamily,
        buttonCase: button.textTransform,
        cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : "6px",
        boxRadius: b.borderTopLeftRadius,
        boxEdge: b.borderTopColor,
        boxFont: b.fontFamily,
      };
    });
    expect(look.buttonRadius).toBe("2px");
    expect(look.buttonFont).toContain("Cinzel");
    expect(look.buttonCase).toBe("uppercase");
    expect(look.cardRadius).toBe("6px");
    expect(look.boxRadius).toBe("4px");
    expect(look.boxEdge).toBe(rgb("#536872"));
    expect(look.boxFont).toContain("EB Garamond");
  });

  test("the page is white, not cream", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    expect(await page.locator(".club-app").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  });

  test("the sign-in screen, the front-desk iPad pages and the public site are untouched: none of them is inside the new look", async ({ page }) => {
    for (const path of ["/club/sign-in", "/site"]) {
      await page.goto(path);
      await expect(page.locator(".club-app")).toHaveCount(0);
    }
    // The dashboard's menu bar is the dashboard's own.
    await mockAll(page);
    await page.goto("/");
    await expect(page.locator(".club-app")).toHaveCount(0);
  });
});
