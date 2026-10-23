import { NextResponse } from "next/server";
import { clubEnabled } from "@/club/enabled";
import { ROSTER_TEMPLATE } from "@/club/engine/roster";
import { getCurrentActor } from "@/club/identity";

/** Staff only: the blank roster file, with three invented example rows that the import refuses so they cannot be added by accident. */
export async function GET() {
  if (!clubEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getCurrentActor();
  if (actor?.kind !== "staff") return new NextResponse(null, { status: 404 });
  return new NextResponse(ROSTER_TEMPLATE, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="ccs-roster-template.csv"', "Cache-Control": "no-store" },
  });
}
