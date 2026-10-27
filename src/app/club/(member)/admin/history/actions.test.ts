import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_HISTORY_BYTES } from "@/club/engine/icrew";
import { fingerprintOf } from "@/club/engine/history";
import { booking, icrewCsv } from "@/club/sample/icrew";
import { MemoryHistoryStore, type HistoryStore } from "@/club/store/history";
import { MemoryClubStore, sequentialIds } from "@/club/store/memory";

/**
 * The old-bookings screen's server action, called directly with the page's own ingredients replaced by fakes: who is signed in,
 * whether the member area is on, and the two stores. Everything that matters about it lives in the action: staff only, the file
 * must be the one that was checked, and a problem is told in plain words.
 */
const NOW = new Date("2026-10-28T20:00:00Z");
const h = vi.hoisted(() => ({ enabled: true, actor: null as unknown, club: null as unknown, history: null as unknown, now: null as unknown }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/club/enabled", () => ({ clubEnabled: () => h.enabled }));
vi.mock("@/club/clock", () => ({ clubNow: () => h.now }));
vi.mock("@/club/identity", () => ({
  getCurrentActor: async () => h.actor,
  toEngineActor: (a: { kind: string; label: string }) => ({ kind: a.kind, label: a.label }),
}));
vi.mock("@/club/store/instance", () => ({ getClubStore: async () => h.club }));
vi.mock("@/club/store/history-instance", () => ({ getHistoryStore: async () => h.history }));

import { importHistory } from "./actions";

const GOOD = icrewCsv([booking("2026-03-09", { id: 1001, by: "Una Example" }), booking("2026-03-10", { id: 1002, by: "Vic Example" }), booking("2026-03-11", { id: 1003, by: "Wes Example", type: "Gym Space", item: "Gym Space 01" })]);
const STAFF = { kind: "staff", label: "Alex Staffer", source: "login" };
const MEMBER = { kind: "member", label: "Una Example" };

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const csvFile = (text: string, name = "icrew.csv") => new File([text], name, { type: "text/csv" });
const check = (text: string) => importHistory(form({ file: csvFile(text), intent: "check" }));
const add = (text: string, extra: Record<string, string> = {}) => importHistory(form({ file: csvFile(text), intent: "add", ...extra }));
const stored = async () => (await (h.history as HistoryStore).summary()).rows;

beforeEach(() => {
  h.enabled = true;
  h.actor = STAFF;
  h.now = NOW;
  h.club = new MemoryClubStore(sequentialIds());
  h.history = new MemoryHistoryStore();
});

describe("the old-bookings action: who may use it", () => {
  it("answers 'not found' when the member area is off, when nobody is signed in, and for a member", async () => {
    h.enabled = false;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    h.enabled = true;
    h.actor = null;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    h.actor = MEMBER;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(add(GOOD, { fingerprint: fingerprintOf(GOOD), toAdd: "3" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await stored()).toBe(0);
  });
});

describe("the old-bookings action: the file", () => {
  it("asks for a file when there is none, it is empty, or it is not a file", async () => {
    for (const fields of [{ intent: "check" }, { file: csvFile(""), intent: "check" }, { file: "not a file", intent: "check" }] as Record<string, string | File>[]) {
      expect(await importHistory(form(fields))).toEqual({ kind: "error", message: "Choose a file first." });
    }
  });

  it("refuses a file that is too big, without reading it", async () => {
    const big = csvFile("x".repeat(MAX_HISTORY_BYTES + 1));
    const answer = await importHistory(form({ file: big, intent: "check" }));
    expect(answer).toMatchObject({ kind: "error" });
    expect((answer as { message: string }).message).toContain("The file is too big: it can be up to 4 MB");
  });

  it("does not understand an unknown button", async () => {
    expect(await importHistory(form({ file: csvFile(GOOD), intent: "delete-everything" }))).toEqual({ kind: "error", message: "Something was missing. Check the file again." });
    expect(await stored()).toBe(0);
  });
});

describe("the old-bookings action: checking", () => {
  it("says what the file would do and saves nothing", async () => {
    const result = await check(GOOD);
    expect(result).toMatchObject({ kind: "checked", fileName: "icrew.csv" });
    if (result.kind !== "checked") throw new Error("expected a check");
    expect(result.plan.problems).toEqual([]);
    expect(result.plan).toMatchObject({ toAdd: 3, alreadyStored: 0, firstDay: "2026-03-09", lastDay: "2026-03-11" });
    expect(result.plan.fingerprint).toBe(fingerprintOf(GOOD));
    await check(GOOD);
    expect(await stored()).toBe(0);
  });

  it("judges which days have passed on the Pacific clock, not the server's", async () => {
    // 8 pm on Oct 28 in Seattle is already Oct 29 in UTC.
    h.now = new Date("2026-10-29T03:00:00Z");
    const toAdd = async (day: string) => {
      const result = await check(icrewCsv([booking(day, { id: 1, by: "Una Example" })]));
      if (result.kind !== "checked") throw new Error("expected a check");
      return result.plan.toAdd;
    };
    expect(await toAdd("2026-10-27")).toBe(1);
    expect(await toAdd("2026-10-28")).toBe(0);
  });

  it("carries a file's problems, in words", async () => {
    const result = await check(GOOD.replace("1002", "ten"));
    if (result.kind !== "checked") throw new Error("expected a check");
    expect(result.plan.problems).toEqual(['Row 3: ID "ten" should be a number, like 123456.']);
  });
});

describe("the old-bookings action: adding", () => {
  const checked = async (text: string) => {
    const r = await check(text);
    if (r.kind !== "checked") throw new Error("expected a check");
    return { fingerprint: r.plan.fingerprint, toAdd: String(r.plan.toAdd) };
  };

  it("adds the file that was checked, as the signed-in staff member, and says how many", async () => {
    expect(await add(GOOD, await checked(GOOD))).toEqual({ kind: "added", fileName: "icrew.csv", added: 3, skipped: 0 });
    expect(await stored()).toBe(3);
    const summary = await (h.history as HistoryStore).summary();
    expect(summary.imports[0]).toMatchObject({ importedBy: "Alex Staffer", importedAt: NOW.toISOString(), fileName: "icrew.csv" });
  });

  it("will not add without the check: no fingerprint, a wrong-shaped one, or a count that is not a number", async () => {
    const good = await checked(GOOD);
    const refusal = { kind: "error", message: "Check the file first, then add." };
    expect(await add(GOOD)).toEqual(refusal);
    expect(await add(GOOD, { ...good, fingerprint: "abc" })).toEqual(refusal);
    expect(await add(GOOD, { ...good, fingerprint: "G".repeat(64) })).toEqual(refusal);
    expect(await add(GOOD, { ...good, toAdd: "three" })).toEqual(refusal);
    expect(await add(GOOD, { ...good, toAdd: "" })).toEqual(refusal);
    expect(await add(GOOD, { ...good, toAdd: "2.5" })).toEqual(refusal);
    expect(await stored()).toBe(0);
  });

  it("will not add a file other than the one that was checked, or when the count differs", async () => {
    const good = await checked(GOOD);
    expect(await add(`${GOOD}\r\n`, good)).toEqual({ kind: "error", message: "That is not the file you checked, so nothing was added. Check the file again." });
    expect(await add(GOOD, { ...good, toAdd: "4" })).toEqual({ kind: "error", message: "The file, or what is already stored, changed since you checked it, so nothing was added. Check the file again." });
    expect(await stored()).toBe(0);
  });

  it("tells a file's problems in words instead of adding, even with a matching fingerprint", async () => {
    const bad = GOOD.replace("1002", "ten");
    expect(await add(bad, { fingerprint: fingerprintOf(bad), toAdd: "3" })).toEqual({ kind: "error", message: "The file has 1 problem, so nothing was added. Fix the file and check it again." });
    expect(await stored()).toBe(0);
  });

  it("says so, and changes nothing, when everything is already stored", async () => {
    await add(GOOD, await checked(GOOD));
    const again = await checked(GOOD);
    expect(again.toAdd).toBe("0");
    expect(await add(GOOD, again)).toEqual({ kind: "error", message: "Every row in the file is already stored, so there is nothing to add." });
    expect(await stored()).toBe(3);
  });

  it("passes on a failure it does not understand instead of hiding it", async () => {
    const good = await checked(GOOD);
    (h.history as HistoryStore).add = async () => {
      throw new Error("the database is down");
    };
    await expect(add(GOOD, good)).rejects.toThrow("the database is down");
  });
});
