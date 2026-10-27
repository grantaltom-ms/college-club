import { describe, expect, it } from "vitest";
import { icrewCsv, booking } from "../sample/icrew";
import { ICREW_COLUMNS, ICREW_TEMPLATE, MAX_HISTORY_BYTES, MAX_HISTORY_PROBLEMS, MAX_HISTORY_ROWS, parseIcrewClock, parseIcrewDay, readIcrew, rowKeyOf } from "./icrew";

const TODAY = "2026-12-01";
const HEADER = ICREW_COLUMNS.join(",");
const one = (over: Parameters<typeof booking>[1], day = "2026-03-09") => icrewCsv([booking(day, over)]);

describe("reading iCrew's Reservations report", () => {
  it("reads a booking with every column", () => {
    const r = readIcrew(
      icrewCsv([booking("2026-01-05", { id: 123456, item: "Cormorant", oars: "Green C2", by: "Pat Example", rowers: "Pat Example (1),Sam Example (2)", bookedOn: "01-02-2026", bookedAt: "09:15:30", out: "7:05am", in: "7:58am" })]),
      TODAY,
    );
    expect(r.problems).toEqual([]);
    expect(r.rowCount).toBe(1);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row).toMatchObject({ row: 2, sourceId: "123456", day: "2026-01-05", itemType: "Shell", itemName: "Cormorant", oars: "Green C2", bookedBy: "Pat Example", rowers: "Pat Example (1),Sam Example (2)", outText: "7:05am", inText: "7:58am" });
    // January is Pacific Standard Time, eight hours behind UTC.
    expect(row.startsAt).toBe("2026-01-05T15:00:00.000Z");
    expect(row.endsAt).toBe("2026-01-05T16:00:00.000Z");
    expect(row.bookedAt).toBe("2026-01-02T17:15:30.000Z");
    expect(row.people).toEqual([
      { name: "Pat Example", key: "pat example", role: "booker" },
      { name: "Pat Example", key: "pat example", role: "rower" },
      { name: "Sam Example", key: "sam example", role: "rower" },
    ]);
  });

  it("keeps the Pacific clock across both clock changes", () => {
    // Sunday Mar 8, 2026 springs forward at 2 am: 7 am that day is already daylight time.
    expect(readIcrew(one({ id: 1, date: "03-08-2026" }, "2026-03-08"), TODAY).rows[0].startsAt).toBe("2026-03-08T14:00:00.000Z");
    expect(readIcrew(one({ id: 1 }, "2026-03-07"), TODAY).rows[0].startsAt).toBe("2026-03-07T15:00:00.000Z");
    // Sunday Nov 1, 2026 falls back: 7 am that day is standard time again.
    expect(readIcrew(one({ id: 1 }, "2026-11-01"), TODAY).rows[0].startsAt).toBe("2026-11-01T15:00:00.000Z");
    expect(readIcrew(one({ id: 1 }, "2026-10-31"), TODAY).rows[0].startsAt).toBe("2026-10-31T14:00:00.000Z");
  });

  it("reads 12 o'clock correctly, and 12:00am as the end of the day", () => {
    const r = readIcrew(icrewCsv([booking("2026-03-09", { id: 1, start: "12:00pm", end: "12:30pm" }), booking("2026-03-09", { id: 2, start: "11:00pm", end: "12:00am" })]), TODAY);
    expect(r.problems).toEqual([]);
    expect(r.rows[0].startsAt).toBe("2026-03-09T19:00:00.000Z");
    expect(r.rows[0].endsAt).toBe("2026-03-09T19:30:00.000Z");
    expect(r.rows[1].endsAt).toBe("2026-03-10T07:00:00.000Z");
  });

  it("calls a row with no item type an event", () => {
    const r = readIcrew(one({ id: 5, type: "", item: "Fall Social", by: "Pat Example", out: "", in: "" }), TODAY);
    expect(r.rows[0].itemType).toBe("Event");
  });

  it("keeps two rows with the same ID for different people (an event has one row per person)", () => {
    const r = readIcrew(icrewCsv([booking("2026-03-09", { id: 9, type: "", item: "Social", by: "Pat Example" }), booking("2026-03-09", { id: 9, type: "", item: "Social", by: "Sam Example" })]), TODAY);
    expect(r.rows).toHaveLength(2);
    expect(r.repeatedInFile).toBe(0);
    expect(new Set(r.rows.map((x) => x.key)).size).toBe(2);
  });

  it("keeps a booking that appears twice once, and says so", () => {
    const r = readIcrew(icrewCsv([booking("2026-03-09", { id: 9, by: "Pat Example" }), booking("2026-03-09", { id: 9, by: "  pat   example " })]), TODAY);
    expect(r.rows).toHaveLength(1);
    expect(r.repeatedInFile).toBe(1);
    expect(r.notices).toContain("1 row repeats another row in the file (same ID and same person), so each is kept once.");
  });

  it("leaves out today and later days, and says so", () => {
    const r = readIcrew(icrewCsv([booking("2026-11-30", { id: 1 }), booking("2026-12-01", { id: 2 }), booking("2026-12-09", { id: 3 })]), TODAY);
    expect(r.rows.map((x) => x.sourceId)).toEqual(["1"]);
    expect(r.futureRows).toBe(2);
    expect(r.rowCount).toBe(3);
    expect(r.notices).toContain("2 rows are for today or a later day. History only holds days that have passed, so they are left out.");
  });

  it("finds columns by name in any order and ignores the Day column and extras", () => {
    const text = ["id,ItemType,Shell/Item,ReservedBy,Date,StartTime,EndTime,Notes", "77,Shell,Cormorant,Pat Example,03-09-2026,7:00am,8:00am,hello"].join("\n");
    const r = readIcrew(text, TODAY);
    expect(r.problems).toEqual([]);
    expect(r.rows[0].sourceId).toBe("77");
    expect(r.ignoredColumns).toEqual(["Notes"]);
    expect(r.notices.join(" ")).toContain('"Notes"');
    expect(readIcrew(icrewCsv([booking("2026-03-09", { id: 1 })]), TODAY).ignoredColumns).toEqual([]);
  });

  it("reads dates a spreadsheet may rewrite", () => {
    for (const date of ["3/9/2026", "03-09-2026", "2026-03-09"]) {
      const r = readIcrew([HEADER, `${date},Monday,7:00am,8:00am,,,1,Shell,Cormorant,,Pat Example,,,`].join("\r\n"), TODAY);
      expect(r.problems, date).toEqual([]);
      expect(r.rows[0].day, date).toBe("2026-03-09");
    }
  });

  it("reads 24-hour times, a leading marker, quoted cells and LF line endings", () => {
    const text = String.fromCharCode(0xfeff) + [HEADER, '03-09-2026,Monday,16:00,17:30,,,1,Shell,"Cormorant, the second",,"Pat Example",,,'].join("\n");
    const r = readIcrew(text, TODAY);
    expect(r.problems).toEqual([]);
    expect(r.rows[0].itemName).toBe("Cormorant, the second");
    expect(r.rows[0].startsAt).toBe("2026-03-09T23:00:00.000Z");
  });

  it("works out the same key for the same booking however the name is spaced or capitalised", () => {
    expect(rowKeyOf("1", "Pat Example")).toBe(rowKeyOf("1", "  pat   EXAMPLE "));
    expect(rowKeyOf("1", "Pat Example")).not.toBe(rowKeyOf("2", "Pat Example"));
    expect(rowKeyOf("1", "Pat Example")).not.toBe(rowKeyOf("1", "Sam Example"));
  });
});

