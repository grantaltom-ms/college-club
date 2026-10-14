import { sampleShells } from "@/lib/shells";
import { liveConfig, loadShells } from "@/lib/supabase";

const NO_STORE = { "Cache-Control": "no-store" };

/** Public, counts only: boats, days and times. Rowers are counted on the server and never named. */
export async function GET() {
  const cfg = liveConfig();
  if (cfg) {
    try {
      const data = await loadShells(cfg);
      if (data.outings.length === 0) {
        return Response.json({ error: "There is no shell data yet. Load the iCrew shell export into the shell_outings table." }, { status: 503, headers: NO_STORE });
      }
      return Response.json(data, { headers: NO_STORE });
    } catch (error) {
      console.error("Could not load shell data", error);
      return Response.json(
        { error: "The shell data could not be loaded. If the shell_outings table has not been set up yet, see db/shell_outings.sql." },
        { status: 502, headers: NO_STORE },
      );
    }
  }
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") {
    return Response.json(sampleShells(), { headers: NO_STORE });
  }
  return Response.json(
    { error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
    { status: 500, headers: NO_STORE },
  );
}
