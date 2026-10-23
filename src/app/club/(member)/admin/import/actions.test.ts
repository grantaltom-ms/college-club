import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryClubStore, sequentialIds } from "@/club/store/memory";
import { MAX_ROSTER_BYTES, ROSTER_COLUMNS } from "@/club/engine/roster";
import { fingerprintOf } from "@/club/engine/import";
import { historyOf } from "@/club/engine/queries";
import type { ClubStore } from "@/club/store/memory";

/**
 * The import screen's server action, called directly with the page's own ingredients replaced by fakes: who is signed in,
 * whether the member area is on, and the club's records. Everything that matters about it lives in the action: staff only,
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

import { importRoster } from "./actions";

const HEADER = ROSTER_COLUMNS.join(",");
const GOOD = [HEADER, "1001,The Aldridge household,Resident,2015-06-01,Una,Aldridge,una@example.com,206-555-0101,", "1001,The Aldridge household,Resident,2015-06-01,Vic,Aldridge,vic@example.com,,", "1002,The Bowman household,Intermediate,3/14/2022,Wes,Bowman,wes@example.com,,"].join("\r\n");
const STAFF = { kind: "staff", label: "Alex Staffer", source: "login" };
const MEMBER = { kind: "member", label: "Una Aldridge" };

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const csvFile = (text: string, name = "roster.csv") => new File([text], name, { type: "text/csv" });
const check = (text: string) => importRoster(form({ file: csvFile(text), intent: "check" }));
const add = (text: string, extra: Record<string, string> = {}) => importRoster(form({ file: csvFile(text), intent: "add", ...extra }));
const counts = async () => {
  const s = await (h.store as ClubStore).read();
  return { households: s.households.length, members: s.members.length };
};

beforeEach(() => {
  h.enabled = true;
  h.actor = STAFF;
  h.now = NOW;
  h.store = new MemoryClubStore(sequentialIds());
});

describe("the import screen's action: who may use it", () => {
  it("answers 'not found' when the member area is off, when nobody is signed in, and for a member", async () => {
    h.enabled = false;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    h.enabled = true;
    h.actor = null;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    h.actor = MEMBER;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(add(GOOD, { fingerprint: fingerprintOf(GOOD), households: "2", adults: "3" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await counts()).toEqual({ households: 0, members: 0 });
  });
});

describe("the import screen's action: the file", () => {
  it("asks for a file when there is none, it is empty, or it is not a file", async () => {
    for (const fields of [{ intent: "check" }, { file: csvFile(""), intent: "check" }, { file: "not a file", intent: "check" }] as Record<string, string | File>[]) {
      expect(await importRoster(form(fields))).toEqual({ kind: "error", message: "Choose a file first." });
    }
  });

  it("refuses a file that is too big, without reading it", async () => {
    const big = csvFile("x".repeat(MAX_ROSTER_BYTES + 1));
    expect(await importRoster(form({ file: big, intent: "check" }))).toEqual({ kind: "error", message: "The file is too big: it can be up to 500 KB, which is about 3,000 people." });
  });

  it("does not understand an unknown button", async () => {
    expect(await importRoster(form({ file: csvFile(GOOD), intent: "delete-everything" }))).toEqual({ kind: "error", message: "Something was missing. Check the file again." });
    expect(await counts()).toEqual({ households: 0, members: 0 });
  });
});

describe("the import screen's action: checking", () => {
  it("says what the file would do and saves nothing", async () => {
    const result = await check(GOOD);
    expect(result).toMatchObject({ kind: "checked", fileName: "roster.csv" });
    if (result.kind !== "checked") throw new Error("expected a check");
    expect(result.plan.problems).toEqual([]);
    expect(result.plan.toAdd.map((x) => x.displayName)).toEqual(["The Aldridge household", "The Bowman household"]);
    expect(result.plan.adultsToAdd).toBe(3);
    expect(result.plan.fingerprint).toBe(fingerprintOf(GOOD));
    expect(await counts()).toEqual({ households: 0, members: 0 });
  });

  it("judges join dates against today on the Pacific clock, not the server's", async () => {
    // 8 pm on Oct 28 in Seattle is already Oct 29 in UTC.
    h.now = new Date("2026-10-29T03:00:00Z");
    const one = (joined: string) => [HEADER, `1001,The Aldridge household,Resident,${joined},Una,Aldridge,una@example.com,,`].join("\r\n");
    const problems = async (joined: string) => {
      const result = await check(one(joined));
      if (result.kind !== "checked") throw new Error("expected a check");
      return result.plan.problems;
    };
    expect(await problems("2026-10-28")).toEqual([]);
    expect(await problems("2026-10-29")).toEqual(['Row 2: Joined "2026-10-29" is in the future. Check the date.']);
  });

  it("carries a file's problems, in words, and a check never saves anything even for a good file checked twice", async () => {
    const result = await check(GOOD.replace("Intermediate", "Medium"));
    expect(result).toMatchObject({ kind: "checked" });
    if (result.kind === "checked") expect(result.plan.problems).toEqual(['Row 4: Membership type "Medium" is not Resident, Intermediate or Non-Resident.']);
    await check(GOOD);
    await check(GOOD);
    expect(await counts()).toEqual({ households: 0, members: 0 });
  });
});

describe("the import screen's action: adding", () => {
  const checked = async (text: string) => {
    const r = await check(text);
    if (r.kind !== "checked") throw new Error("expected a check");
    return { fingerprint: r.plan.fingerprint, households: String(r.plan.toAdd.length), adults: String(r.plan.adultsToAdd) };
  };

  it("adds the file that was checked, as the signed-in staff member, and says how many", async () => {
    expect(await add(GOOD, await checked(GOOD))).toEqual({ kind: "added", fileName: "roster.csv", added: 2, adults: 3, alreadyHere: 0 });
    expect(await counts()).toEqual({ households: 2, members: 3 });
    const state = await (h.store as ClubStore).read();
    const joined = historyOf(state, state.households[0].id).find((l) => l.kind === "joined")!;
    expect(joined.actor).toEqual({ kind: "staff", label: "Alex Staffer" });
    expect(joined.at).toBe(NOW.toISOString());
  });

  it("will not add without the check: no fingerprint, a wrong-shaped one, or counts that are not numbers", async () => {
    const good = await checked(GOOD);
    const refusal = { kind: "error", message: "Check the file first, then add." };
    expect(await add(GOOD)).toEqual(refusal);
    expect(await add(GOOD, { ...good, fingerprint: "abc" })).toEqual(refusal);
    expect(await add(GOOD, { ...good, fingerprint: "G".repeat(64) })).toEqual(refusal);
    expect(await add(GOOD, { ...good, households: "two" })).toEqual(refusal);
    expect(await add(GOOD, { ...good, adults: "" })).toEqual(refusal);
    expect(await add(GOOD, { ...good, households: "2.5" })).toEqual(refusal);
    expect(await counts()).toEqual({ households: 0, members: 0 });
  });

  it("will not add a file other than the one that was checked, or when the numbers differ", async () => {
    const good = await checked(GOOD);
    const refusal = { kind: "error", message: "The file, or the club's records, changed since you checked it, so nothing was added. Check the file again." };
    expect(await add(`${GOOD}\r\n`, good)).toEqual(refusal);
    expect(await add(GOOD, { ...good, households: "3" })).toEqual(refusal);
    expect(await add(GOOD, { ...good, adults: "4" })).toEqual(refusal);
    expect(await counts()).toEqual({ households: 0, members: 0 });
  });

  it("tells a file's problems in words instead of adding, even with a matching fingerprint", async () => {
    const bad = GOOD.replace("una@example.com", "una-at-example");
    const fingerprint = fingerprintOf(bad);
    expect(await add(bad, { fingerprint, households: "2", adults: "3" })).toEqual({ kind: "error", message: "The file has 1 problem, so nothing was added. Fix the file and check it again." });
    expect(await counts()).toEqual({ households: 0, members: 0 });
  });

  it("says so, and changes nothing, when everything is already here", async () => {
    await add(GOOD, await checked(GOOD));
    const again = await checked(GOOD);
    expect(await add(GOOD, again)).toEqual({ kind: "error", message: "Every household in the file is already here, so there is nothing to add." });
    expect(await counts()).toEqual({ households: 2, members: 3 });
  });

  it("passes on a failure it does not understand instead of hiding it", async () => {
    const good = await checked(GOOD);
    (h.store as ClubStore).transaction = async () => {
      throw new Error("the database is down");
    };
    await expect(add(GOOD, good)).rejects.toThrow("the database is down");
  });
});
