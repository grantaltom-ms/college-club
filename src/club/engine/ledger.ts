import { CLASS_RULES } from "../settings/class-rules";
import type { ClassRules } from "../types";
import { bookingLedger } from "./bookings";
import { classLedger } from "./classes";
import type { BookingLedger } from "./households";

/**
 * Everything that has to happen to a member's future when they leave the club: boat bookings cancelled and class
 * sign-ups cancelled, with the waiting lists moved up behind them. Ending a household and removing an adult both use this.
 */
export function clubLedgerFor(classRules: ClassRules): BookingLedger {
  return { cancelFutureBookings: bookingLedger.cancelFutureBookings, ...classLedger(classRules) };
}

/** The ledger the app uses, on the club's class rules. */
export const clubLedger: BookingLedger = clubLedgerFor(CLASS_RULES);
