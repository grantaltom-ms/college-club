import { describe, expect, it } from "vitest";
import { addDays } from "../time";
import { dayView, pickableDays, type Viewer } from "./availability";
import { cancelBooking, takeOutOfService } from "./bookings";
import { describeRules } from "./describe";
import { NOW, TODAY, at, bookAs, fixture, memberCtx, ruleBookWith, staffCtx } from "./testkit";

const tomorrow = addDays(TODAY, 1);
const heronOn = (view: ReturnType<typeof dayView>) => view.items.find((i) => i.item.name === "Heron")!;
const states = (slots: { state: string }[]) => slots.map((s) => s.state);

describe("the day view", () => {
  it("shows every half hour from 5 am to 8 pm for each item, free until booked", async () => {
    const f = await fixture();
    const view = dayView(await f.store.read(), f.book, { day: tomorrow, now: NOW, viewer: { kind: "member", memberId: f.m.Ada } });
    expect(view.items.map((i) => i.item.name)).toEqual(["Heron", "Osprey", "Kingfisher", "Loon", "Pelican", "Albatross", "Otter", "Skimmer", "Dock slip A"]);
    for (const item of view.items) {
      expect(item.slots).toHaveLength(30);
      expect(new Set(states(item.slots))).toEqual(new Set(["free"]));
      expect(item.note).toBeNull();
    }
    expect(heronOn(view).slots[0].startsAt).toBe(at(1, 5).toISOString());
    expect(heronOn(view).slots[29].endsAt).toBe(at(1, 20).toISOString());
  });

  it("filters by type", async () => {
    const f = await fixture();
    const state = await f.store.read();
    const viewer: Viewer = { kind: "staff" };
    const names = (type: "Shell" | "Kayak" | "Paddle Board" | "Dock Space") => dayView(state, f.book, { day: tomorrow, now: NOW, viewer, type }).items.map((i) => i.item.name);
    expect(names("Shell")).toEqual(["Heron", "Osprey", "Kingfisher", "Loon", "Pelican", "Albatross"]);
    expect(names("Kayak")).toEqual(["Otter"]);
    expect(names("Paddle Board")).toEqual(["Skimmer"]);
    expect(names("Dock Space")).toEqual(["Dock slip A"]);
  });

  it("shows other people's bookings only as 'booked', and your own as 'yours'", async () => {
    const f = await fixture();
    const { booking } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8, 30));
    const state = await f.store.read();
    const asDee = heronOn(dayView(state, f.book, { day: tomorrow, now: NOW, viewer: { kind: "member", memberId: f.m.Dee } }));
    const asAda = heronOn(dayView(state, f.book, { day: tomorrow, now: NOW, viewer: { kind: "member", memberId: f.m.Ada } }));
    // 7:00 to 8:30 is slots 4, 5, 6.
    expect(states(asDee.slots).slice(3, 8)).toEqual(["free", "booked", "booked", "booked", "free"]);
    expect(states(asAda.slots).slice(3, 8)).toEqual(["free", "yours", "yours", "yours", "free"]);
    // A member never learns who booked or even which booking it is.
    for (const s of asDee.slots) expect(s).toMatchObject({ bookedBy: null, bookingId: null });
    expect(JSON.stringify(asDee)).not.toMatch(/Ada|Quill/);
    // They do get the booking for their own, so they can cancel it.
    expect(asAda.slots[4]).toMatchObject({ bookingId: booking.id, bookedBy: null });
  });

  it("shows crew their seat as 'yours'", async () => {
    const f = await fixture();
    await bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ben"]);
    const view = dayView(await f.store.read(), f.book, { day: tomorrow, now: NOW, viewer: { kind: "member", memberId: f.m.Ben } });
    expect(states(view.items.find((i) => i.item.name === "Loon")!.slots).slice(3, 7)).toEqual(["free", "yours", "yours", "free"]);
  });

  it("shows staff who booked every slot", async () => {
    const f = await fixture();
    await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
    const view = dayView(await f.store.read(), f.book, { day: tomorrow, now: NOW, viewer: { kind: "staff" } });
    const slot = heronOn(view).slots[4];
    expect(slot).toMatchObject({ state: "booked", bookedBy: "Ada Quill" });
    expect(slot.bookingId).toBeTruthy();
  });

  it("frees a slot in the view the moment its booking is cancelled", async () => {
    const f = await fixture();
    const { booking } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
    const viewer: Viewer = { kind: "member", memberId: f.m.Ada };
    expect(states(heronOn(dayView(await f.store.read(), f.book, { day: tomorrow, now: NOW, viewer })).slots).slice(4, 6)).toEqual(["yours", "yours"]);
    await cancelBooking(f.store, f.book, memberCtx(f.m.Ada), booking.id);
    expect(states(heronOn(dayView(await f.store.read(), f.book, { day: tomorrow, now: NOW, viewer })).slots).slice(4, 6)).toEqual(["free", "free"]);
  });

  it("marks slots that have passed, slots out of service, and the days not yet open", async () => {
    const f = await fixture();
    await takeOutOfService(f.store, staffCtx(), f.i.Osprey, { from: at(0, 14), until: at(0, 16), reason: "Repair" });
    const state = await f.store.read();
    const viewer: Viewer = { kind: "member", memberId: f.m.Ada };
    // Today at 1 pm: everything before 1 pm is past, and Osprey is out 2 to 4 pm.
    const today = dayView(state, f.book, { day: TODAY, now: NOW, viewer });
    const slots = heronOn(today).slots;
    expect(states(slots).filter((s) => s === "past")).toHaveLength(16); // 5:00 am to 1:00 pm
    expect(slots[15].state).toBe("past"); // 12:30 pm
    expect(slots[16].state).toBe("free"); // 1:00 pm: starts exactly now, so not yet past
    const osprey = today.items.find((i) => i.item.name === "Osprey")!;
    expect(states(osprey.slots).slice(18, 24)).toEqual(["out_of_service", "out_of_service", "out_of_service", "out_of_service", "free", "free"]); // 2:00 to 4:00 pm
    // Nov 5 opens at midnight tonight; Nov 4 is open.
    const closed = dayView(state, f.book, { day: "2026-11-05", now: NOW, viewer });
    expect(new Set(closed.items.flatMap((i) => states(i.slots)))).toEqual(new Set(["not_open"]));
    expect(closed.items[0].note).toBe("Opens Thursday, Oct 29 at midnight.");
    expect(new Set(dayView(state, f.book, { day: "2026-11-04", now: NOW, viewer }).items.flatMap((i) => states(i.slots)))).toEqual(new Set(["free"]));
  });

  it("keeps a booked slot visible as booked even once it is in the past", async () => {
    const f = await fixture();
    await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
    const view = dayView(await f.store.read(), f.book, { day: tomorrow, now: at(1, 12), viewer: { kind: "member", memberId: f.m.Dee } });
    expect(states(heronOn(view).slots).slice(3, 7)).toEqual(["past", "booked", "booked", "past"]);
  });

  it("tells each member whether they hold the qualification an item needs", async () => {
    const f = await fixture();
    const state = await f.store.read();
    const asCy = dayView(state, f.book, { day: tomorrow, now: NOW, viewer: { kind: "member", memberId: f.m.Cy } });
    const asAda = dayView(state, f.book, { day: tomorrow, now: NOW, viewer: { kind: "member", memberId: f.m.Ada } });
    const asStaff = dayView(state, f.book, { day: tomorrow, now: NOW, viewer: { kind: "staff" } });
    const pick = (v: typeof asCy, name: string) => v.items.find((i) => i.item.name === name)!;
    expect(pick(asCy, "Heron")).toMatchObject({ needs: "Sculling level 1 (placeholder)", qualified: false });
    expect(pick(asCy, "Otter")).toMatchObject({ needs: null, qualified: null });
    expect(pick(asAda, "Albatross")).toMatchObject({ needs: "Sculling level 3 (placeholder)", qualified: true });
    expect(pick(asStaff, "Heron").qualified).toBeNull();
    expect(pick(asCy, "Loon")).toMatchObject({ className: "Double", seats: 2, type: "Shell" });
  });

  it("follows the settings: other bookable hours and step sizes change the grid", async () => {
    const f = await fixture(ruleBookWith({ dayStart: "06:00", dayEnd: "09:00", slotMinutes: 60, minMinutes: 60, maxMinutes: 120 }));
    const view = dayView(await f.store.read(), f.book, { day: tomorrow, now: NOW, viewer: { kind: "staff" }, type: "Kayak" });
    expect(view.items[0].slots.map((s) => s.startsAt)).toEqual([at(1, 6).toISOString(), at(1, 7).toISOString(), at(1, 8).toISOString()]);
  });
});

