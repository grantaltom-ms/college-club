import { pacificWall } from "./time";
import type { EventFields } from "./engine/events";
import { centsFromForm, dateParam, timeParam } from "./web";
import { field } from "./web-post";

/**
 * Reads the staff event form (add or edit) into event fields, or null if a field is not what it should be. The wording of
 * anything wrong with the values themselves (an end before a start, a limit of zero) comes from the engine, not from here.
 */
export function parseEventForm(form: FormData): EventFields | null {
  const date = dateParam(field(form, "date"));
  const start = timeParam(field(form, "start"));
  const end = timeParam(field(form, "end"));
  if (!date || start === null || end === null) return null;

  const limitText = field(form, "limit");
  let capacity: number | null = null;
  if (limitText !== "") {
    if (!/^\d{1,4}$/.test(limitText)) return null;
    capacity = Number(limitText);
  }
  const price = centsFromForm(field(form, "price"));
  if (price === undefined) return null;

  const replyDate = field(form, "replyByDate");
  const replyTime = field(form, "replyByTime");
  let replyBy: Date | null = null;
  if (replyDate !== "" || replyTime !== "") {
    const d = dateParam(replyDate);
    const t = timeParam(replyTime);
    if (!d || t === null) return null;
    replyBy = pacificWall(d, t);
  }
  return {
    title: field(form, "title", 120),
    description: field(form, "description", 1000),
    location: field(form, "location", 200),
    startsAt: pacificWall(date, start),
    endsAt: pacificWall(date, end),
    capacity,
    priceCents: price,
    replyBy,
  };
}
