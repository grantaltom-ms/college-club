import { classOf, rulesFor } from "../settings/rulebook";
import { addDays, clockToMinutes, formatClock, formatDayLong, pacificDate, pacificWall } from "../time";
import { HOLDING_STATUSES, type Booking, type BookingType, type ClassSession, type ClubState, type Item, type RuleBook } from "../types";
import { boatLocked, isPrivate, itemVisibleTo } from "./boat-access";
import { dayWindow, opensAt, outOfServiceAt } from "./bookings";
import { meetsQualification } from "./eligibility";
import { placesOf } from "./pools";
import { fullName, memberById, practiceHold } from "./queries";

/** Who is looking. Members see "Booked" and "Yours"; staff also see names. */
export type Viewer = { kind: "member"; memberId: string } | { kind: "staff" };

export type SlotState = "free" | "booked" | "yours" | "class" | "practice" | "out_of_service" | "past" | "not_open";

export interface SlotView {
  startsAt: string;
  endsAt: string;
  state: SlotState;
  /** The booking in this slot, for "yours" and for staff. */
  bookingId: string | null;
  /** Names, for staff only. Always null for members. */
  bookedBy: string | null;
  /** The class holding this room in this slot, for everyone (classes are public). */
  heldFor: string | null;
  /** A pool only: how many places are still free in this slot. Null for a single item. */
  placesLeft: number | null;
  /** A pool only, staff only: who holds a place in this slot. Always empty for members. */
  holders: string[];
}

export interface ItemDayView {
  item: Item;
  className: string;
  type: BookingType;
  seats: number;
  /** How many people can hold this item at once: one for a boat, more for a pool (a dock, the club room, the gym). */
  places: number;
  slots: SlotView[];
  /** The qualification needed, if any, and whether this member holds it (null for staff). */
  needs: string | null;
  qualified: boolean | null;
  /** Why the whole day is closed to booking for this item, in words (for example when it opens). */
  note: string | null;
  /** A privately owned boat. Only staff and its owners and invited people are ever shown it. */
  isPrivate: boolean;
  /** A private boat with no owner who can use it: nobody can book it until staff add an owner. */
  locked: boolean;
}

export interface DayView {
  day: string;
  items: ItemDayView[];
}

/** One day of what is free and booked, by item. Slots are stepped in real time, so the 25-hour day on Nov 1 has no lost or doubled slot. */
export function dayView(state: ClubState, book: RuleBook, input: { day: string; now: Date; viewer: Viewer; type?: BookingType | null }): DayView {
  const { day, now, viewer } = input;
  const items = state.items
    .filter((item) => itemVisibleTo(state, item, viewer))
    .filter((item) => !input.type || classOf(book, item).type === input.type)
    .map((item): ItemDayView => {
      const { cls, rules, requiredQualification } = rulesFor(book, item);
      const { open, close } = dayWindow(day, rules.dayStart, rules.dayEnd);
      const step = rules.slotMinutes * 60000;
      const opens = opensAt(day, rules.windowDays, rules.opensAt);
      const holding = state.bookings.filter((b) => b.itemId === item.id && HOLDING_STATUSES.includes(b.status));
      const classes = state.sessions.filter((x) => x.roomItemId === item.id && x.status === "scheduled");
      const places = placesOf(item);
      const slots: SlotView[] = [];
      for (let t = open.getTime(); t + step <= close.getTime(); t += step) {
        const end = t + step;
        if (places > 1) {
          slots.push(poolSlot({ state, item, places, holding, classes, t, end, now, opens, viewer }));
          continue;
        }
        const booking = holding.find((b) => Date.parse(b.startsAt) < end && t < Date.parse(b.endsAt));
        const heldBy = booking ? undefined : classes.find((x) => Date.parse(x.startsAt) < end && t < Date.parse(x.endsAt));
        let slotState: SlotState;
        if (booking) {
          const mine = viewer.kind === "member" && (booking.bookerId === viewer.memberId || booking.crew.includes(viewer.memberId));
          slotState = mine ? "yours" : "booked";
        } else if (heldBy) {
          slotState = "class";
        } else if (practiceHold(state, item.id, t, end)) {
          slotState = "practice";
        } else if (outOfServiceAt(state, item.id, new Date(t)) || state.outOfService.some((p) => p.itemId === item.id && Date.parse(p.from) < end && t < (p.until === null ? Infinity : Date.parse(p.until)))) {
          slotState = "out_of_service";
        } else if (t < now.getTime()) {
          slotState = "past";
        } else if (now.getTime() < opens.getTime()) {
          slotState = "not_open";
        } else {
          slotState = "free";
        }
        const shown = booking && (viewer.kind === "staff" || slotState === "yours");
        const booker = booking && shown ? memberById(state, booking.bookerId) : undefined;
        slots.push({
          startsAt: new Date(t).toISOString(),
          endsAt: new Date(end).toISOString(),
          state: slotState,
          bookingId: shown && booking ? booking.id : null,
          bookedBy: viewer.kind === "staff" && booker ? fullName(booker) : null,
          heldFor: heldBy ? (state.classes.find((c) => c.id === heldBy.classId)?.name ?? "A class") : null,
          placesLeft: null,
          holders: [],
        });
      }
      const need = requiredQualification && !isPrivate(item) ? state.qualifications.find((q) => q.code === requiredQualification) : undefined;
      let note: string | null = null;
      if (now.getTime() < opens.getTime()) {
        const openDay = pacificDate(opens);
        const minutes = clockToMinutes(rules.opensAt);
        note = `Opens ${formatDayLong(openDay)} at ${minutes === 0 ? "midnight" : formatClock(pacificWall(openDay, minutes))}.`;
      }
      return {
        item,
        className: cls.name,
        type: cls.type,
        seats: cls.seats,
        places,
        slots,
        needs: need?.name ?? null,
        qualified: viewer.kind === "member" && need ? meetsQualification(state, viewer.memberId, need.code) : null,
        note,
        isPrivate: isPrivate(item),
        locked: boatLocked(state, item),
      };
    });
  return { day, items };
}

