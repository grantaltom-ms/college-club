import { describe, expect, it } from "vitest";
import { SEARCH_MAX_CHARS, SEARCH_SHOW_MAX, searchHouseholds, tidyQuery } from "./household-search";
import { buildFixture } from "./testkit";
import type { ClubState, Household } from "../types";

/** Quill (Ada, Ben, Cy) and Reed (Dee, Eli), with phone numbers added, an ended household and a member who left. */
async function club(): Promise<ClubState> {
  const f = await buildFixture("memory");
  const state = await f.store.read();
  const phone = (name: string, value: string) => (state.members.find((m) => m.firstName === name)!.phone = value);
  phone("Ada", "206-555-0142");
  phone("Ben", "(425) 555 0199");
  phone("Dee", "206-555-0177");
  state.members.find((m) => m.firstName === "Cy")!.status = "removed";
  state.households.push({ id: "11111111-1111-4111-8111-111111111111", displayName: "The Fitzgerald household", membershipType: "Resident", status: "ended", joinedOn: "2018-03-12", endedOn: "2026-10-01", quickbooksId: null, notes: "" } satisfies Household);
  state.members.push({ id: "22222222-2222-4222-8222-222222222222", householdId: "11111111-1111-4111-8111-111111111111", firstName: "Colm", lastName: "O'Fitzgerald", email: "colm@example.net", phone: "206-555-0111", role: "primary", status: "household_ended", brivoCredentialId: null, mailchimpContactId: null, loginId: null });
  return state;
}

const names = (state: ClubState, typed: string | undefined) => searchHouseholds(state, typed).shown.map((m) => m.household.displayName);

describe("searching for a household", () => {
  it("runs no search, and finds nothing, until something is typed", async () => {
    const state = await club();
    for (const typed of [undefined, "", "   ", "\n\t "]) {
      expect(searchHouseholds(state, typed)).toEqual({ query: "", total: 0, shown: [] });
    }
  });

  it("finds a household by its display name, from the start of any word, ignoring capitals and spacing", async () => {
    const state = await club();
    expect(names(state, "quill")).toEqual(["The Quill household"]);
    expect(names(state, "  QUI  ")).toEqual(["The Quill household"]);
    expect(names(state, "the reed")).toEqual(["The Reed household"]);
    expect(names(state, "house")).toEqual(["The Fitzgerald household", "The Quill household", "The Reed household"]);
    // The middle of a word is not the start of one.
    expect(names(state, "uill")).toEqual([]);
  });

  it("finds a household by the name of any adult in it, first or last name or both, including adults who left", async () => {
    const state = await club();
    expect(names(state, "ada")).toEqual(["The Quill household"]);
    expect(names(state, "ben quill")).toEqual(["The Quill household"]);
    expect(names(state, "eli")).toEqual(["The Reed household"]);
    // Cy has been removed from the household and Colm's whole household has ended: both can still be looked for.
    expect(names(state, "cy")).toEqual(["The Quill household"]);
    expect(names(state, "colm")).toEqual(["The Fitzgerald household"]);
    expect(names(state, "o'fitz")).toEqual(["The Fitzgerald household"]);
  });

  it("finds a household by any part of an adult's email address", async () => {
    const state = await club();
    expect(names(state, "ada@example.com")).toEqual(["The Quill household"]);
    expect(names(state, "DEE@Example.com")).toEqual(["The Reed household"]);
    expect(names(state, "@example.net")).toEqual(["The Fitzgerald household"]);
    expect(names(state, "eli@")).toEqual(["The Reed household"]);
  });

  it("finds a household by an adult's phone number, written any way, from three digits", async () => {
    const state = await club();
    expect(names(state, "206-555-0142")).toEqual(["The Quill household"]);
    expect(names(state, "(206) 555 0142")).toEqual(["The Quill household"]);
    expect(names(state, "2065550142")).toEqual(["The Quill household"]);
    expect(names(state, "+1 206 555 0142")).toEqual(["The Quill household"]);
    expect(names(state, "555-0199")).toEqual(["The Quill household"]);
    expect(names(state, "425")).toEqual(["The Quill household"]);
    expect(names(state, "555-0177")).toEqual(["The Reed household"]);
    expect(names(state, "0111")).toEqual(["The Fitzgerald household"]);
    // Two digits are not enough to be a phone number, and the same digits in a name search find no names.
    expect(names(state, "55")).toEqual([]);
    // A number nobody has.
    expect(names(state, "206-555-9999")).toEqual([]);
  });

  it("a number plus letters is not a phone number", async () => {
    const state = await club();
    expect(names(state, "206 quill")).toEqual([]);
  });

  it("returns every household that matches, in name order, once each, with its active adults", async () => {
    const state = await club();
    const found = searchHouseholds(state, "example");
    expect(found.total).toBe(3);
    expect(found.shown.map((m) => [m.household.displayName, m.activeAdults])).toEqual([
      ["The Fitzgerald household", 0],
      ["The Quill household", 2],
      ["The Reed household", 2],
    ]);
  });

  it("says nothing matches when nothing does, and a query with no letter or digit in it matches nothing rather than everything", async () => {
    const state = await club();
    expect(searchHouseholds(state, "zzzz")).toEqual({ query: "zzzz", total: 0, shown: [] });
    for (const typed of ["@", "...", "- -", "'"]) expect(searchHouseholds(state, typed).total, typed).toBe(0);
  });

  it("shows the first 50 and says how many there were in all", async () => {
    const state = await club();
    for (let n = 0; n < 60; n++) {
      state.households.push({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, displayName: `The Many${String(n).padStart(2, "0")} household`, membershipType: "Resident", status: "active", joinedOn: "2020-01-01", endedOn: null, quickbooksId: null, notes: "" });
    }
    const found = searchHouseholds(state, "many");
    expect(found.total).toBe(60);
    expect(found.shown).toHaveLength(SEARCH_SHOW_MAX);
    expect(found.shown[0].household.displayName).toBe("The Many00 household");
    expect(found.shown.at(-1)!.household.displayName).toBe("The Many49 household");
  });

  it("tidies what was typed: squeezes spaces, drops control characters, cuts to 100 characters", () => {
    expect(tidyQuery("  Ada   Quill ")).toBe("Ada Quill");
    expect(tidyQuery("ada\u0000\nquill")).toBe("ada quill");
    expect(tidyQuery(undefined)).toBe("");
    expect(tidyQuery("x".repeat(SEARCH_MAX_CHARS))).toHaveLength(SEARCH_MAX_CHARS);
    expect(tidyQuery("x".repeat(SEARCH_MAX_CHARS + 1))).toHaveLength(SEARCH_MAX_CHARS);
    expect(tidyQuery(`${"x".repeat(SEARCH_MAX_CHARS - 1)}  tail`)).toBe("x".repeat(SEARCH_MAX_CHARS - 1));
  });

  it("changes nothing in the records however often it is run", async () => {
    const state = await club();
    const before = JSON.stringify(state);
    for (let n = 0; n < 3; n++) searchHouseholds(state, "quill");
    expect(JSON.stringify(state)).toBe(before);
  });
});
