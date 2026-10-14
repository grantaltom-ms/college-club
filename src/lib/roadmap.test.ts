import { describe, expect, it } from "vitest";
import {
  LIMITS,
  buildGroups,
  compareItems,
  dueState,
  dueText,
  filterGroups,
  isUuid,
  isValidDay,
  matchesFilter,
  parseItemPatch,
  parseNewItem,
  parseNote,
  progressText,
  subitemProgress,
  summarize,
  todayLocal,
  type RoadmapItem,
} from "./roadmap";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
let counter = 0;
function item(over: Partial<RoadmapItem> = {}): RoadmapItem {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    parentId: null,
    title: `Item ${counter}`,
    group: "Group A",
    status: "Not started",
    dueDate: null,
    owner: null,
    sortOrder: counter,
    createdAt: `2026-10-01T00:00:${String(counter % 60).padStart(2, "0")}Z`,
    ...over,
  };
}

describe("checking what the browser sends", () => {
  it("accepts only real calendar days", () => {
    for (const ok of ["2026-10-14", "2028-02-29", "2000-01-01"]) expect(isValidDay(ok)).toBe(true);
    for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-1-5", "10/14/2026", "", null, 20261014, "1999-12-31", "2101-01-01"]) {
      expect(isValidDay(bad)).toBe(false);
    }
  });

  it("recognizes ids", () => {
    expect(isUuid(UUID)).toBe(true);
    for (const bad of ["", "abc", "1; drop table roadmap_items", `${UUID}&select=*`, null, 5]) expect(isUuid(bad)).toBe(false);
  });

  it("builds a new item with defaults, trimming text and turning blanks into nothing", () => {
    const r = parseNewItem({ title: "  Call Caitlin  ", group: "  ", owner: " Grant ", dueDate: "" });
    expect(r).toEqual({
      ok: true,
      value: { title: "Call Caitlin", group: null, status: "Not started", dueDate: null, owner: "Grant", parentId: null },
    });
  });

  it("builds a subitem under a parent", () => {
    const r = parseNewItem({ title: "Step one", parentId: UUID, status: "Waiting", dueDate: "2026-11-06" });
    expect(r).toMatchObject({ ok: true, value: { parentId: UUID, status: "Waiting", dueDate: "2026-11-06" } });
  });

  it("explains what is wrong in plain sentences", () => {
    const errors = [
      parseNewItem(null),
      parseNewItem({}),
      parseNewItem({ title: "   " }),
      parseNewItem({ title: "x".repeat(LIMITS.title + 1) }),
      parseNewItem({ title: "ok", status: "Finished" }),
      parseNewItem({ title: "ok", dueDate: "2026-02-30" }),
      parseNewItem({ title: "ok", owner: "x".repeat(LIMITS.owner + 1) }),
      parseNewItem({ title: "ok", group: "x".repeat(LIMITS.group + 1) }),
      parseNewItem({ title: "ok", parentId: "nope" }),
      parseNewItem({ title: 5 }),
    ];
    for (const e of errors) {
      expect(e.ok).toBe(false);
      if (!e.ok) expect(e.error).toMatch(/^[A-Z].*[.]$/);
    }
    expect(parseNewItem({ title: "x".repeat(LIMITS.title) }).ok).toBe(true);
  });

  it("changes only the fields that were sent, and lets a date, owner or group be cleared", () => {
    expect(parseItemPatch({ status: "Done" })).toEqual({ ok: true, value: { status: "Done" } });
    expect(parseItemPatch({ dueDate: null, owner: "", group: "", title: " New " })).toEqual({
      ok: true,
      value: { dueDate: null, owner: null, group: null, title: "New" },
    });
    expect(parseItemPatch({})).toEqual({ ok: false, error: "There is nothing to change." });
    expect(parseItemPatch({ title: "" }).ok).toBe(false); // a title can never be removed
    expect(parseItemPatch({ status: "nope" }).ok).toBe(false);
    expect(parseItemPatch("text").ok).toBe(false);
    // Fields the page cannot change are ignored, not passed along.
    expect(parseItemPatch({ status: "Done", parentId: UUID, id: UUID })).toEqual({ ok: true, value: { status: "Done" } });
  });

  it("checks notes", () => {
    expect(parseNote({ body: "  hello\nthere  " })).toEqual({ ok: true, value: "hello\nthere" });
    expect(parseNote({ body: "x".repeat(LIMITS.note) }).ok).toBe(true);
    for (const bad of [{ body: "x".repeat(LIMITS.note + 1) }, { body: "   " }, {}, { body: 4 }, null]) expect(parseNote(bad).ok).toBe(false);
  });
});

