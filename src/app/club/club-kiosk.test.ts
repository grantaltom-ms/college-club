import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The kiosk screens' colours live in club-kiosk.css and apply only inside `.club-kiosk` (the front-desk iPad, the snack bar iPad and
 * the test landing page). Grant's rule for them (Nov 4) is the package's colours and nothing else: no band, no top bar, and no change
 * to their layout, fonts, sizes or shapes. These tests hold the file to that, so a later edit cannot quietly turn it into a second
 * copy of the members' look, bring back a green or an amber, or leak onto the dashboard, the public site or the members' screens.
 */

const here = __dirname;
const css = readFileSync(path.join(here, "club-kiosk.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const PALETTE = new Set(["#ffffff", "#536872", "#435661", "#44484d", "#33363a", "#e2ddd0", "#f5f3ec", "#6c7176", "#e6ebed", "#c3cbce", "#d3ccbc", "#7f96a0"]);
const expand = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex).toLowerCase();

/** Every declaration in the file, as [selector, property, value]. */
const declarations = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) =>
  m[2]
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => [m[1].trim(), d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()] as const),
);

describe("club-kiosk.css uses only the package's colours", () => {
  it("has no colour written as a hex outside the palette", () => {
    const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => expand(m[0]));
    expect(hexes.length).toBeGreaterThan(5);
    const outside = [...new Set(hexes.filter((h) => !PALETTE.has(h)))];
    expect(outside, `colours outside the package palette: ${outside.join(", ")}`).toEqual([]);
  });

  it("only uses rgba() for the ink-coloured shadows", () => {
    const rgbas = [...css.matchAll(/rgba?\(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ""));
    for (const value of rgbas) expect(value, `rgba(${value})`).toMatch(/^51,54,58,0?\.\d+$/);
  });

  it("never uses a gradient or Debonair, and takes its error red from the app's one error token", () => {
    expect(css).not.toMatch(/gradient\(/i);
    expect(css.toLowerCase()).not.toContain("90a0a6");
    expect(css).toContain("var(--error)");
  });
});

describe("club-kiosk.css is a palette swap and nothing else", () => {
  it("starts every selector with .club-kiosk, so nothing outside the three kiosk layouts can change", () => {
    const selectors = declarations.flatMap(([selector]) => selector.split(",").map((s) => s.trim()));
    expect(selectors.length).toBeGreaterThan(5);
    const loose = [...new Set(selectors.filter((s) => !s.startsWith(".club-kiosk")))];
    expect(loose, `selectors that are not scoped: ${loose.join(" | ")}`).toEqual([]);
  });

  it("changes no font, size, spacing, corner or layout: only colours, the remapped tokens and the page's own height", () => {
    const allowed = new Set(["background", "border-color", "border-style", "color", "backdrop-filter", "min-height"]);
    const other = declarations.filter(([, property]) => !allowed.has(property) && !property.startsWith("--"));
    expect(other.map(([selector, property]) => `${selector} { ${property} }`)).toEqual([]);
  });

  it("remaps the older warm tokens to the package's white and cool lines", () => {
    const value = (token: string) => declarations.find(([selector, property]) => selector === ".club-kiosk" && property === token)?.[2];
    expect(value("--paper")).toBe("var(--kiosk-canvas)");
    expect(value("--card")).toBe("var(--kiosk-canvas)");
    expect(value("--hairline")).toBe("var(--kiosk-line)");
    expect(value("--grid")).toBe("var(--kiosk-line)");
    expect(value("--oyster-50")).toBe("var(--kiosk-selected)");
    expect(value("--kiosk-canvas")).toBe("#ffffff");
    expect(value("--kiosk-line")).toBe("#c3cbce");
    expect(value("--kiosk-selected")).toBe("#e6ebed");
  });
});

describe("who imports club-kiosk.css", () => {
  it("is imported by the ipad, snacks and start layouts and by nothing else", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|css)$/.test(name) && !name.endsWith(".test.ts") && /import\s+["'][^"']*club-kiosk\.css["']/.test(readFileSync(full, "utf8"))) importers.push(path.relative(path.join(here, "..", ".."), full));
      }
    };
    walk(path.join(here, "..", "..")); // all of src/
    expect(importers.map((p) => p.split(path.sep).join("/")).sort()).toEqual(["app/club/ipad/layout.tsx", "app/club/snacks/layout.tsx", "app/club/start/layout.tsx"]);
  });

  it("is never imported by the members' and staff layout, which has its own look", () => {
    expect(readFileSync(path.join(here, "(member)", "layout.tsx"), "utf8")).not.toContain("club-kiosk");
  });
});
