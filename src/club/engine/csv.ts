import { ClubError } from "../errors";

/**
 * Reads comma-separated text, the kind a spreadsheet saves as "CSV", into rows of cells. Handles quoted cells (with commas,
 * line breaks and doubled quotation marks inside), Windows, Mac and Linux line endings, and the invisible marker some
 * spreadsheets put at the start of a file. A quotation mark that is never closed is refused in words.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        cell += c;
        i += 1;
      }
      continue;
    }
    if (c === '"' && cell === "") {
      // A quotation mark only opens a quoted cell at the very start of the cell.
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      i += 1;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else {
      cell += c;
      i += 1;
    }
  }
  if (inQuotes) throw new ClubError("invalid", "A quotation mark in the file is never closed. Open the file in a spreadsheet and save it again as CSV.");
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
