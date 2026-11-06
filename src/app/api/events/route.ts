import { sampleEvents } from "@/lib/events";
import { liveConfig, loadEvents } from "@/lib/supabase";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Public, counts only: how each promoted event was promoted, signed up for and attended. No names.
 * Its own route, so a missing event_scoreboard table only breaks the Events and Marketing page.
 */
export async function GET() {
  const cfg = liveConfig();
  if (cfg) {
    try {
      const data = await loadEvents(cfg);
      if (data.events.length === 0) {
        return Response.json({ error: "There are no event figures yet. Load db/event_scoreboard.csv into the event_scoreboard table." }, { status: 503, headers: NO_STORE });
      }
      return Response.json(data, { headers: NO_STORE });
    } catch (error) {
      console.error("Could not load event figures", error);
      return Response.json(
        { error: "The event figures could not be loaded. If the event_scoreboard table has not been set up yet, see db/event_scoreboard.sql." },
        { status: 502, headers: NO_STORE },
      );
    }
  }
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") {
    return Response.json(sampleEvents(), { headers: NO_STORE });
  }
  return Response.json(
    { error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
    { status: 500, headers: NO_STORE },
  );
}
