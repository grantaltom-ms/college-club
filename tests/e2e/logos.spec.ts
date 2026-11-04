import { expect, test, type Page } from "@playwright/test";

/**
 * The club's logos (Grant, Nov 4: switch them on for the public site's header, the sign-in and demo screens and the phone
 * home-screen icons). Until then each spot showed the club's name in the heading font. These checks hold what a visitor sees:
 * a picture that really loaded (not a broken one), named for a screen reader, the right size in the right place, and a header
 * that stayed exactly as tall and as tidy as the design says. The sign-in band and the icons only exist on previews and in tests.
 */

const LOGO_NAME = "College Club Seattle logo";

/** Is this picture drawn, with its real size known? A broken picture has a width of 0. */
const loaded = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((img) => {
    const el = img as HTMLImageElement;
    return { complete: el.complete, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, alt: el.alt, src: el.currentSrc || el.src };
  });

test.describe("the logo files", () => {
  for (const file of ["ccs-logo-black.png", "ccs-logo-white.png"]) {
    test(`/${file} is served as a PNG`, async ({ request }) => {
      const res = await request.get(`/${file}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/png");
      const bytes = await res.body();
      expect([...bytes.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
    });
  }
});

for (const { name, viewport } of [
  { name: "a phone", viewport: { width: 390, height: 844 } },
  { name: "a wide screen", viewport: { width: 1180, height: 800 } },
]) {
  test.describe(`the public header on ${name}`, () => {
    test.use({ viewport });

    test("shows the black logo as a picture that loaded, named for a screen reader, 36 pixels square, with the club's name no longer written beside it", async ({ page }) => {
      await page.goto("/site");
      const link = page.locator(".ds-logo-link");
      const img = link.locator("img");
      await expect(img).toHaveCount(1);
      const info = await loaded(page, ".ds-logo-link img");
      expect(info.complete).toBe(true);
      expect(info.naturalWidth, "a broken picture has no width").toBeGreaterThan(0);
      expect(info.alt).toBe(LOGO_NAME);
      expect(decodeURIComponent(info.src)).toContain("ccs-logo-black.png");
      const box = (await img.boundingBox())!;
      expect([Math.round(box.width), Math.round(box.height)]).toEqual([36, 36]);
      await expect(link.locator(".ds-wordmark")).toHaveCount(0);
      expect((await link.boundingBox())!.height, "the link around it is still a 44 pixel tap target").toBeGreaterThanOrEqual(44);
      await expect(link).toHaveAttribute("href", "/site");
      await expect(page.getByRole("link", { name: LOGO_NAME })).toBeVisible();
    });

    test("keeps the header 64 pixels tall, the logo, the Member login pill and the Menu button on one line, and nothing scrolls sideways", async ({ page }) => {
      await page.goto("/site");
      expect(Math.round((await page.getByTestId("site-header").boundingBox())!.height)).toBe(64);
      const logo = (await page.locator(".ds-logo-link img").boundingBox())!;
      const pill = (await page.getByTestId("member-login-header").boundingBox())!;
      expect(Math.abs(logo.y + logo.height / 2 - (pill.y + pill.height / 2)), "the logo and the pill sit on one line").toBeLessThan(4);
      expect(logo.x + logo.width, "the logo ends before the pill begins").toBeLessThan(pill.x);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("the other public pages", () => {
  for (const path of ["/site/about", "/site/programs", "/site/membership", "/site/request-a-tour", "/site/contact"]) {
    test(`${path} has the same logo in its header`, async ({ page }) => {
      await page.goto(path);
      const info = await loaded(page, ".ds-logo-link img");
      expect(info.naturalWidth).toBeGreaterThan(0);
      expect(info.alt).toBe(LOGO_NAME);
    });
  }
});

test.describe("the sign-in screen", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows the white logo, 48 pixels square, at the top of its dark band, with the screen's one heading below it", async ({ page }) => {
    await page.goto("/club/sign-in");
    const info = await loaded(page, ".ds-app-band img");
    expect(info.complete).toBe(true);
    expect(info.naturalWidth).toBeGreaterThan(0);
    expect(info.alt).toBe(LOGO_NAME);
    expect(decodeURIComponent(info.src)).toContain("ccs-logo-white.png");
    const box = (await page.locator(".ds-app-band img").boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([48, 48]);
    expect(await page.locator(".ds-app-band .ds-wordmark").count()).toBe(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const heading = (await page.locator(".ds-app-band h1").boundingBox())!;
    expect(box.y + box.height, "the logo is above the heading").toBeLessThanOrEqual(heading.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe("the phone home-screen icons", () => {
  /**
   * Draws the icon in the browser and reports, for a short stretch of rows in one column, whether any pixel is white. The logo
   * and the letters CCS are both white on Cyberspace, so the probes sit where only the logo reaches: the two thin oar shafts at
   * the top and bottom of it (the letters stay in the middle). Measured on the real icon, and checked to be empty on the
   * letters-only icon.
   */
  async function icon(page: Page, size: number) {
    await page.goto("/club/sign-in");
    return page.evaluate(async (size) => {
      const img = new Image();
      img.src = `/club/pwa-icon/${size}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const px = (x: number, y: number) => Array.from(ctx.getImageData(Math.round(x * canvas.width), Math.round(y * canvas.height), 1, 1).data.slice(0, 3));
      const anyWhite = (x: number, from: number, to: number) => {
        for (let y = from; y <= to; y += 0.002) if (px(x, y).every((c) => c > 200)) return true;
        return false;
      };
      return { width: img.naturalWidth, height: img.naturalHeight, corner: px(0.005, 0.005), topShaft: anyWhite(0.47, 0.255, 0.275), bottomShaft: anyWhite(0.47, 0.725, 0.745), aboveLogo: px(0.5, 0.195), belowLogo: px(0.5, 0.82) };
    }, size);
  }

  for (const size of [180, 192, 512]) {
    test(`the ${size} pixel icon is the white logo on Cyberspace, not the stand-in letters`, async ({ page }) => {
      const result = await icon(page, size);
      expect([result.width, result.height]).toEqual([size, size]);
      expect(result.corner, "the background is Cyberspace").toEqual([68, 72, 77]);
      expect(result.topShaft, "the logo's top oar shaft").toBe(true);
      expect(result.bottomShaft, "the logo's bottom oar shaft").toBe(true);
      expect(result.aboveLogo, "empty above the logo").toEqual([68, 72, 77]);
      expect(result.belowLogo, "empty below the logo").toEqual([68, 72, 77]);
    });
  }
});
