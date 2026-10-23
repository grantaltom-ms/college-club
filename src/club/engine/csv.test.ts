import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { parseCsv } from "./csv";

describe("reading CSV text", () => {
  it("reads rows and cells, whatever line ending the spreadsheet used", () => {
    const expected = [["a", "b", "c"], ["1", "2", "3"]];
    expect(parseCsv("a,b,c\n1,2,3")).toEqual(expected);
    expect(parseCsv("a,b,c\r\n1,2,3\r\n")).toEqual(expected);
    expect(parseCsv("a,b,c\r1,2,3\r")).toEqual(expected);
    expect(parseCsv("a,b,c\n1,2,3\n\n")).toEqual([...expected, [""]]);
  });

  it("keeps empty cells, including at the end of a row", () => {
    expect(parseCsv("a,,c,\n,,,")).toEqual([["a", "", "c", ""], ["", "", "", ""]]);
  });

  it("reads quoted cells with commas, line breaks and doubled quotation marks inside", () => {
    expect(parseCsv('"The Smith, Jones household","line one\nline two","She said ""hi"""')).toEqual([["The Smith, Jones household", "line one\nline two", 'She said "hi"']]);
    expect(parseCsv('"",x')).toEqual([["", "x"]]);
    expect(parseCsv('"a""",b')).toEqual([['a"', "b"]]);
  });

  it("treats a quotation mark in the middle of a plain cell as an ordinary character", () => {
    expect(parseCsv('5" pipe,ok')).toEqual([['5" pipe', "ok"]]);
  });

  it("ignores the invisible marker some spreadsheets put at the start of a file", () => {
    expect(parseCsv("﻿Name,Email\nAda,ada@example.com")).toEqual([["Name", "Email"], ["Ada", "ada@example.com"]]);
  });

  it("gives nothing for empty text", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("refuses a quotation mark that is never closed, in plain words", () => {
    expect(() => parseCsv('a,"never closed\nb,c')).toThrow(ClubError);
    expect(() => parseCsv('a,"never closed\nb,c')).toThrow("A quotation mark in the file is never closed.");
  });
});
