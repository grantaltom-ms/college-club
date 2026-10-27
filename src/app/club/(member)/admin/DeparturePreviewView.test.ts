import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeparturePreview, DepartureLine } from "@/club/engine/departure";
import { DeparturePreviewView } from "./DeparturePreviewView";

/**
 * What staff read before they end a membership, or many at once. The household desk shows every line; the resignations screen
 * passes a limit so a read-back covering dozens of households stays readable, and says how many lines it left out.
 */
const lines = (what: string, count: number): DepartureLine[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${what}-${i + 1}`, what: `${what} ${i + 1}`, when: "Thursday, Oct 29, 7 to 8 am", startsAt: `2026-10-29T14:0${i % 10}:00Z`, who: `Member ${i + 1}`, detail: "" }));
const preview = (counts: { bookings?: number; crewSeats?: number; signUps?: number; rsvps?: number }): DeparturePreview => {
  const { bookings = 0, crewSeats = 0, signUps = 0, rsvps = 0 } = counts;
  return { bookings: lines("Boat", bookings), crewSeats: lines("Seat", crewSeats), signUps: lines("Class", signUps), rsvps: lines("Dinner", rsvps), total: bookings + crewSeats + signUps + rsvps };
};
const render = (p: DeparturePreview, limit?: number) => renderToStaticMarkup(createElement(DeparturePreviewView, { preview: p, limit }));
const KINDS = ["Boat", "Seat", "Class", "Dinner"] as const;

describe("the preview of what leaving cancels", () => {
  it("shows every line of every list when no limit is given, as the household desk does", () => {
    const html = render(preview({ bookings: 5, crewSeats: 5, signUps: 5, rsvps: 5 }));
    for (const kind of KINDS) for (let n = 1; n <= 5; n++) expect(html).toContain(`${kind} ${n}, Thursday, Oct 29, 7 to 8 am: Member ${n}`);
    expect(html).not.toContain("more.");
    expect(html).toContain("<strong>20</strong> things will change:");
  });

  it("shows only as many lines of each of the four lists as the limit, counts each whole list in its heading, and says how many it left out", () => {
    const html = render(preview({ bookings: 5, crewSeats: 5, signUps: 5, rsvps: 5 }), 3);
    for (const kind of KINDS) {
      expect(html, kind).toContain(`${kind} 3,`);
      expect(html, kind).not.toContain(`${kind} 4,`);
      expect(html, kind).not.toContain(`${kind} 5,`);
    }
    expect((html.match(/\(5\)/g) ?? []).length).toBe(4);
    expect((html.match(/…and 2 more\./g) ?? []).length).toBe(4);
    expect(html).toContain("<strong>20</strong> things will change:");
  });

  it("applies the limit to each list on its own, and leaves a list that fits whole", () => {
    const html = render(preview({ bookings: 4, rsvps: 2 }), 2);
    expect(html).toContain("Boat 2,");
    expect(html).not.toContain("Boat 3,");
    expect(html).toContain("Dinner 2,");
    expect((html.match(/more\./g) ?? []).length).toBe(1);
    expect(html).toContain("…and 2 more.");
  });

  it("shows a list of exactly the limit in full, without a 'more' line", () => {
    const html = render(preview({ bookings: 3 }), 3);
    expect(html).toContain("Boat 3,");
    expect(html).not.toContain("more.");
  });

  it("says nothing will be cancelled when there is nothing", () => {
    expect(render(preview({}), 3)).toContain("Nothing is booked, signed up for or RSVPed to from now on, so nothing will be cancelled.");
  });
});
