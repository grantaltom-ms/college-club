import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageBand } from "./PageBand";

/** The title band holds a screen's one heading. A cancelled practice adds a small tag inside that heading. */
describe("PageBand", () => {
  it("draws the label, one heading and no tag by default", () => {
    const html = renderToStaticMarkup(h(PageBand, { eyebrow: "Coaching", title: "Morning session" }));
    expect(html).toContain('<p class="club-band-eyebrow">Coaching</p>');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Morning session");
    expect(html).not.toContain("club-tag");
  });

  it("puts the tag inside the heading, after the title", () => {
    const html = renderToStaticMarkup(h(PageBand, { eyebrow: "Practice", title: "Morning session", titleTag: "Cancelled" }));
    const heading = /<h1[^>]*>(.*?)<\/h1>/.exec(html)![1];
    expect(heading).toBe('Morning session<span class="club-tag">Cancelled</span>');
  });

  it("draws the actions to the right of the heading when given", () => {
    const html = renderToStaticMarkup(h(PageBand, { title: "Events" }, h("button", { type: "button" }, "Add an event")));
    expect(html).toContain('<div class="club-band-actions"><button type="button">Add an event</button></div>');
  });

  it("draws no actions box when there are none", () => {
    expect(renderToStaticMarkup(h(PageBand, { title: "Events" }))).not.toContain("club-band-actions");
  });
});
