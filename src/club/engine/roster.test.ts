import { describe, expect, it } from "vitest";
import { MAX_ROSTER_BYTES, MAX_ROSTER_ROWS, ROSTER_COLUMNS, ROSTER_TEMPLATE, parseJoinDate, readRoster } from "./roster";

const TODAY = "2026-10-28";
const HEADER = ROSTER_COLUMNS.join(",");
const file = (...rows: string[]) => [HEADER, ...rows].join("\n");
const row = (o: Partial<Record<"id" | "name" | "type" | "joined" | "first" | "last" | "email" | "phone" | "role", string>> = {}) =>
  [o.id ?? "1001", o.name ?? "The Aldridge household", o.type ?? "Resident", o.joined ?? "2015-06-01", o.first ?? "Una", o.last ?? "Aldridge", o.email ?? "una@example.com", o.phone ?? "", o.role ?? ""].join(",");
const read = (text: string) => readRoster(text, TODAY);

describe("reading a roster file: a good file", () => {
  it("groups the rows of a household, primary adult first, with each adult's details", () => {
    const r = read(
      file(
        row({ id: "1001", first: "Una", email: "una@example.com", phone: "206-555-0101" }),
        row({ id: "1001", first: "Vic", email: "vic@example.com" }),
        row({ id: "1002", name: "The Bowman household", type: "Intermediate", joined: "3/14/2022", first: "Wes", last: "Bowman", email: "wes@example.com" }),
      ),
    );
    expect(r.problems).toEqual([]);
    expect(r.rowCount).toBe(3);
    expect(r.households).toEqual([
      {
        quickbooksId: "1001",
        displayName: "The Aldridge household",
        membershipType: "Resident",
        joinedOn: "2015-06-01",
        adults: [
          { row: 2, firstName: "Una", lastName: "Aldridge", email: "una@example.com", phone: "206-555-0101", role: "primary" },
          { row: 3, firstName: "Vic", lastName: "Aldridge", email: "vic@example.com", phone: "", role: "additional" },
        ],
      },
      { quickbooksId: "1002", displayName: "The Bowman household", membershipType: "Intermediate", joinedOn: "2022-03-14", adults: [{ row: 4, firstName: "Wes", lastName: "Bowman", email: "wes@example.com", phone: "", role: "primary" }] },
    ]);
  });

  it("makes the first adult primary unless a row says otherwise, and puts the marked primary first", () => {
    const none = read(file(row({ first: "Una" }), row({ first: "Vic", email: "vic@example.com" })));
    expect(none.households[0].adults.map((a) => [a.firstName, a.role])).toEqual([["Una", "primary"], ["Vic", "additional"]]);
    const marked = read(file(row({ first: "Una" }), row({ first: "Vic", email: "vic@example.com", role: "primary" })));
    expect(marked.households[0].adults.map((a) => [a.firstName, a.role])).toEqual([["Vic", "primary"], ["Una", "additional"]]);
    const spelled = read(file(row({ first: "Una", role: "ADDITIONAL" }), row({ first: "Vic", email: "vic@example.com", role: " Primary " })));
    expect(spelled.households[0].adults.map((a) => a.firstName)).toEqual(["Vic", "Una"]);
  });

  it("understands the membership types however they are spelled", () => {
    for (const [typed, type] of [["resident", "Resident"], ["RESIDENT", "Resident"], ["Intermediate", "Intermediate"], ["Non-Resident", "Non-Resident"], ["non resident", "Non-Resident"], ["NonResident", "Non-Resident"], ["non_resident", "Non-Resident"]] as const) {
      expect(read(file(row({ type: typed }))).households[0].membershipType, typed).toBe(type);
    }
  });

  it("understands join dates written 2020-01-15 or 1/15/2020, with or without leading zeros", () => {
    for (const [typed, iso] of [["2020-01-15", "2020-01-15"], ["1/15/2020", "2020-01-15"], ["01/05/2020", "2020-01-05"], ["12/1/1999", "1999-12-01"], ["2026-10-28", "2026-10-28"]] as const) {
      expect(read(file(row({ joined: typed }))).households[0].joinedOn, typed).toBe(iso);
    }
  });

  it("does not mind the order of the columns, how they are spelled, extra columns, blank rows, or spaces around cells", () => {
    const text = [
      "Customer, e-mail ,First,Last,Balance,Quickbooks ID,MEMBERSHIP,Date Joined,Notes",
      "The Aldridge household, una@example.com ,Una,Aldridge,$0.00,1001,Resident,6/1/2015,whatever",
      ",,,,,,,,",
      "",
    ].join("\r\n");
    const r = read(text);
    expect(r.problems).toEqual([]);
    expect(r.ignoredColumns).toEqual(["Balance", "Notes"]);
    expect(r.rowCount).toBe(1);
    expect(r.households[0]).toMatchObject({ quickbooksId: "1001", displayName: "The Aldridge household", membershipType: "Resident", joinedOn: "2015-06-01" });
    expect(r.households[0].adults[0]).toMatchObject({ email: "una@example.com", phone: "", role: "primary" });
  });

  it("reads quoted cells, an invisible start-of-file marker and numbers used as QuickBooks IDs", () => {
    const r = read(`﻿${HEADER}\r\n1042,"The Smith, Jones household",Resident,2015-06-01,Una,"O'Brien, Jr.",una@example.com,"(206) 555-0101",\r\n`);
    expect(r.problems).toEqual([]);
    expect(r.households[0]).toMatchObject({ quickbooksId: "1042", displayName: "The Smith, Jones household" });
    expect(r.households[0].adults[0]).toMatchObject({ lastName: "O'Brien, Jr.", phone: "(206) 555-0101" });
  });

  it("a file with only a header has no households and no problems (the import says there is nothing to add)", () => {
    expect(read(HEADER)).toMatchObject({ households: [], problems: [], rowCount: 0 });
  });
});

