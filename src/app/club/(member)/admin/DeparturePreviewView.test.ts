import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeparturePreview, DepartureLine } from "@/club/engine/departure";
import { DeparturePreviewView } from "./DeparturePreviewView";

/**
 * What staff read before they end a membership, or many at once. The household desk shows every line; the resignations screen
 * passes a limit so a read-back covering dozens of households stays readable, and says how many lines it left out.
 */
const line = (n: number): DepartureLine => ({ id: `line-${n}`, what: `Boat ${n}`, when: "Thursday, Oct 29, 7 to 8 am", startsAt: `2026-10-29T14:0${n % 10}:00Z`, who: `Member ${n}`, detail: "" });
const preview = (bookings: number, rsvps = 0): DeparturePreview => ({
  bookings: Array.from({ length: bookings }, (_, i) => line(i + 1)),
  crewSeats: [],
  signUps: [],
  rsvps: Array.from({ length: rsvps }, (_, i) => ({ ...line(i + 1), id: `rsvp-${i + 1}`, what: `Dinner ${i + 1}` })),
  total: bookings + rsvps,
});
const render = (p: DeparturePreview, limit?: number) => renderToStaticMarkup(createElement(DeparturePreviewView, { preview: p, limit }));

describe("the preview of what leaving cancels", () => {
  it("shows every line when no limit is given, as the household desk does", () => {
    const html = render(preview(5));
    for (let n = 1; n <= 5; n++) expect(html).toContain(`Boat ${n}, Thursday, Oct 29, 7 to 8 am: Member ${n}`);
    expect(html).not.toContain("more.");
    expect(html).toContain("<strong>5</strong> things will change:");
  });

  it("shows only as many lines of a list as the limit, counts the whole list in its heading, and says how many it left out", () => {
    const html = render(preview(5), 3);
    expect(html).toContain("Boat 3,");
    expect(html).not.toContain("Boat 4,");
    expect(html).not.toContain("Boat 5,");
    expect(html).toContain("(5)");
    expect(html).toContain("…and 2 more.");
    expect(html).toContain("<strong>5</strong> things will change:");
  });

  it("applies the limit to each list on its own, and shows a list that fits in full", () => {
    const html = render(preview(4, 2), 2);
    expect(html).toContain("Boat 2,");
    expect(html).not.toContain("Boat 3,");
    expect(html).toContain("Dinner 2,");
    expect(html).toContain("…and 2 more.");
    expect((html.match(/more\./g) ?? []).length).toBe(1);
  });

  it("shows a list of exactly the limit in full, without a 'more' line", () => {
    const html = render(preview(3), 3);
    expect(html).toContain("Boat 3,");
    expect(html).not.toContain("more.");
  });

  it("says nothing will be cancelled when there is nothing", () => {
    expect(render(preview(0), 3)).toContain("Nothing is booked, signed up for or RSVPed to from now on, so nothing will be cancelled.");
  });
});
