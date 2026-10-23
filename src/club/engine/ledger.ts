import { CLASS_RULES } from "../settings/class-rules";
import { EVENT_RULES } from "../settings/event-rules";
import type { ClassRules, EventRules } from "../types";
import { bookingLedger } from "./bookings";
import { classLedger } from "./classes";
import { eventLedger } from "./events";
import type { BookingLedger } from "./households";

/**
 * Everything that has to happen to a member's future when they leave the club: boat bookings cancelled, class sign-ups
 * and event RSVPs cancelled, with the waiting lists moved up behind them. Ending a household and removing an adult both use this.
 */
export function clubLedgerFor(classRules: ClassRules, eventRules: EventRules): BookingLedger {
  return { cancelFutureBookings: bookingLedger.cancelFutureBookings, ...classLedger(classRules), ...eventLedger(eventRules) };
}

/** The ledger the app uses, on the club's class and event rules. */
export const clubLedger: BookingLedger = clubLedgerFor(CLASS_RULES, EVENT_RULES);
