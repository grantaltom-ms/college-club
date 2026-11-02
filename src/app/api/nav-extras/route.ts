import { NextResponse } from "next/server";
import { pickerEnabled } from "@/club/enabled";

/**
 * What extra items the dashboard's menu bar should show right now.
 *
 * The dashboard pages are built ahead of time, but whether the "CCS System" link belongs in the menu depends on where the
 * site is running: it is for test builds (development, previews, automated tests) and never for the live site, where the
 * reservation system does not exist yet. So the menu asks here when a page opens, and this answers per request, never at build
 * time. On the live site the answer is an empty list, and nothing about the reservation system appears.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ extras: pickerEnabled() ? ["system"] : [] }, { headers: { "Cache-Control": "no-store" } });
}
