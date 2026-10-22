import { describe, expect, it } from "vitest";
import { formatRange, pacificDayStart, pacificWall } from "../time";
import { dayView } from "./availability";
import { cancelBooking } from "./bookings";
import { NOW, STORE_KINDS, bookAs, cancelEverything, fixtureFor, memberCtx, refusedFor, ruleBookWith } from "./testkit";

describe.each(STORE_KINDS)("on the %s store", (kind) => {
  const fixture = fixtureFor(kind);

  /** Pacific clocks fall back at 2 am on Sunday Nov 1, 2026 (a 25-hour day) and spring forward on Sunday Mar 14, 2027 (23 hours). */
  const SAT = "2026-10-31";
  const SUN = "2026-11-01";
  const MON = "2026-11-02";
  const slot = (day: string, h: number, m = 0) => pacificWall(day, h * 60 + m);
  const half = (d: Date) => new Date(d.getTime() + 1800000);

  describe("bookings around the clocks going back on Nov 1, 2026", () => {
    it("has the same 30 member-hours slots on the day before, the day of, and the day after", async () => {
      const f = await fixture();
      const state = await f.store.read();
      const grids: Record<string, string[]> = {};
      for (const day of [SAT, SUN, MON]) {
        const view = dayView(state, f.book, { day, now: NOW, viewer: { kind: "staff" }, type: "Shell" });
        const heron = view.items.find((i) => i.item.name === "Heron")!;
        grids[day] = heron.slots.map((s) => s.startsAt);
        expect(heron.slots, day).toHaveLength(30);
      }
      // 5 am to 8 pm: Saturday in summer time, Sunday and Monday in winter time.
      expect(grids[SAT][0]).toBe("2026-10-31T12:00:00.000Z");
      expect(grids[SUN][0]).toBe("2026-11-01T13:00:00.000Z");
      expect(grids[MON][0]).toBe("2026-11-02T13:00:00.000Z");
      expect(grids[SUN].at(-1)).toBe("2026-11-02T03:30:00.000Z"); // 7:30 pm PST
    });

    it("books Saturday evening, the whole of Sunday morning and Monday morning without a lost or doubled slot", async () => {
      const f = await fixture();
      expect(await refusedFor(bookAs(f, "Ada", "Heron", slot(SAT, 19, 30), slot(SAT, 20)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ben", "Heron", slot(SUN, 5), slot(SUN, 7)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Dee", "Heron", slot(SUN, 7), slot(SUN, 8)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Eli", "Heron", slot(MON, 5), slot(MON, 6)))).toEqual([]);
      // Taken is taken: the same Sunday slot cannot be booked twice.
      expect(await refusedFor(bookAs(f, "Ada", "Heron", slot(SUN, 6), slot(SUN, 7)))).toEqual(["slot_taken"]);
      const text = (await f.store.read()).bookings.map((b) => formatRange(b.startsAt, b.endsAt));
      expect(text).toEqual(["7:30 to 8:00 pm", "5:00 to 7:00 am", "7:00 to 8:00 am", "5:00 to 6:00 am"]);
    });

    it("counts the 25-hour day as 25 real hours: every half hour exists exactly once", async () => {
      const f = await fixture(ruleBookWith({ dayStart: "00:00", dayEnd: "24:00" }));
      const state = await f.store.read();
      const view = dayView(state, f.book, { day: SUN, now: NOW, viewer: { kind: "staff" }, type: "Shell" });
      const slots = view.items.find((i) => i.item.name === "Heron")!.slots;
      expect(slots).toHaveLength(50);
      expect(new Set(slots.map((s) => s.startsAt)).size).toBe(50);
      expect(slots[0].startsAt).toBe(pacificDayStart(SUN).toISOString());
      expect(slots.at(-1)!.endsAt).toBe(pacificDayStart(MON).toISOString());
      for (let n = 1; n < slots.length; n++) expect(slots[n].startsAt, `slot ${n}`).toBe(slots[n - 1].endsAt);
      expect(slots[0].endsAt).toBe("2026-11-01T07:30:00.000Z");
    });

    it("treats the two 1:00 am hours as different hours: both can be booked, and a booking can span the change", async () => {
      const f = await fixture(ruleBookWith({ dayStart: "00:00", dayEnd: "24:00" }));
      const firstOne = new Date("2026-11-01T08:00:00Z"); // 1:00 am PDT
      const secondOne = new Date("2026-11-01T09:00:00Z"); // 1:00 am PST, an hour later
      expect(await refusedFor(bookAs(f, "Ada", "Heron", firstOne, half(firstOne)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ben", "Heron", secondOne, half(secondOne)))).toEqual([]);
      // 1:30 am PDT to 1:30 am PST is a real hour long.
      expect(await refusedFor(bookAs(f, "Dee", "Heron", half(firstOne), half(secondOne)))).toEqual(["slot_taken"]);
      expect(await refusedFor(bookAs(f, "Eli", "Osprey", half(firstOne), half(secondOne)))).toEqual([]);
      // The longest booking is 2 real hours, not 2 clock hours: 12:30 am PDT for 2 real hours ends at 1:30 am PST.
      const longest = await bookAs(f, "Cy", "Otter", new Date("2026-11-01T07:30:00Z"), new Date("2026-11-01T09:30:00Z"));
      expect(longest.booking.endsAt).toBe("2026-11-01T09:30:00.000Z");
      expect(await refusedFor(bookAs(f, "Dee", "Otter", new Date("2026-11-01T10:00:00Z"), new Date("2026-11-01T12:30:00Z")))).toEqual(["too_long"]);
    });

    it("opens each day at midnight Pacific on either side of the change: Nov 8 at the start of Nov 1, Nov 9 at the start of Nov 2", async () => {
      const f = await fixture();
      const nov8 = slot("2026-11-08", 5);
      const nov9 = slot("2026-11-09", 5);
      const book = (start: Date, now: string) => refusedFor(bookAs(f, "Ada", "Heron", start, half(start), [], undefined, new Date(now)));
      // Midnight starting Sunday Nov 1 is 07:00 UTC (still summer time).
      expect(await book(nov8, "2026-11-01T06:59:00Z")).toEqual(["too_far_ahead"]);
      expect(await book(nov8, "2026-11-01T07:00:00Z")).toEqual([]);
      await cancelEverything(f);
      // Midnight starting Monday Nov 2 is 08:00 UTC (winter time): the 25-hour day has passed.
      expect(await book(nov9, "2026-11-02T07:59:00Z")).toEqual(["too_far_ahead"]);
      expect(await book(nov9, "2026-11-02T08:00:00Z")).toEqual([]);
    });

    it("applies the late-cancellation cutoff in real hours across the change", async () => {
      const f = await fixture();
      const start = slot(SUN, 5); // 5 am PST = 13:00Z
      const { booking } = await bookAs(f, "Ada", "Heron", start, half(start));
      // Two real hours before 5 am PST (13:00Z) is 11:00Z, which is 3:00 am PST. Exactly then is still on time.
      const result = await cancelBooking(f.store, f.book, memberCtx(f.m.Ada, "Ada", new Date("2026-11-01T11:00:00Z")), booking.id);
      expect(result.late).toBe(false);
    });
  });

  describe("the clocks going forward on Mar 14, 2027", () => {
    it("is a 23-hour day: 46 half hours, none doubled", async () => {
      const f = await fixture(ruleBookWith({ dayStart: "00:00", dayEnd: "24:00", windowDays: 400 }));
      const state = await f.store.read();
      const view = dayView(state, f.book, { day: "2027-03-14", now: NOW, viewer: { kind: "staff" }, type: "Shell" });
      const slots = view.items.find((i) => i.item.name === "Heron")!.slots;
      expect(slots).toHaveLength(46);
      expect(new Set(slots.map((s) => s.startsAt)).size).toBe(46);
      for (let n = 1; n < slots.length; n++) expect(slots[n].startsAt).toBe(slots[n - 1].endsAt);
      // 1:30 am is followed straight by 3:00 am.
      const around = slots.map((s) => formatRange(s.startsAt, s.endsAt)).filter((t) => /^(1:30|3:00) .* am$/.test(t));
      expect(around).toEqual(["1:30 to 3:00 am", "3:00 to 3:30 am"]);
    });
  });
});
