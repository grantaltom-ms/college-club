import { describe, expect, it } from "vitest";
import { bookingLedger, cancelBooking, markAttendance } from "./bookings";
import { endHousehold, removeMember, type BookingLedger } from "./households";
import { historyOf } from "./queries";
import { NOW, at, bookAs, fixture, memberCtx, refusalMessages, refusedFor, staffCtx } from "./testkit";

/** A busy Quill household: two future bookings, one finished outing, one outing in progress, and a seat in Eli's double. */
async function busyClub() {
  const f = await fixture();
  const future1 = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
  const future2 = await bookAs(f, "Ada", "Osprey", at(2, 7), at(2, 8));
  // A finished outing, booked back when it was still ahead and marked completed afterwards.
  const past = await bookAs(f, "Ben", "Heron", at(-2, 7), at(-2, 8), [], undefined, at(-3, 12));
  await markAttendance(f.store, staffCtx(at(-2, 9)), past.booking.id, "completed");
  // An outing that started an hour ago.
  const inProgress = await bookAs(f, "Ben", "Kingfisher", at(0, 12), at(0, 13, 30), [], undefined, at(0, 9));
  // Ben is crew on Eli's double, and Eli's own single is nothing to do with the Quills.
  const crewed = await bookAs(f, "Eli", "Loon", at(3, 7), at(3, 8), ["Ben"]);
  const reeds = await bookAs(f, "Dee", "Otter", at(1, 7), at(1, 8));
  return { f, future1, future2, past, inProgress, crewed, reeds };
}

describe("ending a household that has bookings", () => {
  it("cancels every future booking of every adult in it, and logs it", async () => {
    const { f, future1, future2 } = await busyClub();
    const result = await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill);
    expect(result.blocked.sort()).toEqual([f.m.Ada, f.m.Ben, f.m.Cy].sort());
    expect(result.cancelledBookings.sort()).toEqual([future1.booking.id, future2.booking.id].sort());

    const state = await f.store.read();
    for (const id of [future1.booking.id, future2.booking.id]) {
      expect(state.bookings.find((b) => b.id === id)).toMatchObject({
        status: "cancelled",
        cancelReason: "The household's membership ended",
        cancelledBy: { kind: "staff", label: "Test staff" },
        statusChangedAt: NOW.toISOString(),
      });
    }
    const history = historyOf(state, f.h.Quill);
    expect(history.map((e) => e.kind)).toEqual(expect.arrayContaining(["membership_ended", "bookings_cancelled"]));
    expect(history.find((e) => e.kind === "bookings_cancelled")).toMatchObject({ summary: "2 future bookings cancelled because the membership ended.", details: { count: 2 } });
  });

  it("leaves past bookings, and an outing already under way, exactly as they were", async () => {
    const { f, past, inProgress } = await busyClub();
    const before = (await f.store.read()).bookings.filter((b) => [past.booking.id, inProgress.booking.id].includes(b.id));
    await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill);
    const after = (await f.store.read()).bookings.filter((b) => [past.booking.id, inProgress.booking.id].includes(b.id));
    expect(after).toEqual(before);
    expect(after.map((b) => b.status).sort()).toEqual(["completed", "upcoming"]);
  });

  it("takes the leaving members off other people's boats and keeps those bookings", async () => {
    const { f, crewed } = await busyClub();
    await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill);
    const booking = (await f.store.read()).bookings.find((b) => b.id === crewed.booking.id)!;
    expect(booking.status).toBe("upcoming");
    expect(booking.bookerId).toBe(f.m.Eli);
    expect(booking.crew).toEqual([]);
    expect(booking.removedCrew).toEqual([{ memberId: f.m.Ben, at: NOW.toISOString(), reason: "The household's membership ended" }]);
  });

  it("does not touch other households' bookings", async () => {
    const { f, reeds } = await busyClub();
    await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill);
    expect((await f.store.read()).bookings.find((b) => b.id === reeds.booking.id)?.status).toBe("upcoming");
  });

  it("blocks every adult from new bookings at once, with the reason, and from being added as crew", async () => {
    const { f } = await busyClub();
    await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill);
    for (const who of ["Ada", "Ben", "Cy"]) {
      const messages = await refusalMessages(bookAs(f, who, "Otter", at(4, 7), at(4, 8)));
      expect(messages, who).toEqual(["This household's membership ended on Oct 28, 2026, so new bookings are closed."]);
    }
    expect(await refusedFor(bookAs(f, "Eli", "Pelican", at(4, 9), at(4, 10), ["Ben"]))).toEqual(["crew_blocked"]);
  });

  it("frees the slots, so another member can take them straight away", async () => {
    const { f } = await busyClub();
    expect(await refusedFor(bookAs(f, "Eli", "Heron", at(1, 7), at(1, 8)))).toEqual(["slot_taken"]);
    await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill);
    expect(await refusedFor(bookAs(f, "Eli", "Heron", at(1, 7), at(1, 8)))).toEqual([]);
  });

  it("is all or nothing: if anything fails, no booking is cancelled and the household stays active", async () => {
    const { f } = await busyClub();
    const failsAfterCancelling: BookingLedger = {
      async cancelFutureBookings(input) {
        await bookingLedger.cancelFutureBookings(input);
        throw new Error("the calendar went away");
      },
    };
    const before = await f.store.read();
    await expect(endHousehold(f.store, failsAfterCancelling, staffCtx(), f.h.Quill)).rejects.toThrow("the calendar went away");
    expect(await f.store.read()).toEqual(before);
    // Ada's two bookings are still there: she is still at her limit of two.
    expect(await refusedFor(bookAs(f, "Ada", "Kingfisher", at(4, 7), at(4, 8)))).toEqual(["over_future_limit"]);
    expect((await f.store.read()).bookings.filter((b) => b.bookerId === f.m.Ada && b.status === "upcoming")).toHaveLength(2);
  });

  it("with nothing booked simply ends, and logs no cancellation line", async () => {
    const f = await fixture();
    const result = await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Reed);
    expect(result.cancelledBookings).toEqual([]);
    expect(historyOf(await f.store.read(), f.h.Reed).map((e) => e.kind)).not.toContain("bookings_cancelled");
  });
});

describe("removing one adult from a household that carries on", () => {
  it("cancels just their future bookings and leaves the rest of the household bookable", async () => {
    const { f, future1 } = await busyClub();
    const ben = await bookAs(f, "Ben", "Skimmer", at(1, 7), at(1, 8));
    await removeMember(f.store, bookingLedger, staffCtx(), f.m.Ben);
    const state = await f.store.read();
    expect(state.bookings.find((b) => b.id === ben.booking.id)?.status).toBe("cancelled");
    expect(state.bookings.find((b) => b.id === future1.booking.id)?.status).toBe("upcoming"); // Ada's
    expect(await refusedFor(bookAs(f, "Ada", "Otter", at(3, 7), at(3, 8)))).toEqual([]);
    expect(await refusalMessages(bookAs(f, "Ben", "Otter", at(4, 7), at(4, 8)))).toEqual(["Ben is no longer listed on this household's membership, so new bookings are closed."]);
  });
});

describe("the member's own cancel does not clash with the household's", () => {
  it("cannot cancel a booking the household ending already cancelled", async () => {
    const { f, future1 } = await busyClub();
    await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill);
    await expect(cancelBooking(f.store, f.book, memberCtx(f.m.Ada), future1.booking.id)).rejects.toThrow("That booking is already cancelled.");
  });
});
