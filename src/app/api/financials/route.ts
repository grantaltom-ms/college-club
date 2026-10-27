import type { NextRequest } from "next/server";
import { sampleFinancials } from "@/lib/financials";
import { FINANCIALS_COOKIE, financialsUnlocked } from "@/lib/financials-lock";
import { liveConfig, loadFinancials } from "@/lib/supabase";

const NO_STORE = { "Cache-Control": "no-store" };

/** Aggregates only, no names: monthly profit-and-loss figures for the club, for browsers that typed the Financials password. */
export async function GET(request: NextRequest) {
  if (!financialsUnlocked(request.cookies.get(FINANCIALS_COOKIE)?.value)) {
    return Response.json({ error: "Financials is locked. Type the Financials password to see these figures." }, { status: 401, headers: NO_STORE });
  }
  const cfg = liveConfig();
  if (cfg) {
    try {
      const data = await loadFinancials(cfg);
      if (data.months.length === 0) {
        return Response.json({ error: "There are no finance figures yet. Load the Board Reporting Packages into the finance_monthly table." }, { status: 503, headers: NO_STORE });
      }
      return Response.json(data, { headers: NO_STORE });
    } catch (error) {
      console.error("Could not load finance figures", error);
      return Response.json(
        { error: "The finance figures could not be loaded. If the finance_monthly table has not been set up yet, see db/finance_monthly.sql." },
        { status: 502, headers: NO_STORE },
      );
    }
  }
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") {
    return Response.json(sampleFinancials(), { headers: NO_STORE });
  }
  return Response.json(
    { error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
    { status: 500, headers: NO_STORE },
  );
}
