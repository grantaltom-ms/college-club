import { NextResponse } from "next/server";
import { clubEnabled } from "@/club/enabled";
import { RESIGNATION_TEMPLATE } from "@/club/engine/resignations";
import { getCurrentActor } from "@/club/identity";

/** Staff only: the blank resignations file, with two invented example rows that the tool refuses so they cannot be acted on by accident. */
export async function GET() {
  if (!clubEnabled()) return new NextResponse(null, { status: 404 });
  const actor = await getCurrentActor();
  if (actor?.kind !== "staff") return new NextResponse(null, { status: 404 });
  return new NextResponse(RESIGNATION_TEMPLATE, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="ccs-resignations-template.csv"', "Cache-Control": "no-store" },
  });
}
