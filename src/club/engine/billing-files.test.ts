import { describe, expect, it } from "vitest";
import { BILLING_RULES } from "../settings/billing-rules";
import type { BillingLine, BillingRun, Household } from "../types";
import { CHARGES_HEADER, QBO_HEADER, QBO_MAX_INVOICES, QBO_MAX_ROWS, chargesCsv, qboInvoiceFiles, type FileSource } from "./billing-files";

const run: BillingRun = { id: "run-1", month: "2026-09", createdAt: "2026-10-02T20:00:00.000Z", createdBy: { kind: "staff", label: "Test staff" }, invoiceCount: 0, totalCents: 0 };

const household = (n: number, extra: Partial<Household> = {}): Household => ({
  id: `h${n}`,
  displayName: `The Number${n} household`,
  membershipType: "Resident",
  status: "active",
  joinedOn: "2020-01-01",
  endedOn: null,
  quickbooksId: `QB-${n}`,
  notes: "",
  ...extra,
});

let lineNo = 0;
const line = (n: number, over: Partial<BillingLine> = {}): BillingLine => {
  const quantity = over.quantity ?? 1;
  const unitCents = over.unitCents ?? 15450;
  return {
    id: `l${++lineNo}`,
    runId: run.id,
    householdId: `h${n}`,
    invoiceNo: `2609-${String(n).padStart(4, "0")}`,
    kind: "dues",
    description: "September 2026 dues (Resident)",
    quantity,
    unitCents,
    amountCents: quantity * unitCents,
    taxable: false,
    adjustment: false,
    ...over,
  };
};

const source = (lines: BillingLine[], households: Household[]): FileSource => ({ run, lines, households, rules: BILLING_RULES });
const rowsOf = (csv: string) => csv.trimEnd().split("\r\n");

