import { loadDashboard, withoutNames } from "@/lib/dashboard-data";

const NO_STORE = { "Cache-Control": "no-store" };

/** Public: totals and patterns, with member names removed. */
export async function GET() {
  const result = await loadDashboard();
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers: NO_STORE });
  return Response.json(withoutNames(result.data), { headers: NO_STORE });
}
