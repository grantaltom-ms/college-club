/**
 * Reading the boxes on the damage report screens. Staff type hours as a number ("1.5") and the cost in dollars ("12.50"); the
 * engine keeps minutes and cents. A mistake comes back as a sentence, never as a silent guess.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** "1.5" hours becomes 90 minutes. Empty means not said. */
export function hoursToMinutes(text: string): Parsed<number | null> {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return { ok: false, message: "Hours spent should be a number like 1.5." };
  return { ok: true, value: Math.round(Number(t) * 60) };
}

/** "$12.50" or "1,200" dollars becomes cents. Empty means not said. */
export function dollarsToCents(text: string): Parsed<number | null> {
  const t = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (t === "") return { ok: true, value: null };
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return { ok: false, message: "The cost should be a number of dollars like 12.50." };
  return { ok: true, value: Math.round(Number(t) * 100) };
}
