import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { addDays, pacificWall } from "../time";
import { BookingRefused, affectedBookings, cancelBooking, checkBooking, createBooking, outOfServiceAt, returnToService, takeOutOfService } from "./bookings";
import { NOW, STORE_KINDS, cancelEverything, TODAY, at, bookAs, fixtureFor, memberCtx, refusalMessages, refusedFor, request, staffCtx, mark } from "./testkit";

describe.each(STORE_KINDS)("on the %s store", (kind) => {
  const fixture = fixtureFor(kind);

  describe("a simple booking", () => {
    it("is made, owned by the booker, and starts as upcoming", async () => {
      const f = await fixture();
      const { booking, waived } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      expect(waived).toEqual([]);
      expect(booking).toMatchObject({ bookerId: f.m.Ada, itemId: f.i.Heron, status: "upcoming", crew: [], cancelledBy: null, cancelReason: null, override: null, removedCrew: [] });
      expect(booking.startsAt).toBe(at(1, 7).toISOString());
      expect((await f.store.read()).bookings).toHaveLength(1);
    });

    it("is refused in words, with every reason, never a bare error", async () => {
      const f = await fixture();
      // Cy has no qualification and asks for 3 hours at 4:45 am, two weeks ahead.
      const messages = await refusalMessages(bookAs(f, "Cy", "Heron", at(14, 4, 45), at(14, 7, 45)));
      expect(messages).toEqual([
        "You can book up to 7 days ahead. Wednesday, Nov 11 opens Wednesday, Nov 4 at midnight.",
        "Heron can be booked from 5:00 am to 8:00 pm.",
        "Bookings run in 30-minute steps, counted from 5:00 am.",
        "The longest booking is 2 hours.",
        "You need Sculling level 1 (placeholder) to use Heron.",
      ]);
    });

    it("refuses an end before the start, and a time that has already begun", async () => {
      const f = await fixture();
      expect(await refusalMessages(bookAs(f, "Ada", "Heron", at(1, 8), at(1, 7)))).toEqual(["The end time must be after the start time."]);
      expect(await refusalMessages(bookAs(f, "Ada", "Heron", at(0, 12), at(0, 13)))).toEqual(["That time has already started. Choose a later time."]);
      expect(await refusalMessages(bookAs(f, "Ada", "Heron", at(0, 13, 30), at(0, 14)))).toEqual([]);
    });
  });

  describe("how far ahead a member can book", () => {
    // Today is Wed Oct 28 at 1 pm. Seven days ahead is Wed Nov 4, which is open. Thu Nov 5 opens at midnight tonight.
    it("allows the last open day and refuses the first day beyond it", async () => {
      const f = await fixture();
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(7, 5), at(7, 6)))).toEqual([]);
      const messages = await refusalMessages(bookAs(f, "Ada", "Osprey", at(8, 5), at(8, 6)));
      expect(messages).toEqual(["You can book up to 7 days ahead. Thursday, Nov 5 opens Thursday, Oct 29 at midnight."]);
    });

    it("opens a new day exactly at midnight Pacific: one minute before is refused, the stroke of midnight is allowed", async () => {
      const f = await fixture();
      const nov5 = at(8, 5);
      const end = at(8, 5, 30);
      const oneMinuteBefore = new Date("2026-10-29T06:59:00Z"); // 11:59 pm Wed Oct 28
      const midnight = new Date("2026-10-29T07:00:00Z"); // 12:00 am Thu Oct 29
      expect(await refusedFor(bookAs(f, "Ada", "Heron", nov5, end, [], undefined, oneMinuteBefore))).toEqual(["too_far_ahead"]);
      expect(await refusedFor(bookAs(f, "Ada", "Heron", nov5, end, [], undefined, midnight))).toEqual([]);
    });

    it("rolls over each midnight: the window moves one day, day after day", async () => {
      const f = await fixture();
      for (let n = 0; n < 5; n++) {
        const today = addDays(TODAY, n);
        const justAfterMidnight = pacificWall(today, 1);
        const justBeforeMidnight = pacificWall(today, 24 * 60 - 1);
        const lastOpen = pacificWall(addDays(today, 7), 5 * 60);
        const firstClosed = pacificWall(addDays(today, 8), 5 * 60);
        const book = (start: Date, now: Date) => refusedFor(bookAs(f, "Dee", "Kingfisher", start, new Date(start.getTime() + 1800000), [], undefined, now));
        expect(await book(lastOpen, justAfterMidnight), `day ${n} last open`).toEqual([]);
        await cancelEverything(f);
        expect(await book(firstClosed, justBeforeMidnight), `day ${n} first closed, before midnight`).toEqual(["too_far_ahead"]);
        expect(await book(firstClosed, pacificWall(addDays(today, 1), 0)), `day ${n} first closed, at midnight`).toEqual([]);
        await cancelEverything(f);
      }
    });

    it("follows the settings: a different window and opening time change the answer without touching code", async () => {
      const { ruleBookWith } = await import("./testkit");
      const f = await fixture(ruleBookWith({ windowDays: 2, opensAt: "06:00" }));
      // Wed 1 pm: Fri Oct 30 opens Wed 6 am (open); Sat Oct 31 opens Thu Oct 29 at 6:00 am.
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(2, 7), at(2, 8)))).toEqual([]);
      expect(await refusalMessages(bookAs(f, "Ada", "Osprey", at(3, 7), at(3, 8)))).toEqual(["You can book up to 2 days ahead. Saturday, Oct 31 opens Thursday, Oct 29 at 6:00 am."]);
    });
  });


  describe("how long a booking can be", () => {
    it("allows the shortest and longest, and refuses one step short or over", async () => {
      const f = await fixture();
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(1, 7), at(1, 7, 30)))).toEqual([]); // 30 minutes
      expect(await refusedFor(bookAs(f, "Ben", "Heron", at(2, 7), at(2, 9)))).toEqual([]); // 2 hours
      expect(await refusalMessages(bookAs(f, "Dee", "Heron", at(3, 7), at(3, 9, 30)))).toEqual(["The longest booking is 2 hours."]); // one 30-minute step over
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(3, 7), at(3, 7)))).toEqual(["starts_in_past"]); // zero length is not a booking
    });

    it("refuses a booking that is not a whole number of steps, or does not start on one", async () => {
      const f = await fixture();
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(1, 7), at(1, 7, 45)))).toEqual(["not_on_slot"]);
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(1, 7, 15), at(1, 7, 45)))).toEqual(["not_on_slot"]);
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(1, 7, 10), at(1, 7, 40)))).toEqual(["not_on_slot"]);
    });

    it("uses an item's own limit when it has one", async () => {
      const f = await fixture();
      await f.store.transaction(async (s) => {
        s.items.find((i) => i.name === "Loon")!.ruleOverrides = { maxMinutes: 60 };
      });
      expect(await refusalMessages(bookAs(f, "Ben", "Loon", at(1, 7), at(1, 8, 30)))).toEqual(["The longest booking is 1 hour."]);
      expect(await refusedFor(bookAs(f, "Ben", "Loon", at(1, 7), at(1, 8)))).toEqual([]);
    });

    it("keeps to the bookable hours: 5 am to 8 pm, edge to edge", async () => {
      const f = await fixture();
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(1, 5), at(1, 5, 30)))).toEqual([]); // first slot
      expect(await refusedFor(bookAs(f, "Ben", "Heron", at(2, 19, 30), at(2, 20)))).toEqual([]); // last slot
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(3, 4, 30), at(3, 5)))).toEqual(["outside_hours"]);
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(3, 20), at(3, 20, 30)))).toEqual(["outside_hours"]);
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(3, 19, 30), at(3, 20, 30)))).toEqual(["outside_hours"]); // runs one step past closing
    });
  });

  describe("limits on one member", () => {
    it("holds two upcoming bookings of a type at once and refuses the third", async () => {
      const f = await fixture();
      await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      await bookAs(f, "Ada", "Heron", at(2, 7), at(2, 8));
      const messages = await refusalMessages(bookAs(f, "Ada", "Heron", at(3, 7), at(3, 8)));
      expect(messages).toEqual(["You already hold 2 shell bookings, the most allowed at once. Cancel one or wait until one is done."]);
    });

    it("counts shells and kayaks separately", async () => {
      const f = await fixture();
      await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      await bookAs(f, "Ada", "Heron", at(2, 7), at(2, 8));
      expect(await refusedFor(bookAs(f, "Ada", "Otter", at(3, 7), at(3, 8)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ada", "Skimmer", at(3, 9), at(3, 10)))).toEqual([]);
    });

    it("allows one booking of a type per day and refuses a second that day, but not on another day", async () => {
      const f = await fixture();
      await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      const messages = await refusalMessages(bookAs(f, "Ada", "Osprey", at(1, 15), at(1, 16)));
      expect(messages).toEqual(["You can have 1 shell booking a day, and you already have one on Thursday, Oct 29."]);
      expect(await refusedFor(bookAs(f, "Ada", "Osprey", at(2, 15), at(2, 16)))).toEqual([]);
    });

    it("counts the day on the Pacific clock, not UTC", async () => {
      const f = await fixture();
      // 6 pm Pacific is already the next day in UTC; it still counts as the same Pacific day as 7 am.
      await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      expect(await refusedFor(bookAs(f, "Ada", "Osprey", at(1, 18), at(1, 19)))).toEqual(["over_daily_limit"]);
    });

    it("is one past the limit only: with one booking the next is fine, at the limit it is not", async () => {
      const f = await fixture();
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(1, 7), at(1, 8)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(2, 7), at(2, 8)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(3, 7), at(3, 8)))).toEqual(["over_future_limit"]);
    });

    it("does not count a booking that has finished or was cancelled", async () => {
      const f = await fixture();
      const first = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      await bookAs(f, "Ada", "Heron", at(2, 7), at(2, 8));
      await cancelBooking(f.store, f.book, memberCtx(f.m.Ada), first.booking.id);
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(3, 7), at(3, 8)))).toEqual([]);
    });
  });

  describe("skill levels", () => {
    it("refuses an unqualified member on a restricted boat and says what is needed", async () => {
      const f = await fixture();
      expect(await refusalMessages(bookAs(f, "Cy", "Heron", at(1, 7), at(1, 8)))).toEqual(["You need Sculling level 1 (placeholder) to use Heron."]);
      // Dee holds level 1: fine on a single, not on the double or the quad.
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(1, 7), at(1, 8)))).toEqual([]);
      expect(await refusalMessages(bookAs(f, "Dee", "Loon", at(2, 7), at(2, 8)))).toEqual(["You need Sculling level 2 (placeholder) to use Loon."]);
      expect(await refusedFor(bookAs(f, "Dee", "Albatross", at(2, 7), at(2, 8)))).toEqual(["not_qualified"]);
    });

    it("lets a higher level use a lower boat, and says the name when staff book for someone", async () => {
      const f = await fixture();
      expect(await refusedFor(bookAs(f, "Eli", "Heron", at(1, 7), at(1, 8)))).toEqual([]); // level 3 on a level 1 boat
      const messages = await refusalMessages(createBooking(f.store, f.book, staffCtx(), request(f, "Cy", "Osprey", at(1, 9), at(1, 10))));
      expect(messages).toEqual(["Cy Quill needs Sculling level 1 (placeholder) to use Osprey."]);
    });

    it("needs nothing for kayaks, paddle boards and dock space", async () => {
      const f = await fixture();
      for (const [n, item] of ["Otter", "Skimmer", "Dock slip A"].entries()) {
        expect(await refusedFor(bookAs(f, "Cy", item, at(1 + n, 7), at(1 + n, 8))), item).toEqual([]);
      }
    });
  });

  describe("the same boat cannot be booked twice", () => {
    it("refuses an overlap of any kind but allows back to back", async () => {
      const f = await fixture();
      await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      const overlaps: [number, number, number, number][] = [
        [7, 0, 8, 0], // identical
        [6, 30, 7, 30], // overlaps the start
        [7, 30, 8, 30], // overlaps the end
        [7, 30, 8, 0], // inside it
        [6, 30, 8, 30], // around it
      ];
      for (const [h1, m1, h2, m2] of overlaps) {
        expect(await refusalMessages(bookAs(f, "Dee", "Heron", at(1, h1, m1), at(1, h2, m2))), `${h1}:${m1}-${h2}:${m2}`).toEqual(["Heron is already booked from 7:00 to 8:00 am."]);
      }
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(1, 6), at(1, 7)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Eli", "Heron", at(1, 8), at(1, 9)))).toEqual([]);
    });

    it("frees the slot when the booking is cancelled, for anyone", async () => {
      const f = await fixture();
      const { booking } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(1, 7), at(1, 8)))).toEqual(["slot_taken"]);
      await cancelBooking(f.store, f.book, memberCtx(f.m.Ada), booking.id);
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(1, 7), at(1, 8)))).toEqual([]);
    });

    it("can ask for a gap between bookings, and is off by default", async () => {
      const { ruleBookWith } = await import("./testkit");
      const f = await fixture(ruleBookWith({ gapMinutes: 30 }));
      await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      expect(await refusalMessages(bookAs(f, "Dee", "Heron", at(1, 8), at(1, 9)))).toEqual(["Heron needs 30 minutes free between bookings."]);
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(1, 8, 30), at(1, 9)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Eli", "Heron", at(1, 6), at(1, 6, 30)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ben", "Heron", at(1, 6, 30), at(1, 7)))).toEqual(["gap_needed"]);
    });
  });

  describe("multi-seat boats and crew", () => {
    it("books a double with a qualified crewmate", async () => {
      const f = await fixture();
      const { booking } = await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ben"]);
      expect(booking.crew).toEqual([f.m.Ben]);
      expect(booking.bookerId).toBe(f.m.Ada);
    });

    it("allows a double to go out with one person, and a quad needs every seat's rower at level 3", async () => {
      const f = await fixture();
      expect(await refusedFor(bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8)))).toEqual([]); // a double with only one aboard
      expect(await refusedFor(bookAs(f, "Eli", "Albatross", at(2, 7), at(2, 8), ["Ada"]))).toEqual([]); // both hold level 3
      expect(await refusedFor(bookAs(f, "Eli", "Albatross", at(3, 7), at(3, 8), ["Ada", "Ben"]))).toEqual(["crew_not_qualified"]); // Ben holds only level 2
      expect(await refusalMessages(bookAs(f, "Eli", "Albatross", at(3, 7), at(3, 8), ["Ada", "Ben", "Dee", "Cy"]))).toContain("Albatross has 4 seats, so there is room for 3 other people.");
    });

    it("refuses too many crew, in words", async () => {
      const f = await fixture();
      expect(await refusalMessages(bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ben", "Eli"]))).toEqual(["Loon has 2 seats, so there is room for 1 other person."]);
      expect(await refusalMessages(bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8), ["Ben"]))).toEqual(["Heron has room for one person."]);
    });

    it("requires every crew member to be qualified too, and names the one who is not", async () => {
      const f = await fixture();
      expect(await refusalMessages(bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Dee"]))).toEqual(["Dee Reed needs Sculling level 2 (placeholder) to crew Loon."]);
      expect(await refusalMessages(bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Cy"]))).toEqual(["Cy Quill needs Sculling level 2 (placeholder) to crew Loon."]);
    });

    it("does not let anyone be in two boats at once, as booker or crew", async () => {
      const f = await fixture();
      await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ben"]);
      // Ben is crew on the Loon 7 to 8; he cannot take a single then, or crew another boat.
      expect(await refusalMessages(bookAs(f, "Ben", "Heron", at(1, 7, 30), at(1, 8, 30)))).toEqual(["You are already on another boat from 7:00 to 8:00 am."]);
      expect(await refusalMessages(bookAs(f, "Eli", "Pelican", at(1, 7, 30), at(1, 8), ["Ben"]))).toEqual(["Ben Quill is already on another boat from 7:00 to 8:00 am."]);
      // At another time, or on something that is not a boat, it is fine.
      expect(await refusedFor(bookAs(f, "Ben", "Heron", at(1, 8), at(1, 9)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ben", "Dock slip A", at(1, 7), at(1, 9)))).toEqual([]);
    });

    it("does not count crew toward their own limits", async () => {
      const f = await fixture();
      // Eli crews a double three days running, then still has all of his own bookings available.
      await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Eli"]);
      await bookAs(f, "Ben", "Loon", at(2, 7), at(2, 8), ["Eli"]);
      await bookAs(f, "Ada", "Loon", at(3, 7), at(3, 8), ["Eli"]);
      expect(await refusedFor(bookAs(f, "Eli", "Heron", at(1, 9), at(1, 10)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Eli", "Heron", at(2, 9), at(2, 10)))).toEqual([]);
    });

    it("refuses a crew member listed twice, or the booker listed as crew, as a mistake rather than a rule", async () => {
      const f = await fixture();
      await expect(bookAs(f, "Ada", "Albatross", at(1, 7), at(1, 8), ["Ben", "Ben"])).rejects.toThrow("listed twice");
      await expect(bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ada"])).rejects.toThrow("already in the boat");
    });
  });

  describe("out of service", () => {
    it("blocks new bookings that overlap the period and says why and until when", async () => {
      const f = await fixture();
      await takeOutOfService(f.store, staffCtx(), f.i.Heron, { from: at(1, 0), until: at(5, 0), reason: "Rigger being repaired", expectedReturn: "2026-11-02" });
      expect(await refusalMessages(bookAs(f, "Ada", "Heron", at(2, 7), at(2, 8)))).toEqual(["Heron is out of service (Rigger being repaired), expected back Nov 2, 2026."]);
      // Other boats are fine, and so is the same boat before and after.
      expect(await refusedFor(bookAs(f, "Ada", "Osprey", at(2, 7), at(2, 8)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ben", "Heron", at(0, 14), at(0, 15)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ben", "Heron", at(5, 7), at(5, 8)))).toEqual([]);
    });

    it("edge to edge: the last half hour before it starts is fine, the first inside it is not", async () => {
      const f = await fixture();
      await takeOutOfService(f.store, staffCtx(), f.i.Heron, { from: at(2, 7), until: at(2, 9), reason: "Repair" });
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(2, 6, 30), at(2, 7)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ben", "Heron", at(2, 7), at(2, 7, 30)))).toEqual(["out_of_service"]);
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(2, 8, 30), at(2, 9)))).toEqual(["out_of_service"]);
      expect(await refusedFor(bookAs(f, "Eli", "Heron", at(2, 9), at(2, 9, 30)))).toEqual([]);
    });

    it("is open ended until staff return it, and staff cannot be overridden past it", async () => {
      const f = await fixture();
      const { period } = await takeOutOfService(f.store, staffCtx(), f.i.Heron, { reason: "Hull crack" });
      expect(period.until).toBeNull();
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(6, 7), at(6, 8)))).toEqual(["out_of_service"]);
      expect(await refusedFor(createBooking(f.store, f.book, staffCtx(), request(f, "Ada", "Heron", at(6, 7), at(6, 8)), { override: { reason: "Lesson" } }))).toEqual(["out_of_service"]);
      await returnToService(f.store, staffCtx(), period.id);
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(6, 7), at(6, 8)))).toEqual([]);
      expect(outOfServiceAt(await f.store.read(), f.i.Heron, at(6, 7))).toBeUndefined();
    });

    it("keeps bookings already made and lists the members affected for staff, crew included", async () => {
      const f = await fixture();
      await bookAs(f, "Ada", "Loon", at(2, 7), at(2, 8), ["Ben"]);
      await bookAs(f, "Eli", "Loon", at(3, 7), at(3, 8));
      const { affected } = await takeOutOfService(f.store, staffCtx(), f.i.Loon, { from: at(1, 0), until: at(2, 12), reason: "Seat track" });
      expect(affected).toHaveLength(1);
      expect(affected[0]).toMatchObject({ itemName: "Loon", startsAt: at(2, 7).toISOString() });
      expect(affected[0].people.map((p) => [p.name, p.role])).toEqual([["Ada Quill", "booker"], ["Ben Quill", "crew"]]);
      expect(affected[0].people[0]).toMatchObject({ email: "ada@example.com" });
      // Nothing was cancelled.
      const state = await f.store.read();
      expect(state.bookings.map((b) => b.status)).toEqual(["upcoming", "upcoming"]);
      // An open-ended period catches both.
      expect(affectedBookings(state, f.i.Loon, at(1, 0), null)).toHaveLength(2);
    });

    it("is for staff only, with a reason, and a return time after the start", async () => {
      const f = await fixture();
      await expect(takeOutOfService(f.store, memberCtx(f.m.Ada), f.i.Heron, { reason: "x" })).rejects.toMatchObject({ code: "forbidden" });
      await expect(takeOutOfService(f.store, staffCtx(), f.i.Heron, { reason: "  " })).rejects.toThrow("Say why it is out of service");
      await expect(takeOutOfService(f.store, staffCtx(), f.i.Heron, { from: at(2, 7), until: at(2, 7), reason: "x" })).rejects.toThrow("return time must be after");
      await expect(takeOutOfService(f.store, staffCtx(), f.i.Heron, { reason: "x", expectedReturn: "soon" })).rejects.toThrow("must look like 2026-11-05");
      await expect(takeOutOfService(f.store, staffCtx(), "nope", { reason: "x" })).rejects.toMatchObject({ code: "not_found" });
      const { period } = await takeOutOfService(f.store, staffCtx(), f.i.Heron, { from: at(1, 0), until: at(2, 0), reason: "x" });
      await expect(returnToService(f.store, memberCtx(f.m.Ada), period.id)).rejects.toMatchObject({ code: "forbidden" });
      await expect(returnToService(f.store, staffCtx(at(3, 0)), period.id)).rejects.toThrow("already back in service");
    });
  });

  describe("staff booking past the rules", () => {
    it("is allowed with a reason, and the record says which rules were set aside and by whom", async () => {
      const f = await fixture();
      // A 3-hour lesson at 4:30 am, two weeks ahead, for a member with no qualification.
      const { booking, waived } = await createBooking(f.store, f.book, staffCtx(), request(f, "Cy", "Heron", at(14, 4, 30), at(14, 7, 30)), { override: { reason: "  Learn-to-row lesson with the coach " } });
      expect(waived.sort()).toEqual(["not_qualified", "outside_hours", "too_far_ahead", "too_long"]);
      expect(booking.override).toEqual({ reason: "Learn-to-row lesson with the coach", actor: { kind: "staff", label: "Test staff" }, waived: expect.arrayContaining(["not_qualified", "too_far_ahead"]) });
      expect(booking.createdBy).toEqual({ kind: "staff", label: "Test staff" });
    });

    it("records nothing as an override when nothing needed setting aside", async () => {
      const f = await fixture();
      const { booking, waived } = await createBooking(f.store, f.book, staffCtx(), request(f, "Ada", "Heron", at(1, 7), at(1, 8)), { override: { reason: "Just in case" } });
      expect(waived).toEqual([]);
      expect(booking.override).toBeNull();
    });

    it("needs a reason, and a member cannot do it", async () => {
      const f = await fixture();
      await expect(createBooking(f.store, f.book, staffCtx(), request(f, "Cy", "Heron", at(1, 7), at(1, 8)), { override: { reason: "   " } })).rejects.toThrow("Say why the rules are being set aside");
      await expect(createBooking(f.store, f.book, staffCtx(), request(f, "Cy", "Heron", at(1, 7), at(1, 8)), { override: { reason: "x".repeat(301) } })).rejects.toThrow("300 characters");
      await expect(bookAs(f, "Cy", "Heron", at(1, 7), at(1, 8), [], { override: { reason: "Let me" } })).rejects.toMatchObject({ code: "forbidden", message: "Only club staff can book past the rules." });
      expect((await f.store.read()).bookings).toHaveLength(0);
    });

    it("never sets aside a fact: a taken boat, a time that has passed, or a member who has left", async () => {
      const f = await fixture();
      await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      const lesson = (who: string, item: string, start: Date, end: Date) => createBooking(f.store, f.book, staffCtx(), request(f, who, item, start, end), { override: { reason: "Lesson" } });
      expect(await refusedFor(lesson("Dee", "Heron", at(1, 7), at(1, 8)))).toEqual(["slot_taken"]);
      expect(await refusedFor(lesson("Dee", "Osprey", at(0, 9), at(0, 10)))).toEqual(["starts_in_past"]);
    });
  });

  describe("who may book", () => {
    it("lets a member book only for themselves, and never the system", async () => {
      const f = await fixture();
      await expect(createBooking(f.store, f.book, memberCtx(f.m.Ada), request(f, "Dee", "Heron", at(1, 7), at(1, 8)))).rejects.toMatchObject({ code: "forbidden", message: "You can only make bookings for yourself." });
      await expect(createBooking(f.store, f.book, { actor: { kind: "system", label: "Job" }, now: NOW }, request(f, "Dee", "Heron", at(1, 7), at(1, 8)))).rejects.toMatchObject({ code: "forbidden" });
    });

    it("refuses a booking for an item or member that does not exist", async () => {
      const f = await fixture();
      await expect(createBooking(f.store, f.book, staffCtx(), { ...request(f, "Ada", "Heron", at(1, 7), at(1, 8)), itemId: "nope" })).rejects.toMatchObject({ code: "not_found" });
      await expect(createBooking(f.store, f.book, staffCtx(), { ...request(f, "Ada", "Heron", at(1, 7), at(1, 8)), bookerId: "nope" })).rejects.toMatchObject({ code: "not_found" });
    });

    it("reads without booking: checkBooking explains but changes nothing", async () => {
      const f = await fixture();
      const state = await f.store.read();
      const reasons = checkBooking(state, f.book, memberCtx(f.m.Cy), request(f, "Cy", "Heron", at(1, 7), at(1, 8)));
      expect(reasons.map((r) => r.code)).toEqual(["not_qualified"]);
      expect(reasons[0].overridable).toBe(true);
      expect((await f.store.read()).bookings).toHaveLength(0);
    });
  });

  describe("cancelling", () => {
    it("frees the slot and records who cancelled, when it is well before the start", async () => {
      const f = await fixture();
      const { booking } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      const result = await cancelBooking(f.store, f.book, memberCtx(f.m.Ada, "Ada Quill"), booking.id);
      expect(result.late).toBe(false);
      expect(result.booking).toMatchObject({ status: "cancelled", cancelledBy: { kind: "member", memberId: f.m.Ada } });
    });

    it("counts as late only after the cutoff: exactly 2 hours before is fine, one minute later is late", async () => {
      const f = await fixture();
      const start = at(1, 7);
      const twoHoursBefore = new Date(start.getTime() - 120 * 60000);
      const a = await bookAs(f, "Ada", "Heron", start, at(1, 8));
      const b = await bookAs(f, "Dee", "Osprey", start, at(1, 8));
      expect((await cancelBooking(f.store, f.book, memberCtx(f.m.Ada, "Ada", twoHoursBefore), a.booking.id)).booking.status).toBe("cancelled");
      const late = await cancelBooking(f.store, f.book, memberCtx(f.m.Dee, "Dee", new Date(twoHoursBefore.getTime() + 60000)), b.booking.id);
      expect(late.late).toBe(true);
      expect(late.booking.status).toBe("late_cancelled");
      // A late cancellation still frees the slot.
      expect(await refusedFor(bookAs(f, "Eli", "Osprey", start, at(1, 8), [], undefined, new Date(twoHoursBefore.getTime() + 120000)))).toEqual([]);
    });

    it("never records staff cancelling for a member as the member's late cancellation", async () => {
      const f = await fixture();
      const { booking } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      const result = await cancelBooking(f.store, f.book, staffCtx(at(1, 6, 30)), booking.id, { reason: "  Boat needs repair " });
      expect(result.late).toBe(false);
      expect(result.booking).toMatchObject({ status: "cancelled", cancelReason: "Boat needs repair", cancelledBy: { kind: "staff" } });
    });

    it("is refused for someone else's booking, one already cancelled, and one that has started", async () => {
      const f = await fixture();
      const { booking } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      await expect(cancelBooking(f.store, f.book, memberCtx(f.m.Dee), booking.id)).rejects.toMatchObject({ code: "forbidden", message: "Only the member who made the booking can cancel it." });
      await expect(cancelBooking(f.store, f.book, { actor: { kind: "system", label: "x" }, now: NOW }, booking.id)).rejects.toMatchObject({ code: "forbidden" });
      await expect(cancelBooking(f.store, f.book, memberCtx(f.m.Ada, "Ada", at(1, 7, 30)), booking.id)).rejects.toThrow("already started");
      await cancelBooking(f.store, f.book, memberCtx(f.m.Ada), booking.id);
      await expect(cancelBooking(f.store, f.book, memberCtx(f.m.Ada), booking.id)).rejects.toThrow("That booking is already cancelled.");
      await expect(cancelBooking(f.store, f.book, memberCtx(f.m.Ada), "nope")).rejects.toMatchObject({ code: "not_found" });
    });

    it("crew cannot cancel the booker's booking", async () => {
      const f = await fixture();
      const { booking } = await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ben"]);
      await expect(cancelBooking(f.store, f.book, memberCtx(f.m.Ben), booking.id)).rejects.toMatchObject({ code: "forbidden" });
    });
  });

  describe("attendance", () => {
    it("ends every booking in one of the five states, and only staff move it after the start", async () => {
      const f = await fixture();
      const done = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      const missed = await bookAs(f, "Dee", "Osprey", at(1, 7), at(1, 8));
      const cancelled = await bookAs(f, "Eli", "Kingfisher", at(1, 7), at(1, 8));
      const late = await bookAs(f, "Ben", "Loon", at(1, 7), at(1, 8));
      const upcoming = await bookAs(f, "Cy", "Otter", at(1, 7), at(1, 8));
      const after = staffCtx(at(1, 9));
      await mark(f.store, after, "booking", done.booking.id, "attended");
      await mark(f.store, after, "booking", missed.booking.id, "no_show");
      await cancelBooking(f.store, f.book, memberCtx(f.m.Eli), cancelled.booking.id);
      await cancelBooking(f.store, f.book, memberCtx(f.m.Ben, "Ben", at(1, 6)), late.booking.id);
      const status = Object.fromEntries((await f.store.read()).bookings.map((b) => [b.id, b.status]));
      expect(status).toEqual({
        [done.booking.id]: "completed",
        [missed.booking.id]: "no_show",
        [cancelled.booking.id]: "cancelled",
        [late.booking.id]: "late_cancelled",
        [upcoming.booking.id]: "upcoming",
      });
    });

    it("is staff only, opens 30 minutes before the start, and refuses a no-show before the start", async () => {
      const f = await fixture();
      const { booking } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      await expect(mark(f.store, memberCtx(f.m.Ada, "Ada", at(1, 9)), "booking", booking.id, "attended")).rejects.toMatchObject({ code: "forbidden" });
      await expect(mark(f.store, staffCtx(), "booking", booking.id, "attended")).rejects.toThrow("Check-in for Heron opens at 6:30 am, 30 minutes before the start.");
      await expect(mark(f.store, staffCtx(at(1, 6, 45)), "booking", booking.id, "no_show")).rejects.toThrow("has not started yet, so it cannot be a no-show");
      await expect(mark(f.store, staffCtx(at(1, 9)), "booking", "nope", "attended")).rejects.toMatchObject({ code: "not_found" });
      await expect(mark(f.store, staffCtx(at(1, 9)), "booking", booking.id, "attended", { memberId: f.m.Dee })).rejects.toThrow("not on this reservation");
      await mark(f.store, staffCtx(at(1, 6, 45)), "booking", booking.id, "attended");
      expect((await f.store.read()).bookings.find((b) => b.id === booking.id)!.status).toBe("completed");
    });

    it("lets staff correct an outcome afterwards, writes every change to the record, and refuses a repeat", async () => {
      const f = await fixture();
      const { booking } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      const first = await mark(f.store, staffCtx(at(1, 9)), "booking", booking.id, "no_show");
      expect(first).toMatchObject({ outcome: "no_show", previous: null, via: "staff" });
      await expect(mark(f.store, staffCtx(at(1, 9, 5)), "booking", booking.id, "no_show")).rejects.toThrow("already recorded as a no-show");
      const fix = await mark(f.store, staffCtx(at(1, 10)), "booking", booking.id, "attended", { note: "iPad was down" });
      expect(fix).toMatchObject({ outcome: "attended", previous: "no_show", note: "iPad was down" });
      const state = await f.store.read();
      expect(state.bookings.find((b) => b.id === booking.id)).toMatchObject({ status: "completed", statusChangedAt: at(1, 10).toISOString() });
      expect(state.attendance.map((l) => [l.outcome, l.previous])).toEqual([["no_show", null], ["attended", "no_show"]]);
      // A cancelled booking has nothing to check in.
      const gone = await bookAs(f, "Dee", "Osprey", at(2, 7), at(2, 8));
      await cancelBooking(f.store, f.book, memberCtx(f.m.Dee), gone.booking.id);
      await expect(mark(f.store, staffCtx(at(2, 7)), "booking", gone.booking.id, "attended")).rejects.toThrow("cancelled, so there is nothing to check in");
    });

    it("keeps a no-show or completed outing holding the slot and counting toward the day, but not toward holding", async () => {
      const f = await fixture();
      const { booking } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      await mark(f.store, staffCtx(at(1, 9)), "booking", booking.id, "no_show");
      const later = at(1, 9);
      // Same day: still counts toward the one-a-day limit.
      expect(await refusedFor(bookAs(f, "Ada", "Osprey", at(1, 15), at(1, 16), [], undefined, later))).toEqual(["over_daily_limit"]);
      // The slot is in the past, but nobody can rewrite it.
      expect(await refusedFor(bookAs(f, "Dee", "Heron", at(1, 7), at(1, 8), [], undefined, at(0, 14)))).toEqual(["slot_taken"]);
    });
  });

  describe("repeated and realistic use", () => {
    it("books, cancels and rebooks thirty times in a row and the limits still count right", async () => {
      const f = await fixture();
      const keeper = await bookAs(f, "Ada", "Heron", at(2, 7), at(2, 8)); // one booking always held
      for (let round = 0; round < 30; round++) {
        const { booking } = await bookAs(f, "Ada", "Osprey", at(1, 7), at(1, 8));
        // Now at the limit of two: a third, anywhere, is refused every time.
        expect(await refusedFor(bookAs(f, "Ada", "Kingfisher", at(3, 7), at(3, 8))), `round ${round} third`).toEqual(["over_future_limit"]);
        // And the same day is refused too.
        expect(await refusedFor(bookAs(f, "Ada", "Kingfisher", at(1, 9), at(1, 10))), `round ${round} same day`).toEqual(expect.arrayContaining(["over_daily_limit"]));
        await cancelBooking(f.store, f.book, memberCtx(f.m.Ada), booking.id);
        // After cancelling, the slot and the allowance both come straight back.
        expect(await refusedFor(bookAs(f, "Dee", "Osprey", at(1, 7), at(1, 8)))).toEqual([]);
        await cancelBooking(f.store, f.book, memberCtx(f.m.Dee), (await f.store.read()).bookings.find((b) => b.bookerId === f.m.Dee && b.status === "upcoming")!.id);
      }
      const state = await f.store.read();
      expect(state.bookings.filter((b) => b.status === "upcoming").map((b) => b.id)).toEqual([keeper.booking.id]);
      expect(state.bookings.filter((b) => b.status === "cancelled")).toHaveLength(60);
      expect(new Set(state.bookings.map((b) => b.id)).size).toBe(state.bookings.length);
    });

    it("lets many members fill a whole day of one boat, slot by slot, and then refuses everyone", async () => {
      const { addMembers } = await import("./testkit");
      const f = await fixture();
      const people = await addMembers(f, 30);
      // 5 am to 8 pm in half hours is 30 slots on Thursday.
      const results = await Promise.all(people.map((id, n) => bookAs(f, id, "Heron", at(1, 5, n * 30), at(1, 5, n * 30 + 30)).then(() => "booked", () => "refused")));
      expect(results.filter((r) => r === "booked")).toHaveLength(30);
      const state = await f.store.read();
      const mine = state.bookings.filter((b) => b.itemId === f.i.Heron).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      expect(mine).toHaveLength(30);
      // Back to back with no gap and no overlap, from 5:00 to 20:00.
      expect(mine[0].startsAt).toBe(at(1, 5).toISOString());
      expect(mine[29].endsAt).toBe(at(1, 20).toISOString());
      for (let n = 1; n < mine.length; n++) expect(mine[n].startsAt, `slot ${n}`).toBe(mine[n - 1].endsAt);
      // The day is now full for everyone.
      for (const [n, slot] of [[0, 5], [15, 12], [29, 19]]) {
        const start = at(1, slot as number, n === 29 ? 30 : 0);
        expect(await refusedFor(bookAs(f, "Dee", "Heron", start, new Date(start.getTime() + 1800000)))).toEqual(["slot_taken"]);
      }
    });

    it("gives exactly one booking when twenty members grab the same boat and slot at the same instant", async () => {
      const { addMembers } = await import("./testkit");
      const f = await fixture();
      const people = await addMembers(f, 20);
      const outcomes = await Promise.allSettled(people.map((id) => bookAs(f, id, "Heron", at(1, 7), at(1, 8))));
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
      expect(rejected).toHaveLength(19);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(BookingRefused);
        expect((r.reason as BookingRefused).reasons.map((x) => x.code)).toEqual(["slot_taken"]);
      }
      expect((await f.store.read()).bookings.filter((b) => b.status === "upcoming")).toHaveLength(1);
    });

    it("cannot be talked past a limit by sending many requests at once", async () => {
      const f = await fixture();
      // Ada fires 20 requests for 20 different days at the same moment. Only two can hold at once.
      const days = [1, 2, 3, 4, 5, 6, 7];
      const outcomes = await Promise.allSettled(Array.from({ length: 20 }, (_, n) => bookAs(f, "Ada", "Heron", at(days[n % 7], 5 + Math.floor(n / 7), 0), at(days[n % 7], 5 + Math.floor(n / 7), 30))));
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(2);
      expect((await f.store.read()).bookings.filter((b) => b.bookerId === f.m.Ada && b.status === "upcoming")).toHaveLength(2);
    });

    it("is unharmed by a refused booking in the middle of a busy run", async () => {
      const f = await fixture();
      const runs = await Promise.allSettled([
        bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8)),
        bookAs(f, "Cy", "Heron", at(1, 9), at(1, 10)), // refused: not qualified
        bookAs(f, "Dee", "Osprey", at(1, 7), at(1, 8)),
        bookAs(f, "Eli", "Heron", at(1, 7, 30), at(1, 8, 30)), // refused: Ada has it
      ]);
      expect(runs.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled", "rejected"]);
      expect((await f.store.read()).bookings).toHaveLength(2);
    });
  });

  describe("a ClubError from the engine is always plain language", () => {
    it("never leaks code or technical wording", async () => {
      const f = await fixture();
      // Each attempt is started only when it is its turn, so nothing fails before the test is looking.
    const attempts: (() => Promise<unknown>)[] = [
      () => bookAs(f, "Cy", "Heron", at(14, 4, 45), at(14, 7, 45)),
      () => cancelBooking(f.store, f.book, memberCtx(f.m.Dee), "nope"),
      () => mark(f.store, memberCtx(f.m.Dee), "booking", "nope", "attended"),
      () => takeOutOfService(f.store, memberCtx(f.m.Dee), f.i.Heron, { reason: "x" }),
    ];
    for (const a of attempts) {
        const error = await a().then(() => null, (e: unknown) => e);
        expect(error).toBeInstanceOf(ClubError);
        expect((error as ClubError).message).not.toMatch(/undefined|null|\[object|TypeError|\n\s+at |stack/i);
        expect((error as ClubError).message).toMatch(/^[A-Z]/);
      }
    });
  });
});
