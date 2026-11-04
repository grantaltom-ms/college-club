import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The member app's manifest and icons (the design handoff's step 6). The pages that point at them are checked in a browser
 * (tests/e2e/member-app.spec.ts); this holds what the manifest says and what the icon is, to the handoff's numbers.
 */
const h = vi.hoisted(() => ({ clubOn: true, logos: false }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("./enabled", () => ({ clubEnabled: () => h.clubOn }));
vi.mock("../site/brand-assets", () => ({ LOGO_FILES: { black: "/ccs-logo-black.png", white: "/ccs-logo-white.png" }, get LOGOS_AVAILABLE() { return h.logos; } }));

import { BACKGROUND_COLOR, ICON_SIZES, MANIFEST_PATH, THEME_COLOR, iconElement, iconPath, memberAppManifest, memberAppMetadata, memberAppViewport, parseIconSize, whiteLogoDataUri } from "./pwa";

beforeEach(() => {
  h.clubOn = true;
  h.logos = false;
});

describe("the member app manifest", () => {
  it("is named and coloured as the handoff says, and opens like an app", () => {
    const m = memberAppManifest();
    expect(m).toMatchObject({ name: "College Club Seattle", short_name: "CCS Members", display: "standalone", theme_color: "#44484D", background_color: "#FBFAF6" });
    expect(THEME_COLOR).toBe("#44484D");
    expect(BACKGROUND_COLOR).toBe("#FBFAF6");
  });

  it("lists icons at 192 and 512 pixels, and a maskable one", () => {
    const { icons } = memberAppManifest();
    expect(icons).toEqual([
      { src: "/club/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/club/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/club/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  it("stays inside the member area: it starts there and only covers that, never the public site or the dashboard", () => {
    const m = memberAppManifest();
    expect(m.scope).toBe("/club");
    expect(m.start_url).toBe("/club");
    for (const icon of m.icons) expect(icon.src.startsWith("/club/")).toBe(true);
    expect(MANIFEST_PATH).toBe("/club/manifest.webmanifest");
  });
});

describe("icon sizes", () => {
  it("are the three we make, and nothing else", () => {
    expect([...ICON_SIZES]).toEqual([180, 192, 512]);
    expect(parseIconSize("192")).toBe(192);
    expect(parseIconSize("512")).toBe(512);
    expect(parseIconSize("180")).toBe(180);
    for (const bad of ["", "0", "100", "193", "1024", "192.0", "0192", "192px", "abc", "-192", "192 ", "../192"]) expect(parseIconSize(bad), bad).toBeNull();
    expect(iconPath(180)).toBe("/club/pwa-icon/180");
  });
});

/** The size written inside a PNG file (bytes 16 to 23 hold the width and the height). */
function pngSize(bytes: Uint8Array) {
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("the icon picture", () => {
  it.each(ICON_SIZES)("is a real PNG exactly %i pixels square, with the letters CCS until the logo files exist", async (size) => {
    const res = new ImageResponse(iconElement(size, null), { width: size, height: size });
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(pngSize(new Uint8Array(await res.arrayBuffer()))).toEqual({ width: size, height: size });
  });

  it("is a real PNG with the logo in it when a logo is given", async () => {
    // A tiny one-pixel white PNG stands in for the logo file.
    const onePixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const res = new ImageResponse(iconElement(512, onePixel), { width: 512, height: 512 });
    expect(pngSize(new Uint8Array(await res.arrayBuffer()))).toEqual({ width: 512, height: 512 });
  });
});

describe("the white logo for the icon", () => {
  it("is nothing until the logo files are switched on", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    expect(await whiteLogoDataUri("https://club.example.org")).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("is fetched from this site's own public folder and handed over as a data address once they are", async () => {
    h.logos = true;
    const png = { "content-type": "image/png" };
    const fetched = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: png }));
    vi.stubGlobal("fetch", fetched);
    expect(await whiteLogoDataUri("https://club.example.org")).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
    expect(String((fetched.mock.calls[0] as unknown[])[0])).toBe("https://club.example.org/ccs-logo-white.png");
    vi.unstubAllGlobals();
  });

  it("is nothing, rather than a broken icon, when the file cannot be fetched", async () => {
    h.logos = true;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    expect(await whiteLogoDataUri("https://club.example.org")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("is nothing when the answer is a page and not a picture, as a preview behind Vercel's login wall answers its own request", async () => {
    h.logos = true;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Sign in to Vercel</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })));
    expect(await whiteLogoDataUri("https://club.example.org")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })));
    expect(await whiteLogoDataUri("https://club.example.org"), "an answer that names no type is not trusted either").toBeNull();
    vi.unstubAllGlobals();
  });

  it("is the real white logo file, and an icon drawn with it is a PNG of the right size that differs from the letters-only icon", async () => {
    const real = readFileSync(join(__dirname, "../../public/ccs-logo-white.png"));
    const uri = `data:image/png;base64,${real.toString("base64")}`;
    for (const size of ICON_SIZES) {
      const withLogo = new Uint8Array(await new ImageResponse(iconElement(size, uri), { width: size, height: size }).arrayBuffer());
      const letters = new Uint8Array(await new ImageResponse(iconElement(size, null), { width: size, height: size }).arrayBuffer());
      expect(pngSize(withLogo)).toEqual({ width: size, height: size });
      expect(Buffer.compare(Buffer.from(withLogo), Buffer.from(letters)), `the ${size} pixel icon must not be the letters-only one`).not.toBe(0);
    }
  });
});

describe("what a member page's head says", () => {
  it("points at the manifest, the home-screen icon and the name, and colours the phone's top bar", async () => {
    expect(await memberAppMetadata()).toEqual({
      manifest: "/club/manifest.webmanifest",
      icons: { apple: [{ url: "/club/pwa-icon/180", sizes: "180x180", type: "image/png" }] },
      appleWebApp: { capable: true, title: "CCS Members" },
    });
    expect(await memberAppViewport()).toEqual({ themeColor: "#44484D" });
  });

  it("says nothing at all where the member area is off, so a hidden page gives nothing away", async () => {
    h.clubOn = false;
    expect(await memberAppMetadata()).toEqual({});
    expect(await memberAppViewport()).toEqual({});
  });
});
