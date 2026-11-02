import { NextResponse } from "next/server";
import { navExtras } from "@/club/demo-link";

/**
 * What extra items the dashboard's menu bar should show right now.
 *
 * The dashboard pages are built ahead of time, but whether the "CCS System" link belongs in the menu depends on where the
 * site is running: it is for test builds (development, previews, automated tests) and never for the live site, where the
 * reservation system does not exist yet. So the menu asks here when a page opens, and this answers per request, never at build
 * time. On the live site the answer is an empty list, and nothing about the reservation system appears, unless the club has set
 * the demo's address (CCS_DEMO_URL): then the answer also carries the link to the demo, which is a test version on its own
 * address behind the demo password. The live site itself still runs nothing of the reservation system.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(navExtras(), { headers: { "Cache-Control": "no-store" } });
}
