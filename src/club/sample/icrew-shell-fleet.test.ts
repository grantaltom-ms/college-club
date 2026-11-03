import { describe, expect, it } from "vitest";
import { RULE_BOOK, classOf } from "../settings/rulebook";
import { SAMPLE_ITEMS } from "./equipment";
import { ICREW_SHELL_FLEET, findIcrewShell, shellClassForSeats, skillForIcrewShell } from "./icrew-shell-fleet";
import { weightRangeWords } from "../engine/equipment-edit";

describe("iCrew shell fleet (Nov 2, 2026)", () => {
  it("has 103 shells: 68 singles, 26 doubles, 6 fours, 3 eights; 34 with weights and 69 without", () => {
    expect(ICREW_SHELL_FLEET).toHaveLength(103);
    expect(ICREW_SHELL_FLEET.filter((s) => s.seats === 1)).toHaveLength(68);
    expect(ICREW_SHELL_FLEET.filter((s) => s.seats === 2)).toHaveLength(26);
    expect(ICREW_SHELL_FLEET.filter((s) => s.seats === 4)).toHaveLength(6);
    expect(ICREW_SHELL_FLEET.filter((s) => s.seats === 8)).toHaveLength(3);
    expect(ICREW_SHELL_FLEET.filter((s) => s.minWeightLbs != null)).toHaveLength(34);
    expect(ICREW_SHELL_FLEET.filter((s) => s.minWeightLbs == null && s.maxWeightLbs == null)).toHaveLength(69);
  });

  it("never invents zero for a missing weight, and a single value is stored as min = max", () => {
    for (const s of ICREW_SHELL_FLEET) {
      expect(s.minWeightLbs === 0 || s.maxWeightLbs === 0).toBe(false);
      if (s.minWeightLbs != null) expect(s.maxWeightLbs).toBeGreaterThanOrEqual(s.minWeightLbs);
    }
    expect(findIcrewShell("Grey LiteBoat", 1)).toMatchObject({ minWeightLbs: 220, maxWeightLbs: 220 });
    expect(weightRangeWords(220, 220)).toBe("220 lb");
    expect(weightRangeWords(110, 143)).toBe("110-143 lb");
    expect(weightRangeWords(null, null)).toBe("weight not on file");
  });

  it('treats "Sykes (70-80kg)" as an eight name with weight not on file', () => {
    const boat = findIcrewShell("Sykes (70-80kg)", 8);
    expect(boat).toMatchObject({ seats: 8, skill: "Int", minWeightLbs: null, maxWeightLbs: null, manufacturer: null });
    expect(findIcrewShell("Sykes (70-80kg)", 1)).toBeUndefined();
  });

  it("keeps 2-6 Gradek and 2-7 Gradek as different boats (rack location prefix + owner name)", () => {
    expect(findIcrewShell("2-6 Gradek", 1)?.skill).toBe("Adv");
    expect(findIcrewShell("2-7 Gradek", 1)?.skill).toBe("Adv");
    expect(findIcrewShell("2-6 Gradek", 1)?.name).not.toBe(findIcrewShell("2-7 Gradek", 1)?.name);
    // The leading number-dash-number is the storage rack, not seats — both are singles.
    expect(findIcrewShell("2-6 Gradek", 1)?.seats).toBe(1);
    expect(findIcrewShell("2-7 Gradek", 1)?.seats).toBe(1);
  });

  it("keeps #201's maker spelling Liagjin as in iCrew, and leaves Lange and Valiant in service (no permanent damage)", () => {
    expect(findIcrewShell("#201", 2)?.manufacturer).toBe("Liagjin");
    expect(findIcrewShell("The Lange", 1)).toMatchObject({ minWeightLbs: 176, maxWeightLbs: 220 });
    expect(findIcrewShell("Valiant", 2)).toMatchObject({ minWeightLbs: 187, maxWeightLbs: 220, skill: "Nov" });
    expect(findIcrewShell("Lange", 2)?.minWeightLbs).toBeNull();
  });

  it("maps seat counts onto shell classes including eights, and maps iCrew skill onto club qualifications", () => {
    expect(shellClassForSeats(8)).toBe("shell-eight");
    expect(classOf(RULE_BOOK, { classCode: "shell-eight" })).toMatchObject({ seats: 8, name: "Eight", type: "Shell" });
    expect(skillForIcrewShell(findIcrewShell("Heron", 1)!, "scull-1")).toBeUndefined();
    expect(skillForIcrewShell(findIcrewShell("Dear Prudence", 1)!, "scull-1")).toBe("scull-2");
    expect(skillForIcrewShell(findIcrewShell("Light boat- Wright", 1)!, "scull-1")).toBeNull();
    expect(skillForIcrewShell(findIcrewShell("Alliance", 4)!, "scull-3")).toBeUndefined();
  });

  it("seeds every fleet shell into the sample club without inventing private ownership from the list", () => {
    for (const shell of ICREW_SHELL_FLEET) {
      const item = SAMPLE_ITEMS.find((i) => i.name === shell.name && i.classCode === shellClassForSeats(shell.seats));
      expect(item, shell.name).toBeDefined();
      expect(item!.minWeightLbs ?? null).toBe(shell.minWeightLbs);
      expect(item!.maxWeightLbs ?? null).toBe(shell.maxWeightLbs);
      expect(item!.manufacturer ?? null).toBe(shell.manufacturer);
      expect(item!.private).toBeUndefined();
    }
    const heron = SAMPLE_ITEMS.find((i) => i.name === "Heron")!;
    expect(heron).toMatchObject({ classCode: "shell-single", minWeightLbs: 110, maxWeightLbs: 132, manufacturer: null });
    expect(heron.requiredQualification).toBeUndefined();
    expect(SAMPLE_ITEMS.find((i) => i.name === "Osprey")).toBeDefined();
    expect(SAMPLE_ITEMS.find((i) => i.name === "Kestrel")?.private).toEqual({ owners: ["Nora Abernathy"], invited: ["Tomas Vandermeer"] });
  });
});
