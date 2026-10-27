import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { booking, icrewCsv, type InventedBooking } from "../sample/icrew";
import { NOW, STORE_KINDS, historyUrls, makeHistoryStore, memberCtx, openAnotherHistory, staffCtx } from "./testkit";
import { HISTORY_PAGE_SIZE, memberHistory, nameReport, planHistoryImport, runHistoryImport, searchHistory } from "./history";

/**
 * The archive of old iCrew bookings, on both stores. Today is Wed Oct 28, 2026; the invented club has these members.
 */
const MEMBERS = [
  { id: "m-pat", firstName: "Pat", lastName: "Example" },
  { id: "m-sam", firstName: "Sam", lastName: "Example" },
  { id: "m-zoe", firstName: "Zoë", lastName: "O'Brien" },
  { id: "m-lee1", firstName: "Lee", lastName: "Twin" },
  { id: "m-lee2", firstName: "Lee", lastName: "Twin" },
];
const csv = (...b: InventedBooking[]) => icrewCsv(b);
const fileFor = (text: string, fileName = "icrew.csv") => ({ fileName, text });

const rejection = async (attempt: Promise<unknown>): Promise<ClubError> => {
  try {
    await attempt;
  } catch (e) {
    if (e instanceof ClubError) return e;
    throw e;
  }
  throw new Error("expected a refusal, but it went through");
};

