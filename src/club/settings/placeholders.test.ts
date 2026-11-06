import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RULES_FILES, placeholderRulesFiles } from "./placeholders";

const FOLDER = __dirname;
const jsonFiles = readdirSync(FOLDER).filter((f) => f.endsWith(".json")).sort();

describe("the list of rules files the switch-on checklist reads", () => {
  it("holds every rules file in the settings folder, so a new one cannot be left out", () => {
    expect(RULES_FILES.map((f) => f.file).sort()).toEqual(jsonFiles);
  });

  it("names each file once", () => {
    const names = RULES_FILES.map((f) => f.file);
    expect(new Set(names).size).toBe(names.length);
  });

  it("reads each file's own placeholder mark, and every file has one written as true or false", () => {
    for (const { file, placeholder } of RULES_FILES) {
      const data = JSON.parse(readFileSync(path.join(FOLDER, file), "utf8")) as { placeholder?: unknown };
      expect(typeof data.placeholder, `${file} has a placeholder mark`).toBe("boolean");
      expect(placeholder, file).toBe(data.placeholder !== false);
    }
  });

  it("lists as placeholders exactly the files marked true, and nothing when none is", () => {
    expect(placeholderRulesFiles([{ file: "a.json", placeholder: true }, { file: "b.json", placeholder: false }, { file: "c.json", placeholder: true }])).toEqual(["a.json", "c.json"]);
    expect(placeholderRulesFiles([{ file: "a.json", placeholder: false }])).toEqual([]);
    expect(placeholderRulesFiles([])).toEqual([]);
    // Today's real files: the club's numbers have not been confirmed by staff yet.
    expect(placeholderRulesFiles()).toEqual(RULES_FILES.filter((f) => f.placeholder).map((f) => f.file));
  });
});
