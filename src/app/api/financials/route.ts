import { sampleFinancials } from "@/lib/financials";
import { liveConfig, loadFinancials } from "@/lib/supabase";

const NO_STORE = { "Cache-Control": "no-store" };

/** Public, aggregates only: monthly profit-and-loss figures for the club. No names. */
export async function GET() {
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