/**
 * One slot of a pool. It is counted, not numbered: members see how many places are left (or that it is full, or that a place is
 * theirs); staff also see who holds the places. A class holds the whole room, so a slot under a class has no places at all.
 */
function poolSlot(input: {
  state: ClubState;
  item: Item;
  places: number;
  holding: Booking[];
  classes: ClassSession[];
  t: number;
  end: number;
  now: Date;
  opens: Date;
  viewer: Viewer;
}): SlotView {
  const { state, item, places, holding, classes, t, end, now, opens, viewer } = input;
  const here = holding.filter((b) => Date.parse(b.startsAt) < end && t < Date.parse(b.endsAt));
  const mine = viewer.kind === "member" ? here.find((b) => b.bookerId === viewer.memberId) : undefined;
  const heldBy = classes.find((x) => Date.parse(x.startsAt) < end && t < Date.parse(x.endsAt));
  const left = Math.max(0, places - here.length);
  let slotState: SlotState;
  if (mine) slotState = "yours";
  else if (heldBy) slotState = "class";
  else if (left === 0) slotState = "booked";
  else if (outOfServiceAt(state, item.id, new Date(t)) || state.outOfService.some((p) => p.itemId === item.id && Date.parse(p.from) < end && t < (p.until === null ? Infinity : Date.parse(p.until)))) slotState = "out_of_service";
  else if (t < now.getTime()) slotState = "past";
  else if (now.getTime() < opens.getTime()) slotState = "not_open";
  else slotState = "free";
  return {
    startsAt: new Date(t).toISOString(),
    endsAt: new Date(end).toISOString(),
    state: slotState,
    bookingId: mine?.id ?? null,
    bookedBy: null,
    heldFor: heldBy && !mine ? (state.classes.find((c) => c.id === heldBy.classId)?.name ?? "A class") : null,
    placesLeft: heldBy ? 0 : left,
    holders: viewer.kind === "staff" ? here.map((b) => fullName(memberById(state, b.bookerId)!)) : [],
  };
}

/** The days a member can pick from: today through the furthest any item allows. */
export function pickableDays(state: ClubState, book: RuleBook, now: Date): string[] {
  const today = pacificDate(now);
  const furthest = Math.max(book.defaults.windowDays, ...state.items.map((i) => rulesFor(book, i).rules.windowDays));
  return Array.from({ length: furthest + 1 }, (_, n) => addDays(today, n));
}