describe("what is wrong with a file, in words", () => {
  it("names the columns that are missing", () => {
    const r = readIcrew("Date,StartTime\r\n03-09-2026,7:00am", TODAY);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('The file has no column for "EndTime", "ID", "ItemType", "Shell/Item", "ReservedBy"');
    expect(r.problems[0]).toContain("Is this iCrew's Reservations report?");
    expect(r.rows).toEqual([]);
  });

  it("refuses two columns that mean the same thing", () => {
    const r = readIcrew(HEADER + ",Reserved By\r\n", TODAY);
    expect(r.problems.join(" ")).toContain('Two columns both mean "ReservedBy": "ReservedBy" and "Reserved By"');
  });

  it("reports every problem at once with spreadsheet row numbers", () => {
    const text = [
      HEADER,
      "13-45-2026,Monday,7:00am,8:00am,,,111,Shell,Cormorant,,Pat Example,,,",
      "03-09-2026,Monday,7:61am,8:00am,,,112,Shell,Cormorant,,Pat Example,,,",
      "03-09-2026,Monday,9:00am,8:00am,,,113,Shell,Cormorant,,Pat Example,,,",
      "03-09-2026,Monday,7:00am,8:00am,,,,Shell,Cormorant,,Pat Example,,,",
      "03-09-2026,Monday,7:00am,8:00am,,,abc,Shell,Cormorant,,Pat Example,,,",
      "03-09-2026,Monday,7:00am,8:00am,,,115,Shell,,,Pat Example,,,",
      "03-09-2026,Monday,7:00am,8:00am,,,116,Shell,Cormorant,,,,,",
      "03-09-2026,Monday,7:00am,8:00am,,09:15:00,117,Shell,Cormorant,,Pat Example,,,",
      "03-09-2026,Monday,7:00am,8:00am,01-02-2026,25:99:00,118,Shell,Cormorant,,Pat Example,,,",
      "03-09-2026,Monday,,8:00am,,,119,Shell,Cormorant,,Pat Example,,,",
      "03-09-2026,Monday,7:00am,8:00am,,,120,Shell,Cormorant,,Pat Example,,,",
    ].join("\r\n");
    const r = readIcrew(text, TODAY);
    expect(r.problems).toEqual([
      'Row 2: Date "13-45-2026" is not a real date.',
      'Row 3: StartTime "7:61am" is not a time of day.',
      "Row 4: It ends at 8:00am, which is not after it starts at 9:00am.",
      "Row 5: ID is empty. Every booking has an ID in iCrew's report.",
      'Row 6: ID "abc" should be a number, like 123456.',
      "Row 7: Shell/Item is empty.",
      "Row 8: ReservedBy is empty.",
      "Row 9: BookedAtTime is filled in but BookedOnDate is empty.",
      'Row 10: BookedAtTime "25:99:00" is not a time like 14:05:33.',
      "Row 11: StartTime is empty.",
    ]);
    expect(r.rows).toHaveLength(1);
  });

  it("refuses dates that cannot be right", () => {
    expect(parseIcrewDay("02-30-2026")).toEqual({ problem: '"02-30-2026" is not a real date.' });
    expect(parseIcrewDay("01-05-1998")).toEqual({ problem: '"01-05-1998" is before 2000. Check the year.' });
    expect(parseIcrewDay("sometime")).toEqual({ problem: '"sometime" is not a date. Write it like 09-08-2026.' });
    expect(parseIcrewClock("13:00pm")).toEqual({ problem: '"13:00pm" is not a time of day.' });
    expect(parseIcrewClock("noon")).toEqual({ problem: '"noon" is not a time. Write it like 4:00pm.' });
    expect(parseIcrewClock("24:30")).toEqual({ problem: '"24:30" is not a time of day.' });
    expect(parseIcrewClock("16:61")).toEqual({ problem: '"16:61" is not a time of day.' });
    expect(parseIcrewClock("25:00")).toEqual({ problem: '"25:00" is not a time of day.' });
    expect(parseIcrewClock("24:00")).toEqual({ minutes: 1440 });
    expect(parseIcrewClock("12:00am")).toEqual({ minutes: 0 });
    expect(parseIcrewClock("12:30pm")).toEqual({ minutes: 750 });
    expect(parseIcrewClock("1:05pm")).toEqual({ minutes: 785 });
    expect(parseIcrewClock("0:30am")).toEqual({ problem: '"0:30am" is not a time of day.' });
  });

  it("refuses fields that are too long", () => {
    const long = "x".repeat(121);
    const r = readIcrew(icrewCsv([booking("2026-03-09", { id: 1, item: long, by: long, oars: long, rowers: "x".repeat(201) })]), TODAY);
    expect(r.problems).toEqual(["Row 2: Shell/Item is longer than 120 characters.", "Row 2: ReservedBy is longer than 120 characters.", "Row 2: Rower(s) is longer than 200 characters.", "Row 2: Oars is longer than 120 characters."]);
    // Exactly at each limit is fine.
    const edge = readIcrew(icrewCsv([booking("2026-03-09", { id: 1, item: "x".repeat(120), by: "y".repeat(120), oars: "z".repeat(120), rowers: "w".repeat(200) })]), TODAY);
    expect(edge.problems).toEqual([]);
  });

  it("refuses the template's example rows", () => {
    const r = readIcrew(ICREW_TEMPLATE, TODAY);
    expect(r.problems).toEqual([
      'Row 2: "EXAMPLE-1" is one of the template\'s example rows. Delete the example rows before uploading.',
      'Row 3: "EXAMPLE-2" is one of the template\'s example rows. Delete the example rows before uploading.',
      'Row 4: "EXAMPLE-3" is one of the template\'s example rows. Delete the example rows before uploading.',
    ]);
  });

  it("stops listing after a few hundred problems and says how many more there were", () => {
    const bad = Array.from({ length: 300 }, (_, i) => `03-09-2026,Monday,7:00am,8:00am,,,${i},Shell,,,Pat Example,,,`).join("\r\n");
    const r = readIcrew(`${HEADER}\r\n${bad}`, TODAY);
    expect(r.problems).toHaveLength(MAX_HISTORY_PROBLEMS + 1);
    expect(r.problems[0]).toBe("Row 2: Shell/Item is empty.");
    expect(r.problems.at(-1)).toBe("...and 100 more problems after these.");
  });

  it("refuses an Excel file, a binary file, an empty file and an unclosed quotation mark, each with what to do", () => {
    expect(readIcrew("PK\u0003\u0004 rest of a zip", TODAY).problems[0]).toContain("looks like an Excel file");
    expect(readIcrew("a,b\u0000c", TODAY).problems[0]).toContain("not a plain CSV text file");
    expect(readIcrew("", TODAY).problems).toEqual(["The file is empty."]);
    expect(readIcrew("\r\n\r\n", TODAY).problems).toEqual(["The file is empty."]);
    expect(readIcrew(`${HEADER}\r\n"03-09-2026,Monday`, TODAY).problems[0]).toContain("never closed");
  });

  it("refuses a file that is too big or has too many rows, saying what to do", () => {
    expect(readIcrew("x".repeat(MAX_HISTORY_BYTES + 1), TODAY).problems[0]).toContain("too big");
    const rows = Array.from({ length: MAX_HISTORY_ROWS + 1 }, () => "a").join("\n");
    expect(readIcrew(`${HEADER}\n${rows}`, TODAY).problems[0]).toContain(`The file has ${MAX_HISTORY_ROWS + 1} rows. It can have up to ${MAX_HISTORY_ROWS}.`);
  });

  it("accepts exactly the largest file allowed", () => {
    const line = "03-09-2026,Monday,7:00am,8:00am,,,1,Shell,Cormorant,,Pat Example,,,";
    const text = `${HEADER}\r\n${line}\r\n`.padEnd(MAX_HISTORY_BYTES, " ");
    expect(text.length).toBe(MAX_HISTORY_BYTES);
    expect(readIcrew(text, TODAY).problems).toEqual([]);
  });
});