describe("due dates", () => {
  const today = "2026-10-14";

  it("takes today from the visitor's own clock, in their own time zone", () => {
    expect(todayLocal(new Date(2026, 9, 14, 23, 59))).toBe("2026-10-14");
    expect(todayLocal(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });

  it("sorts a date into overdue, due soon (today to 7 days ahead), later, or none", () => {
    expect(dueState("2026-10-13", "Not started", today)).toBe("overdue");
    expect(dueState("2026-10-14", "In progress", today)).toBe("soon");
    expect(dueState("2026-10-21", "Waiting", today)).toBe("soon");
    expect(dueState("2026-10-22", "Waiting", today)).toBe("later");
    expect(dueState(null, "Not started", today)).toBe("none");
  });

  it("never calls a finished item overdue", () => {
    expect(dueState("2020-01-01", "Done", today)).toBe("done");
    expect(dueText("2020-01-01", "Done", today).text).toBe("Done (was due Jan 1, 2020)");
    expect(dueText(null, "Done", today).text).toBe("Done");
  });

  it("handles month, year and leap-day edges without time zone drift", () => {
    expect(dueState("2026-11-04", "Not started", "2026-10-28")).toBe("soon"); // 7 days across a month end
    expect(dueState("2027-01-02", "Not started", "2026-12-31")).toBe("soon");
    expect(dueState("2026-12-31", "Not started", "2027-01-01")).toBe("overdue");
    expect(dueState("2028-03-01", "Not started", "2028-02-29")).toBe("soon");
  });

  it("puts words next to the date, so urgency never depends on color alone", () => {
    expect(dueText("2026-10-12", "Not started", today).text).toBe("Overdue by 2 days (Oct 12)");
    expect(dueText("2026-10-13", "Not started", today).text).toBe("Overdue by 1 day (Oct 13)");
    expect(dueText("2026-10-14", "Not started", today).text).toBe("Due today");
    expect(dueText("2026-10-15", "Not started", today).text).toBe("Due tomorrow (Oct 15)");
    expect(dueText("2026-10-20", "Not started", today).text).toBe("Due in 6 days (Oct 20)");
    expect(dueText("2026-11-06", "Not started", today).text).toBe("Due Nov 6");
    expect(dueText("2027-01-15", "Not started", today).text).toBe("Due Jan 15, 2027");
    expect(dueText(null, "Not started", today).text).toBe("No due date");
  });
});

describe("subitems", () => {
  it("counts finished subitems without touching the parent", () => {
    const kids = [item({ status: "Done" }), item({ status: "Done" }), item({ status: "Waiting" }), item(), item({ status: "In progress" })];
    expect(subitemProgress(kids)).toEqual({ done: 2, total: 5 });
    expect(progressText(kids)).toBe("2 of 5 done");
    expect(progressText(kids.map((k) => ({ ...k, status: "Done" as const })))).toBe("5 of 5 done");
    expect(progressText([])).toBe("");
  });
});

describe("order, groups and filters", () => {
  it("sorts by due date, with undated items last and ties kept in the order added", () => {
    const a = item({ dueDate: "2026-11-01" });
    const b = item({ dueDate: "2026-10-20" });
    const c = item({ dueDate: null });
    const d = item({ dueDate: null });
    expect([c, a, d, b].sort(compareItems).map((i) => i.id)).toEqual([b.id, a.id, c.id, d.id]);
  });

  it("builds groups in the order they were created, with ungrouped items last, and subitems under their parent", () => {
    const first = item({ group: "First", sortOrder: 1 });
    const second = item({ group: "Second", sortOrder: 5 });
    const loose = item({ group: null, sortOrder: 0 });
    const late = item({ group: "First", sortOrder: 9, dueDate: "2026-10-01" });
    const sub2 = item({ parentId: first.id, group: null, dueDate: "2026-12-01" });
    const sub1 = item({ parentId: first.id, group: null, dueDate: "2026-11-01" });
    const groups = buildGroups([second, loose, sub2, first, late, sub1]);
    expect(groups.map((g) => g.name)).toEqual(["First", "Second", null]);
    expect(groups[0].nodes.map((n) => n.item.id)).toEqual([late.id, first.id]); // dated item first
    expect(groups[0].nodes[1].children.map((c) => c.id)).toEqual([sub1.id, sub2.id]);
    expect(buildGroups([])).toEqual([]);
  });

  it("filters: Open, Due soon (including overdue), Done", () => {
    const today = "2026-10-14";
    const overdue = item({ dueDate: "2026-10-01" });
    const soon = item({ dueDate: "2026-10-18", status: "In progress" });
    const later = item({ dueDate: "2026-12-01" });
    const none = item();
    const done = item({ status: "Done", dueDate: "2026-10-01" });
    const ids = (f: "all" | "open" | "soon" | "done") =>
      [overdue, soon, later, none, done].filter((i) => matchesFilter(i, f, today)).map((i) => i.id);
    expect(ids("all")).toHaveLength(5);
    expect(ids("open")).toEqual([overdue.id, soon.id, later.id, none.id]);
    expect(ids("soon")).toEqual([overdue.id, soon.id]);
    expect(ids("done")).toEqual([done.id]);
  });

  it("keeps a parent whose subitem matches, and drops groups left empty", () => {
    const today = "2026-10-14";
    const parent = item({ group: "A", status: "Not started" });
    const sub = item({ parentId: parent.id, group: null, dueDate: "2026-10-15" });
    const other = item({ group: "B", dueDate: "2027-05-01" });
    const groups = buildGroups([parent, sub, other]);
    const soon = filterGroups(groups, "soon", today);
    expect(soon.map((g) => g.name)).toEqual(["A"]);
    expect(soon[0].nodes[0].children).toHaveLength(1);
    expect(filterGroups(groups, "done", today)).toEqual([]);
    expect(filterGroups(groups, "all", today)).toBe(groups);
  });

  it("counts open, overdue, due-soon and done across items and subitems", () => {
    const today = "2026-10-14";
    const items = [
      item({ dueDate: "2026-10-01" }),
      item({ dueDate: "2026-10-15" }),
      item({ status: "Done", dueDate: "2026-09-01" }),
      item({ status: "Waiting" }),
    ];
    expect(summarize(items, today)).toEqual({ open: 3, overdue: 1, soon: 1, done: 1 });
    expect(summarize([], today)).toEqual({ open: 0, overdue: 0, soon: 0, done: 0 });
  });
});
