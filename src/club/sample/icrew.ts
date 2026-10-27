import { ICREW_COLUMNS } from "../engine/icrew";
import { addDays } from "../time";

/**
 * Invented files in the layout of iCrew's Reservations report, for the tests and for the sample club. Every name here is made up.
 * (The real report has the same fourteen columns; nothing from it is ever kept in this project.)
 */

export interface InventedBooking {
  /** iCrew writes dates as MM-DD-YYYY. */
  date: string;
  start: string;
  end: string;
  bookedOn?: string;
  bookedAt?: string;
  id: string | number;
  /** Blank for an event. */
  type: string;
  item: string;
  oars?: string;
  by: string;
  rowers?: string;
  out?: string;
  in?: string;
}

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026-03-08" becomes "03-08-2026". */
export const icrewDay = (iso: string) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;
const weekdayOf = (iso: string) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

/** One booking as a CSV line. Pass the day as MM-DD-YYYY, as iCrew does. */
export function icrewLine(b: InventedBooking): string {
  const [mm, dd, yyyy] = b.date.split("-");
  const day = weekdayOf(`${yyyy}-${mm}-${dd}`);
  return [b.date, day, b.start, b.end, b.bookedOn ?? "", b.bookedAt ?? "", String(b.id), b.type, b.item, b.oars ?? "", b.by, b.rowers ?? "", b.out ?? "", b.in ?? ""].map(cell).join(",");
}

export function icrewCsv(bookings: InventedBooking[], eol = "\r\n"): string {
  return [ICREW_COLUMNS.join(","), ...bookings.map(icrewLine)].join(eol) + eol;
}

/** A booking on an ISO day (2026-03-08), with sensible defaults. */
export function booking(isoDay: string, over: Partial<InventedBooking> & { id: string | number }): InventedBooking {
  return { date: icrewDay(isoDay), start: "7:00am", end: "8:00am", type: "Shell", item: "Cormorant", by: "Pat Example", out: "7:02am", in: "7:58am", ...over };
}

/**
 * The sample club's old bookings: a few for people who are in the invented club (so a member can see their own), a double with a
 * crewmate, an event, a joint booking, and one name that is not a member. Days are counted back from `today`, so the sample always reads as past.
 */
export function sampleHistoryCsv(today: string): string {
  const ago = (n: number) => addDays(today, -n);
  const rows: InventedBooking[] = [
    booking(ago(20), { id: 800001, item: "Cormorant", by: "Nora Abernathy", rowers: "Nora Abernathy (1)" }),
    booking(ago(34), { id: 800002, item: "Gym Space 01", type: "Gym Space", start: "6:30am", end: "7:30am", by: "Nora Abernathy", out: "6:31am", in: "7:29am" }),
    booking(ago(41), { id: 800003, item: "Heron Double", start: "7:30am", end: "9:00am", by: "Nora Abernathy", rowers: "Nora Abernathy (1),Tomas Vandermeer (2)" }),
    booking(ago(55), { id: 800004, item: "Fall Regatta Social", type: "", start: "6:00pm", end: "9:00pm", by: "Nora Abernathy", bookedOn: icrewDay(ago(70)), bookedAt: "", out: "", in: "" }),
    booking(ago(12), { id: 800005, item: "Heron Double", start: "8:00am", end: "9:30am", by: "Erik Lindqvist", rowers: "Erik Lindqvist (1),Maren Lindqvist (2)" }),
    booking(ago(27), { id: 800006, item: "Skimmer", type: "Paddle Board", start: "12:00pm", end: "1:00pm", by: "Erik Lindqvist", out: "12:03pm", in: "12:55pm" }),
    booking(ago(18), { id: 800007, item: "Loft Room 1", type: "Room Space", start: "5:00pm", end: "7:00pm", by: "Walter Pemberton", out: "5:00pm", in: "7:00pm" }),
    booking(ago(25), { id: 800008, item: "Cormorant", by: "Tomas & Maren Vandermeer", rowers: "Tomas Vandermeer (1)" }),
    booking(ago(9), { id: 800009, item: "Gym Space 02", type: "Gym Space", start: "6:00pm", end: "7:00pm", by: "Pat Visitingrower", out: "6:01pm", in: "6:58pm" }),
  ];
  return icrewCsv(rows);
}
