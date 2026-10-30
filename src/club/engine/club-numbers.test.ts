import { describe, expect, it } from "vitest";
import { RULE_BOOK } from "../settings/rulebook";
import { pacificWall } from "../time";
import { lengthChoices } from "../web";
import { describeRules } from "./describe";
import { STORE_KINDS, at, bookAs, fixtureFor, refusalMessages, refusedFor, ruleBookWith } from "./testkit";

/**
 * The club's own booking numbers, as the rules file ships them (copied from iCrew's Reservation Settings on Oct 30, 2026): 14 days
 * ahead, 90 minutes to start with and up to 4 hours, and no limit on how many bookings a member holds or makes in a day. The other
 * engine tests run on fixed test numbers (testkit.ts), so editing the file never breaks them; these tests hold the file itself.
 */

for (const kind of STORE_KINDS) {
  describe(`the club's own booking numbers on the ${kind} store`, () => {
    const club = () => fixtureFor(kind)(RULE_BOOK);

    it("let a booking be made 14 days ahead and refuse the 15th day, in words that name the opening day", async () => {
      const f = await club();
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(14, 7), at(14, 8)))).toEqual([]);
      expect(await refusalMessages(bookAs(f, "Ben", "Heron", at(15, 7), at(15, 8)))).toEqual(["You can book up to 14 days ahead. Thursday, Nov 12 opens Thursday, Oct 29 at midnight."]);
    });

    it("open a new day at midnight Pacific: one minute before is too early and the minute itself is fine", async () => {
      const f = await club();
      const before = pacificWall("2026-10-28", 1439);
      const opening = pacificWall("2026-10-29", 0);
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(15, 7), at(15, 8), [], undefined, before))).toEqual(["too_far_ahead"]);
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(15, 7), at(15, 8), [], undefined, opening))).toEqual([]);
    });

    it("take 90 minutes and 4 hours, and refuse 4 hours and a half", async () => {
      const f = await club();
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8, 30)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ben", "Osprey", at(1, 7), at(1, 11)))).toEqual([]);
      expect(await refusalMessages(bookAs(f, "Dee", "Kingfisher", at(1, 7), at(1, 11, 30)))).toEqual(["The longest booking is 4 hours."]);
    });

    it("put no limit on how many bookings one member holds at once or makes in a day", async () => {
      const f = await club();
      // Six non-overlapping outings on one day, in different boats, and six more on the six days after: none is refused for a limit.
      for (const [i, boat] of ["Heron", "Osprey", "Kingfisher", "Heron", "Osprey", "Kingfisher"].entries()) {
        expect(await refusedFor(bookAs(f, "Ada", boat, at(2, 6 + i * 2), at(2, 7 + i * 2)))).toEqual([]);
      }
      for (let d = 3; d <= 8; d++) expect(await refusedFor(bookAs(f, "Ada", "Heron", at(d, 7), at(d, 8)))).toEqual([]);
      const mine = (await f.store.read()).bookings.filter((b) => b.bookerId === f.m.Ada && b.status === "upcoming");
      expect(mine).toHaveLength(12);
    });

    it("still refuse a member in two boats at once, whatever the limits", async () => {
      const f = await club();
      await bookAs(f, "Ada", "Heron", at(2, 7), at(2, 8, 30));
      expect(await refusedFor(bookAs(f, "Ada", "Osprey", at(2, 8), at(2, 9)))).toEqual(["person_busy"]);
    });

    it("say in the rules that there is no limit, and offer lengths from 30 minutes to 4 hours", async () => {
      const f = await club();
      const state = await f.store.read();
      const heron = state.items.find((i) => i.name === "Heron")!;
      const lines = describeRules(state, RULE_BOOK, heron).lines;
      expect(lines[0]).toBe("Book up to 14 days ahead. A new day opens at midnight Pacific time.");
      expect(lines).toContain("The shortest booking is 30 minutes and the longest is 4 hours.");
      expect(lines).toContain("There is no limit on how many shell bookings you can hold or make in a day.");
      expect(lengthChoices(RULE_BOOK.defaults)).toEqual([30, 60, 90, 120, 150, 180, 210, 240]);
      expect(lengthChoices(RULE_BOOK.defaults)).toContain(RULE_BOOK.defaults.defaultMinutes);
    });
  });

  describe(`a limit of 0 turns off only that limit, on the ${kind} store`, () => {
    it("with no limit on holding but one a day: a second booking the same day is refused, bookings on other days are not", async () => {
      const f = await fixtureFor(kind)(ruleBookWith({ maxFuturePerType: 0, maxPerDayPerType: 1 }));
      await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      expect(await refusedFor(bookAs(f, "Ada", "Osprey", at(1, 10), at(1, 11)))).toEqual(["over_daily_limit"]);
      for (let d = 2; d <= 6; d++) expect(await refusedFor(bookAs(f, "Ada", "Heron", at(d, 7), at(d, 8)))).toEqual([]);
      const state = await f.store.read();
      const words = describeRules(state, f.book, state.items.find((i) => i.name === "Heron")!).lines;
      expect(words).toContain("There is no limit on how many upcoming shell bookings you can hold, and you can have 1 a day.");
    });

    it("with a limit on holding but none a day: three the same day are fine up to the holding limit, then refused", async () => {
      const f = await fixtureFor(kind)(ruleBookWith({ maxFuturePerType: 3, maxPerDayPerType: 0 }));
      for (const [i, boat] of ["Heron", "Osprey", "Kingfisher"].entries()) expect(await refusedFor(bookAs(f, "Ada", boat, at(1, 7 + i * 2), at(1, 8 + i * 2)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(2, 7), at(2, 8)))).toEqual(["over_future_limit"]);
      const state = await f.store.read();
      const words = describeRules(state, f.book, state.items.find((i) => i.name === "Heron")!).lines;
      expect(words).toContain("You can hold 3 upcoming shell bookings at once, with no limit on how many you make in a day.");
    });

    it("with both limits set, says both, and a single one in the singular", async () => {
      const f = await fixtureFor(kind)(ruleBookWith({ maxFuturePerType: 1, maxPerDayPerType: 1 }));
      const state = await f.store.read();
      expect(describeRules(state, f.book, state.items.find((i) => i.name === "Heron")!).lines).toContain("You can hold 1 upcoming shell booking at once, and have 1 a day.");
      await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      expect(await refusedFor(bookAs(f, "Ada", "Osprey", at(2, 7), at(2, 8)))).toEqual(["over_future_limit"]);
    });
  });
}
