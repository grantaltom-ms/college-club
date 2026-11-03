import { describe, expect, it } from "vitest";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { buildSampleStore } from "@/club/sample/club";
import { browseFromType, dockSeasonOpen, itemMatchesBrowse, visibleBrowse, browseById, shellKindById } from "@/club/web-book";

describe("web-book browse", () => {
  it("orders categories by use and hides dock outside May–September Pacific", async () => {
    const state = await (await buildSampleStore("2026-10-28")).read();
    const always = () => true;
    const lateOct = new Date("2026-10-28T20:00:00Z");
    expect(dockSeasonOpen(lateOct)).toBe(false);
    const autumn = visibleBrowse(state, RULE_BOOK, lateOct, always).map((b) => b.id);
    expect(autumn[0]).toBe("gym");
    expect(autumn[1]).toBe("shell");
    expect(autumn[2]).toBe("room");
    expect(autumn).toContain("paddle");
    expect(autumn).not.toContain("dock");

    const midJune = new Date("2026-06-15T17:00:00Z");
    expect(dockSeasonOpen(midJune)).toBe(true);
    expect(visibleBrowse(state, RULE_BOOK, midJune, always).map((b) => b.id)).toContain("dock");
  });

  it("maps legacy type= links onto the new browse groups", () => {
    expect(browseFromType("Gym Space")?.id).toBe("gym");
    expect(browseFromType("Shell")?.id).toBe("shell");
    expect(browseFromType("Kayak")?.id).toBe("paddle");
    expect(browseFromType("Paddle Board")?.id).toBe("paddle");
    expect(browseFromType("Dock Space")?.id).toBe("dock");
  });

  it("filters shells by seat only when a size is chosen", async () => {
    const state = await (await buildSampleStore("2026-10-28")).read();
    const shell = browseById("shell")!;
    const single = state.items.find((i) => i.name === "Heron")!;
    const double = state.items.find((i) => i.name === "Loon")!;
    expect(itemMatchesBrowse(RULE_BOOK, single, shell, null)).toBe(true);
    expect(itemMatchesBrowse(RULE_BOOK, double, shell, null)).toBe(true);
    expect(itemMatchesBrowse(RULE_BOOK, single, shell, shellKindById("single"))).toBe(true);
    expect(itemMatchesBrowse(RULE_BOOK, double, shell, shellKindById("single"))).toBe(false);
    expect(itemMatchesBrowse(RULE_BOOK, double, shell, shellKindById("double"))).toBe(true);
  });
});
