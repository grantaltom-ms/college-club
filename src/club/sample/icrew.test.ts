import { describe, expect, it } from "vitest";
import { memberHistory, nameReport, runHistoryImport } from "../engine/history";
import { readIcrew } from "../engine/icrew";
import { MemoryHistoryStore } from "../store/history";
import { buildSampleStore } from "./club";
import { icrewCsv, booking, icrewDay, sampleHistoryCsv } from "./icrew";

const TODAY = "2026-10-28";

describe("the invented old bookings", () => {
  it("make a file the reader accepts, all in the past", () => {
    const reading = readIcrew(sampleHistoryCsv(TODAY), TODAY);
    expect(reading.problems).toEqual([]);
    expect(reading.rows).toHaveLength(9);
    expect(reading.futureRows).toBe(0);
    expect(reading.rows.every((r) => r.day < TODAY)).toBe(true);
  });

  it("line up with the invented club, so members can see their own", async () => {
    const club = await buildSampleStore(TODAY);
    const members = (await club.read()).members;
    const history = new MemoryHistoryStore();
    await runHistoryImport(history, { actor: { kind: "staff", label: "Test staff" }, now: new Date("2026-10-28T20:00:00Z") }, { fileName: "sample.csv", text: sampleHistoryCsv(TODAY) });
    const idOf = (first: string, last: string) => members.find((m) => m.firstName === first && m.lastName === last)!.id;

    const nora = await memberHistory(history, members, idOf("Nora", "Abernathy"));
    expect(nora.items.map((i) => i.itemName)).toEqual(["Cormorant", "Gym Space 01", "Heron Double", "Fall Regatta Social"]);
    const tomas = await memberHistory(history, members, idOf("Tomas", "Vandermeer"));
    expect(tomas.items.map((i) => [i.itemName, i.role])).toEqual([
      ["Cormorant", "You reserved it and were in the boat"],
      ["Heron Double", "You were in the boat"],
    ]);
    expect((await memberHistory(history, members, idOf("Erik", "Lindqvist"))).total).toBe(2);
    expect((await memberHistory(history, members, idOf("Walter", "Pemberton"))).items.map((i) => i.itemType)).toEqual(["Room Space"]);
    // Someone with nothing in the archive sees nothing.
    expect((await memberHistory(history, members, idOf("Declan", "Halloran"))).total).toBe(0);

    const report = await nameReport(history, members);
    expect(report.none.map((n) => n.name).sort()).toEqual(["Maren Vandermeer", "Pat Visitingrower"]);
    expect(report.many).toEqual([]);
  });

  it("are written the way iCrew writes them", () => {
    const csv = icrewCsv([booking("2026-03-08", { id: 5, by: "Pat Example" })]);
    expect(csv.split("\r\n")[0]).toBe("Date,Day,StartTime,EndTime,BookedOnDate,BookedAtTime,ID,ItemType,Shell/Item,Oars,ReservedBy,Rower(s),OutAt,InAt");
    expect(csv.split("\r\n")[1]).toBe("03-08-2026,Sunday,7:00am,8:00am,,,5,Shell,Cormorant,,Pat Example,,7:02am,7:58am");
    expect(icrewDay("2026-03-08")).toBe("03-08-2026");
  });
});
