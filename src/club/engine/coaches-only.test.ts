import { describe, expect, it } from "vitest";
import { addDays } from "../time";
import { dayView } from "./availability";
import { bookingLedger, createBooking } from "./bookings";
import { describeRules } from "./describe";
import { endHousehold } from "./households";
import { addBoatOwner } from "./boat-access";
import { setCoach } from "./practices";
import { REAL_CLASS_RULES, STORE_KINDS, TODAY, NOW, addMembers, at, bookAs, fixtureFor, refusalMessages, refusedFor, request, staffCtx, type Fixture } from "./testkit";

/**
 * The 8x (Grant, Nov 5, 2026) and the 4x (Grant, Nov 10) are booked only by coaches and club staff. A member who is not a coach still
 * sees them, marked "Coaches only", but cannot book them. A coach books one without a skill check and can crew it with any active
 * member. Staff book one for anyone, with no reason needed. A private boat of either size is left to its own owners. These tests use
 * the real rules file's classes (REAL_CLASS_RULES), not the engine tests' open quad. Every test runs on both stores, so the
 * in-memory copy and Postgres must agree.
 */

/** Adds an eight to the invented club. The fixture's own boats are the 1x, 2x and 4x. */
async function addEight(f: Fixture, name = "Gull", itemOverrides: Record<string, unknown> = {}): Promise<string> {
  await f.store.transaction(async (s, newId) => {
    s.items.push({ id: newId(), name, classCode: "shell-eight", ruleOverrides: {}, ...itemOverrides });
  });
  const id = (await f.store.read()).items.find((i) => i.name === name)!.id;
  f.i[name] = id;
  return id;
}

const coach = (f: Fixture, who: string) => setCoach(f.store, staffCtx(), f.m[who], true);
const tomorrow = addDays(TODAY, 1);

