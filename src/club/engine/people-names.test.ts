import { describe, expect, it } from "vitest";
import { keyOwners, memberNameKey, nameKey, peopleIn, searchPrefix } from "./people-names";

describe("a name becomes a key", () => {
  it("is first word and last word, lower case", () => {
    expect(nameKey("Pat Example")).toBe("pat example");
    expect(nameKey("  PAT   EXAMPLE ")).toBe("pat example");
  });

  it("ignores a middle name, an initial, a suffix and a nickname in brackets", () => {
    expect(nameKey("Pat Quentin Example")).toBe("pat example");
    expect(nameKey("Pat Q. Example")).toBe("pat example");
    expect(nameKey("Pat Example Jr.")).toBe("pat example");
    expect(nameKey("Pat (Patty) Example")).toBe("pat example");
    expect(nameKey("Pat Example (Guest)")).toBe("pat example");
  });

  it("ignores a seat number written after a rower", () => {
    expect(nameKey("Sam Example (2)")).toBe("sam example");
    expect(nameKey("Sam Example ( 1 )")).toBe("sam example");
  });

  it("ignores accents and apostrophes and keeps hyphenated names whole", () => {
    expect(nameKey("Zoë O'Brien")).toBe("zoe obrien");
    expect(nameKey("Zoe O’Brien")).toBe("zoe obrien");
    expect(nameKey("José Muñoz")).toBe("jose munoz");
    expect(nameKey("Zoë")).toBe("zoe");
    expect(nameKey("Mary-Jane Smith")).toBe("mary-jane smith");
    expect(nameKey("Anne Smith - Jones")).toBe("anne smith-jones");
    expect(nameKey("Anne Smith–Jones")).toBe("anne smith-jones");
    expect(nameKey("Anne Smith-")).toBe("anne smith");
  });

  it("gives a single word as it is, and nothing for nothing", () => {
    expect(nameKey("Cher")).toBe("cher");
    expect(nameKey("")).toBe("");
    expect(nameKey("   ")).toBe("");
    expect(nameKey("(1)")).toBe("");
    expect(nameKey("---")).toBe("");
  });

  it("is the same key for a member as for the name written in the old system", () => {
    expect(memberNameKey("Pat", "Example")).toBe(nameKey("Pat Example"));
    expect(memberNameKey("Zoë", "O'Brien")).toBe(nameKey("Zoe OBrien"));
  });
});

describe("the people named in one field", () => {
  it("reads one person", () => {
    expect(peopleIn("Pat Example", "booker")).toEqual([{ name: "Pat Example", key: "pat example" }]);
  });

  it("reads a joint booking, where the first shares the last name written after the second", () => {
    expect(peopleIn("Pat & Sam Example", "booker")).toEqual([
      { name: "Pat Example", key: "pat example" },
      { name: "Sam Example", key: "sam example" },
    ]);
    expect(peopleIn("Pat/Sam Example", "booker").map((p) => p.key)).toEqual(["pat example", "sam example"]);
    expect(peopleIn("Pat Example & Sam Other", "booker").map((p) => p.key)).toEqual(["pat example", "sam other"]);
  });

  it("reads a list of rowers with seat numbers", () => {
    expect(peopleIn("Pat Example (1),Sam Example (2)", "rowers").map((p) => p.key)).toEqual(["pat example", "sam example"]);
    expect(peopleIn("Pat Example (1)", "rowers")).toEqual([{ name: "Pat Example", key: "pat example" }]);
    expect(peopleIn("Pat Example (1); Sam Other (2)", "rowers").map((p) => p.key)).toEqual(["pat example", "sam other"]);
  });

  it("reads a comma in a booker field as part of one name, not a list", () => {
    expect(peopleIn("Example, Pat", "booker")).toHaveLength(1);
  });

  it("leaves out anyone with no usable name", () => {
    expect(peopleIn("", "rowers")).toEqual([]);
    expect(peopleIn("(1)", "rowers")).toEqual([]);
  });
});

describe("which members have a name", () => {
  it("lists every member who has each key, so a shared name can be told from a unique one", () => {
    const owners = keyOwners([
      { id: "a", firstName: "Pat", lastName: "Example" },
      { id: "b", firstName: "Pat", lastName: "Example" },
      { id: "c", firstName: "Sam", lastName: "Example" },
    ]);
    expect(owners.get("pat example")).toEqual(["a", "b"]);
    expect(owners.get("sam example")).toEqual(["c"]);
    expect(owners.get("nobody here")).toBeUndefined();
  });
});

describe("what staff type in the name box", () => {
  it("is cleaned like a key but may be a start", () => {
    expect(searchPrefix("Pat Ex")).toBe("pat ex");
    expect(searchPrefix("  PAT   ")).toBe("pat");
    expect(searchPrefix("O'Br")).toBe("obr");
    expect(searchPrefix("Pat Quentin Example")).toBe("pat example");
  });
});
