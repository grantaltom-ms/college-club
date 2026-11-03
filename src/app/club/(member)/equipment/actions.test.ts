import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullName } from "@/club/engine/queries";
import { buildSampleStore } from "@/club/sample/club";
import type { ClubStore } from "@/club/store/memory";
import type { ClubState } from "@/club/types";

/**
 * The staff buttons on one item, called directly with who is signed in, whether the member area is on, and the club's records
 * replaced by the invented sample: staff only (anyone else gets "page not found" before the form is read), plain words for a
 * refusal (every problem together), and nothing saved when something is wrong.
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

import { bringItemBack, changeItem, retireTheItem } from "./actions";

const STAFF = { kind: "staff", label: "Alex Staffer", source: "login" };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const state = (): Promise<ClubState> => (h.store as ClubStore).read();
const boat = async (name: string) => (await state()).items.find((i) => i.name === name)!;

beforeEach(async () => {
  h.enabled = true;
  h.actor = STAFF;
  h.now = NOW;
  h.store = await buildSampleStore("2026-10-28", NOW);
});

describe("the item buttons: who may use them", () => {
  it("answer 'not found' when the member area is off, when nobody is signed in, and for a member, and save nothing", async () => {
    const heron = await boat("Heron");
    const fields = form({ item: heron.id, name: "Heron II", reason: "Sold" });
    const before = (await state()).itemLog.length;
    h.enabled = false;
    for (const act of [changeItem, retireTheItem, bringItemBack]) await expect(act(fields)).rejects.toThrow("NEXT_NOT_FOUND");
    h.enabled = true;
    h.actor = null;
    for (const act of [changeItem, retireTheItem, bringItemBack]) await expect(act(fields)).rejects.toThrow("NEXT_NOT_FOUND");
    const ada = (await state()).members.find((m) => fullName(m) === "Nora Abernathy")!;
    h.actor = { kind: "member", label: "Nora Abernathy", member: { id: ada.id }, source: "login" };
    for (const act of [changeItem, retireTheItem, bringItemBack]) await expect(act(fields)).rejects.toThrow("NEXT_NOT_FOUND");
    const s = await state();
    expect(s.itemLog).toHaveLength(before);
    expect(s.items.find((i) => i.id === heron.id)).toMatchObject({ name: "Heron" });
    expect(s.items.find((i) => i.id === heron.id)?.retired).toBeUndefined();
  });
});

describe("fixing an item", () => {
  it("asks for the item", async () => {
    for (const act of [changeItem, retireTheItem, bringItemBack]) expect(await act(form({}))).toEqual({ kind: "error", message: "Choose the item." });
  });

  it("renames it, and says what changed in words", async () => {
    const heron = await boat("Heron");
    expect(await changeItem(form({ item: heron.id, name: "Heron II" }))).toEqual({ kind: "ok", message: 'Saved: name from Heron to Heron II.' });
    const s = await state();
    expect(s.items.find((i) => i.id === heron.id)?.name).toBe("Heron II");
    expect(s.itemLog.at(-1)).toMatchObject({ itemId: heron.id, by: { kind: "staff", label: "Alex Staffer" } });
  });

  it("changes the seats, the skill level and the places from the boxes on the form, and leaves alone a box that is not there", async () => {
    const heron = await boat("Heron");
    const done = await changeItem(form({ item: heron.id, name: "Heron", seats: "2", skill: "none" }));
    expect(done.kind).toBe("ok");
    expect(await boat("Heron")).toMatchObject({ classCode: "shell-double", requiredQualification: null });

    const berths = await boat("Dock berths");
    expect(await changeItem(form({ item: berths.id, name: "Dock berths", places: "6" }))).toEqual({ kind: "ok", message: "Saved: places from 4 to 6." });
    expect((await boat("Dock berths")).places).toBe(6);

    const osprey = await boat("Osprey");
    expect((await changeItem(form({ item: osprey.id, skill: "class" }))).kind).toBe("error"); // already the usual level: nothing changed
    expect((await changeItem(form({ item: osprey.id, skill: "scull-3" }))).kind).toBe("ok");
    expect((await boat("Osprey")).requiredQualification).toBe("scull-3");
  });

  it("says when nothing changed, and names every problem together", async () => {
    const heron = await boat("Heron");
    expect(await changeItem(form({ item: heron.id, name: "Heron", seats: "1", skill: "class" }))).toEqual({ kind: "error", message: "Nothing was changed: what you entered is what Heron already has." });
    expect(await changeItem(form({ item: heron.id, name: "  ", seats: "3", skill: "nope", places: "9" }))).toEqual({
      kind: "error",
      message: 'The name cannot be empty. A shell can have 1, 2, 4 or 8 seats, not 3. "nope" is not a skill level the club uses. Heron has a single place, so it is not a pool and has no number of places to change.',
    });
    expect(await boat("Heron")).toMatchObject({ name: "Heron", classCode: "shell-single" });
  });

  it("refuses seats or places that are not whole numbers, before the engine is asked", async () => {
    const heron = await boat("Heron");
    const berths = await boat("Dock berths");
    expect(await changeItem(form({ item: heron.id, seats: "two" }))).toEqual({ kind: "error", message: "Seats must be a whole number." });
    expect(await changeItem(form({ item: heron.id, seats: "1.5" }))).toEqual({ kind: "error", message: "Seats must be a whole number." });
    expect(await changeItem(form({ item: berths.id, places: "six" }))).toEqual({ kind: "error", message: "Places must be a whole number." });
    expect(await changeItem(form({ item: berths.id, places: "-3" }))).toEqual({ kind: "error", message: "Places must be a whole number." });
    // Scientific notation is a number to JavaScript but not a number a person types into a whole-number box.
    expect(await changeItem(form({ item: heron.id, seats: "1e0" }))).toEqual({ kind: "error", message: "Seats must be a whole number." });
    expect(await changeItem(form({ item: berths.id, places: "6e0" }))).toEqual({ kind: "error", message: "Places must be a whole number." });
    expect((await state()).itemLog).toHaveLength(1); // only the sample's own retirement line
  });

  it("refuses a name another item has, in the engine's own words", async () => {
    const heron = await boat("Heron");
    expect(await changeItem(form({ item: heron.id, name: "gannet" }))).toEqual({
      kind: "error",
      message: 'There is already an item called "Gannet" (retired). Names have to be different, even for a retired item.',
    });
  });

  it("passes on a failure that is not a refusal, instead of hiding it", async () => {
    h.store = {
      read: async () => {
        throw new Error("the database is down");
      },
      transaction: async () => {
        throw new Error("the database is down");
      },
    };
    await expect(changeItem(form({ item: "00000000-0000-4000-8000-000000000001", name: "X" }))).rejects.toThrow("the database is down");
  });
});

describe("retiring and bringing back", () => {
  it("retires an item with a reason, and says what stays in place", async () => {
    const loon = await boat("Loon");
    const said = await retireTheItem(form({ item: loon.id, reason: "Sold to a club in Tacoma" }));
    expect(said).toEqual({ kind: "ok", message: "Loon is retired. 1 booking, class or practice stays in place: the list below says who to contact." });
    expect((await boat("Loon")).retired).toMatchObject({ reason: "Sold to a club in Tacoma", by: { kind: "staff", label: "Alex Staffer" } });
    expect(await retireTheItem(form({ item: loon.id, reason: "Again" }))).toEqual({ kind: "error", message: "Loon has already been retired." });
  });

  it("says nothing was booked when nothing was, and counts more than one in the plural", async () => {
    const wren = await boat("Wren");
    expect(await retireTheItem(form({ item: wren.id, reason: "Sold" }))).toEqual({ kind: "ok", message: "Wren is retired. Nothing was booked on it." });
    // The Boathouse gym is the room of the sample's classes: several scheduled sessions stay in place.
    const gym = await boat("Boathouse gym");
    const said = await retireTheItem(form({ item: gym.id, reason: "Closed for refit" }));
    expect(said).toMatchObject({ kind: "ok", message: expect.stringMatching(/^Boathouse gym is retired\. \d+ bookings, classes or practices stay in place: the list below says who to contact\.$/) });
  });

  it("needs a reason", async () => {
    const loon = await boat("Loon");
    expect(await retireTheItem(form({ item: loon.id, reason: "  " }))).toEqual({ kind: "error", message: "Say why it is being retired, for the record." });
    expect((await boat("Loon")).retired).toBeUndefined();
  });

  it("brings a retired item back, and refuses one that is not retired", async () => {
    const gannet = await boat("Gannet");
    expect(await bringItemBack(form({ item: gannet.id }))).toEqual({ kind: "ok", message: "Gannet is back. It can be booked again." });
    expect((await boat("Gannet")).retired).toBeUndefined();
    expect(await bringItemBack(form({ item: gannet.id }))).toEqual({ kind: "error", message: "Gannet has not been retired." });
  });
});
