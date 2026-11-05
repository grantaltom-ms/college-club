import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The kiosk screens' colours (Grant, Nov 4: the front-desk iPad, the honor snack bar iPad and the test landing page take the design
 * package's colours and nothing else). They have no top bar and no title band, so a shared screen never shows anyone's menu, and they
 * keep their own layout, large taps, fonts and shapes. What is held here is exactly that: every colour the browser draws on them is in
 * the package's palette, and none of the members' and staff look (the band, the bar, the square corners, Cinzel buttons) has leaked in.
 * The same colour check runs on every screen of the logged-in app in club-app-look.spec.ts.
 */

/** The package's colours, plus Debonair's absence and the app's one error red. */
const PALETTE = ["#ffffff", "#536872", "#435661", "#44484d", "#33363a", "#e2ddd0", "#f5f3ec", "#6c7176", "#e6ebed", "#c3cbce", "#d3ccbc", "#7f96a0", "#8a2b1a"];
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const ALLOWED = [...new Set(PALETTE.map(rgb))];

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** The two private addresses, and one member's id, as staff and the picker show them. */
async function setUp(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await actAs(page, "Test staff");
  await page.goto("/club/admin/ipad");
  const snack = (await page.getByTestId("snack-link").getAttribute("href"))!;
  const checkIn = (await page.getByTestId("ipad-link").getAttribute("href"))!;
  await page.goto("/club/act-as");
  const value = (await page.getByRole("button", { name: "Act as Nora Abernathy", exact: true }).getAttribute("value"))!;
  await context.close();
  expect(snack).toMatch(/^\/club\/snacks\/[A-Za-z0-9_-]{43}$/);
  expect(checkIn).toMatch(/^\/club\/ipad\/[A-Za-z0-9_-]{43}$/);
  return { snack, checkIn, nora: value.replace("member:", "") };
}

type Where = { name: string; path: (a: { snack: string; checkIn: string; nora: string }) => string; h1: string | RegExp; fill?: (page: Page) => Promise<void> };

const SCREENS: Where[] = [
  { name: "the check-in iPad's start screen", path: (a) => a.checkIn, h1: "Who is checking in?" },
  { name: "the iPad's visitors search", path: (a) => `${a.checkIn}/visitors`, h1: /\S/ },
  { name: "the iPad's visitors count", path: (a) => `${a.checkIn}/visitors/${a.nora}`, h1: /\S/ },
  { name: "the snack bar's start screen", path: (a) => a.snack, h1: "Honor snack bar" },
  {
    name: "the snack bar with a name found",
    path: (a) => a.snack,
    h1: "Honor snack bar",
    fill: async (page) => {
      await page.getByLabel("Type your name, then press Find me").fill("nora abernathy");
      await page.getByRole("button", { name: "Find me" }).click();
      await expect(page.getByTestId("snack-names").getByRole("link", { name: "Nora Abernathy", exact: true })).toBeVisible();
    },
  },
  { name: "a member's snack screen", path: (a) => `${a.snack}/${a.nora}`, h1: /^Hi, Nora/ },
  { name: "the test landing page", path: () => "/club/start", h1: "CCS System" },
];

const open = async (page: Page, screen: Where, addr: Awaited<ReturnType<typeof setUp>>) => {
  await page.goto(screen.path(addr));
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  if (screen.fill) await screen.fill(page);
};

test.describe("the kiosk screens' colours", () => {
  let addr: Awaited<ReturnType<typeof setUp>>;
  test.beforeAll(async ({ browser, baseURL }) => {
    addr = await setUp(browser, baseURL!);
  });

  for (const screen of SCREENS) {
    test.describe(screen.name, () => {
      test("draws only the package's colours", async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 768 });
        await open(page, screen, addr);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(screen.h1);
        // Measure the colours a page settles on, not a link half-way through a fade.
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
        }, ALLOWED);
        expect(stray, `colours outside the palette on ${screen.name}`).toEqual([]);
      });

      test("has no top bar, no member menu, no title band, and none of the members' and staff look", async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 768 });
        await open(page, screen, addr);
        await expect(page.getByRole("navigation", { name: "Member area" })).toHaveCount(0);
        await expect(page.getByTestId("acting-as")).toHaveCount(0);
        await expect(page.locator(".club-band, .club-app, .club-brand")).toHaveCount(0);
        // The page is white, not the old cream.
        const page_bg = await page.evaluate(() => getComputedStyle(document.querySelector(".club-kiosk")!).backgroundColor);
        expect(page_bg).toBe(rgb("#ffffff"));
        // Layout, fonts and shapes are the screen's own: a button is still the older rounded one in the sans font, not the 2px Cinzel capitals.
        const button = page.locator(".club-button, .ipad-go, .ipad-back").first();
        if (await button.count()) {
          const look = await button.evaluate((el) => {
            const s = getComputedStyle(el);
            return { radius: s.borderTopLeftRadius, family: s.fontFamily, transform: s.textTransform };
          });
          expect(look.radius).not.toBe("2px");
          expect(look.family).not.toContain("Cinzel");
          expect(look.transform).not.toBe("uppercase");
        }
      });

      test("never scrolls sideways on an iPad either way up or on a phone", async ({ page }) => {
        for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport);
          await open(page, screen, addr);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${screen.name} at ${viewport.width}px`).toBeLessThanOrEqual(0);
        }
      });
    });
  }
});
