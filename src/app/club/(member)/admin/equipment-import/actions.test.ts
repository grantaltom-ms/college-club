import { beforeEach, describe, expect, it, vi } from "vitest";
import { EQUIPMENT_COLUMNS, MAX_EQUIPMENT_BYTES } from "@/club/engine/equipment-import";
import { fingerprintOf } from "@/club/engine/import";
import { MemoryClubStore, sequentialIds, type ClubStore } from "@/club/store/memory";

/**
 * The equipment upload screen's server action, called directly with the page's own ingredients replaced by fakes: who is signed
 * in, whether the member area is on, and the club's records. Everything that matters about it lives in the action: staff only,
 * the file must be the one that was checked, and a problem is told in plain words.
 */
const NOW = new Date("2026-10-28T20:00:00Z");
const h = vi.hoisted(() => ({ enabled: true, actor: null as unknown, store: null as unknown, now: null as unknown }));

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
vi.mock("@/club/store/instance", () => ({ getClubStore: async () => h.store }));

import { loadEquipment } from "./actions";

const HEADER = EQUIPMENT_COLUMNS.join(",");
const GOOD = [HEADER, "Test Single,Shell,1,,Club,,,", "Test Twin Kayak,Kayak,2,None,Club,No,,Paddle needs mending"].join("\r\n");
const STAFF = { kind: "staff", label: "Alex Staffer", source: "login" };
const MEMBER = { kind: "member", label: "Ann Number1" };

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const csvFile = (text: string, name = "equipment.csv") => new File([text], name, { type: "text/csv" });
const check = (text: string) => loadEquipment(form({ file: csvFile(text), intent: "check" }));
const add = (text: string, extra: Record<string, string> = {}) => loadEquipment(form({ file: csvFile(text), intent: "add", ...extra }));
const names = async () => (await (h.store as ClubStore).read()).items.map((i) => i.name);

beforeEach(() => {
  h.enabled = true;
  h.actor = STAFF;
  h.now = NOW;
  h.store = new MemoryClubStore(sequentialIds());
});

