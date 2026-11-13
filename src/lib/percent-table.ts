/**
 * "Show as %" for a chart card's table: turns its numbers into each number's share of a total.
 *
 * Which total depends on the table, so each chart says it:
 * - `"column"`: each number's share of its column (e.g. each month's share of the year's outings).
 * - `"row"`: each number's share of the converted cells in its row added up (e.g. each hour's share of a day).
 * - a column number: each number's share of that row's total in that column (e.g. each type's share
 *   of the month's "Total"); that column then reads 100%.
 *
 * Cells are what the table already shows ("1,234", "12 (so far)", "—"). The leading number is read and
 * anything after it is kept ("8% (part month)"); a cell with no number is left as it is.
 */

export type TableCell = string | number;
export interface CardTable {
  headers: string[];
  rows: TableCell[][];
}

export interface PercentSpec {
  /** "column" for each column's own sum, "row" for the row's converted cells added up, or the index of the column that holds each row's total. */
  of: "column" | "row" | number;
  /** The columns to turn into percentages. Others (labels, rates already in %, change text) are left alone. */
  columns: number[];
  /** One plain sentence under the table saying what the percentages are of. */
  note: string;
}

const LEADING = /^\s*(-?\d[\d,]*(?:\.\d+)?)([^]*)$/;

/** The leading number of a cell and the words after it, or null when it does not start with a number. */
export function readCell(cell: TableCell): { value: number; rest: string } | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? { value: cell, rest: "" } : null;
  const m = LEADING.exec(cell);
  if (!m) return null;
  // A cell that is already a percentage or a money figure is not a count.
  if (/^\s*%/.test(m[2])) return null;
  return { value: Number(m[1].replace(/,/g, "")), rest: m[2] };
}

/** A share as a whole percent; a small share that rounds to 0 reads "<1%", and nothing out of nothing reads "—". */
export function formatShare(value: number, total: number): string {
  if (total === 0) return "—";
  const p = (value / total) * 100;
  const r = Math.round(p);
  if (r === 0 && p > 0) return "<1%";
  return `${r}%`;
}

export function toPercentTable(table: CardTable, spec: PercentSpec): CardTable {
  const convert = new Set(spec.columns);
  const columnTotals = new Map<number, number>();
  if (spec.of === "column") {
    for (const c of convert) {
      columnTotals.set(
        c,
        table.rows.reduce((sum, row) => sum + (readCell(row[c] ?? "")?.value ?? 0), 0),
      );
    }
  }
  const rows = table.rows.map((row) => {
    const rowTotal =
      typeof spec.of === "number"
        ? readCell(row[spec.of] ?? "")?.value ?? null
        : spec.of === "row"
          ? [...convert].reduce((sum, c) => sum + (readCell(row[c] ?? "")?.value ?? 0), 0)
          : null;
    return row.map((cell, c) => {
      if (!convert.has(c)) return cell;
      const parsed = readCell(cell);
      if (!parsed) return cell;
      const total = spec.of === "column" ? columnTotals.get(c) ?? 0 : rowTotal;
      if (total === null) return cell;
      return `${formatShare(parsed.value, total)}${parsed.rest}`;
    });
  });
  return { headers: table.headers, rows };
}

/** Columns from `from` to the last one, skipping any listed in `except`. */
export function columnsFrom(table: CardTable, from: number, except: number[] = []): number[] {
  const out: number[] = [];
  for (let i = from; i < table.headers.length; i++) if (!except.includes(i)) out.push(i);
  return out;
}
