/**
 * Names as the old reservation system wrote them, turned into something a member's record can be matched against.
 *
 * iCrew has names but no emails, and writes them in several ways: "Pat Example", "Pat (Patty) Example", "Pat & Sam Example"
 * for a joint booking, "Sam Example (1)" for the first seat in a boat. A name becomes a *key*: lower case, no accents or
 * punctuation, and only the first and last word ("pat example"), so a middle name or a nickname in brackets does not stop a
 * match. A key is only ever used to find a person, never to show one.
 */

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/** The key for one person's name, or "" when there is nothing usable. A single word is its own key and matches no member. */
export function nameKey(raw: string): string {
  const cleaned = raw
    .replace(/\([^)]*\)/g, " ") // a nickname, a note, or a seat number: "Sam Example (2)"
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[.]/g, " ")
    .replace(/\s*[-–—]\s*/g, "-")
    .replace(/[^a-z0-9 -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") return "";
  const words = cleaned.split(" ").map((w) => w.replace(/^-+|-+$/g, "")).filter((w) => w !== "");
  if (words.length === 0) return "";
  while (words.length > 2 && SUFFIXES.has(words[words.length - 1])) words.pop();
  if (words.length === 1) return words[0];
  return `${words[0]} ${words[words.length - 1]}`;
}

/**
 * What staff typed in a name box, cleaned the same way, for finding every key that starts with it ("pat ex" finds "pat example").
 * Three words or more (a middle name) are reduced to first and last, like a key.
 */
export function searchPrefix(raw: string): string {
  const typed = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[.]/g, " ")
    .replace(/\s*[-–—]\s*/g, "-")
    .replace(/[^a-z0-9 -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return typed.split(" ").length >= 3 ? nameKey(typed) : typed;
}

/** The key for a member of the club. */
export const memberNameKey = (firstName: string, lastName: string) => nameKey(`${firstName} ${lastName}`);

export interface PersonInFile {
  /** The name as it will be shown to staff: tidied, and with a shared last name filled in. */
  name: string;
  key: string;
}

const tidy = (s: string) =>
  s
    .replace(/\(\s*\d+\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The people named in one field. A reservation can name two people: "Pat & Sam Example" or "Pat/Sam Example" (the first
 * shares the last name written after the second), and a list of rowers is separated by commas. Anyone with no usable name is left out.
 */
export function peopleIn(field: string, separators: "booker" | "rowers"): PersonInFile[] {
  const parts = tidy(field)
    .split(separators === "rowers" ? /\s*[,;&/+]\s*/ : /\s*[&/+]\s*/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const wordsOf = (p: string) => p.replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean);
  const out: PersonInFile[] = [];
  parts.forEach((part, i) => {
    let name = part;
    if (wordsOf(part).length === 1) {
      // "Pat & Sam Example": Pat shares the last name written after Sam.
      const later = parts.slice(i + 1).find((p) => wordsOf(p).length >= 2);
      if (later) name = `${part} ${wordsOf(later).at(-1)}`;
    }
    const key = nameKey(name);
    if (key !== "") out.push({ name: name.replace(/\s+/g, " ").trim(), key });
  });
  return out;
}

/** For each key, the ids of every member who has it. A key held by exactly one member can be matched; two or more cannot, because it could be either. */
export function keyOwners(members: { id: string; firstName: string; lastName: string }[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const m of members) {
    const key = memberNameKey(m.firstName, m.lastName);
    if (key === "") continue;
    owners.set(key, [...(owners.get(key) ?? []), m.id]);
  }
  return owners;
}
