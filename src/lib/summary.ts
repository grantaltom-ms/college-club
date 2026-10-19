/** Plain-language pieces for the summary page, kept apart from the page so they can be tested. */

/** "+10%" or "−24%" (a true minus sign), or "no change". */
export function fmtChange(change: number): string {
  if (change === 0) return "no change";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}%`;
}

export interface StoryInput {
  /** Door entries, this year against last, percent. */
  doorChange: number | null;
  /** Club shell outings so far this year against the same dates last year, percent. */
  shellChange: number | null;
  /** Different members who took a club shell out, this year and the same dates last year. */
  rowersNow: number | null;
  rowersBefore: number | null;
}

/** The sentence a board member should read first: how building use and rowing are moving against last year. */
export function storyLines(s: StoryInput): string[] {
  const lines: string[] = [];
  if (s.doorChange !== null && s.shellChange !== null) {
    const rowers =
      s.rowersNow !== null && s.rowersBefore !== null && s.rowersBefore > s.rowersNow
        ? `, and ${s.rowersBefore - s.rowersNow} fewer members took one out`
        : "";
    if (s.doorChange > 0 && s.shellChange < 0) {
      lines.push(
        `The building is busier than last year, but fewer members are rowing club boats. Door entries are up ${s.doorChange}% while club shell outings are down ${Math.abs(s.shellChange)}%${rowers}.`,
      );
    } else {
      const dir = (n: number) => (n >= 0 ? `up ${n}%` : `down ${Math.abs(n)}%`);
      lines.push(`Door entries are ${dir(s.doorChange)} on last year and club shell outings are ${dir(s.shellChange)}${rowers}.`);
    }
  }
  return lines;
}
