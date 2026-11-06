import { describe, expect, it } from "vitest";
import { labelStep } from "./ColumnChart";

describe("labelStep: how often a month label is drawn so none overlap", () => {
  it("labels every column when each has room, and never less often than that", () => {
    expect(labelStep(46)).toBe(1);
    expect(labelStep(60)).toBe(1);
    expect(labelStep(500)).toBe(1);
  });

  it("labels every second, third or fourth column as the slots get narrower", () => {
    expect(labelStep(45)).toBe(2);
    expect(labelStep(23)).toBe(2);
    expect(labelStep(22)).toBe(3);
    expect(labelStep(15.4)).toBe(3);
    expect(labelStep(11.5)).toBe(4);
  });

  it("copes with a chart that has no width yet, or a different label width", () => {
    expect(labelStep(0)).toBe(1);
    expect(labelStep(-5)).toBe(1);
    expect(labelStep(20, 100)).toBe(5);
  });
});
