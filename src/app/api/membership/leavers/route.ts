import { sampleLeavers } from "@/lib/leavers";
import { liveConfig, loadLeavers } from "@/lib/supabase";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Public, counts only: how members who resigned used the club before they left, against members who stayed.
 * Names, resignation dates and any one person's visits stay on the server; the answer holds counts, averages and percentages.
 */
export async function GET() {
  const cfg = liveConfig();
  if (cfg) {
    try {
      const data = await loadLeavers(cfg);
      if (data.resignations === 0) {
        return Response.json(
          { error: "No named resignations are loaded yet. Add them to the resignations table (see db/resignations.sql)." },
          { status: 503, headers: NO_STORE },
        );
      }
      return Response.json(data, { headers: NO_STORE });
    } catch (error) {
      console.error("Could not load resignation usage", error);
      return Response.json(
        { error: "The resignation figures could not be loaded. If the resignations table has not been set up yet, see db/resignations.sql." },
        { status: 502, headers: NO_STORE },
      );
    }
  }
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") {
    return Response.json(sampleLeavers(), { headers: NO_STORE });
  }
  return Response.json(
    { error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
    { status: 500, headers: NO_STORE },
  );
}
