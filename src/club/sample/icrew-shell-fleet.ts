import fleet from "./icrew-shell-fleet.json";

/**
 * The club's shell list from iCrew (Nov 2, 2026): size, skill, weight class in lb, manufacturer.
 * Matched by exact full name + size. A leading "2-6" / "2-7" style prefix is the storage rack
 * location, so full names matter. Weights are only those iCrew had — never invent; null means
 * "weight not on file". "Sykes (70-80kg)" is an eight's name, not a weight. Private vs club is not
 * inferred from this list. Lange/Valiant were marked damaged in iCrew's calendar that day only.
 */

export type IcrewShellSkill = "Nov" | "Int" | "Adv" | "LTR" | "HP";

export interface IcrewShell {
  name: string;
  seats: 1 | 2 | 4 | 8;
  skill: IcrewShellSkill;
  /** Null when iCrew had no weight. A single value is stored as min = max. */
  minWeightLbs: number | null;
  maxWeightLbs: number | null;
  /** Null when the source said "Maker not listed". */
  manufacturer: string | null;
}

const SKILLS = new Set<IcrewShellSkill>(["Nov", "Int", "Adv", "LTR", "HP"]);
const SEATS = new Set([1, 2, 4, 8]);

function readShell(raw: unknown, index: number): IcrewShell {
  const row = raw as Partial<IcrewShell>;
  const where = `icrew-shell-fleet.json shells[${index}]`;
  if (!row || typeof row !== "object") throw new Error(`${where} is empty.`);
  if (typeof row.name !== "string" || row.name.trim() === "") throw new Error(`${where} needs a name.`);
  if (!SEATS.has(row.seats as number)) throw new Error(`${where} (${row.name}): seats must be 1, 2, 4 or 8.`);
  if (!SKILLS.has(row.skill as IcrewShellSkill)) throw new Error(`${where} (${row.name}): skill must be Nov, Int, Adv, LTR or HP.`);
  const min = row.minWeightLbs ?? null;
  const max = row.maxWeightLbs ?? null;
  if ((min == null) !== (max == null)) throw new Error(`${where} (${row.name}): min and max weight must both be set or both null.`);
  if (min != null && max != null) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 50 || max > 800 || min > max) {
      throw new Error(`${where} (${row.name}): weight class must be whole pounds from 50 to 800 with min ≤ max.`);
    }
  }
  if (min === 0 || max === 0) throw new Error(`${where} (${row.name}): do not invent zero for a missing weight.`);
  const manufacturer = row.manufacturer ?? null;
  if (manufacturer !== null && (typeof manufacturer !== "string" || manufacturer.trim() === "" || manufacturer.length > 80)) {
    throw new Error(`${where} (${row.name}): manufacturer must be a short name or null.`);
  }
  return {
    name: row.name.trim(),
    seats: row.seats as 1 | 2 | 4 | 8,
    skill: row.skill as IcrewShellSkill,
    minWeightLbs: min,
    maxWeightLbs: max,
    manufacturer,
  };
}

/** Every shell in the iCrew list, checked once when the module loads. */
export const ICREW_SHELL_FLEET: readonly IcrewShell[] = (() => {
  const shells = (fleet as { shells: unknown[] }).shells.map(readShell);
  if (shells.length !== 103) throw new Error(`icrew-shell-fleet.json must list 103 shells, not ${shells.length}.`);
  const seen = new Set<string>();
  for (const s of shells) {
    const key = `${s.name.toLowerCase()}|${s.seats}`;
    if (seen.has(key)) throw new Error(`Duplicate shell in fleet: "${s.name}" (${s.seats}x). Match by exact full name + size.`);
    seen.add(key);
  }
  const withWeight = shells.filter((s) => s.minWeightLbs != null).length;
  if (withWeight !== 34) throw new Error(`Expected 34 shells with weights, found ${withWeight}.`);
  if (shells.filter((s) => s.seats === 1).length !== 68) throw new Error("Expected 68 singles.");
  if (shells.filter((s) => s.seats === 2).length !== 26) throw new Error("Expected 26 doubles.");
  if (shells.filter((s) => s.seats === 4).length !== 6) throw new Error("Expected 6 fours.");
  if (shells.filter((s) => s.seats === 8).length !== 3) throw new Error("Expected 3 eights.");
  const sykes = shells.find((s) => s.name === "Sykes (70-80kg)");
  if (!sykes || sykes.seats !== 8 || sykes.minWeightLbs != null) {
    throw new Error('"Sykes (70-80kg)" must be an eight with weight not on file (the name is not a weight).');
  }
  return shells;
})();

/** Class code for a shell's seat count, including eights. */
export function shellClassForSeats(seats: 1 | 2 | 4 | 8): "shell-single" | "shell-double" | "shell-quad" | "shell-eight" {
  if (seats === 1) return "shell-single";
  if (seats === 2) return "shell-double";
  if (seats === 4) return "shell-quad";
  return "shell-eight";
}

/**
 * Map iCrew's skill word onto the club's qualification codes. Class defaults stay scull-1/2/3 by size;
 * return `undefined` when the mapped level is the class usual so the item follows its class.
 * LTR → none needed. HP → scull-3 (highest level on file until High Performance is a separate qualification).
 */
export function skillForIcrewShell(shell: IcrewShell, classUsual: string | null): string | null | undefined {
  const mapped: string | null =
    shell.skill === "Nov" ? "scull-1" : shell.skill === "Int" ? "scull-2" : shell.skill === "Adv" ? "scull-3" : shell.skill === "LTR" ? null : "scull-3";
  if (mapped === classUsual) return undefined;
  return mapped;
}

/** Find a fleet row by exact full name and size. */
export function findIcrewShell(name: string, seats: number): IcrewShell | undefined {
  return ICREW_SHELL_FLEET.find((s) => s.name === name && s.seats === seats);
}
