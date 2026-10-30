import { expect, test } from "@playwright/test";

/**
 * The refresh's design tokens (the design handoff, Oct 2026) reach every kind of page, and Figtree really loads: the file being
 * right is not enough, the browser has to be handed the tokens and the font. The values themselves are held in
 * src/app/theme-tokens.test.ts.
 */

const PAGES = [
  { name: "the dashboard", path: "/" },
  { name: "the public site", path: "/site" },
  { name: "the member sign-in", path: "/club/sign-in" },
];

for (const { name, path } of PAGES) {
  test.describe(name, () => {
    test("is handed the refresh's tokens", async ({ page }) => {
      await page.goto(path);
      const read = (names: string[]) => page.evaluate((list) => Object.fromEntries(list.map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()])), names);
      expect(await read(["--sun", "--sun-hover", "--waterloo-dark", "--paper-on-dark", "--radius-pill", "--radius-input", "--radius-card", "--tap-min", "--container"])).toEqual({
        "--sun": "#f2c14e",
        "--sun-hover": "#e5b23f",
        "--waterloo-dark": "#435661",
        "--paper-on-dark": "#f5f3ec",
        "--radius-pill": "999px",
        "--radius-input": "12px",
        "--radius-card": "16px",
        "--tap-min": "44px",
        "--container": "980px",
      });
    });

    test("can use Figtree at 400, 600 and 800, and still has Cinzel and EB Garamond", async ({ page }) => {
      await page.goto(path);
      const loaded = await page.evaluate(async () => {
        const wanted = ["400 16px Figtree", "600 16px Figtree", "800 16px Figtree", "600 16px Cinzel", "400 16px 'EB Garamond'"];
        const result: Record<string, boolean> = {};
        for (const font of wanted) {
          await document.fonts.load(font);
          result[font] = document.fonts.check(font);
        }
        return result;
      });
      expect(loaded).toEqual({ "400 16px Figtree": true, "600 16px Figtree": true, "800 16px Figtree": true, "600 16px Cinzel": true, "400 16px 'EB Garamond'": true });
    });
  });
}

test("a page that does not use Figtree does not download it (the dashboard stays as light as before)", async ({ page }) => {
  const fontFiles: string[] = [];
  page.on("response", (r) => {
    if (/\.woff2?(\?|$)/.test(r.url())) fontFiles.push(r.url());
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(fontFiles.filter((u) => /figtree/i.test(u))).toEqual([]);
});