describe("the equipment screen's action: who may use it", () => {
  it("answers 'not found' when the member area is off, when nobody is signed in, and for a member", async () => {
    h.enabled = false;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    h.enabled = true;
    h.actor = null;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    h.actor = MEMBER;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(add(GOOD, { fingerprint: fingerprintOf(GOOD), items: "2" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await names()).toEqual([]);
  });
});

describe("the equipment screen's action: the file", () => {
  it("asks for a file when there is none, it is empty, or it is not a file", async () => {
    for (const fields of [{ intent: "check" }, { file: csvFile(""), intent: "check" }, { file: "not a file", intent: "check" }] as Record<string, string | File>[]) {
      expect(await loadEquipment(form(fields))).toEqual({ kind: "error", message: "Choose a file first." });
    }
  });

  it("refuses a file that is too big, without reading it", async () => {
    const big = csvFile("x".repeat(MAX_EQUIPMENT_BYTES + 1));
    expect(await loadEquipment(form({ file: big, intent: "check" }))).toEqual({
      kind: "error",
      message: "The file is too big: it can be up to 200 KB, which is far more equipment than the club has.",
    });
  });

  it("does not understand an unknown button", async () => {
    expect(await loadEquipment(form({ file: csvFile(GOOD), intent: "delete-everything" }))).toEqual({ kind: "error", message: "Something was missing. Check the file again." });
    expect(await names()).toEqual([]);
  });
});

describe("the equipment screen's action: checking", () => {
  it("says what the file would do and saves nothing", async () => {
    const result = await check(GOOD);
    expect(result).toMatchObject({ kind: "checked", fileName: "equipment.csv" });
    if (result.kind !== "checked") throw new Error("expected a check");
    expect(result.plan.problems).toEqual([]);
    expect(result.plan.toAdd.map((i) => i.name)).toEqual(["Test Single", "Test Twin Kayak"]);
    expect(result.plan.fingerprint).toBe(fingerprintOf(GOOD));
    expect(await names()).toEqual([]);
  });

  it("carries a file's problems, in words, and checking twice saves nothing", async () => {
    const result = await check(GOOD.replace(",Kayak,2,", ",Kayak,5,"));
    expect(result).toMatchObject({ kind: "checked" });
    if (result.kind === "checked") expect(result.plan.problems).toEqual(["Row 3: Seats 5 does not fit a kayak: use 1 or 2."]);
    await check(GOOD);
    await check(GOOD);
    expect(await names()).toEqual([]);
  });
});

describe("the equipment screen's action: adding", () => {
  const checked = async (text: string) => {
    const r = await check(text);
    if (r.kind !== "checked") throw new Error("expected a check");
    return { fingerprint: r.plan.fingerprint, items: String(r.plan.toAdd.length) };
  };

  it("adds the file that was checked, as the signed-in staff member, and says how many", async () => {
    expect(await add(GOOD, await checked(GOOD))).toEqual({ kind: "added", fileName: "equipment.csv", added: 2, outOfService: 1, alreadyHere: 0, pools: 0, privateBoats: 0 });
    expect(await names()).toEqual(["Test Single", "Test Twin Kayak"]);
    const state = await (h.store as ClubStore).read();
    expect(state.outOfService[0]).toMatchObject({ reason: "Paddle needs mending", createdBy: { kind: "staff", label: "Alex Staffer" } });
    expect(state.outOfService[0].from).toBe(NOW.toISOString());
  });

  it("will not add anything without the check: no fingerprint, a wrong-shaped one, or a count that is not a number", async () => {
    const good = await checked(GOOD);
    const refusal = { kind: "error", message: "Check the file first, then add the equipment." };
    expect(await add(GOOD)).toEqual(refusal);
    expect(await add(GOOD, { ...good, fingerprint: "abc" })).toEqual(refusal);
    expect(await add(GOOD, { ...good, fingerprint: "G".repeat(64) })).toEqual(refusal);
    expect(await add(GOOD, { ...good, items: "two" })).toEqual(refusal);
    expect(await add(GOOD, { ...good, items: "" })).toEqual(refusal);
    expect(await add(GOOD, { ...good, items: "2.5" })).toEqual(refusal);
    expect(await names()).toEqual([]);
  });

  it("will not add a file other than the one that was checked, or when the number differs", async () => {
    const good = await checked(GOOD);
    const refusal = { kind: "error", message: "The file, or the club's records, changed since you checked it, so nothing was added. Check the file again." };
    expect(await add(`${GOOD}\r\n`, good)).toEqual(refusal);
    expect(await add(GOOD, { ...good, items: "3" })).toEqual(refusal);
    expect(await names()).toEqual([]);
  });

  it("tells a file's problems in words instead of adding, even with a matching fingerprint", async () => {
    const bad = GOOD.replace(",Kayak,2,", ",Kayak,5,");
    expect(await add(bad, { fingerprint: fingerprintOf(bad), items: "1" })).toEqual({ kind: "error", message: "The file has 1 problem, so nothing was added. Fix the file and check it again." });
    expect(await names()).toEqual([]);
  });

  it("says so, and changes nothing more, when everything is already here", async () => {
    await add(GOOD, await checked(GOOD));
    expect(await add(GOOD, await checked(GOOD))).toEqual({ kind: "error", message: "Everything in the file is already here or waiting for a later step, so there is nothing to add." });
    expect(await names()).toEqual(["Test Single", "Test Twin Kayak"]);
  });

  it("passes on a failure it does not understand instead of hiding it", async () => {
    const good = await checked(GOOD);
    (h.store as ClubStore).transaction = async () => {
      throw new Error("the database is down");
    };
    await expect(add(GOOD, good)).rejects.toThrow("the database is down");
  });
});
