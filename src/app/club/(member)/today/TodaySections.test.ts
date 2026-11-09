import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TodayRow } from "@/club/engine/today";
import { Section } from "./TodaySections";

const rows: TodayRow[] = [
  { memberId: "1", name: "Ada Quill", what: [{ title: "Heron", category: "Boat" }], hello: { kind: "rare", words: "Say hello — first visit in a while" } },
  { memberId: "2", name: "Dee Reed", what: [{ title: "Morning Yoga", category: "Class" }, { title: "Dock slip A", category: "Dock" }], hello: null },
];

const draw = (props: { rows: TodayRow[]; defaultOpen?: boolean }) =>
  renderToStaticMarkup(h(Section, { testId: "today-here", title: "Who's here now?", empty: "Nobody's checked in or mid-reservation right now.", ...props }));

/** The two folded lists on Today at the Club: counts while closed, names only when opened. */
describe("a folded list on Today at the Club", () => {
  it("is closed by default and shows the title and a count, and none of the names", () => {
    const html = draw({ rows });
    expect(html).toContain("Who&#x27;s here now?");
    expect(html).toContain("— 2 members");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Ada Quill");
    expect(html).not.toContain("Dee Reed");
    expect(html).not.toContain("Heron");
    expect(html).not.toContain("Say hello");
    expect(html).not.toContain("<li");
  });

  it("says one member in the singular", () => {
    expect(draw({ rows: rows.slice(0, 1) })).toContain("— 1 member<");
  });

  it("shows the count even with nobody in it", () => {
    const html = draw({ rows: [] });
    expect(html).toContain("— 0 members");
    expect(html).not.toContain("Nobody&#x27;s checked in");
  });

  it("opens to each member's name and what they are here for, with the warm note only where there is one", () => {
    const html = draw({ rows, defaultOpen: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Ada Quill");
    expect(html).toContain("Dee Reed");
    expect(html.match(/data-testid="today-row"/g)).toHaveLength(2);
    expect(html.match(/Say hello — first visit in a while/g)).toHaveLength(1);
    // A member with two things shows both, each with its category.
    expect(html).toMatch(/Morning Yoga <span class="club-now-cat">Class<\/span><\/span><span class="club-now-item">Dock slip A <span class="club-now-cat">Dock<\/span>/);
    expect(html).toContain('data-hello="rare"');
  });

  it("opened with nobody in it, says so in the words Grant gave", () => {
    const html = draw({ rows: [], defaultOpen: true });
    expect(html).toContain("Nobody&#x27;s checked in or mid-reservation right now.");
    expect(html).not.toContain("<li");
  });

  it("holds no clock time of any reservation", () => {
    const html = draw({ rows, defaultOpen: true });
    expect(html).not.toMatch(/\d{1,2}:\d{2}/);
    expect(html).not.toMatch(/\b(am|pm)\b/i);
  });

  it("joins the button to the list it opens", () => {
    const html = draw({ rows, defaultOpen: true });
    const controls = /aria-controls="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`id="${controls}"`);
  });
});
