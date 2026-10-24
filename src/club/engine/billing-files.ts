import { addDays } from "../time";
import type { BillingLine, BillingRun, BillingRules, Household } from "../types";
import { decimal, lastDayOf, monthLabel, usDate } from "./billing-words";
import { KIND_LABEL } from "./billing";
import { csvCell } from "./rsvp-links";

/**
 * The two files made from a closed month. Both are worked out from the frozen invoice lines, so downloading a month again
 * always gives the same amounts. Nothing here talks to QuickBooks; staff download the files and import them there.
 */

/** QuickBooks Online imports at most this many invoices, and this many rows, in one file. */
export const QBO_MAX_INVOICES = 100;
export const QBO_MAX_ROWS = 1000;

export interface FileSource {
  run: BillingRun;
  /** The run's lines, in the order they were written. */
  lines: BillingLine[];
  households: Household[];
  rules: BillingRules;
}

/** A number for a spreadsheet: never made "safe" with a quotation mark, so a credit stays -20.00. Text is made safe. */
const text = csvCell;

/** The columns named as QuickBooks Online's own invoice import names them, so its mapping step matches them on its own. */
export const QBO_HEADER = ["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "Memo", "Item(Product/Service)", "ItemDescription", "ItemQuantity", "ItemRate", "ItemAmount"];

export interface QboPart {
  /** 1-based. */
  number: number;
  of: number;
  invoices: number;
  /** Data rows, not counting the header. */
  rows: number;
  csv: string;
}

export interface QboFiles {
  parts: QboPart[];
  /** Credit lines left out, because QuickBooks cannot import a negative amount. They are in the plain charges file. */
  creditLines: number;
  creditCents: number;
  /** Invoices left out because every one of their lines was a credit. */
  invoicesLeftOut: number;
}

const byInvoice = (lines: BillingLine[]): Map<string, BillingLine[]> => {
  const out = new Map<string, BillingLine[]>();
  for (const l of lines) out.set(l.invoiceNo, [...(out.get(l.invoiceNo) ?? []), l]);
  return out;
};

/**
 * One invoice per household, a row per line, split into parts QuickBooks will accept (whole invoices only: no more than 100
 * invoices or 999 data rows in a part). Credits are left out, and counted, because QuickBooks does not import them.
 */
export function qboInvoiceFiles(src: FileSource): QboFiles {
  const { run, rules } = src;
  const invoiceDate = lastDayOf(run.month);
  const dueDate = addDays(invoiceDate, rules.defaults.invoiceDueDays);
  const customer = new Map(src.households.map((h) => [h.id, h.displayName]));
  const credits = src.lines.filter((l) => l.amountCents < 0);

  const invoices: string[][] = [];
  let left = 0;
  for (const [invoiceNo, lines] of byInvoice(src.lines)) {
    const positive = lines.filter((l) => l.amountCents >= 0);
    if (positive.length === 0) {
      left += 1;
      continue;
    }
    invoices.push(
      positive.map((l) =>
        [
          text(invoiceNo),
          text(customer.get(l.householdId) ?? ""),
          usDate(invoiceDate),
          usDate(dueDate),
          text(`College Club Seattle ${monthLabel(run.month)}`),
          text(rules.defaults.items[l.kind]),
          text(l.description),
          String(l.quantity),
          decimal(l.unitCents),
          decimal(l.amountCents),
        ].join(","),
      ),
    );
  }

  const parts: string[][][] = [];
  let current: string[][] = [];
  let rows = 0;
  for (const invoice of invoices) {
    if (current.length > 0 && (current.length >= QBO_MAX_INVOICES || rows + invoice.length > QBO_MAX_ROWS - 1)) {
      parts.push(current);
      current = [];
      rows = 0;
    }
    current.push(invoice);
    rows += invoice.length;
  }
  if (current.length > 0) parts.push(current);

  return {
    parts: parts.map((part, i) => ({
      number: i + 1,
      of: parts.length,
      invoices: part.length,
      rows: part.reduce((n, inv) => n + inv.length, 0),
      csv: [QBO_HEADER.join(","), ...part.flat()].join("\r\n") + "\r\n",
    })),
    creditLines: credits.length,
    creditCents: credits.reduce((n, l) => n + l.amountCents, 0),
    invoicesLeftOut: left,
  };
}

export const CHARGES_HEADER = ["Month", "Invoice no", "QuickBooks ID", "Household", "Line", "QuickBooks item", "Description", "Quantity", "Unit price", "Amount", "Taxable", "Adjustment"];

/** Every line of the month, credits and the tax flag included: a complete record to read, check, or enter by hand. */
export function chargesCsv(src: FileSource): string {
  const household = new Map(src.households.map((h) => [h.id, h]));
  const rows = src.lines.map((l) => {
    const h = household.get(l.householdId);
    return [
      src.run.month,
      text(l.invoiceNo),
      text(h?.quickbooksId ?? ""),
      text(h?.displayName ?? ""),
      text(KIND_LABEL[l.kind]),
      text(src.rules.defaults.items[l.kind]),
      text(l.description),
      String(l.quantity),
      decimal(l.unitCents),
      decimal(l.amountCents),
      l.taxable ? "Yes" : "No",
      l.adjustment ? "Yes" : "No",
    ].join(",");
  });
  return [CHARGES_HEADER.join(","), ...rows].join("\r\n") + "\r\n";
}
