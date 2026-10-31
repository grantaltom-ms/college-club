import { describe, expect, it } from "vitest";
import { incidentDetail, incidentQueue, myIncidents, officeIncidents } from "../engine/incidents";
import { fullName } from "../engine/queries";
import { buildSampleStore } from "./club";

const TODAY = "2026-10-28";
const NOW = new Date("2026-10-28T20:00:00Z");

describe("the sample incident reports", () => {
  it("has one open capsize with someone hurt, one open dock incident not yet reviewed, and one closed near-miss", async () => {
    const state = await (await buildSampleStore(TODAY, NOW)).read();
    expect(state.incidents).toHaveLength(3);
    const queue = incidentQueue(state, NOW, "open");
    expect(queue.map((r) => [r.whatHappened.slice(0, 18), r.hurtCount, r.peopleCount, r.followUpBy])).toEqual([
      ["The double flipped", 1, 3, "Safety officer"],
      ["A cleat pulled out", 0, 0, null],
    ]);
    expect(incidentQueue(state, NOW, "closed").map((r) => r.statusWords)).toEqual(["Closed"]);
    expect(officeIncidents(state, NOW)).toMatchObject({ open: 2, hurt: 1, emergency: 0 });
  });

  it("was filed by the sample coach and by staff, and only the coach sees the capsize on My reports", async () => {
    const state = await (await buildSampleStore(TODAY, NOW)).read();
    const kenji = state.members.find((m) => fullName(m) === "Kenji Tanaka")!;
    expect(kenji.isCoach).toBe(true);
    const mine = myIncidents(state, kenji.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ boats: ["Pelican"], status: "open" });
    expect(mine[0].people.map((p) => [p.name, p.member, p.injured])).toEqual([["Tomas Vandermeer", true, true], ["Alex Brooks", true, false], ["Jordan Example", false, false]]);
    expect(JSON.stringify(mine)).not.toContain("wind came up faster");
    const alex = state.members.find((m) => fullName(m) === "Alex Brooks")!;
    expect(myIncidents(state, alex.id)).toEqual([]);
  });

  it("gives staff the whole story of the capsize, in order", async () => {
    const state = await (await buildSampleStore(TODAY, NOW)).read();
    const capsize = state.incidents.find((i) => i.whatHappened.startsWith("The double flipped"))!;
    const detail = incidentDetail(state, capsize.id)!;
    expect(detail.log.map((l) => l.kind)).toEqual(["reviewed", "filed"]);
    expect(detail.incident).toMatchObject({ cause: "The wind came up faster than the forecast said.", firstAidGiven: true, status: "open" });
    expect(detail.incident.firstAidNotes).toMatch(/bandaged a cut hand/);
  });
});