describe.each(STORE_KINDS)("the archive of old bookings on the %s store", (kind) => {
  const open = () => makeHistoryStore(kind);

  const SMALL = csv(
    booking("2026-03-09", { id: 1001, by: "Pat Example", rowers: "Pat Example (1)" }),
    booking("2026-03-10", { id: 1002, by: "Sam Example", type: "Gym Space", item: "Gym Space 01" }),
    booking("2026-03-11", { id: 1003, by: "Nobody Known", type: "Dock Space", item: "DockSpace01" }),
    booking("2026-03-12", { id: 1004, by: "Lee Twin", item: "Heron Double", rowers: "Lee Twin (1),Pat Example (2)" }),
    booking("2026-03-13", { id: 1005, type: "", item: "Spring Social", by: "Zoe OBrien", out: "", in: "" }),
  );

  describe("planning an import", () => {
    it("says what the file would do, and changes nothing however often it is run", async () => {
      const history = await open();
      const plan = await planHistoryImport(history, MEMBERS, SMALL, NOW);
      expect(plan.problems).toEqual([]);
      expect(plan).toMatchObject({ rowsInFile: 5, toAdd: 5, alreadyStored: 0, futureRows: 0, firstDay: "2026-03-09", lastDay: "2026-03-13" });
      expect(plan.byType).toEqual([
        { itemType: "Shell", rows: 2 },
        { itemType: "Dock Space", rows: 1 },
        { itemType: "Event", rows: 1 },
        { itemType: "Gym Space", rows: 1 },
      ]);
      for (let i = 0; i < 3; i += 1) expect(await planHistoryImport(history, MEMBERS, SMALL, NOW)).toEqual(plan);
      expect((await history.summary()).rows).toBe(0);
    });

    it("sorts the names in the file into one member, more than one member, and no member", async () => {
      const history = await open();
      const plan = await planHistoryImport(history, MEMBERS, SMALL, NOW);
      // pat example, sam example, nobody known, lee twin, zoe obrien
      expect(plan.names).toEqual({ total: 5, matchedOne: 3, matchedMany: 1, matchedNone: 1 });
      expect(plan.unmatched).toEqual([{ name: "Nobody Known", rows: 1 }]);
      expect(plan.notices.join(" ")).toContain("1 name matches no member of the club");
      expect(plan.notices.join(" ")).toContain("1 name matches more than one member");
    });

    it("lists the names that match no member with the most bookings first, ties by name", async () => {
      const history = await open();
      const rows = [
        ...Array.from({ length: 3 }, (_, i) => booking("2026-03-09", { id: 40 + i, by: "Zed Visitor" })),
        booking("2026-03-10", { id: 50, by: "Amy Visitor" }),
        booking("2026-03-10", { id: 51, by: "Bob Visitor" }),
        ...Array.from({ length: 2 }, (_, i) => booking("2026-03-11", { id: 60 + i, by: "Cat Visitor" })),
      ];
      const plan = await planHistoryImport(history, MEMBERS, csv(...rows), NOW);
      expect(plan.unmatched).toEqual([
        { name: "Zed Visitor", rows: 3 },
        { name: "Cat Visitor", rows: 2 },
        { name: "Amy Visitor", rows: 1 },
        { name: "Bob Visitor", rows: 1 },
      ]);
      const many = csv(...Array.from({ length: 25 }, (_, i) => booking("2026-03-09", { id: 100 + i, by: `Visitor${String.fromCharCode(97 + i)} Name` })));
      expect((await planHistoryImport(history, MEMBERS, many, NOW)).unmatched).toHaveLength(20);
    });

    it("reports a file's problems and adds up nothing", async () => {
      const history = await open();
      const plan = await planHistoryImport(history, MEMBERS, "nonsense", NOW);
      expect(plan.problems.length).toBeGreaterThan(0);
      expect(plan).toMatchObject({ toAdd: 0, alreadyStored: 0, firstDay: null, byType: [] });
    });

    it("counts what is already stored, and only what is new", async () => {
      const history = await open();
      await runHistoryImport(history, staffCtx(), fileFor(SMALL));
      const more = csv(booking("2026-03-09", { id: 1001, by: "Pat Example" }), booking("2026-03-20", { id: 1006, by: "Pat Example" }));
      const plan = await planHistoryImport(history, MEMBERS, more, NOW);
      expect(plan).toMatchObject({ rowsInFile: 2, toAdd: 1, alreadyStored: 1, firstDay: "2026-03-20", lastDay: "2026-03-20" });
    });
  });

  describe("adding", () => {
    it("adds exactly what was previewed, and records who did it and when", async () => {
      const history = await open();
      const plan = await planHistoryImport(history, MEMBERS, SMALL, NOW);
      const result = await runHistoryImport(history, staffCtx(), fileFor(SMALL, "march.csv"), { fingerprint: plan.fingerprint, toAdd: plan.toAdd });
      expect(result).toEqual({ added: 5, skipped: 0 });
      const summary = await history.summary();
      expect(summary).toMatchObject({ rows: 5, firstDay: "2026-03-09", lastDay: "2026-03-13" });
      expect(summary.imports).toHaveLength(1);
      expect(summary.imports[0]).toMatchObject({ fileName: "march.csv", importedBy: "Test staff", importedAt: NOW.toISOString(), rowsInFile: 5, rowsAdded: 5, rowsSkipped: 0, firstDay: "2026-03-09", lastDay: "2026-03-13", fingerprint: plan.fingerprint });
    });

    it("is staff only, and a member's attempt adds nothing", async () => {
      const history = await open();
      const e = await rejection(runHistoryImport(history, memberCtx("m-pat", "Pat Example"), fileFor(SMALL)));
      expect(e.code).toBe("forbidden");
      expect((await history.summary()).rows).toBe(0);
    });

    it("adds nothing when the file has a problem", async () => {
      const history = await open();
      const bad = csv(booking("2026-03-09", { id: 1, by: "Pat Example" }), booking("2026-03-10", { id: "x", by: "Sam Example" }));
      const e = await rejection(runHistoryImport(history, staffCtx(), fileFor(bad)));
      expect(e.code).toBe("invalid");
      expect(e.message).toBe("The file has 1 problem, so nothing was added. Fix the file and check it again.");
      expect((await history.summary()).rows).toBe(0);
    });

    it("adds nothing when the file is not the one that was checked", async () => {
      const history = await open();
      const plan = await planHistoryImport(history, MEMBERS, SMALL, NOW);
      const other = csv(booking("2026-03-09", { id: 2001, by: "Pat Example" }));
      const e = await rejection(runHistoryImport(history, staffCtx(), fileFor(other), { fingerprint: plan.fingerprint, toAdd: plan.toAdd }));
      expect(e.code).toBe("conflict");
      expect((await history.summary()).rows).toBe(0);
    });

    it("adds nothing when the file has the same number of new rows as the one checked but is a different file", async () => {
      const history = await open();
      const plan = await planHistoryImport(history, MEMBERS, SMALL, NOW);
      const sameSize = csv(...Array.from({ length: plan.toAdd }, (_, i) => booking("2026-03-09", { id: 3000 + i, by: "Pat Example" })));
      const e = await rejection(runHistoryImport(history, staffCtx(), fileFor(sameSize), { fingerprint: plan.fingerprint, toAdd: plan.toAdd }));
      expect(e.message).toBe("That is not the file you checked, so nothing was added. Check the file again.");
      expect((await history.summary()).rows).toBe(0);
    });

    it("adds nothing when what is stored changed since the check", async () => {
      const history = await open();
      const plan = await planHistoryImport(history, MEMBERS, SMALL, NOW);
      // Someone else adds one of the same bookings first.
      await runHistoryImport(history, staffCtx(), fileFor(csv(booking("2026-03-09", { id: 1001, by: "Pat Example", rowers: "Pat Example (1)" }))));
      const e = await rejection(runHistoryImport(history, staffCtx(), fileFor(SMALL), { fingerprint: plan.fingerprint, toAdd: plan.toAdd }));
      expect(e.message).toBe("The file, or what is already stored, changed since you checked it, so nothing was added. Check the file again.");
      expect((await history.summary()).rows).toBe(1);
    });

    it("refuses a file whose bookings are all stored already, and a file with nothing from the past", async () => {
      const history = await open();
      await runHistoryImport(history, staffCtx(), fileFor(SMALL));
      expect((await rejection(runHistoryImport(history, staffCtx(), fileFor(SMALL)))).message).toBe("Every row in the file is already stored, so there is nothing to add.");
      const future = csv(booking("2026-12-30", { id: 9, by: "Pat Example" }));
      expect((await rejection(runHistoryImport(history, staffCtx(), fileFor(future)))).message).toBe("The file has no past bookings to add.");
      expect((await history.summary()).rows).toBe(5);
    });

    it("adds only the new rows of an overlapping second file, and counts the others as skipped", async () => {
      const history = await open();
      await runHistoryImport(history, staffCtx(), fileFor(SMALL));
      const second = csv(
        booking("2026-03-12", { id: 1004, by: "Lee Twin", item: "Heron Double", rowers: "Lee Twin (1),Pat Example (2)" }),
        booking("2026-03-14", { id: 1007, by: "Sam Example" }),
        booking("2026-12-30", { id: 1008, by: "Sam Example" }),
      );
      expect(await runHistoryImport(history, staffCtx(), fileFor(second, "second.csv"))).toEqual({ added: 1, skipped: 2 });
      const summary = await history.summary();
      expect(summary.rows).toBe(6);
      expect(summary.lastDay).toBe("2026-03-14");
      expect(summary.imports.map((i) => [i.fileName, i.rowsAdded, i.rowsSkipped])).toEqual([["second.csv", 1, 2], ["icrew.csv", 5, 0]]);
    });

    it("stores a booking listed twice in one file once", async () => {
      const history = await open();
      const twice = csv(booking("2026-03-09", { id: 1, by: "Pat Example" }), booking("2026-03-09", { id: 1, by: "Pat Example" }));
      expect(await runHistoryImport(history, staffCtx(), fileFor(twice))).toEqual({ added: 1, skipped: 1 });
    });

    it("lets only one of two simultaneous uploads of the same file in", async () => {
      const history = await open();
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => runHistoryImport(history, staffCtx(), fileFor(SMALL))));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((x) => x.status === "rejected")) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ClubError);
      expect((await history.summary()).rows).toBe(5);
    });

    it("lets overlapping files in at the same time without a raw database error, each booking stored once", async () => {
      const history = await open();
      const shared = Array.from({ length: 10 }, (_, j) => booking("2026-04-03", { id: 20_000 + j, by: "Shared Rower" }));
      const files = Array.from({ length: 6 }, (_, i) => csv(...shared, ...Array.from({ length: 10 }, (_, j) => booking("2026-04-04", { id: 30_000 + i * 100 + j, by: `Own${i} Rower` }))));
      const results = await Promise.allSettled(files.map((f, i) => runHistoryImport(history, staffCtx(), fileFor(f, `o${i}.csv`))));
      expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason?.message)).toEqual([]);
      expect((await history.summary()).rows).toBe(10 + 60);
    });

    it("keeps its book when many different files are added at the same time", async () => {
      const history = await open();
      const files = Array.from({ length: 8 }, (_, i) => csv(...Array.from({ length: 25 }, (_, j) => booking("2026-04-02", { id: 10_000 + i * 100 + j, by: `Person${i} Example` }))));
      await Promise.all(files.map((f, i) => runHistoryImport(history, staffCtx(), fileFor(f, `f${i}.csv`))));
      const summary = await history.summary();
      expect(summary.rows).toBe(200);
      expect(summary.imports).toHaveLength(8);
    });

    it("adds three thousand bookings in one go", async () => {
      const history = await open();
      const many = csv(...Array.from({ length: 3000 }, (_, i) => booking(`2026-0${1 + (i % 9)}-1${i % 9}`, { id: 100_000 + i, by: `Person${i % 400} Example`, rowers: i % 7 === 0 ? `Person${i % 400} Example (1),Other${i % 50} Example (2)` : "" })));
      const plan = await planHistoryImport(history, MEMBERS, many, NOW);
      expect(plan.toAdd).toBe(3000);
      expect(await runHistoryImport(history, staffCtx(), fileFor(many), { fingerprint: plan.fingerprint, toAdd: 3000 })).toEqual({ added: 3000, skipped: 0 });
      expect((await history.summary()).rows).toBe(3000);
      expect((await history.names()).length).toBe(450);
    });
  });

  describe("a member's own old bookings", () => {
    const setup = async () => {
      const history = await open();
      await runHistoryImport(history, staffCtx(), fileFor(SMALL));
      return history;
    };

    it("shows a member the bookings they reserved or rowed, newest first, in words", async () => {
      const history = await setup();
      const pat = await memberHistory(history, MEMBERS, "m-pat");
      expect(pat).toMatchObject({ findable: true, total: 2, page: 1, pages: 1 });
      // Pat reserved 1001 and rowed in the double that Lee Twin reserved (1004).
      expect(pat.items.map((i) => [i.day, i.itemName, i.role, i.others])).toEqual([
        ["2026-03-12", "Heron Double", "You were in the boat", 1],
        ["2026-03-09", "Cormorant", "You reserved it and were in the boat", 0],
      ]);
      expect(pat.items[1]).toMatchObject({ itemType: "Shell", startsAt: "2026-03-09T14:00:00.000Z", endsAt: "2026-03-09T15:00:00.000Z" });
    });

    it("matches an accent and an apostrophe, and says an event was signed up for", async () => {
      const history = await setup();
      const zoe = await memberHistory(history, MEMBERS, "m-zoe");
      expect(zoe.items.map((i) => [i.itemName, i.role])).toEqual([["Spring Social", "You signed up"]]);
    });

    it("never shows another member's bookings, or their names", async () => {
      const history = await setup();
      const sam = await memberHistory(history, MEMBERS, "m-sam");
      expect(sam.items.map((i) => i.itemName)).toEqual(["Gym Space 01"]);
      expect(JSON.stringify(sam)).not.toMatch(/Example|Twin|Nobody/);
      const pat = await memberHistory(history, MEMBERS, "m-pat");
      expect(JSON.stringify(pat)).not.toMatch(/Lee|Twin/);
    });

    it("shows nothing, and says why, to a member whose name another member shares", async () => {
      const history = await setup();
      const lee = await memberHistory(history, MEMBERS, "m-lee1");
      expect(lee).toMatchObject({ findable: false, total: 0, items: [] });
      expect(await memberHistory(history, MEMBERS, "m-lee2")).toMatchObject({ findable: false, items: [] });
    });

    it("counts a former member with the same name too, so nobody is shown the wrong person's outings", async () => {
      const history = await setup();
      const withFormer = [...MEMBERS, { id: "m-old-pat", firstName: "Pat", lastName: "Example" }];
      expect(await memberHistory(history, withFormer, "m-pat")).toMatchObject({ findable: false, items: [] });
    });

    it("finds a joint booking for both of the people on it", async () => {
      const history = await open();
      await runHistoryImport(history, staffCtx(), fileFor(csv(booking("2026-03-09", { id: 7, by: "Pat & Sam Example", rowers: "Pat Example (1)" }))));
      expect((await memberHistory(history, MEMBERS, "m-pat")).items).toHaveLength(1);
      const sam = await memberHistory(history, MEMBERS, "m-sam");
      expect(sam.items).toHaveLength(1);
      expect(sam.items[0].others).toBe(1);
    });

    it("pages through a long history, newest first, 50 at a time", async () => {
      const history = await open();
      const many = csv(...Array.from({ length: 120 }, (_, i) => booking(`2026-0${1 + Math.floor(i / 30)}-${String((i % 28) + 1).padStart(2, "0")}`, { id: 500 + i, by: "Pat Example", item: `Boat ${i}` })));
      await runHistoryImport(history, staffCtx(), fileFor(many));
      const first = await memberHistory(history, MEMBERS, "m-pat");
      expect(first).toMatchObject({ total: 120, page: 1, pages: 3 });
      expect(first.items).toHaveLength(HISTORY_PAGE_SIZE);
      const third = await memberHistory(history, MEMBERS, "m-pat", 3);
      expect(third.items).toHaveLength(20);
      const days = [...first.items, ...(await memberHistory(history, MEMBERS, "m-pat", 2)).items, ...third.items].map((i) => i.day);
      expect(days).toEqual([...days].sort().reverse());
      // A page past the end shows the last page; nonsense shows the first.
      expect((await memberHistory(history, MEMBERS, "m-pat", 99)).page).toBe(3);
      expect((await memberHistory(history, MEMBERS, "m-pat", -4)).page).toBe(1);
      expect((await memberHistory(history, MEMBERS, "m-pat", Number.NaN)).page).toBe(1);
    });

    it("shows nothing for someone who has no bookings, or who is not a member", async () => {
      const history = await setup();
      expect(await memberHistory(history, [{ id: "x", firstName: "No", lastName: "History" }], "x")).toMatchObject({ findable: true, total: 0, items: [] });
      expect(await memberHistory(history, MEMBERS, "nobody")).toMatchObject({ total: 0, items: [] });
    });
  });

  describe("what staff can find", () => {
    it("searches by the start of a name, newest first, and tells who each name matches", async () => {
      const history = await open();
      await runHistoryImport(history, staffCtx(), fileFor(SMALL));
      const { found, tooShort } = await searchHistory(history, MEMBERS, "pat ex");
      expect(tooShort).toBe(false);
      expect(found.map((f) => f.reservation.sourceId)).toEqual(["1004", "1001"]);
      expect(found[0].people).toEqual([
        { name: "Lee Twin", role: "booker", matches: "many" },
        { name: "Lee Twin", role: "rower", matches: "many" },
        { name: "Pat Example", role: "rower", matches: "one" },
      ]);
      const none = await searchHistory(history, MEMBERS, "nobody");
      expect(none.found.map((f) => f.people[0].matches)).toEqual(["none"]);
    });

    it("wants at least three letters", async () => {
      const history = await open();
      await runHistoryImport(history, staffCtx(), fileFor(SMALL));
      expect(await searchHistory(history, MEMBERS, "pa")).toEqual({ tooShort: true, found: [] });
      expect(await searchHistory(history, MEMBERS, "")).toEqual({ tooShort: false, found: [] });
    });

    it("lists every name with how it matches the members", async () => {
      const history = await open();
      await runHistoryImport(history, staffCtx(), fileFor(SMALL));
      const report = await nameReport(history, MEMBERS);
      expect(report).toMatchObject({ total: 5, matchedOne: 3 });
      expect(report.none).toEqual([{ key: "nobody known", name: "Nobody Known", rows: 1 }]);
      expect(report.many).toEqual([{ key: "lee twin", name: "Lee Twin", rows: 1, members: 2 }]);
    });
  });

  it("stores a booking handed to it twice once, and spells a name the same way on both stores", async () => {
    const history = await open();
    const row = {
      key: "a".repeat(64),
      sourceId: "1",
      day: "2026-03-09",
      startsAt: "2026-03-09T14:00:00.000Z",
      endsAt: "2026-03-09T15:00:00.000Z",
      bookedAt: null,
      itemType: "Shell",
      itemName: "Cormorant",
      oars: "",
      bookedBy: "Pat Example",
      rowers: "",
      outText: "",
      inText: "",
      people: [{ name: "Pat Example", key: "pat example", role: "booker" as const }],
    };
    const other = { ...row, key: "b".repeat(64), sourceId: "2", people: [{ name: "pat example", key: "pat example", role: "booker" as const }] };
    const a = { fileName: "a.csv", fingerprint: "c".repeat(64), by: "Test staff", at: NOW, rowsInFile: 3, rows: [other, row, row] };
    expect(await history.add(a, null)).toEqual({ added: 2, skipped: 1 });
    expect((await history.summary()).rows).toBe(2);
    // The same person written two ways: the plain-sorted first spelling is the one shown.
    expect(await history.names()).toEqual([{ key: "pat example", name: "Pat Example", rows: 2 }]);
  });

  it("limits a search, and treats percent signs and underscores as ordinary characters", async () => {
    const history = await open();
    await runHistoryImport(history, staffCtx(), fileFor(SMALL));
    expect(await history.search("pat", 1)).toHaveLength(1);
    expect((await history.search("pat", 50)).length).toBeGreaterThan(1);
    expect(await history.search("%", 10)).toEqual([]);
    expect(await history.search("p_t", 10)).toEqual([]);
  });

  it("gives the same answers whichever store keeps it", async () => {
    const history = await open();
    await runHistoryImport(history, staffCtx(), fileFor(SMALL));
    const names = await history.names();
    expect(names.map((n) => [n.key, n.name, n.rows])).toEqual([
      ["pat example", "Pat Example", 2],
      ["lee twin", "Lee Twin", 1],
      ["nobody known", "Nobody Known", 1],
      ["sam example", "Sam Example", 1],
      ["zoe obrien", "Zoe OBrien", 1],
    ]);
    expect((await history.forName("pat example", 10, 0)).items.map((i) => i.reservation.sourceId)).toEqual(["1004", "1001"]);
    expect(Array.from(await history.existingKeys(["nope"]))).toEqual([]);
  });
});

describe.skipIf(!STORE_KINDS.includes("postgres"))("two app servers sharing one archive", () => {
  it("add a file once between them, and each sees what the other added", async () => {
    const one = await makeHistoryStore("postgres");
    const two = openAnotherHistory(historyUrls.get(one)!);
    const text = icrewCsv([booking("2026-03-09", { id: 1, by: "Pat Example" }), booking("2026-03-10", { id: 2, by: "Pat Example" })]);
    const results = await Promise.allSettled([1, 2, 3, 4].map((i) => runHistoryImport(i % 2 ? one : two, staffCtx(), { fileName: "same.csv", text })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await one.summary()).rows).toBe(2);
    expect((await two.summary()).rows).toBe(2);
    await runHistoryImport(two, staffCtx(), { fileName: "next.csv", text: icrewCsv([booking("2026-03-11", { id: 3, by: "Pat Example" })]) });
    expect((await memberHistory(one, MEMBERS, "m-pat")).total).toBe(3);
  });
});
