import { NextResponse } from "next/server";
import { chargesCsv } from "@/club/engine/billing-files";
import { linesComplete } from "@/club/engine/billing-views";
import { BILLING_RULES } from "@/club/settings/billing-rules";
import { startStaffGet } from "@/club/web-post";

/**
 * Staff only: every line of a closed month, credits and the tax flag included, as a plain spreadsheet. Worked out from the
 * month's frozen lines. A month that is not closed, and anyone who is not staff, get "not found".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ month: string }> }) {
  const started = await startStaffGet();
  if ("response" in started) return started.response;
  const { month } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new NextResponse(null, { status: 404 });
  const state = await started.store.read();
  const run = state.billingRuns.find((r) => r.month === month);
  if (!run) return new NextResponse(null, { status: 404 });
  if (!linesComplete(state, run)) return new NextResponse("This month is older than the records loaded here, so its file cannot be made safely from this screen. Ask for help.", { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const csv = chargesCsv({ run, lines: state.billingLines.filter((l) => l.runId === run.id), households: state.households, rules: BILLING_RULES });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ccs-charges-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
