import { sampleMembership } from "@/lib/membership";
import { liveConfig, loadMembership } from "@/lib/supabase";

const NO_STORE = { "Cache-Control": "no-store" };

/** Public, counts only: paying members, leavers, applicants and waitlist by month. No names. */
export async function GET() {
  const cfg = liveConfig();
  if (cfg) {
    try {
      const data = await loadMembership(cfg);
      if (data.months.length === 0) {
        return Response.json({ error: "There are no membership counts yet. Load the Membership Count workbooks into the membership_monthly table." }, { status: 503, headers: NO_STORE });
      }
      return Response.json(data, { headers: NO_STORE });
    } catch (error) {
      console.error("Could not load membership counts", error);
      return Response.json(
        { error: "The membership figures could not be loaded. If the membership_monthly table has not been set up yet, see db/membership_monthly.sql." },
        { status: 502, headers: NO_STORE },
      );
    }
  }
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") {
    return Response.json(sampleMembership(), { headers: NO_STORE });
  }
  return Response.json(
    { error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
    { status: 500, headers: NO_STORE },
  );
}
