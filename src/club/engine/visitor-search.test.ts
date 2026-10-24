import { describe, expect, it } from "vitest";
import { HOST_SEARCH_MIN_LETTERS, HOST_SEARCH_MOST, findHosts } from "./visitor-search";
import { endHousehold, createHousehold, removeMember } from "./households";
import { clubLedger } from "./ledger";
import { fixture, staffCtx, type Fixture } from "./testkit";

const person = (first: string, last: string, email = `${first}.${last}@example.com`.toLowerCase()) => ({ firstName: first, lastName: last, email });
const household = (f: Fixture, name: string, primary: ReturnType<typeof person>, additional: ReturnType<typeof person>[] = []) =>
  createHousehold(f.store, staffCtx(), { displayName: name, membershipType: "Resident", joinedOn: "2020-01-01", primary, additional });
const names = (state: Awaited<ReturnType<Fixture["store"]["read"]>>, typed: string) => findHosts(state, typed).hosts.map((h) => h.name);

describe("finding yourself on the iPad to sign visitors in", () => {
  it("shows nothing until at least three letters are typed, spaces not counted", async () => {
    const f = await fixture();
    const state = await f.store.read();
    expect(HOST_SEARCH_MIN_LETTERS).toBe(3);
    for (const typed of ["", " ", "a", "ad", " a d ", "  ad  "]) {
      expect(findHosts(state, typed), typed).toEqual({ tooShort: true, hosts: [], more: false });
    }
    expect(findHosts(state, "ada").tooShort).toBe(false);
    expect(findHosts(state, "a d a").tooShort).toBe(false);
  });

  it("finds the start of any word of a name, in any case, listed by last name then first name", async () => {
    const f = await fixture();
    const state = await f.store.read();
    expect(names(state, "ada")).toEqual(["Ada Quill"]);
    expect(names(state, "ADA")).toEqual(["Ada Quill"]);
    expect(names(state, "qui")).toEqual(["Ada Quill", "Ben Quill", "Cy Quill"]);
    expect(names(state, "ben q")).toEqual(["Ben Quill"]);
    expect(names(state, "ben quill")).toEqual(["Ben Quill"]);
    expect(names(state, "ree")).toEqual(["Dee Reed", "Eli Reed"]);
    expect(names(state, "zzz")).toEqual([]);
    expect(findHosts(state, "zzz")).toEqual({ tooShort: false, hosts: [], more: false });
  });

  it("never shows more than five names, says there are more, and narrows as more is typed", async () => {
    const f = await fixture();
    for (let n = 1; n <= 7; n++) await household(f, `The Smith${n} household`, person(`Sam${n}`, "Smith", `sam${n}@example.com`));
    const state = await f.store.read();
    expect(HOST_SEARCH_MOST).toBe(5);
    const result = findHosts(state, "smi");
    expect(result.hosts).toHaveLength(5);
    expect(result.more).toBe(true);
    expect(result.hosts.map((h) => h.name)).toEqual(["Sam1 Smith", "Sam2 Smith", "Sam3 Smith", "Sam4 Smith", "Sam5 Smith"]);
    expect(names(state, "sam7")).toEqual(["Sam7 Smith"]);
    expect(findHosts(state, "sam7").more).toBe(false);
    // Exactly five matches is not "more".
    expect(findHosts(state, "sam").more).toBe(true);
    expect(findHosts(await withOnly(f, 5), "smi")).toMatchObject({ more: false });
  });

  it("leaves out adults who have left and everyone in a household whose membership ended", async () => {
    const f = await fixture();
    await removeMember(f.store, clubLedger, staffCtx(), f.m.Ben);
    await endHousehold(f.store, clubLedger, staffCtx(), f.h.Reed);
    const state = await f.store.read();
    expect(names(state, "qui")).toEqual(["Ada Quill", "Cy Quill"]);
    expect(names(state, "ree")).toEqual([]);
    expect(names(state, "eli")).toEqual([]);
  });

  it("tells two people with the same name apart by household, and only them", async () => {
    const f = await fixture();
    await household(f, "The Lee household", person("Pat", "Lee", "pat.lee1@example.com"));
    await household(f, "The Leigh household", person("Pat", "Lee", "pat.lee2@example.com"));
    await household(f, "The Other household", person("Patricia", "Long", "patricia@example.com"));
    const result = findHosts(await f.store.read(), "pat");
    expect(result.hosts).toEqual([
      { memberId: expect.any(String), name: "Pat Lee", household: "The Lee household" },
      { memberId: expect.any(String), name: "Pat Lee", household: "The Leigh household" },
      { memberId: expect.any(String), name: "Patricia Long", household: null },
    ]);
  });

  it("does not search for anything but what was typed: no regular-expression or wildcard tricks", async () => {
    const f = await fixture();
    const state = await f.store.read();
    for (const typed of [".*", "%%%", "a.a", "(ad|be)", "ada|ben", "\\w\\w\\w", "***", "...", "- - -", "' ' '", "  ¿?¡  "]) expect(findHosts(state, typed).hosts, typed).toEqual([]);
    // Punctuation does not count towards the three letters, and is not what is searched for.
    expect(findHosts(state, "%%%").tooShort).toBe(true);
    expect(findHosts(state, "a.d").tooShort).toBe(true);
    expect(findHosts(state, "a.d.a").tooShort).toBe(false);
  });
});

/** A fixture whose Smith households are cut back to exactly `count`, to test the edge of "more". */
async function withOnly(f: Fixture, count: number) {
  const state = await f.store.read();
  const smiths = state.members.filter((m) => m.lastName === "Smith");
  return { ...state, members: state.members.filter((m) => m.lastName !== "Smith" || smiths.indexOf(m) < count) };
}