describe("the QuickBooks Online invoice file", () => {
  it("has one row per line, carrying the whole invoice header on each, in QuickBooks' own column names", () => {
    const files = qboInvoiceFiles(
      source(
        [
          line(1),
          line(1, { kind: "event_tickets", description: "Members' Dinner, Sep 20, 2026: Ada Quill, party of 3", quantity: 3, unitCents: 4500 }),
          line(1, { kind: "bar", description: "Bar: 4 charges in September 2026", unitCents: 4650, taxable: true }),
        ],
        [household(1)],
      ),
    );
    expect(files.parts).toHaveLength(1);
    const rows = rowsOf(files.parts[0].csv);
    expect(rows[0]).toBe(QBO_HEADER.join(","));
    expect(QBO_HEADER).toEqual(["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "Memo", "Item(Product/Service)", "ItemDescription", "ItemQuantity", "ItemRate", "ItemAmount"]);
    expect(rows.slice(1)).toEqual([
      "2609-0001,The Number1 household,09/30/2026,10/15/2026,College Club Seattle September 2026,Membership Dues,September 2026 dues (Resident),1,154.50,154.50",
      "2609-0001,The Number1 household,09/30/2026,10/15/2026,College Club Seattle September 2026,Event Tickets,\"Members' Dinner, Sep 20, 2026: Ada Quill, party of 3\",3,45.00,135.00",
      "2609-0001,The Number1 household,09/30/2026,10/15/2026,College Club Seattle September 2026,Bar Sales,Bar: 4 charges in September 2026,1,46.50,46.50",
    ]);
    expect(files.parts[0]).toMatchObject({ number: 1, of: 1, invoices: 1, rows: 3 });
  });

  it("dates every invoice the last day of the month, due the number of days later that the rules say, across a year end", () => {
    const december: BillingRun = { ...run, month: "2026-12" };
    const files = qboInvoiceFiles({ run: december, lines: [line(1)], households: [household(1)], rules: BILLING_RULES });
    expect(rowsOf(files.parts[0].csv)[1]).toContain(",12/31/2026,01/15/2027,");
    const slower = { ...BILLING_RULES, defaults: { ...BILLING_RULES.defaults, invoiceDueDays: 30 } };
    expect(rowsOf(qboInvoiceFiles({ ...source([line(1)], [household(1)]), rules: slower }).parts[0].csv)[1]).toContain(",09/30/2026,10/30/2026,");
  });

  it("uses the QuickBooks names from the rules for each kind of line", () => {
    const renamed = { ...BILLING_RULES, defaults: { ...BILLING_RULES.defaults, items: { ...BILLING_RULES.defaults.items, dues: "Income:Dues" } } };
    expect(rowsOf(qboInvoiceFiles({ ...source([line(1)], [household(1)]), rules: renamed }).parts[0].csv)[1]).toContain(",Income:Dues,");
  });

  it("leaves credits out and counts them, and leaves out an invoice that is nothing but credits", () => {
    const files = qboInvoiceFiles(
      source(
        [line(1), line(1, { kind: "dues", description: "Adjustment: double charge", unitCents: -2000, amountCents: -2000, adjustment: true }), line(2, { unitCents: -500, amountCents: -500, adjustment: true, description: "Adjustment: refund" })],
        [household(1), household(2)],
      ),
    );
    expect(files.parts).toHaveLength(1);
    expect(rowsOf(files.parts[0].csv)).toHaveLength(2);
    expect(files.parts[0].csv).not.toContain("-20.00");
    expect(files).toMatchObject({ creditLines: 2, creditCents: -2500, invoicesLeftOut: 1 });
  });

  it("makes no parts at all for a month with nothing to import", () => {
    expect(qboInvoiceFiles(source([], [])).parts).toEqual([]);
    expect(qboInvoiceFiles(source([line(1, { unitCents: -500, amountCents: -500, adjustment: true })], [household(1)])).parts).toEqual([]);
  });

  it("splits into parts of at most 100 invoices, whole invoices only, in order", () => {
    const n = QBO_MAX_INVOICES * 2 + 30;
    const households = Array.from({ length: n }, (_, i) => household(i + 1));
    const files = qboInvoiceFiles(source(households.map((h) => line(Number(h.id.slice(1)))), households));
    expect(files.parts.map((p) => p.invoices)).toEqual([100, 100, 30]);
    expect(files.parts.map((p) => [p.number, p.of])).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(files.parts.every((p) => rowsOf(p.csv)[0] === QBO_HEADER.join(","))).toBe(true);
    const numbers = files.parts.flatMap((p) => rowsOf(p.csv).slice(1).map((r) => r.split(",")[0]));
    expect(numbers).toEqual(households.map((h) => `2609-${String(Number(h.id.slice(1))).padStart(4, "0")}`));
    expect(new Set(numbers).size).toBe(n);
  });

  it("starts a new part before a file would pass the row limit, never splitting an invoice", () => {
    // 90 invoices of 12 lines each is 1,080 rows: too many for one file, though only 90 invoices.
    const households = Array.from({ length: 90 }, (_, i) => household(i + 1));
    const lines = households.flatMap((h) => Array.from({ length: 12 }, (_, k) => line(Number(h.id.slice(1)), { description: `Line ${k + 1}` })));
    const files = qboInvoiceFiles(source(lines, households));
    expect(files.parts.length).toBe(2);
    for (const part of files.parts) {
      expect(part.rows).toBeLessThan(QBO_MAX_ROWS);
      expect(rowsOf(part.csv).length).toBe(part.rows + 1);
      expect(part.rows % 12).toBe(0);
    }
    expect(files.parts.reduce((n, p) => n + p.invoices, 0)).toBe(90);
    expect(files.parts.reduce((n, p) => n + p.rows, 0)).toBe(1080);
  });

  it("keeps a part to 999 data rows, so the file with its header is never more than the 1,000 QuickBooks takes", () => {
    const lines = (n: number, count: number) => Array.from({ length: count }, (_, k) => line(n, { description: `Line ${k + 1}` }));
    const exactly = qboInvoiceFiles(source([...lines(1, 998), ...lines(2, 1)], [household(1), household(2)]));
    expect(exactly.parts.map((p) => p.rows)).toEqual([999]);
    const one = qboInvoiceFiles(source([...lines(1, 999), ...lines(2, 1)], [household(1), household(2)]));
    expect(one.parts.map((p) => p.rows)).toEqual([999, 1]);
    expect(rowsOf(one.parts[0].csv)).toHaveLength(1000);
  });

  it("keeps a line of zero dollars, which is not a credit", () => {
    const files = qboInvoiceFiles(source([line(1), line(1, { kind: "bar", description: "Bar: 1 charge in September 2026", unitCents: 0 })], [household(1)]));
    expect(files.creditLines).toBe(0);
    expect(files.creditCents).toBe(0);
    expect(rowsOf(files.parts[0].csv)).toHaveLength(3);
    expect(rowsOf(files.parts[0].csv)[2]).toContain(",Bar Sales,Bar: 1 charge in September 2026,1,0.00,0.00");
    // An invoice that is only a zero-dollar line is still an invoice.
    const only = qboInvoiceFiles(source([line(2, { unitCents: 0 })], [household(2)]));
    expect(only.invoicesLeftOut).toBe(0);
    expect(only.parts).toHaveLength(1);
  });

  it("puts an invoice too big for any file in a part of its own instead of looping or losing it", () => {
    const lines = Array.from({ length: 1200 }, (_, k) => line(1, { description: `Line ${k + 1}` }));
    const files = qboInvoiceFiles(source([...lines, line(2)], [household(1), household(2)]));
    expect(files.parts.map((p) => p.invoices)).toEqual([1, 1]);
    expect(files.parts[0].rows).toBe(1200);
  });

  it("quotes names and notes with commas or quotation marks, and makes text safe against being read as a formula", () => {
    const files = qboInvoiceFiles(
      source([line(1, { description: '=HYPERLINK("http://evil","click")' }), line(1, { description: "-2+3 cash" }), line(1, { description: 'Say "hi", please' })], [household(1, { displayName: "The O'Brien, Smith household" })]),
    );
    const csv = files.parts[0].csv;
    expect(csv).toContain('"The O\'Brien, Smith household"');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(csv).toContain("'-2+3 cash");
    expect(csv).toContain('"Say ""hi"", please"');
  });
});

describe("the plain charges file", () => {
  it("lists every line of every household, credits and the tax flag included, with the QuickBooks ID", () => {
    const csv = chargesCsv(
      source(
        [
          line(1),
          line(1, { kind: "bar", description: "Bar: 2 charges in September 2026", unitCents: 2100, taxable: true }),
          line(1, { kind: "dues", description: "Adjustment: double charge", unitCents: -2000, amountCents: -2000, adjustment: true }),
          line(2, { kind: "visitor_fees", description: "Visitor fee: 6 visitors on Sep 6, 2026 (Dee Reed)", quantity: 6, unitCents: 1000 }),
        ],
        [household(1), household(2)],
      ),
    );
    const rows = rowsOf(csv);
    expect(rows[0]).toBe(CHARGES_HEADER.join(","));
    expect(rows.slice(1)).toEqual([
      "2026-09,2609-0001,QB-1,The Number1 household,Dues,Membership Dues,September 2026 dues (Resident),1,154.50,154.50,No,No",
      "2026-09,2609-0001,QB-1,The Number1 household,Bar,Bar Sales,Bar: 2 charges in September 2026,1,21.00,21.00,Yes,No",
      "2026-09,2609-0001,QB-1,The Number1 household,Dues,Membership Dues,Adjustment: double charge,1,-20.00,-20.00,No,Yes",
      '2026-09,2609-0002,QB-2,The Number2 household,Visitor fees,Guest Fees,"Visitor fee: 6 visitors on Sep 6, 2026 (Dee Reed)",6,10.00,60.00,No,No',
    ]);
  });

  it("keeps a credit a plain negative number, but makes text that starts with a minus safe", () => {
    const csv = chargesCsv(source([line(1, { unitCents: -2000, amountCents: -2000, adjustment: true, description: "-5 off" })], [household(1)]));
    expect(rowsOf(csv)[1]).toContain(",'-5 off,1,-20.00,-20.00,");
  });

  it("is only the header for a month with no lines, and always ends with a line break", () => {
    expect(chargesCsv(source([], []))).toBe(`${CHARGES_HEADER.join(",")}\r\n`);
    expect(chargesCsv(source([line(1)], [household(1)])).endsWith("\r\n")).toBe(true);
  });

  it("is the same every time it is made from the same lines", () => {
    const s = source([line(1), line(2)], [household(1), household(2)]);
    expect(chargesCsv(s)).toBe(chargesCsv(s));
    expect(qboInvoiceFiles(s).parts[0].csv).toBe(qboInvoiceFiles(s).parts[0].csv);
  });
});
