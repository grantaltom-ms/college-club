import { NextResponse } from "next/server";
import { qboInvoiceFiles } from "@/club/engine/billing-files";
import { linesComplete } from "@/club/engine/billing-views";
import { BILLING_RULES } from "@/club/settings/billing-rules";
import { startStaffGet } from "@/club/web-post";

/**
 * Staff only: one part of a closed month's QuickBooks Online invoice file. Worked out from the month's frozen lines, so
 * downloading it again always gives the same file. A month that is not closed, a part that does not exist, and anyone who is
 * not staff all get "not found".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ month: string; part: string }> }) {
  const started = await startStaffGet();
  if ("response" in started) return started.response;
  const { month, part } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^[1-9]\d{0,3}$/.test(part)) return new NextResponse(null, { status: 404 });
  const state = await started.store.read();
  const run = state.billingRuns.find((r) => r.month === month);
  if (!run) return new NextResponse(null, { status: 404 });
  if (!linesComplete(state, run)) return new NextResponse("This month is older than the records loaded here, so its file cannot be made safely from this screen. Ask for help.", { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const files = qboInvoiceFiles({ run, lines: state.billingLines.filter((l) => l.runId === run.id), households: state.households, rules: BILLING_RULES });
  const file = files.parts[Number(part) - 1];
  if (!file) return new NextResponse(null, { status: 404 });
  return new NextResponse(file.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ccs-quickbooks-invoices-${month}-part-${file.number}-of-${file.of}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
