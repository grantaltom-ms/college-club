import { classOf, rulesFor } from "../settings/rulebook";
import { addDays, clockToMinutes, formatClock, formatDayLong, pacificDate, pacificWall } from "../time";
import { HOLDING_STATUSES, type BookingType, type ClubState, type Item, type RuleBook } from "../types";
import { dayWindow, opensAt, outOfServiceAt } from "./bookings";
import { meetsQualification } from "./eligibility";
import { fullName, memberById } from "./queries";

/** Who is looking. Members see "Booked" and "Yours"; staff also see names. */
export type Viewer = { kind: "member"; memberId: string } | { kind: "staff" };

export type SlotState = "free" | "booked" | "yours" | "class" | "out_of_service" | "past" | "not_open";

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
}

export interface ItemDayView {
  item: Item;
  className: string;
  type: BookingType;
  seats: number;
  slots: SlotView[];
  /** The qualification needed, if any, and whether this member holds it (null for staff). */
  needs: string | null;
  qualified: boolean | null;
  /** Why the whole day is closed to booking for this item, in words (for example when it opens). */
  note: string | null;
}

export interface DayView {
  day: string;
  items: ItemDayView[];
}

/** One day of what is free and booked, by item. Slots are stepped in real time, so the 25-hour day on Nov 1 has no lost or doubled slot. */
export function dayView(state: ClubState, book: RuleBook, input: { day: string; now: Date; viewer: Viewer; type?: BookingType | null }): DayView {
  const { day, now, viewer } = input;
  const items = state.items
    .filter((item) => !input.type || classOf(book, item).type === input.type)
    .map((item): ItemDayView => {
      const { cls, rules, requiredQualification } = rulesFor(book, item);
      const { open, close } = dayWindow(day, rules.dayStart, rules.dayEnd);
      const step = rules.slotMinutes * 60000;
      const opens = opensAt(day, rules.windowDays, rules.opensAt);
      const holding = state.bookings.filter((b) => b.itemId === item.id && HOLDING_STATUSES.includes(b.status));
      const classes = state.sessions.filter((x) => x.roomItemId === item.id && x.status === "scheduled");
      const slots: SlotView[] = [];
      for (let t = open.getTime(); t + step <= close.getTime(); t += step) {
        const end = t + step;
        const booking = holding.find((b) => Date.parse(b.startsAt) < end && t < Date.parse(b.endsAt));
        const heldBy = booking ? undefined : classes.find((x) => Date.parse(x.startsAt) < end && t < Date.parse(x.endsAt));
        let slotState: SlotState;
        if (booking) {
          const mine = viewer.kind === "member" && (booking.bookerId === viewer.memberId || booking.crew.includes(viewer.memberId));
          slotState = mine ? "yours" : "booked";
        } else if (heldBy) {
          slotState = "class";
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
        });
      }
      const need = requiredQualification ? state.qualifications.find((q) => q.code === requiredQualification) : undefined;
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
        slots,
        needs: need?.name ?? null,
        qualified: viewer.kind === "member" && need ? meetsQualification(state, viewer.memberId, need.code) : null,
        note,
      };
    });
  return { day, items };
}

/** The days a member can pick from: today through the furthest any item allows. */
export function pickableDays(state: ClubState, book: RuleBook, now: Date): string[] {
  const today = pacificDate(now);
  const furthest = Math.max(book.defaults.windowDays, ...state.items.map((i) => rulesFor(book, i).rules.windowDays));
  return Array.from({ length: furthest + 1 }, (_, n) => addDays(today, n));
}
