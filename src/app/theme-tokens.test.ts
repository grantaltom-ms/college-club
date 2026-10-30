import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The refresh's design tokens (the design handoff, Oct 2026), held to the handoff's own numbers. They live in the one existing
 * `:root` block in globals.css, shared by the dashboard, the public site and the member area, so this also guards the rule that
 * the refresh only ever ADDS tokens: the dashboard's look must not move.
 */

const css = readFileSync(path.join(__dirname, "globals.css"), "utf8");
const layout = readFileSync(path.join(__dirname, "layout.tsx"), "utf8");

const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(withoutComments)![1];
const tokens = new Map<string, string>([...rootBlock.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const token = (name: string): string => {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`--${name} is not defined in globals.css :root`);
  return value;
};

/** WCAG 2.x contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const ratio = (fg: string, bg: string) => contrast(token(fg), token(bg));

describe("the handoff's colours", () => {
  it.each([
    ["sun", "#f2c14e"],
    ["sun-hover", "#e5b23f"],
    ["sun-tint", "#fbebc2"],
    ["cyberspace", "#44484d"],
    ["ink", "#33363a"],
    ["waterloo", "#536872"],
    ["waterloo-dark", "#435661"],
    ["debonair", "#90a0a6"],
    ["oyster", "#e2ddd0"],
    ["hairline", "#d3ccbc"],
    ["paper", "#fbfaf6"],
    ["paper-on-dark", "#f5f3ec"],
    ["slate", "#6c7176"],
    ["white", "#ffffff"],
    ["error", "#8a2b1a"],
  ])("--%s is %s", (name, hex) => {
    expect(token(name)).toBe(hex);
  });
});

describe("what was there before is untouched, so the dashboard cannot change", () => {
  it.each([
    ["oyster-50", "#f3f0e8"],
    ["grid", "#e6e1d4"],
    ["card", "#ffffff"],
    ["focus", "#536872"],
    ["display", '"Cinzel", "Times New Roman", serif'],
    ["body", '"EB Garamond", Georgia, "Times New Roman", serif'],
  ])("--%s is still %s", (name, value) => {
    expect(token(name)).toBe(value);
  });

  it("keeps the old fonts loading", () => {
    for (const file of ["cinzel/latin-500", "cinzel/latin-600", "eb-garamond/latin-400", "eb-garamond/latin-500", "eb-garamond/latin-600"]) {
      expect(layout).toContain(`import "@fontsource/${file}.css";`);
    }
  });
});

describe("fonts", () => {
  it("adds Figtree for the interface, self-hosted like the other two fonts (400, 600 and 800)", () => {
    expect(token("ui")).toMatch(/^"Figtree", system-ui,/);
    for (const weight of [400, 600, 800]) expect(layout).toContain(`import "@fontsource/figtree/latin-${weight}.css";`);
    expect(layout).not.toContain("fonts.googleapis.com");
  });
});

describe("shapes, spacing and motion", () => {
  it("has the handoff's radii", () => {
    expect([token("radius-pill"), token("radius-input"), token("radius-card"), token("radius-card-lg")]).toEqual(["999px", "12px", "16px", "20px"]);
  });

  it("has the handoff's spacing", () => {
    expect(Object.fromEntries(["space-unit", "gutter", "gutter-app", "gap-hero", "gap-features", "gap-steps", "gap-form", "section-features", "section-steps-top", "section-steps-bottom", "section-footer-top", "section-footer-bottom", "container", "tap-min"].map((n) => [n, token(n)]))).toEqual({
      "space-unit": "4px",
      gutter: "20px",
      "gutter-app": "24px",
      "gap-hero": "12px",
      "gap-features": "22px",
      "gap-steps": "18px",
      "gap-form": "16px",
      "section-features": "36px",
      "section-steps-top": "28px",
      "section-steps-bottom": "40px",
      "section-footer-top": "28px",
      "section-footer-bottom": "24px",
      container: "980px",
      "tap-min": "44px",
    });
  });

  it("uses the handoff's motion: one easing curve, 140 to 240 milliseconds", () => {
    expect(token("ease")).toBe("cubic-bezier(0.22, 0.61, 0.36, 1)");
    expect([token("duration-fast"), token("duration")]).toEqual(["140ms", "240ms"]);
  });

  it("names only shadows the app already uses (the handoff says no new shadows)", () => {
    const outsideRoot = withoutComments.replace(rootBlock, "");
    for (const name of ["shadow-xs", "shadow-md"]) expect(outsideRoot).toContain(`box-shadow: ${token(name)};`);
  });
});

describe("contrast (WCAG AA), checked here and not taken on trust", () => {
  it.each([
    ["ink", "sun", "button text on Sun"],
    ["ink", "sun-hover", "button text on a hovered Sun button"],
    ["white", "cyberspace", "headline on a dark band"],
    ["oyster", "cyberspace", "footer text"],
    ["sun", "cyberspace", "eyebrow and Member login link on a dark band"],
    ["paper-on-dark", "cyberspace", "hero lead paragraph"],
    ["waterloo", "paper", "eyebrow on a light page"],
    ["waterloo-dark", "paper", "small links on Paper"],
    ["waterloo-dark", "oyster", "small links on Oyster"],
    ["slate", "paper", "captions and helper text"],
    ["cyberspace", "paper", "body text"],
    ["cyberspace", "oyster", "text in an Oyster card"],
    ["ink", "paper", "headlines"],
    ["ink", "oyster", "text in the header"],
    ["error", "paper", "error text"],
  ])("%s on %s is at least 4.5:1 (%s)", (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the focus ring and the outline pill border at 3:1 or more on what they sit on", () => {
    expect(ratio("focus", "paper")).toBeGreaterThanOrEqual(3);
    expect(ratio("waterloo", "oyster")).toBeGreaterThanOrEqual(3);
  });

  it("agrees with the numbers written in the comments (so the comments cannot go stale)", () => {
    expect(ratio("waterloo", "oyster")).toBeCloseTo(4.3, 1); // "plain Waterloo is only 4.3:1 on Oyster"
    expect(ratio("error", "paper")).toBeCloseTo(8.2, 1); // "(8.2:1)"
  });

  it("records the pairs that must never carry small text, so nobody reaches for them", () => {
    expect(ratio("waterloo", "oyster")).toBeLessThan(4.5);
    expect(ratio("slate", "oyster")).toBeLessThan(4.5);
    expect(ratio("sun", "paper")).toBeLessThan(3);
    expect(ratio("debonair", "white")).toBeLessThan(3);
  });
});
