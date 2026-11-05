import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The members' and staff look (design package "Waterloo Blocks", Nov 4 2026) lives in club-app.css and applies only inside
 * `.club-app`. These tests hold that file to the package's own rules, so a later edit cannot quietly bring back a green, an amber,
 * a gradient, or a rule that leaks onto the dashboard, the public site, the sign-in screen or the iPads.
 */

const here = __dirname;
const raw = readFileSync(path.join(here, "club-app.css"), "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const globals = readFileSync(path.join(here, "..", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every colour the package allows, as lower-case #rrggbb. Debonair (#90a0a6) is deliberately NOT here: it is never text. */
const PALETTE = new Set([
  "#ffffff", // white: page, cards, text on Waterloo
  "#536872", // Waterloo
  "#435661", // Waterloo hover, small blue-grey text on Oyster
  "#44484d", // Cyberspace
  "#33363a", // Ink
  "#e2ddd0", // Oyster (top bar only)
  "#f5f3ec", // Oyster 25 (zebra rows only)
  "#6c7176", // Slate
  "#e6ebed", // selected tint
  "#c3cbce", // cool line
  "#d3ccbc", // warm line (the top bar's bottom edge only)
  "#7f96a0", // focus ring
]);

const expand = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex).toLowerCase();

function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("club-app.css uses only the package's colours", () => {
  it("has no colour written as a hex outside the palette", () => {
    const hexes = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => expand(m[0]));
    expect(hexes.length).toBeGreaterThan(20);
    const outside = [...new Set(hexes.filter((h) => !PALETTE.has(h)))];
    expect(outside, `colours outside the package palette: ${outside.join(", ")}`).toEqual([]);
  });

  it("only uses rgba() for the ink-coloured shadows and the dimmed page behind the phone menu", () => {
    const rgbas = [...css.matchAll(/rgba?\(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ""));
    expect(rgbas.length).toBeGreaterThan(0);
    for (const value of rgbas) expect(value, `rgba(${value})`).toMatch(/^51,54,58,0?\.\d+$/);
  });

  it("never uses a gradient, and never uses Debonair", () => {
    expect(css).not.toMatch(/gradient\(/i);
    expect(css.toLowerCase()).not.toContain("90a0a6");
  });

  it("takes its error red from the app's one error token, and that token is the dark red the package's contrast needs", () => {
    expect(globals).toMatch(/--error:\s*#8a2b1a;/);
    expect(css).toContain("var(--error)");
  });
});

describe("club-app.css stays inside .club-app", () => {
  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(",").map((s) => s.trim())).filter(Boolean);

  it("has rules to check", () => {
    expect(selectors.length).toBeGreaterThan(100);
  });

  it("starts every selector with .club-app, so nothing outside the members' and staff area can change", () => {
    const loose = selectors.filter((s) => !s.startsWith(".club-app"));
    expect(loose, `selectors that are not scoped: ${loose.join(" | ")}`).toEqual([]);
  });

  it("is imported by the (member) layout and by nothing else", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|css)$/.test(name) && !name.endsWith(".test.ts") && /import\s+["'][^"']*club-app\.css["']/.test(readFileSync(full, "utf8"))) importers.push(path.relative(path.join(here, "..", ".."), full));
      }
    };
    walk(path.join(here, "..", "..")); // all of src/
    expect(importers.map((p) => p.split(path.sep).join("/"))).toEqual(["app/club/(member)/layout.tsx"]);
  });
});

