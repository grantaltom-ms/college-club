import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { INCIDENT_RULES } from "../settings/incident-rules";
import type { IncidentRules } from "../types";
import { addBoatOwner } from "./boat-access";
import { fileDamageReport } from "./damage";
import { DAMAGE_RULES } from "../settings/damage-rules";
import { endHousehold } from "./households";
import { bookingLedger } from "./bookings";
import {
  IncidentRefused,
  addIncidentNote,
  canFileIncident,
  closeIncident,
  fileIncident,
  findIncidentPeople,
  incidentBoatChoices,
  incidentDetail,
  incidentQueue,
  myIncidents,
  officeIncidents,
  reviewIncident,
  type IncidentInput,
} from "./incidents";
import { setCoach } from "./practices";
import { NOW, STORE_KINDS, fixtureFor, memberCtx, staffCtx, type Fixture } from "./testkit";

/**
 * Incident reports: who may file, what is cleaned and capped, what staff add afterwards (cause, what will change, who is following
 * up, a linked damage report), closing, what each person may read, and that every step is a line in the log. Every test runs on both
 * stores, so the in-memory copy and Postgres must agree. Today is Wed Oct 28, 2026, 1 pm Pacific. The fixture's members: Ada, Ben,
 * Cy (the Quill household), Dee and Eli (the Reed household). Ben is the coach in most tests.
 */

const HOUR = 3600000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);
const rulesWith = (change: Partial<IncidentRules["defaults"]>): IncidentRules => ({ ...INCIDENT_RULES, defaults: { ...INCIDENT_RULES.defaults, ...change } });

const asMember = (f: Fixture, who: string, now: Date = NOW) => memberCtx(f.m[who], `${who} Quill`, now);
const asStaff = (now: Date = NOW) => staffCtx(now);
const state = (f: Fixture) => f.store.read();
const makeCoach = (f: Fixture, who = "Ben") => setCoach(f.store, asStaff(), f.m[who], true);

const refusalOf = async (attempt: Promise<unknown>): Promise<{ code: string; message: string; reasons?: string[] } | null> => {
  try {
    await attempt;
    return null;
  } catch (e) {
    if (e instanceof IncidentRefused) return { code: e.code, message: e.message, reasons: e.reasons };
    if (e instanceof ClubError) return { code: e.code, message: e.message };
    throw e;
  }
};

const input = (change: Partial<IncidentInput> = {}): IncidentInput => ({ occurredAt: ago(2 * HOUR), whatHappened: "A single capsized near the dock.", onTheWater: true, firstAidGiven: false, emergencyCalled: false, ...change });
const file = (f: Fixture, who: string, change: Partial<IncidentInput> = {}, now: Date = NOW) => fileIncident(f.store, asMember(f, who, now), INCIDENT_RULES, input(change));
const fileAsStaff = (f: Fixture, change: Partial<IncidentInput> = {}) => fileIncident(f.store, asStaff(), INCIDENT_RULES, input(change));
const logOf = async (f: Fixture, id: string) => (await state(f)).incidentLog.filter((l) => l.incidentId === id);

