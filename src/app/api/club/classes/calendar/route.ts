import { clubNow } from "@/club/clock";
import { buildClassCalendarIcs, classCalendarEvents } from "@/club/engine/class-calendar";
import { clubEnabled } from "@/club/enabled";
import { getClubStore } from "@/club/store/instance";
import { siteOrigin } from "@/club/web-post";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Fitness classes subscribe feed (ICS). One-way: calendars read upcoming dated sessions from this app;
 * nothing is written back. No member names. Exists only where the member area is on.
 *
 * Calendar apps fetch this without a signed-in cookie, so the address is open wherever /club is —
 * the same way the club's old public class calendar was shared. On the live site the member area
 * (and this feed) answer "page not found".
 */
export async function GET(request: NextRequest) {
  if (!clubEnabled()) return new NextResponse(null, { status: 404 });

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const events = classCalendarEvents(state, now);
  const ics = buildClassCalendarIcs(events, {
    calendarName: "CCS Fitness Classes",
    siteOrigin: siteOrigin(request),
    now,
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="ccs-fitness-classes.ics"',
      // Short cache so a cancel or new date shows up on the next refresh without hammering the server.
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}

/** Same body as GET: some calendar clients probe with HEAD. */
export async function HEAD(request: NextRequest) {
  const res = await GET(request);
  return new NextResponse(null, { status: res.status, headers: res.headers });
}
