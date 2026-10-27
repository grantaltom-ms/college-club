import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHousehold } from "@/club/engine/households";
import { fingerprintOf } from "@/club/engine/import";
import { historyOf } from "@/club/engine/queries";
import { MAX_RESIGNATION_BYTES, RESIGNATION_COLUMNS } from "@/club/engine/resignations";
import { MemoryClubStore, sequentialIds, type ClubStore } from "@/club/store/memory";

/**
 * The resignations screen's server action, called directly with the page's own ingredients replaced by fakes: who is signed in,
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

import { endHouseholds } from "./actions";

const HEADER = RESIGNATION_COLUMNS.join(",");
const GOOD = [HEADER, "Q1,The Number1 household,Moved away", "Q2,The Number2 household,"].join("\r\n");
const STAFF = { kind: "staff", label: "Alex Staffer", source: "login" };
const MEMBER = { kind: "member", label: "Ann Number1" };

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const csvFile = (text: string, name = "resignations.csv") => new File([text], name, { type: "text/csv" });
const check = (text: string) => endHouseholds(form({ file: csvFile(text), intent: "check" }));
const end = (text: string, extra: Record<string, string> = {}) => endHouseholds(form({ file: csvFile(text), intent: "end", ...extra }));
const ended = async () => (await (h.store as ClubStore).read()).households.filter((x) => x.status === "ended").map((x) => x.quickbooksId);

const seed = async () => {
  const store = new MemoryClubStore(sequentialIds());
  for (const n of [1, 2, 3]) {
    await createHousehold(store, { actor: { kind: "staff", label: "Test staff" }, now: NOW }, {
      displayName: `The Number${n} household`,
      membershipType: "Resident",
      joinedOn: "2020-01-01",
      quickbooksId: `Q${n}`,
      primary: { firstName: "Ann", lastName: `Number${n}`, email: `ann${n}@example.com` },
      additional: [{ firstName: "Bo", lastName: `Number${n}`, email: `bo${n}@example.com` }],
    });
  }
  return store;
};

beforeEach(async () => {
  h.enabled = true;
  h.actor = STAFF;
  h.now = NOW;
  h.store = await seed();
});

describe("the resignations screen's action: who may use it", () => {
  it("answers 'not found' when the member area is off, when nobody is signed in, and for a member", async () => {
    h.enabled = false;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    h.enabled = true;
    h.actor = null;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    h.actor = MEMBER;
    await expect(check(GOOD)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(end(GOOD, { fingerprint: fingerprintOf(GOOD), households: "2", adults: "4" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await ended()).toEqual([]);
  });
});

describe("the resignations screen's action: the file", () => {
  it("asks for a file when there is none, it is empty, or it is not a file", async () => {
    for (const fields of [{ intent: "check" }, { file: csvFile(""), intent: "check" }, { file: "not a file", intent: "check" }] as Record<string, string | File>[]) {
      expect(await endHouseholds(form(fields))).toEqual({ kind: "error", message: "Choose a file first." });
    }
  });

  it("refuses a file that is too big, without reading it", async () => {
    const big = csvFile("x".repeat(MAX_RESIGNATION_BYTES + 1));
    expect(await endHouseholds(form({ file: big, intent: "check" }))).toEqual({ kind: "error", message: "The file is too big: it can be up to 200 KB, which is far more households than one file can end." });
  });

  it("does not understand an unknown button", async () => {
    expect(await endHouseholds(form({ file: csvFile(GOOD), intent: "delete-everything" }))).toEqual({ kind: "error", message: "Something was missing. Check the file again." });
    expect(await ended()).toEqual([]);
  });
});

describe("the resignations screen's action: checking", () => {
  it("says what the file would do and saves nothing", async () => {
    const result = await check(GOOD);
    expect(result).toMatchObject({ kind: "checked", fileName: "resignations.csv" });
    if (result.kind !== "checked") throw new Error("expected a check");
    expect(result.plan.problems).toEqual([]);
    expect(result.plan.toEnd.map((x) => x.displayName)).toEqual(["The Number1 household", "The Number2 household"]);
    expect(result.plan.adultsToBlock).toBe(4);
    expect(result.plan.fingerprint).toBe(fingerprintOf(GOOD));
    expect(await ended()).toEqual([]);
  });

  it("works out today on the Pacific clock, not the server's", async () => {
    // 8 pm on Oct 28 in Seattle is already Oct 29 in UTC.
    h.now = new Date("2026-10-29T03:00:00Z");
    const result = await check(GOOD);
    if (result.kind !== "checked") throw new Error("expected a check");
    expect(result.plan.endsOn).toBe("2026-10-28");
  });

  it("carries a file's problems, in words, and checking twice saves nothing", async () => {
    const result = await check(GOOD.replace("Q2", "Q99"));
    expect(result).toMatchObject({ kind: "checked" });
    if (result.kind === "checked") expect(result.plan.problems).toHaveLength(1);
    await check(GOOD);
    await check(GOOD);
    expect(await ended()).toEqual([]);
  });
});

describe("the resignations screen's action: ending", () => {
  const checked = async (text: string) => {
    const r = await check(text);
    if (r.kind !== "checked") throw new Error("expected a check");
    return { fingerprint: r.plan.fingerprint, households: String(r.plan.toEnd.length), adults: String(r.plan.adultsToBlock) };
  };

  it("ends the file that was checked, as the signed-in staff member, and says how many", async () => {
    expect(await end(GOOD, await checked(GOOD))).toEqual({ kind: "ended", fileName: "resignations.csv", ended: 2, adults: 4, cancelledBookings: 0, cancelledSignUps: 0, cancelledRsvps: 0, alreadyEnded: 0 });
    expect((await ended()).sort()).toEqual(["Q1", "Q2"]);
    const state = await (h.store as ClubStore).read();
    const line = historyOf(state, state.households.find((x) => x.quickbooksId === "Q1")!.id).find((l) => l.kind === "membership_ended")!;
    expect(line.actor).toEqual({ kind: "staff", label: "Alex Staffer" });
    expect(line.at).toBe(NOW.toISOString());
    expect(line.summary).toContain("Note: Moved away");
    // The household the file did not name is untouched.
    expect(state.households.find((x) => x.quickbooksId === "Q3")!.status).toBe("active");
  });

  it("will not end anything without the check: no fingerprint, a wrong-shaped one, or counts that are not numbers", async () => {
    const good = await checked(GOOD);
    const refusal = { kind: "error", message: "Check the file first, then end the memberships." };
    expect(await end(GOOD)).toEqual(refusal);
    expect(await end(GOOD, { ...good, fingerprint: "abc" })).toEqual(refusal);
    expect(await end(GOOD, { ...good, fingerprint: "G".repeat(64) })).toEqual(refusal);
    expect(await end(GOOD, { ...good, households: "two" })).toEqual(refusal);
    expect(await end(GOOD, { ...good, adults: "" })).toEqual(refusal);
    expect(await end(GOOD, { ...good, households: "2.5" })).toEqual(refusal);
    expect(await ended()).toEqual([]);
  });

  it("will not end a file other than the one that was checked, or when the numbers differ", async () => {
    const good = await checked(GOOD);
    const refusal = { kind: "error", message: "The file, or the club's records, changed since you checked it, so nothing was ended. Check the file again." };
    expect(await end(`${GOOD}\r\n`, good)).toEqual(refusal);
    expect(await end(GOOD, { ...good, households: "3" })).toEqual(refusal);
    expect(await end(GOOD, { ...good, adults: "5" })).toEqual(refusal);
    expect(await ended()).toEqual([]);
  });

  it("tells a file's problems in words instead of ending, even with a matching fingerprint", async () => {
    const bad = GOOD.replace("The Number2 household", "The Wrong household");
    expect(await end(bad, { fingerprint: fingerprintOf(bad), households: "2", adults: "4" })).toEqual({ kind: "error", message: "The file has 1 problem, so nothing was ended. Fix the file and check it again." });
    expect(await ended()).toEqual([]);
  });

  it("says so, and changes nothing more, when everything has already ended", async () => {
    await end(GOOD, await checked(GOOD));
    const again = await checked(GOOD);
    expect(await end(GOOD, again)).toEqual({ kind: "error", message: "Every household in the file has already ended, so there is nothing to do." });
    expect((await ended()).sort()).toEqual(["Q1", "Q2"]);
  });

  it("passes on a failure it does not understand instead of hiding it", async () => {
    const good = await checked(GOOD);
    (h.store as ClubStore).transaction = async () => {
      throw new Error("the database is down");
    };
    await expect(end(GOOD, good)).rejects.toThrow("the database is down");
  });
});