describe("the package's shapes and sizes", () => {
  const rule = (selector: string) => {
    const m = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]()*+?^$|\\]/g, "\\$&")}\\s*\\{([^{}]*)\\}`, "m").exec(css);
    if (!m) throw new Error(`no rule for ${selector}`);
    return m[1];
  };

  it("makes the title band Waterloo with a 36px Cinzel heading in white", () => {
    expect(rule(".club-app .club-band")).toMatch(/background:\s*var\(--app-waterloo\)/);
    const h1 = rule(".club-app .club-band h1");
    expect(h1).toMatch(/font-family:\s*var\(--display\)/);
    expect(h1).toMatch(/font-size:\s*36px/);
    expect(h1).toMatch(/color:\s*#ffffff/);
  });

  it("makes the top bar Oyster, 72px tall at least, with the warm line under it", () => {
    expect(rule(".club-app .club-header")).toMatch(/background:\s*var\(--app-oyster\)/);
    expect(rule(".club-app .club-header")).toMatch(/border-bottom:\s*1px solid var\(--app-line-warm\)/);
    expect(rule(".club-app .club-header-bar")).toMatch(/min-height:\s*72px/);
  });

  it("gives buttons 2px corners, Cinzel capitals and a 44px minimum", () => {
    const button = rule(".club-app .club-button");
    expect(button).toMatch(/border-radius:\s*2px/);
    expect(button).toMatch(/font-family:\s*var\(--display\)/);
    expect(button).toMatch(/text-transform:\s*uppercase/);
    expect(button).toMatch(/min-height:\s*var\(--tap-min\)/);
  });

  it("gives cards 6px corners and form boxes 4px corners with a Waterloo edge", () => {
    expect(css).toMatch(/--radius-card:\s*6px/);
    expect(css).toMatch(/--radius-input:\s*4px/);
    expect(rule(".club-app .club-form select,\n.club-app .club-form input[type=\"text\"],\n.club-app .club-form input[type=\"email\"],\n.club-app .club-form input[type=\"tel\"],\n.club-app .club-form input[type=\"date\"],\n.club-app .club-form textarea")).toMatch(/border:\s*1px solid var\(--app-waterloo\)/);
  });

  it("uses a white page and the 1240px frame", () => {
    expect(css).toMatch(/--app-canvas:\s*#ffffff/);
    expect(css).toMatch(/--container:\s*1240px/);
    expect(css).toMatch(/--gutter:\s*32px/);
  });
});

describe("the small tag after a title or name", () => {
  const rule = (selector: string) => {
    const m = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]()*+?^$|\\]/g, "\\$&")}\\s*\\{([^{}]*)\\}`, "m").exec(css);
    if (!m) throw new Error(`no rule for ${selector}`);
    return m[1];
  };

  it("is a square status chip in the palette, not the old pale yellow pill", () => {
    const tag = rule(".club-app .club-tag");
    expect(tag).toMatch(/background:\s*var\(--app-selected\)/);
    expect(tag).toMatch(/color:\s*var\(--app-waterloo-hover\)/);
    expect(tag).toMatch(/border-radius:\s*0/);
    expect(tag).not.toMatch(/sun/i);
  });

  it("is white with Ink text inside a title band, where the heading's white would otherwise vanish on a pale chip", () => {
    const tag = rule(".club-app .club-band .club-tag");
    expect(tag).toMatch(/background:\s*#ffffff/);
    expect(tag).toMatch(/color:\s*var\(--app-ink\)/);
    expect(contrast("#33363a", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#435661", "#e6ebed")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the contrast the package relies on (WCAG)", () => {
  it.each([
    ["white on Waterloo (title band, buttons)", "#ffffff", "#536872", 5.8],
    ["white on Waterloo hover", "#ffffff", "#435661", 7],
    ["white on Cyberspace (your booking)", "#ffffff", "#44484d", 9],
    ["Ink on white", "#33363a", "#ffffff", 12],
    ["Ink on the selected tint", "#33363a", "#e6ebed", 9],
    ["Ink on Oyster (the page you are on)", "#33363a", "#e2ddd0", 8.9],
    ["Cyberspace on Oyster (menu items)", "#44484d", "#e2ddd0", 6.7],
    ["Waterloo hover on Oyster (small text on the bar)", "#435661", "#e2ddd0", 5.6],
    ["Waterloo hover on the selected tint (chips)", "#435661", "#e6ebed", 6],
    ["Slate on white (captions)", "#6c7176", "#ffffff", 4.5],
    ["Waterloo on white (links, free slots)", "#536872", "#ffffff", 5.8],
    ["the error red on white", "#8a2b1a", "#ffffff", 7],
  ])("%s is at least %s to 1", (_name, fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  it("keeps a form box edge (Waterloo on white) above the 3 to 1 a control's edge needs, where Debonair would not", () => {
    expect(contrast("#536872", "#ffffff")).toBeGreaterThan(3);
    expect(contrast("#90a0a6", "#ffffff")).toBeLessThan(3);
  });

  it("keeps Oyster text off Waterloo (it fails for small text)", () => {
    expect(contrast("#e2ddd0", "#536872")).toBeLessThan(4.5);
  });
});
