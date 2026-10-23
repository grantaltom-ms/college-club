import { NextResponse, type NextRequest } from "next/server";
import { rsvpLinksCsv } from "@/club/engine/rsvp-links";
import { clubEnabled } from "@/club/enabled";
import { getCurrentActor } from "@/club/identity";
import { getLinkSecret } from "@/club/link-secret";
import { getClubStore } from "@/club/store/instance";
import { idParam } from "@/club/web";

/**
 * Staff only: every active adult's personal RSVP link for one event, as a CSV for a Mailchimp merge field later.
 * Nothing is sent anywhere. Anyone who is not staff, or any event that does not exist, gets the same "not found".
 */
export async function GET(request: NextRequest, context: { params: Promise<{ eventId: string }> }) {
  const notFound = new NextResponse(null, { status: 404 });
  if (!clubEnabled()) return notFound;
  const actor = await getCurrentActor();
  const eventId = idParam((await context.params).eventId);
  if (actor?.kind !== "staff" || !eventId) return notFound;
  const state = await (await getClubStore()).read();
  const event = state.events.find((e) => e.id === eventId);
  if (!event) return notFound;
  const secret = getLinkSecret();
  if (!secret) return new NextResponse("Personal RSVP links need CLUB_LINK_SECRET to be set on this server. See .env.example.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const csv = rsvpLinksCsv(state, event, secret, request.nextUrl.origin);
  const slug = event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "event";
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rsvp-links-${slug}.csv"`, "Cache-Control": "no-store" } });
}