for (const kind of STORE_KINDS) {
  describe(`incident reports on the ${kind} store`, () => {
    const fixture = fixtureFor(kind);

    describe("who may file", () => {
      it("lets staff and coaches file, and nobody else", async () => {
        const f = await fixture();
        await makeCoach(f);
        const s = await state(f);
        expect(canFileIncident(s, { kind: "staff", label: "Test staff" })).toBe(true);
        expect(canFileIncident(s, { kind: "member", memberId: f.m.Ben, label: "Ben" })).toBe(true);
        expect(canFileIncident(s, { kind: "member", memberId: f.m.Ada, label: "Ada" })).toBe(false);
        expect(canFileIncident(s, { kind: "system", label: "Automatic" })).toBe(false);
      });

      it("refuses an ordinary member, the system, and a coach who is unmarked or whose household ended", async () => {
        const f = await fixture();
        const message = "Only club staff and coaches can file an incident report.";
        expect(await refusalOf(file(f, "Ada"))).toEqual({ code: "forbidden", message });
        expect(await refusalOf(fileIncident(f.store, { actor: { kind: "system", label: "Automatic" }, now: NOW }, INCIDENT_RULES, input()))).toEqual({ code: "forbidden", message });
        await makeCoach(f, "Dee");
        await setCoach(f.store, asStaff(), f.m.Dee, false);
        expect((await refusalOf(file(f, "Dee")))?.code).toBe("forbidden");
        await makeCoach(f, "Eli");
        await endHousehold(f.store, bookingLedger, asStaff(), f.h.Reed);
        expect((await refusalOf(file(f, "Eli")))?.code).toBe("forbidden");
        expect((await state(f)).incidents).toEqual([]);
      });
    });

    describe("filing a report", () => {
      it("saves what the coach wrote, starts it open with nothing from staff, and writes the filed line", async () => {
        const f = await fixture();
        await makeCoach(f);
        const incident = await file(f, "Ben", { location: "East dock", conditions: "Light chop, 10 knots", firstAidGiven: true, firstAidNotes: "Bandaged a cut hand.", boatIds: [f.i.Heron] });
        expect(incident).toMatchObject({
          reportedBy: { kind: "member", memberId: f.m.Ben, label: "Ben Quill" },
          reportedAt: NOW.toISOString(),
          occurredAt: ago(2 * HOUR).toISOString(),
          whatHappened: "A single capsized near the dock.",
          location: "East dock",
          onTheWater: true,
          conditions: "Light chop, 10 knots",
          firstAidGiven: true,
          firstAidNotes: "Bandaged a cut hand.",
          emergencyCalled: false,
          emergencyNotes: "",
          status: "open",
          updatedAt: NOW.toISOString(),
          cause: null,
          whatWillChange: null,
          followUpBy: null,
          damageReportId: null,
          closedAt: null,
          closedNote: null,
        });
        const s = await state(f);
        expect(s.incidents).toEqual([incident]);
        expect(s.incidentBoats).toEqual([{ id: expect.any(String), incidentId: incident.id, itemId: f.i.Heron }]);
        expect(s.incidentLog).toEqual([{ id: expect.any(String), incidentId: incident.id, at: NOW.toISOString(), kind: "filed", by: { kind: "member", memberId: f.m.Ben, label: "Ben Quill" }, text: "Reported by Ben Quill. Nobody was hurt." }]);
      });

      it("lets staff file one under their own name", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f, { onTheWater: false });
        expect(incident.reportedBy).toEqual({ kind: "staff", label: "Test staff" });
        expect((await logOf(f, incident.id))[0].text).toBe("Reported by Test staff. Nobody was hurt.");
      });

      it("records members picked from the list and names typed in, each hurt or not and whether a parent was told", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f, {
          people: [
            { memberId: f.m.Ada, injured: true, parentTold: false },
            { memberId: f.m.Cy, injured: false },
            { name: "  Jordan   Example ", injured: true, parentTold: true },
          ],
          emergencyCalled: true,
          emergencyNotes: "Fire department boat",
        });
        const s = await state(f);
        expect(s.incidentPeople.filter((p) => p.incidentId === incident.id).map((p) => ({ memberId: p.memberId, name: p.name, injured: p.injured, parentTold: p.parentTold }))).toEqual([
          { memberId: f.m.Ada, name: "Ada Quill", injured: true, parentTold: false },
          { memberId: f.m.Cy, name: "Cy Quill", injured: false, parentTold: false },
          { memberId: null, name: "Jordan Example", injured: true, parentTold: true },
        ]);
        expect((await logOf(f, incident.id))[0].text).toBe("Reported by Test staff. 2 people were hurt. Emergency services were called.");
      });

      it("says one person was hurt in the singular", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f, { people: [{ name: "Jordan Example", injured: true }] });
        expect((await logOf(f, incident.id))[0].text).toBe("Reported by Test staff. 1 person was hurt.");
      });

      it("cleans control characters and keeps line breaks only in what happened", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f, { whatHappened: "Line one\u0007\n\nLine two\t  ends", location: "East\ndock\u0000", conditions: "Calm\nwater" });
        expect(incident.whatHappened).toBe("Line one \n\nLine two ends");
        expect(incident.location).toBe("East dock");
        expect(incident.conditions).toBe("Calm water");
      });

      it("takes every limit exactly at the number and refuses one over, in words", async () => {
        const f = await fixture();
        const d = INCIDENT_RULES.defaults;
        const exact = await fileAsStaff(f, { whatHappened: "w".repeat(d.whatHappenedMax), location: "l".repeat(d.locationMax), conditions: "c".repeat(d.conditionsMax), firstAidGiven: true, firstAidNotes: "a".repeat(d.firstAidMax), emergencyCalled: true, emergencyNotes: "e".repeat(d.emergencyMax) });
        expect(exact.status).toBe("open");
        const refused = await refusalOf(fileAsStaff(f, { whatHappened: "w".repeat(d.whatHappenedMax + 1), location: "l".repeat(d.locationMax + 1), conditions: "c".repeat(d.conditionsMax + 1), firstAidGiven: true, firstAidNotes: "a".repeat(d.firstAidMax + 1), emergencyCalled: true, emergencyNotes: "e".repeat(d.emergencyMax + 1) }));
        expect(refused?.reasons).toEqual([
          `What happened must be ${d.whatHappenedMax} characters or fewer. It is ${d.whatHappenedMax + 1}.`,
          `Where it happened must be ${d.locationMax} characters or fewer. It is ${d.locationMax + 1}.`,
          `The water and weather must be ${d.conditionsMax} characters or fewer. It is ${d.conditionsMax + 1}.`,
          `The first aid notes must be ${d.firstAidMax} characters or fewer. It is ${d.firstAidMax + 1}.`,
          `The emergency services notes must be ${d.emergencyMax} characters or fewer. It is ${d.emergencyMax + 1}.`,
        ]);
        expect((await state(f)).incidents).toHaveLength(1);
      });

      it("reports every problem at once and saves nothing", async () => {
        const f = await fixture();
        const refused = await refusalOf(fileAsStaff(f, { whatHappened: "   ", onTheWater: undefined as unknown as boolean, firstAidGiven: undefined as unknown as boolean, emergencyCalled: undefined as unknown as boolean, occurredAt: new Date("nonsense") }));
        expect(refused?.code).toBe("refused");
        expect(refused?.reasons).toEqual(["Say what happened.", "Say whether it happened on the water.", "Say whether first aid was given.", "Say whether emergency services were called.", "Say when it happened."]);
        expect(refused?.message).toBe("Say what happened.");
        const s = await state(f);
        expect([s.incidents.length, s.incidentPeople.length, s.incidentBoats.length, s.incidentLog.length]).toEqual([0, 0, 0, 0]);
      });

      it("refuses first aid or emergency notes when the answer is no", async () => {
        const f = await fixture();
        const refused = await refusalOf(fileAsStaff(f, { firstAidGiven: false, firstAidNotes: "Bandage", emergencyCalled: false, emergencyNotes: "Fire dept" }));
        expect(refused?.reasons).toEqual(["Say that first aid was given, or clear the first aid notes.", "Say that emergency services were called, or clear their notes."]);
      });

      it("takes a time up to the last moment back and one moment too early, and never the future", async () => {
        const f = await fixture();
        const days = INCIDENT_RULES.defaults.maxDaysBack;
        expect((await fileAsStaff(f, { occurredAt: ago(days * DAY) })).status).toBe("open");
        expect((await refusalOf(fileAsStaff(f, { occurredAt: ago(days * DAY + 1) })))?.reasons).toEqual([`An incident can be dated up to ${days} days back.`]);
        expect((await fileAsStaff(f, { occurredAt: NOW })).status).toBe("open");
        expect((await refusalOf(fileAsStaff(f, { occurredAt: later(1) })))?.reasons).toEqual(["That time is in the future. Say when it happened."]);
        expect((await refusalOf(fileIncident(f.store, asStaff(), rulesWith({ maxDaysBack: 1 }), input({ occurredAt: ago(DAY + 1) }))))?.reasons).toEqual(["An incident can be dated up to 1 day back."]);
      });

      it("takes the most people and boats and refuses one more", async () => {
        const f = await fixture();
        const rules = rulesWith({ maxPeople: 3, maxBoats: 2 });
        const names = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Guest ${i + 1}`, injured: false }));
        await fileIncident(f.store, asStaff(), rules, input({ people: names(3), boatIds: [f.i.Heron, f.i.Osprey] }));
        const refused = await refusalOf(fileIncident(f.store, asStaff(), rules, input({ people: names(4), boatIds: [f.i.Heron, f.i.Osprey, f.i.Loon] })));
        expect(refused?.reasons).toEqual(["A report can name up to 3 people.", "A report can name up to 2 boats or spaces."]);
        expect(await refusalOf(fileIncident(f.store, asStaff(), rulesWith({ maxBoats: 1 }), input({ boatIds: [f.i.Heron, f.i.Osprey] })))).toMatchObject({ reasons: ["A report can name up to 1 boat or space."] });
      });

      it("explains each problem with a person or a boat", async () => {
        const f = await fixture();
        const long = "n".repeat(INCIDENT_RULES.defaults.personNameMax + 1);
        const refused = await refusalOf(
          fileAsStaff(f, {
            people: [
              { memberId: f.m.Ada, name: "Ada Too", injured: false },
              { injured: false },
              { name: long, injured: false },
              { memberId: "00000000-0000-4000-8000-0000000000ff", injured: false },
              { memberId: f.m.Cy, injured: false },
              { memberId: f.m.Cy, injured: true },
              { name: "Jordan Example", injured: false },
              { name: "jordan example", injured: false },
            ],
            boatIds: ["00000000-0000-4000-8000-0000000000ff", f.i.Heron, f.i.Heron],
          }),
        );
        expect(refused?.reasons).toEqual([
          "Pick a member or type a name for each person, not both.",
          "Each person needs a name.",
          `A name must be ${INCIDENT_RULES.defaults.personNameMax} characters or fewer. "${"n".repeat(27)}..." is ${long.length}.`,
          "That member no longer exists.",
          "Cy Quill is listed twice.",
          "jordan example is listed twice.",
          "That boat or space no longer exists.",
          "Heron is listed twice.",
        ]);
      });

      it("will not name a member who has left, and says to type the name instead", async () => {
        const f = await fixture();
        await endHousehold(f.store, bookingLedger, asStaff(), f.h.Reed);
        const refused = await refusalOf(fileAsStaff(f, { people: [{ memberId: f.m.Dee, injured: false }] }));
        expect(refused?.reasons).toEqual(["Dee Reed is no longer an active member. Type their name instead."]);
      });

      it("hides a private boat from a coach who is not on its list, and lets its owner and staff name it", async () => {
        const f = await fixture();
        await makeCoach(f);
        await f.store.transaction(async (s, newId) => {
          s.items.push({ id: newId(), name: "Kestrel", classCode: "shell-single", ruleOverrides: {}, isPrivate: true });
        });
        f.i.Kestrel = (await state(f)).items.find((i) => i.name === "Kestrel")!.id;
        await addBoatOwner(f.store, asStaff(), { itemId: f.i.Kestrel, memberId: f.m.Ada });
        expect((await refusalOf(file(f, "Ben", { boatIds: [f.i.Kestrel] })))?.reasons).toEqual(["That boat or space no longer exists."]);
        expect((await fileAsStaff(f, { boatIds: [f.i.Kestrel] })).status).toBe("open");
        await makeCoach(f, "Ada");
        expect((await file(f, "Ada", { boatIds: [f.i.Kestrel] })).status).toBe("open");
        const s = await state(f);
        expect(incidentBoatChoices(s, { kind: "member", memberId: f.m.Ben }).map((i) => i.name)).not.toContain("Kestrel");
        expect(incidentBoatChoices(s, { kind: "member", memberId: f.m.Ada }).map((i) => i.name)).toContain("Kestrel");
      });
    });

    describe("notes", () => {
      it("lets the coach who filed it add notes while it is open, and staff any time", async () => {
        const f = await fixture();
        await makeCoach(f);
        const incident = await file(f, "Ben");
        const note = await addIncidentNote(f.store, asMember(f, "Ben", later(HOUR)), INCIDENT_RULES, { incidentId: incident.id, text: "  The boat was recovered.\n" });
        expect(note).toMatchObject({ kind: "note", text: "The boat was recovered.", by: { kind: "member", memberId: f.m.Ben }, at: later(HOUR).toISOString() });
        await addIncidentNote(f.store, asStaff(later(2 * HOUR)), INCIDENT_RULES, { incidentId: incident.id, text: "Spoke to Ben." });
        await closeIncident(f.store, asStaff(later(3 * HOUR)), INCIDENT_RULES, { incidentId: incident.id, outcome: "Done." });
        await addIncidentNote(f.store, asStaff(later(4 * HOUR)), INCIDENT_RULES, { incidentId: incident.id, text: "A late thought." });
        expect((await logOf(f, incident.id)).map((l) => l.kind)).toEqual(["filed", "note", "note", "closed", "note"]);
      });

      it("tells anyone else the report does not exist, and refuses the filer once it is closed", async () => {
        const f = await fixture();
        await makeCoach(f);
        await makeCoach(f, "Eli");
        const incident = await file(f, "Ben");
        const gone = { code: "not_found", message: "That incident report no longer exists." };
        expect(await refusalOf(addIncidentNote(f.store, asMember(f, "Ada"), INCIDENT_RULES, { incidentId: incident.id, text: "Hi" }))).toEqual(gone);
        expect(await refusalOf(addIncidentNote(f.store, asMember(f, "Eli"), INCIDENT_RULES, { incidentId: incident.id, text: "Hi" }))).toEqual(gone);
        expect(await refusalOf(addIncidentNote(f.store, asStaff(), INCIDENT_RULES, { incidentId: "00000000-0000-4000-8000-0000000000ff", text: "Hi" }))).toEqual(gone);
        await closeIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, outcome: "Done." });
        expect((await refusalOf(addIncidentNote(f.store, asMember(f, "Ben"), INCIDENT_RULES, { incidentId: incident.id, text: "More" })))?.code).toBe("conflict");
        expect(await refusalOf(addIncidentNote(f.store, { actor: { kind: "system", label: "Automatic" }, now: NOW }, INCIDENT_RULES, { incidentId: incident.id, text: "Hi" }))).toMatchObject({ code: "forbidden" });
      });

      it("refuses an empty note and a note one over the limit, and takes one exactly at it", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f);
        const max = INCIDENT_RULES.defaults.noteMax;
        expect(await refusalOf(addIncidentNote(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, text: "  " }))).toEqual({ code: "invalid", message: "Write the note first." });
        expect(await refusalOf(addIncidentNote(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, text: "x".repeat(max + 1) }))).toEqual({ code: "invalid", message: `A note must be ${max} characters or fewer. It is ${max + 1}.` });
        expect(await refusalOf(addIncidentNote(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, text: "x".repeat(max) }))).toBeNull();
      });

      it("will not take a note from a coach who has left the club", async () => {
        const f = await fixture();
        await makeCoach(f, "Dee");
        const incident = await file(f, "Dee");
        await endHousehold(f.store, bookingLedger, asStaff(), f.h.Reed);
        expect((await refusalOf(addIncidentNote(f.store, asMember(f, "Dee"), INCIDENT_RULES, { incidentId: incident.id, text: "Hi" })))?.code).toBe("forbidden");
      });
    });

    describe("staff review", () => {
      it("records the cause, what will change and who is following up in one step with one log line", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f);
        const done = await reviewIncident(f.store, asStaff(later(HOUR)), INCIDENT_RULES, { incidentId: incident.id, cause: "A gust.", whatWillChange: "Wind check before launch.", followUpBy: "Safety officer" });
        expect(done).toMatchObject({ cause: "A gust.", whatWillChange: "Wind check before launch.", followUpBy: "Safety officer", updatedAt: later(HOUR).toISOString(), status: "open" });
        const lines = await logOf(f, incident.id);
        expect(lines).toHaveLength(2);
        expect(lines[1]).toMatchObject({ kind: "reviewed", at: later(HOUR).toISOString(), by: { kind: "staff", label: "Test staff" } });
        expect(lines[1].text).toBe('Reviewed by Test staff. Cause recorded: "A gust.". What will change recorded: "Wind check before launch.". Follow-up by recorded: "Safety officer".');
      });

      it("changes only what differs, says changed and cleared, and refuses a save that changes nothing", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f);
        await reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, cause: "A gust." });
        const again = await refusalOf(reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, cause: "A gust.", whatWillChange: "", followUpBy: "" }));
        expect(again).toEqual({ code: "unchanged", message: "Nothing was changed: what you gave is what the report already says." });
        await reviewIncident(f.store, asStaff(later(1)), INCIDENT_RULES, { incidentId: incident.id, cause: "A strong gust.", followUpBy: "Sam" });
        await reviewIncident(f.store, asStaff(later(2)), INCIDENT_RULES, { incidentId: incident.id, cause: "", followUpBy: "Pat" });
        const text = (await logOf(f, incident.id)).filter((l) => l.kind === "reviewed").map((l) => l.text);
        expect(text).toEqual([
          'Reviewed by Test staff. Cause recorded: "A gust.".',
          'Reviewed by Test staff. Cause changed to "A strong gust.". Follow-up by recorded: "Sam".',
          'Reviewed by Test staff. Cause cleared. Follow-up by changed to "Pat".',
        ]);
        expect((await state(f)).incidents[0]).toMatchObject({ cause: null, followUpBy: "Pat" });
      });

      it("is for staff only, even for the coach who filed it", async () => {
        const f = await fixture();
        await makeCoach(f);
        const incident = await file(f, "Ben");
        const message = "Only club staff can review an incident report.";
        expect(await refusalOf(reviewIncident(f.store, asMember(f, "Ben"), INCIDENT_RULES, { incidentId: incident.id, cause: "Mine" }))).toEqual({ code: "forbidden", message });
        expect(await refusalOf(closeIncident(f.store, asMember(f, "Ben"), INCIDENT_RULES, { incidentId: incident.id, outcome: "Done" }))).toEqual({ code: "forbidden", message: "Only club staff can close an incident report." });
        expect((await state(f)).incidents[0].cause).toBeNull();
      });

      it("takes each limit exactly and refuses one over", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f);
        const d = INCIDENT_RULES.defaults;
        expect(await refusalOf(reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, cause: "c".repeat(d.causeMax), whatWillChange: "w".repeat(d.changeMax), followUpBy: "f".repeat(d.followUpByMax) }))).toBeNull();
        expect(await refusalOf(reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, cause: "c".repeat(d.causeMax + 1) }))).toEqual({ code: "invalid", message: `The cause must be ${d.causeMax} characters or fewer. It is ${d.causeMax + 1}.` });
        expect(await refusalOf(reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, whatWillChange: "w".repeat(d.changeMax + 1) }))).toEqual({ code: "invalid", message: `What will change must be ${d.changeMax} characters or fewer. It is ${d.changeMax + 1}.` });
        expect(await refusalOf(reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, followUpBy: "f".repeat(d.followUpByMax + 1) }))).toEqual({ code: "invalid", message: `Who is following up must be ${d.followUpByMax} characters or fewer. It is ${d.followUpByMax + 1}.` });
      });

      it("links a damage report, changes the link and removes it, with a line each time", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f, { boatIds: [f.i.Heron] });
        const damage = await fileDamageReport(f.store, asStaff(), DAMAGE_RULES, { itemId: f.i.Heron, description: "The bow is cracked.", major: true });
        const other = await fileDamageReport(f.store, asStaff(later(1)), DAMAGE_RULES, { itemId: f.i.Osprey, description: "A loose gate.", major: false });
        await reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, damageReportId: damage.id });
        await reviewIncident(f.store, asStaff(later(1)), INCIDENT_RULES, { incidentId: incident.id, damageReportId: other.id });
        await reviewIncident(f.store, asStaff(later(2)), INCIDENT_RULES, { incidentId: incident.id, damageReportId: null });
        expect((await logOf(f, incident.id)).filter((l) => l.kind === "reviewed").map((l) => l.text)).toEqual([
          'Reviewed by Test staff. Linked to the damage report on Heron: "The bow is cracked.".',
          'Reviewed by Test staff. Linked to the damage report on Osprey: "A loose gate.".',
          "Reviewed by Test staff. Link to the damage report removed.",
        ]);
        expect((await state(f)).incidents[0].damageReportId).toBeNull();
        expect(await refusalOf(reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, damageReportId: "00000000-0000-4000-8000-0000000000ff" }))).toEqual({ code: "not_found", message: "That damage report no longer exists." });
      });

      it("refuses a report that does not exist", async () => {
        const f = await fixture();
        expect(await refusalOf(reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: "00000000-0000-4000-8000-0000000000ff", cause: "x" }))).toEqual({ code: "not_found", message: "That incident report no longer exists." });
      });
    });

    describe("closing", () => {
      it("closes with what was done, and then nothing can change", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f);
        const closed = await closeIncident(f.store, asStaff(later(DAY)), INCIDENT_RULES, { incidentId: incident.id, outcome: "  Rules posted.  " });
        expect(closed).toMatchObject({ status: "closed", closedAt: later(DAY).toISOString(), closedNote: "Rules posted.", updatedAt: later(DAY).toISOString() });
        expect((await logOf(f, incident.id)).at(-1)).toMatchObject({ kind: "closed", text: "Closed by Test staff: Rules posted." });
        const frozen = { code: "conflict", message: "That report is already closed, so it cannot change. If something has come back, file a new report." };
        expect(await refusalOf(reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, cause: "Late" }))).toEqual(frozen);
        expect(await refusalOf(closeIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, outcome: "Again" }))).toEqual(frozen);
      });

      it("needs an outcome, within the limit", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f);
        const max = INCIDENT_RULES.defaults.closingNoteMax;
        expect(await refusalOf(closeIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, outcome: " " }))).toEqual({ code: "invalid", message: "Say what was done, or why nothing more is needed." });
        expect(await refusalOf(closeIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, outcome: "o".repeat(max + 1) }))).toEqual({ code: "invalid", message: `What was done must be ${max} characters or fewer. It is ${max + 1}.` });
        expect(await refusalOf(closeIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, outcome: "o".repeat(max) }))).toBeNull();
      });

      it("keeps a long outcome whole on the report and shortens it in the log line", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f);
        const outcome = "o".repeat(INCIDENT_RULES.defaults.closingNoteMax);
        await closeIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, outcome });
        expect((await state(f)).incidents[0].closedNote).toBe(outcome);
        expect((await logOf(f, incident.id)).at(-1)!.text.length).toBeLessThan(outcome.length);
      });
    });

    describe("finding the people", () => {
      it("needs three letters, shows at most six active members, never someone already named, and tells namesakes apart", async () => {
        const f = await fixture();
        const s0 = await state(f);
        expect(findIncidentPeople(s0, "qu", [])).toEqual({ tooShort: true, people: [], more: false });
        const found = findIncidentPeople(s0, "Quill", [f.m.Ben]);
        expect(found.people.map((p) => p.name).sort()).toEqual(["Ada Quill", "Cy Quill"]);
        expect(found.people[0]).not.toHaveProperty("email");
        await endHousehold(f.store, bookingLedger, asStaff(), f.h.Reed);
        expect(findIncidentPeople(await state(f), "Reed", []).people).toEqual([]);
      });
    });

    describe("what each person may read", () => {
      it("shows a coach their own reports with their own notes, and nothing staff add", async () => {
        const f = await fixture();
        await makeCoach(f);
        await makeCoach(f, "Eli");
        const mine = await file(f, "Ben", { boatIds: [f.i.Heron], people: [{ memberId: f.m.Ada, injured: true }, { name: "Jordan Example", injured: false }], location: "East dock" });
        await file(f, "Eli", { whatHappened: "Somebody else's report." });
        await addIncidentNote(f.store, asMember(f, "Ben", later(1)), INCIDENT_RULES, { incidentId: mine.id, text: "My note." });
        await addIncidentNote(f.store, asStaff(later(2)), INCIDENT_RULES, { incidentId: mine.id, text: "Staff only." });
        await reviewIncident(f.store, asStaff(later(3)), INCIDENT_RULES, { incidentId: mine.id, cause: "A secret cause.", whatWillChange: "Secret change.", followUpBy: "Safety officer" });
        const lines = myIncidents(await state(f), f.m.Ben);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({
          incidentId: mine.id,
          whatHappened: "A single capsized near the dock.",
          location: "East dock",
          onTheWater: true,
          boats: ["Heron"],
          people: [{ name: "Ada Quill", member: true, injured: true, parentTold: false }, { name: "Jordan Example", member: false, injured: false, parentTold: false }],
          status: "open",
          statusWords: "Open",
          closedAt: null,
          notes: [{ at: later(1).toISOString(), text: "My note." }],
        });
        const json = JSON.stringify(lines);
        for (const secret of ["secret cause", "Secret change", "Safety officer", "Staff only"]) expect(json).not.toContain(secret);
        expect(myIncidents(await state(f), f.m.Ada)).toEqual([]);
      });

      it("lists a coach's reports newest first and shows closed ones as closed", async () => {
        const f = await fixture();
        await makeCoach(f);
        const first = await file(f, "Ben", { whatHappened: "First.", occurredAt: ago(DAY + HOUR) }, ago(DAY));
        const second = await file(f, "Ben", { whatHappened: "Second." });
        await closeIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: first.id, outcome: "Done." });
        expect(myIncidents(await state(f), f.m.Ben).map((l) => [l.whatHappened, l.status, l.statusWords])).toEqual([["Second.", "open", "Open"], ["First.", "closed", "Closed"]]);
        expect(second.id).not.toBe(first.id);
      });

      it("gives staff the queue with anyone hurt first, then emergency services, then the oldest; closed by when they closed", async () => {
        const f = await fixture();
        const plain = await fileAsStaff(f, { whatHappened: "Plain, oldest." }); // filed at NOW
        const calledLater = await fileIncident(f.store, asStaff(later(HOUR)), INCIDENT_RULES, input({ whatHappened: "Emergency.", emergencyCalled: true }));
        const hurtLatest = await fileIncident(f.store, asStaff(later(2 * HOUR)), INCIDENT_RULES, input({ whatHappened: "Hurt.", people: [{ name: "Jordan Example", injured: true }] }));
        const plainLater = await fileIncident(f.store, asStaff(later(3 * HOUR)), INCIDENT_RULES, input({ whatHappened: "Plain, newer." }));
        const queue = incidentQueue(await state(f), later(5 * DAY), "open");
        expect(queue.map((r) => r.incidentId)).toEqual([hurtLatest.id, calledLater.id, plain.id, plainLater.id]);
        expect(queue[0]).toMatchObject({ hurtCount: 1, peopleCount: 1, emergencyCalled: false, daysOpen: 4, reporter: "Test staff", statusWords: "Open", followUpBy: null, hasDamageLink: false });
        await closeIncident(f.store, asStaff(later(4 * DAY)), INCIDENT_RULES, { incidentId: plain.id, outcome: "Done." });
        await closeIncident(f.store, asStaff(later(5 * DAY)), INCIDENT_RULES, { incidentId: plainLater.id, outcome: "Done." });
        const s = await state(f);
        expect(incidentQueue(s, later(9 * DAY), "closed").map((r) => r.incidentId)).toEqual([plainLater.id, plain.id]);
        expect(incidentQueue(s, later(9 * DAY), "closed")[1].daysOpen).toBe(4);
        expect(incidentQueue(s, later(9 * DAY), "open").map((r) => r.incidentId)).toEqual([hurtLatest.id, calledLater.id]);
      });

      it("rounds days open down, and shows the boats, the link and who is following up", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f, { boatIds: [f.i.Heron, f.i.Osprey] });
        const damage = await fileDamageReport(f.store, asStaff(), DAMAGE_RULES, { itemId: f.i.Heron, description: "Cracked.", major: false });
        await reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, followUpBy: "Sam", damageReportId: damage.id });
        const [row] = incidentQueue(await state(f), later(2 * DAY - 1), "open");
        expect(row).toMatchObject({ daysOpen: 1, boats: ["Heron", "Osprey"], followUpBy: "Sam", hasDamageLink: true });
      });

      it("gives staff one report with its people, boats, damage link, log (newest first) and the damage reports they can link", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f, { boatIds: [f.i.Heron], people: [{ memberId: f.m.Ada, injured: true, parentTold: true }] });
        const damage = await fileDamageReport(f.store, asStaff(), DAMAGE_RULES, { itemId: f.i.Heron, description: "The bow is cracked.", major: true });
        await reviewIncident(f.store, asStaff(later(HOUR)), INCIDENT_RULES, { incidentId: incident.id, cause: "A gust.", damageReportId: damage.id });
        await addIncidentNote(f.store, asStaff(later(2 * HOUR)), INCIDENT_RULES, { incidentId: incident.id, text: "Called the owner." });
        const detail = incidentDetail(await state(f), incident.id)!;
        expect(detail.reporter).toBe("Test staff");
        expect(detail.statusWords).toBe("Open");
        expect(detail.boats).toEqual([{ itemId: f.i.Heron, name: "Heron" }]);
        expect(detail.people).toEqual([{ name: "Ada Quill", member: true, injured: true, parentTold: true }]);
        expect(detail.log.map((l) => l.kind)).toEqual(["note", "reviewed", "filed"]);
        expect(detail.damage).toEqual({ reportId: damage.id, itemName: "Heron", description: "The bow is cracked.", statusWords: "open" });
        expect(detail.damageChoices).toEqual([{ reportId: damage.id, label: "Heron: The bow is cracked. (open)" }]);
        expect(incidentDetail(await state(f), "00000000-0000-4000-8000-0000000000ff")).toBeNull();
      });

      it("always offers the linked damage report even when it is older than the forty newest", async () => {
        const f = await fixture();
        const incident = await fileAsStaff(f);
        const old = await fileDamageReport(f.store, asStaff(ago(10 * DAY)), DAMAGE_RULES, { itemId: f.i.Heron, description: "Old damage.", major: false });
        await reviewIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: incident.id, damageReportId: old.id });
        for (let i = 0; i < 41; i++) await fileDamageReport(f.store, asStaff(later(i)), DAMAGE_RULES, { itemId: f.i.Osprey, description: `Newer ${i}.`, major: false });
        const detail = incidentDetail(await state(f), incident.id)!;
        expect(detail.damageChoices).toHaveLength(41);
        expect(detail.damageChoices[0].reportId).toBe(old.id);
      });

      it("counts the office board: open, with someone hurt, with emergency services, and the top five", async () => {
        const f = await fixture();
        expect(officeIncidents(await state(f), NOW)).toEqual({ open: 0, hurt: 0, emergency: 0, top: [] });
        for (let i = 0; i < 6; i++) await fileIncident(f.store, asStaff(later(i * HOUR)), INCIDENT_RULES, input({ whatHappened: `Plain ${i}.` }));
        await fileIncident(f.store, asStaff(later(7 * HOUR)), INCIDENT_RULES, input({ whatHappened: "Hurt.", people: [{ name: "Jordan Example", injured: true }, { name: "Pat Example", injured: true }], emergencyCalled: true }));
        const done = await fileAsStaff(f, { whatHappened: "Closed one.", people: [{ name: "Sam Example", injured: true }] });
        await closeIncident(f.store, asStaff(), INCIDENT_RULES, { incidentId: done.id, outcome: "Done." });
        const board = officeIncidents(await state(f), later(DAY));
        expect(board).toMatchObject({ open: 7, hurt: 1, emergency: 1 });
        expect(board.top).toHaveLength(5);
        expect(board.top[0].whatHappened).toBe("Hurt.");
      });
    });
  });
}