describe("the days a member can pick", () => {
  it("run from today through the last open day, and move at midnight Pacific", async () => {
    const f = await fixture();
    const state = await f.store.read();
    const days = pickableDays(state, f.book, NOW);
    expect(days).toHaveLength(8);
    expect(days[0]).toBe("2026-10-28");
    expect(days[7]).toBe("2026-11-04");
    expect(pickableDays(state, f.book, new Date("2026-10-29T06:59:00Z"))[0]).toBe("2026-10-28");
    expect(pickableDays(state, f.book, new Date("2026-10-29T07:00:00Z"))[0]).toBe("2026-10-29");
  });
});

describe("the rules in words", () => {
  it("are written from the settings, with the numbers and a placeholder warning", async () => {
    const f = await fixture();
    const state = await f.store.read();
    const single = describeRules(state, f.book, state.items.find((i) => i.name === "Heron")!);
    expect(single.heading).toBe("Rules for Heron (single)");
    expect(single.placeholder).toBe(true);
    expect(single.lines).toEqual([
      "Book up to 7 days ahead. A new day opens at midnight Pacific time.",
      "Bookings run from 5:00 am to 8:00 pm, in 30-minute steps.",
      "The shortest booking is 30 minutes and the longest is 2 hours.",
      "You can hold 2 upcoming shell bookings at once, and have 1 a day.",
      "Cancel at least 2 hours before the start, or it counts as a late cancellation.",
      "You need Sculling level 1 (placeholder).",
    ]);
  });

  it("add the crew rules for a multi-seat boat, a gap when one is set, and 'no qualification' where none is needed", async () => {
    const f = await fixture(ruleBookWith({ gapMinutes: 30 }));
    const state = await f.store.read();
    const double = describeRules(state, f.book, state.items.find((i) => i.name === "Loon")!);
    expect(double.lines).toContain("Leave 30 minutes free between bookings of the same double.");
    expect(double.lines.at(-1)).toContain("Loon has 2 seats. You can add up to 1 other member as crew; each needs the same qualification.");
    const kayak = describeRules(state, f.book, state.items.find((i) => i.name === "Otter")!);
    expect(kayak.lines).toContain("No qualification is needed.");
    expect(kayak.lines.some((l) => l.includes("seats"))).toBe(false);
  });

  it("use an item's own limit, and say 'placeholder' only while the numbers are", async () => {
    const f = await fixture();
    await f.store.transaction(async (s) => void (s.items.find((i) => i.name === "Heron")!.ruleOverrides = { maxMinutes: 60 }));
    const state = await f.store.read();
    expect(describeRules(state, f.book, state.items.find((i) => i.name === "Heron")!).lines[2]).toBe("The shortest booking is 30 minutes and the longest is 1 hour.");
    expect(describeRules(state, { ...f.book, placeholder: false }, state.items[0]).placeholder).toBe(false);
  });
});
