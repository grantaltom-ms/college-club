import type { Page } from "@playwright/test";

/** WCAG contrast of an element's text against the first solid background behind it, measured as the browser drew it. */
export async function contrastOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const solid = (node: Element | null): number[] => {
      for (let n = node; n; n = n.parentElement) {
        const [r, g, b, a = 1] = parse(getComputedStyle(n).backgroundColor);
        if (a > 0.99) return [r, g, b];
      }
      return [255, 255, 255];
    };
    const light = ([r, g, b]: number[]) => {
      const [x, y, z] = [r, g, b].map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * x + 0.7152 * y + 0.0722 * z;
    };
    const text = parse(getComputedStyle(el).color).slice(0, 3);
    const [hi, lo] = [light(text), light(solid(el))].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  });
}
