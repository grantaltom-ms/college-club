import { NextResponse } from "next/server";
import { clubEnabled } from "@/club/enabled";
import { EQUIPMENT_TEMPLATE } from "@/club/engine/equipment-import";
import { getCurrentActor } from "@/club/identity";

/** Staff only: the blank equipment sheet, with three invented example rows that the upload refuses so they cannot be loaded by accident. */
export async function GET() {
  if (!clubEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getCurrentActor();
  if (actor?.kind !== "staff") return new NextResponse(null, { status: 404 });
  return new NextResponse(EQUIPMENT_TEMPLATE, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="ccs-equipment-template.csv"', "Cache-Control": "no-store" },
  });
}