for (const kind of STORE_KINDS) {
  describe(`coaches-only boats (the 4x and the 8x) on the ${kind} store`, () => {
    const fixture = () => fixtureFor(kind)(REAL_CLASS_RULES);

    describe("who may book", () => {
      it("refuses a member who is not a coach, even one with the highest skill level, and says why", async () => {
        const f = await fixture();
        await addEight(f);
        // Ada holds sculling level 3, the highest in the invented club.
        expect(await refusedFor(bookAs(f, "Ada", "Gull", at(1, 7), at(1, 8)))).toEqual(["coaches_only"]);
        expect(await refusalMessages(bookAs(f, "Ada", "Gull", at(1, 7), at(1, 8)))).toEqual(["Gull can only be booked by coaches and club staff. Ask a coach or club staff to book it."]);
        expect((await f.store.read()).bookings).toEqual([]);
      });

      it("lets a member staff have marked as a coach book it, with no skill level, and any members as crew", async () => {
        const f = await fixture();
        // Even a skill level on the boat itself (iCrew's own level for each boat) is not checked for an eight.
        await addEight(f, "Gull", { requiredQualification: "scull-3" });
        await coach(f, "Cy"); // Cy holds no qualification at all.
        const { booking } = await bookAs(f, "Cy", "Gull", at(1, 7), at(1, 8), ["Ada", "Ben", "Dee", "Eli"]);
        expect(booking).toMatchObject({ bookerId: f.m.Cy, status: "upcoming", crew: [f.m.Ada, f.m.Ben, f.m.Dee, f.m.Eli] });
      });

      it("does not ask the crew to be coaches, or skilled", async () => {
        const f = await fixture();
        await addEight(f);
        await coach(f, "Ada");
        // Dee holds only level 1 and Cy holds nothing: neither is a coach, and neither is refused as crew.
        expect(await refusedFor(bookAs(f, "Ada", "Gull", at(1, 7), at(1, 8), ["Dee", "Cy"]))).toEqual([]);
      });

      it("still applies every ordinary rule to a coach: the seats, a taken slot, and nobody in two boats at once", async () => {
        const f = await fixture();
        await addEight(f);
        const extra = await addMembers(f, 4);
        await coach(f, "Ada");
        await coach(f, "Ben");
        // Seven others fill the eight seats; an eighth other person is one too many.
        const seven = [f.m.Ben, f.m.Cy, f.m.Dee, ...extra];
        expect(await refusedFor(bookAs(f, "Ada", "Gull", at(1, 7), at(1, 8), [...seven, f.m.Eli]))).toEqual(["too_many_crew"]);
        await bookAs(f, "Ada", "Gull", at(1, 7), at(1, 8), seven);
        const reasons = await refusedFor(bookAs(f, "Ben", "Gull", at(1, 7, 30), at(1, 8, 30)));
        expect(reasons).toContain("slot_taken");
        expect(reasons).not.toContain("coaches_only");
      });

      it("stops a coach who is unmarked, or whose household has ended", async () => {
        const f = await fixture();
        await addEight(f);
        await coach(f, "Ada");
        await coach(f, "Dee");
        expect(await refusedFor(bookAs(f, "Ada", "Gull", at(1, 7), at(1, 8)))).toEqual([]);
        await setCoach(f.store, staffCtx(), f.m.Ada, false);
        expect(await refusedFor(bookAs(f, "Ada", "Gull", at(2, 7), at(2, 8)))).toEqual(["coaches_only"]);
        await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Reed);
        expect(await refusedFor(bookAs(f, "Dee", "Gull", at(2, 7), at(2, 8)))).toContain("coaches_only");
      });

      it("lets staff book it for any member, with no reason needed, and records nothing was set aside", async () => {
        const f = await fixture();
        await addEight(f);
        // Eli is not a coach. Staff book on Eli's behalf, as for a lesson, and give no override reason.
        const { booking, waived } = await createBooking(f.store, f.book, staffCtx(), request(f, "Eli", "Gull", at(1, 7), at(1, 8), ["Dee"]));
        expect(booking).toMatchObject({ bookerId: f.m.Eli, status: "upcoming" });
        expect(waived).toEqual([]);
      });

      it("leaves the singles and doubles as they were: a member who is not a coach books a double, with its skill level", async () => {
        const f = await fixture();
        await addEight(f);
        expect(await refusedFor(bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8)))).toEqual([]);
        expect(await refusedFor(bookAs(f, "Eli", "Heron", at(1, 7), at(1, 8)))).toEqual([]);
        // The double still asks for its skill level: Dee holds level 1 and the double needs level 2.
        expect(await refusedFor(bookAs(f, "Dee", "Pelican", at(1, 9), at(1, 10)))).toEqual(["not_qualified"]);
      });
    });

    describe("the 4x is coaches-only too", () => {
      it("refuses a member who is not a coach, even one with the highest skill level, and says why", async () => {
        const f = await fixture();
        expect(await refusedFor(bookAs(f, "Ada", "Albatross", at(1, 7), at(1, 8)))).toEqual(["coaches_only"]);
        expect(await refusalMessages(bookAs(f, "Eli", "Albatross", at(1, 7), at(1, 8)))).toEqual(["Albatross can only be booked by coaches and club staff. Ask a coach or club staff to book it."]);
        expect((await f.store.read()).bookings).toEqual([]);
      });

      it("lets a coach with no skill level book it with any members as crew, even a boat that stores a level", async () => {
        const f = await fixture();
        // A second quad carrying iCrew's own skill level, as the fleet boats do. It is not checked on a coaches-only boat.
        await f.store.transaction(async (s, newId) => {
          s.items.push({ id: newId(), name: "Puffin", classCode: "shell-quad", ruleOverrides: {}, requiredQualification: "scull-3" });
        });
        f.i.Puffin = (await f.store.read()).items.find((i) => i.name === "Puffin")!.id;
        await coach(f, "Cy"); // Cy holds no qualification at all.
        const { booking } = await bookAs(f, "Cy", "Puffin", at(1, 7), at(1, 8), ["Dee", "Ben", "Eli"]);
        expect(booking).toMatchObject({ bookerId: f.m.Cy, status: "upcoming", crew: [f.m.Dee, f.m.Ben, f.m.Eli] });
      });

      it("lets staff book it for a member who is not a coach, with nothing set aside", async () => {
        const f = await fixture();
        const { booking, waived } = await createBooking(f.store, f.book, staffCtx(), request(f, "Dee", "Albatross", at(1, 7), at(1, 8), ["Cy"]));
        expect(booking).toMatchObject({ bookerId: f.m.Dee, status: "upcoming" });
        expect(waived).toEqual([]);
      });

      it("still counts the seats for a coach: four seats, so three others at most", async () => {
        const f = await fixture();
        await coach(f, "Ada");
        expect(await refusedFor(bookAs(f, "Ada", "Albatross", at(1, 7), at(1, 8), ["Ben", "Cy", "Dee", "Eli"]))).toEqual(["too_many_crew"]);
      });
    });

    describe("a private boat of either size", () => {
      it("is booked by its owner, who is not a coach, and is not marked coaches only", async () => {
        const f = await fixture();
        for (const [name, classCode] of [["Tern", "shell-quad"], ["Gannet", "shell-eight"]]) {
          await f.store.transaction(async (s, newId) => {
            s.items.push({ id: newId(), name, classCode, ruleOverrides: {}, isPrivate: true });
          });
          f.i[name] = (await f.store.read()).items.find((i) => i.name === name)!.id;
          await addBoatOwner(f.store, staffCtx(), { itemId: f.i[name], memberId: f.m.Dee });
        }
        expect(await refusedFor(bookAs(f, "Dee", "Tern", at(1, 7), at(1, 8)))).toEqual([]);
        expect(await refusedFor(bookAs(f, "Dee", "Gannet", at(2, 7), at(2, 8)))).toEqual([]);
        const day = dayView(await f.store.read(), f.book, { day: tomorrow, now: NOW, viewer: { kind: "member", memberId: f.m.Dee } });
        for (const name of ["Tern", "Gannet"]) expect(day.items.find((i) => i.item.name === name)).toMatchObject({ coachesOnly: false, coachBlocked: false });
      });
    });

    describe("what members see", () => {
      const view = async (f: Fixture, viewer: Parameters<typeof dayView>[2]["viewer"]) => {
        const day = dayView(await f.store.read(), f.book, { day: tomorrow, now: NOW, viewer });
        return {
          eight: day.items.find((i) => i.item.name === "Gull")!,
          quad: day.items.find((i) => i.item.name === "Albatross")!,
          double: day.items.find((i) => i.item.name === "Loon")!,
        };
      };

      it("shows the eight and the quad to everyone, marks them coaches only, and blocks them for a member who is not a coach", async () => {
        const f = await fixture();
        await addEight(f);
        await coach(f, "Ben");
        const member = await view(f, { kind: "member", memberId: f.m.Ada });
        const theCoach = await view(f, { kind: "member", memberId: f.m.Ben });
        const staff = await view(f, { kind: "staff" });
        for (const boat of ["eight", "quad"] as const) {
          expect(member[boat]).toMatchObject({ coachesOnly: true, coachBlocked: true });
          expect(theCoach[boat]).toMatchObject({ coachesOnly: true, coachBlocked: false });
          expect(staff[boat]).toMatchObject({ coachesOnly: true, coachBlocked: false });
          // Its free times are still free in the data: the page decides to show them as "Coaches only".
          expect(member[boat].slots.some((s) => s.state === "free")).toBe(true);
        }
        // The double is not marked.
        for (const v of [member, theCoach, staff]) expect(v.double).toMatchObject({ coachesOnly: false, coachBlocked: false });
      });

      it("does not show a skill level for the eight or the quad, even when the boat carries one, and still shows the double's", async () => {
        const f = await fixture();
        await addEight(f, "Gull", { requiredQualification: "scull-3" });
        const { eight, quad, double } = await view(f, { kind: "member", memberId: f.m.Ada });
        expect(eight).toMatchObject({ needs: null, qualified: null });
        expect(quad).toMatchObject({ needs: null, qualified: null });
        expect(double.needs).not.toBeNull();
      });

      it("shows a coach's booking as booked to others and as theirs to them, like any boat", async () => {
        const f = await fixture();
        await addEight(f);
        await coach(f, "Ben");
        await bookAs(f, "Ben", "Gull", at(1, 7), at(1, 8));
        const slotAt7 = (v: { eight: { slots: { startsAt: string; state: string }[] } }) => v.eight.slots.find((s) => s.startsAt === at(1, 7).toISOString())!.state;
        expect(slotAt7(await view(f, { kind: "member", memberId: f.m.Ada }))).toBe("booked");
        expect(slotAt7(await view(f, { kind: "member", memberId: f.m.Ben }))).toBe("yours");
      });

      it("says in the rules that only coaches and staff can book it, that no skill is checked, and that any member can crew", async () => {
        const f = await fixture();
        await addEight(f, "Gull", { requiredQualification: "scull-3" });
        const state = await f.store.read();
        const { lines } = describeRules(state, f.book, state.items.find((i) => i.name === "Gull")!);
        expect(lines).toContain("Only coaches and club staff can book this boat. No skill level is checked: the coach decides who rows.");
        expect(lines.some((l) => /You need/.test(l))).toBe(false);
        expect(lines.some((l) => l.includes("any active member can be crew"))).toBe(true);
        // The quad says the same; the double's rules are unchanged.
        const quad = describeRules(state, f.book, state.items.find((i) => i.name === "Albatross")!);
        expect(quad.lines).toContain("Only coaches and club staff can book this boat. No skill level is checked: the coach decides who rows.");
        const double = describeRules(state, f.book, state.items.find((i) => i.name === "Loon")!);
        expect(double.lines.some((l) => /You need/.test(l))).toBe(true);
      });
    });
  });
}
