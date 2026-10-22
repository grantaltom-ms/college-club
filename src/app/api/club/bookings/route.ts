import type { NextRequest } from "next/server";
import { BookingRefused, createBooking } from "@/club/engine/bookings";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { bookingFormHref, idParam, idsParam, intParam, momentParam } from "@/club/web";
import { field, fields, noticeCode, see, startPost } from "@/club/web-post";

/** The booking form posts here. A refusal sends the person back to the form, which explains it in words. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { actor, ctx, form, store } = started;

  const itemId = idParam(field(form, "item"));
  const start = momentParam(field(form, "start"));
  const minutes = intParam(field(form, "minutes"), 1, 1440, 0);
  const bookerId = actor.kind === "member" ? actor.member.id : idParam(field(form, "for"));
  if (!itemId || !start || !minutes || !bookerId) return see(request, "/club/book?notice=invalid");

  const crew = idsParam(fields(form, "crew"));
  const override = actor.kind === "staff" && field(form, "override") === "1";
  const reason = field(form, "reason");
  const back = (notice?: string) =>
    see(request, bookingFormHref({ itemId, start: start.toISOString(), minutes, crew, forId: actor.kind === "staff" ? bookerId : null, override, reason }) + (notice ? `&notice=${notice}` : ""));

  try {
    const { booking } = await createBooking(
      store,
      RULE_BOOK,
      ctx,
      { itemId, bookerId, startsAt: start, endsAt: new Date(start.getTime() + minutes * 60000), crewIds: crew },
      override ? { override: { reason } } : {},
    );
    return see(request, `/club/my-bookings?booked=${booking.id}`);
  } catch (e) {
    if (e instanceof BookingRefused) return back();
    return back(noticeCode(e));
  }
}
