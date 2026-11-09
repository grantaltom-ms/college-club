/**
 * The few words on the staff landing page that both the page's engine and its browser-side lists need. They live apart, with no
 * imports, so that the browser bundle does not have to carry the club's whole rules engine for the sake of "9 members".
 */

/** "1 member", "9 members". */
export const memberCount = (n: number) => `${n} ${n === 1 ? "member" : "members"}`;

/** How often the page refreshes itself, in words: 120 is "2 minutes", 60 is "minute", 90 is "90 seconds". */
export function refreshWords(seconds: number): string {
  if (seconds === 60) return "minute";
  return seconds % 60 === 0 ? `${seconds / 60} minutes` : `${seconds} seconds`;
}
