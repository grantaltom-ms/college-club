import { describe, expect, it } from "vitest";
import { fmtChange, storyLines } from "./summary";

describe("fmtChange", () => {
  it("signs rises and falls, with a true minus sign", () => {
    expect(fmtChange(10)).toBe("+10%");
    expect(fmtChange(-24)).toBe("−24%");
    expect(fmtChange(0)).toBe("no change");
  });
});

describe("storyLines", () => {
  const base = { doorChange: 10, shellChange: -24, rowersNow: 78, rowersBefore: 91 };

  it("calls out a busier building with less rowing", () => {
    const [first, ...rest] = storyLines(base);
    expect(first).toBe(
      "The building is busier than last year, but fewer members are rowing club boats. Door entries are up 10% while club shell outings are down 24%, and 13 fewer members took one out.",
    );
    expect(rest).toEqual([]);
  });

  it("states both directions plainly when they move together", () => {
    expect(storyLines({ ...base, shellChange: 5, rowersNow: 95 })[0]).toBe("Door entries are up 10% on last year and club shell outings are up 5%.");
    expect(storyLines({ ...base, doorChange: -3, shellChange: -8 })[0]).toContain("down 3%");
  });

  it("says nothing while the shell figures are missing, and gives the same answer every time", () => {
    expect(storyLines({ ...base, shellChange: null })).toEqual([]);
    for (let i = 0; i < 5; i++) expect(storyLines(base)).toEqual(storyLines(base));
  });
});