describe("reading a roster file: the template", () => {
  it("has every column, and its example rows are refused so nobody adds them by accident", () => {
    const r = read(ROSTER_TEMPLATE);
    expect(ROSTER_TEMPLATE.split("\r\n")[0]).toBe("QuickBooks ID,Household name,Membership type,Joined,First name,Last name,Email,Phone,Role");
    expect(r.households).toEqual([]);
    expect(r.problems).toEqual([
      `Row 2: "EXAMPLE-1" is one of the template's example rows. Delete the example rows before uploading.`,
      `Row 3: "EXAMPLE-1" is one of the template's example rows. Delete the example rows before uploading.`,
      `Row 4: "EXAMPLE-2" is one of the template's example rows. Delete the example rows before uploading.`,
    ]);
  });

  it("is refused in any capitals", () => {
    expect(read(file(row({ id: "example-2" }))).problems[0]).toContain("one of the template's example rows");
  });

  it("is otherwise a good file: with real IDs and the examples' details the rows read fine", () => {
    const real = ROSTER_TEMPLATE.replaceAll("EXAMPLE-1", "9001").replaceAll("EXAMPLE-2", "9002");
    const r = read(real);
    expect(r.problems).toEqual([]);
    expect(r.households.map((h) => [h.quickbooksId, h.adults.length, h.membershipType, h.joinedOn])).toEqual([["9001", 2, "Resident", "2015-06-01"], ["9002", 1, "Intermediate", "2022-03-14"]]);
  });
});

describe("reading a roster file: the header", () => {
  it("names every missing column and shows the columns it did find", () => {
    const r = read("Customer,Balance\nThe Aldridge household,$0");
    expect(r.households).toEqual([]);
    expect(r.problems).toEqual([
      'The file has no column for "QuickBooks ID", "Membership type", "Joined", "First name", "Last name", "Email". It has: "Customer", "Balance". It needs: QuickBooks ID, Household name, Membership type, Joined, First name, Last name, Email (Phone and Role are optional).',
    ]);
  });

  it("refuses two columns that mean the same thing, naming both", () => {
    const r = read(`${HEADER},Customer\n${row()},x`);
    expect(r.problems).toEqual(['Two columns both mean "Household name": "Household name" and "Customer". Keep only one.']);
  });

  it("refuses an empty file, and files that are not CSV text, in plain words", () => {
    expect(read("").problems).toEqual(["The file is empty."]);
    expect(read("\n\n  \n").problems).toEqual(["The file is empty."]);
    expect(read("PK\u0003\u0004binarystuff").problems[0]).toContain("That looks like an Excel file, not a CSV.");
    expect(read(`${HEADER}\n\u0000\u0000`).problems[0]).toContain("That is not a plain CSV text file.");
    expect(read('a,"never closed').problems[0]).toContain("A quotation mark in the file is never closed.");
  });

  it("refuses a file that is too big, or has too many rows", () => {
    expect(read("x".repeat(MAX_ROSTER_BYTES + 1)).problems[0]).toBe("The file is too big: it can be up to 500 KB, which is about 3,000 people.");
    const rows = Array.from({ length: MAX_ROSTER_ROWS + 1 }, (_, i) => row({ id: String(i), email: `p${i}@example.com` }));
    expect(read(file(...rows)).problems).toEqual([`The file has ${MAX_ROSTER_ROWS + 1} rows. It can have up to ${MAX_ROSTER_ROWS}.`]);
    expect(read(file(...rows.slice(0, MAX_ROSTER_ROWS))).problems).toEqual([]);
  });
});

describe("reading a roster file: mistakes in rows, with the row number as a spreadsheet shows it", () => {
  it("says what is wrong with each field", () => {
    const cases: [string, string][] = [
      [row({ id: "" }), "Row 2: QuickBooks ID is empty. Every row needs the household's QuickBooks ID."],
      [row({ id: "x".repeat(101) }), "Row 2: QuickBooks ID is longer than 100 characters."],
      [row({ name: "" }), "Row 2: Household name is empty."],
      [row({ name: "x".repeat(121) }), "Row 2: Household name is longer than 120 characters."],
      [row({ type: "" }), "Row 2: Membership type is empty. Write Resident, Intermediate or Non-Resident."],
      [row({ type: "Residnt" }), 'Row 2: Membership type "Residnt" is not Resident, Intermediate or Non-Resident.'],
      [row({ joined: "" }), "Row 2: Joined is empty. Every household needs the date it joined."],
      [row({ joined: "last June" }), 'Row 2: Joined "last June" is not a date. Write it like 2020-01-15 or 1/15/2020.'],
      [row({ first: "" }), "Row 2: First name is required."],
      [row({ last: "" }), "Row 2: Last name is required."],
      [row({ email: "" }), "Row 2: Email is required."],
      [row({ email: "una.example.com" }), 'Row 2: "una.example.com" does not look like an email address.'],
      [row({ email: "una..a@example.com" }), 'Row 2: "una..a@example.com" does not look like an email address.'],
      [row({ role: "boss" }), 'Row 2: Role "boss" is not Primary or Additional. Leave it blank if you are not sure.'],
    ];
    for (const [text, problem] of cases) expect(read(file(text)).problems, problem).toEqual([problem]);
  });

  it("refuses dates that are not real, are two-digit, or are before 1900 or in the future", () => {
    for (const [joined, problem] of [
      ["2/30/2020", '"2/30/2020" is not a real date.'],
      ["13/1/2020", '"13/1/2020" is not a real date.'],
      ["2020-02-30", '"2020-02-30" is not a real date.'],
      ["1/15/20", '"1/15/20" is not a date. Write it like 2020-01-15 or 1/15/2020.'],
      ["15/01/2020", '"15/01/2020" is not a real date.'],
      ["1899-12-31", '"1899-12-31" is before 1900. Check the year.'],
      ["2026-10-29", '"2026-10-29" is in the future. Check the date.'],
      ["10/29/2026", '"10/29/2026" is in the future. Check the date.'],
    ] as const) {
      expect(read(file(row({ joined }))).problems, joined).toEqual([`Row 2: Joined ${problem}`]);
    }
    expect(read(file(row({ joined: "2026-10-28" }))).problems).toEqual([]);
    expect("problem" in parseJoinDate("1/1/2000", "2000-01-01")).toBe(false);
    expect("problem" in parseJoinDate("1/2/2000", "2000-01-01")).toBe(true);
  });

  it("reports every problem in the file, in order, not just the first", () => {
    const r = read(file(row({ type: "x" }), row({ id: "1002", email: "bad" }), row({ id: "1003" }), row({ id: "1004", joined: "never" })));
    expect(r.problems).toEqual([
      'Row 2: Membership type "x" is not Resident, Intermediate or Non-Resident.',
      'Row 3: "bad" does not look like an email address.',
      'Row 5: Joined "never" is not a date. Write it like 2020-01-15 or 1/15/2020.',
    ]);
    expect(r.households.map((h) => h.quickbooksId)).toEqual(["1003"]);
  });

  it("reports several problems in one row", () => {
    expect(read(file(row({ type: "x", joined: "never", email: "bad" }))).problems).toHaveLength(3);
  });

  it("refuses a household whose rows disagree on its name, type or join date, naming the rows", () => {
    const r = read(file(row({ first: "Una" }), row({ first: "Vic", email: "vic@example.com", name: "The Other household", type: "Intermediate", joined: "2016-01-01" })));
    expect(r.problems).toEqual([
      'Rows 2 and 3 are both QuickBooks ID 1001 but give a different household name ("The Aldridge household" and "The Other household"). A household must be the same on every row.',
      'Rows 2 and 3 are both QuickBooks ID 1001 but give a different membership type ("Resident" and "Intermediate"). A household must be the same on every row.',
      'Rows 2 and 3 are both QuickBooks ID 1001 but give a different join date ("2015-06-01" and "2016-01-01"). A household must be the same on every row.',
    ]);
  });

  it("refuses the same person listed twice in a household, and two primary adults", () => {
    expect(read(file(row({ first: "Una" }), row({ first: "una", last: "ALDRIDGE" }))).problems).toEqual(["Row 3: una ALDRIDGE is already listed for this household on row 2."]);
    const two = read(file(row({ first: "Una", role: "Primary" }), row({ first: "Vic", email: "vic@example.com", role: "primary" })));
    expect(two.problems).toEqual(["Rows 2 and 3 are all marked Primary for QuickBooks ID 1001. A household has one primary adult."]);
    // The same name with a different address is a different person.
    expect(read(file(row({ first: "Una" }), row({ first: "Una", email: "una.two@example.com" }))).problems).toEqual([]);
  });

  it("lets partners share an email address", () => {
    const r = read(file(row({ first: "Una", email: "family@example.com" }), row({ first: "Vic", email: "family@example.com" })));
    expect(r.problems).toEqual([]);
    expect(r.households[0].adults).toHaveLength(2);
  });
});
