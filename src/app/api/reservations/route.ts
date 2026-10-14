import { fromCounts, sampleReservations, type CountRow } from "@/lib/reservations";
import { fetchAll, liveConfig } from "@/lib/supabase";

const NO_STORE = { "Cache-Control": "no-store" };

/** Public, counts only: how many reservations of each type per day and start hour. No names. */
export async function GET() {
  const cfg = liveConfig();
  if (cfg) {
    try {
      const rows = await fetchAll<CountRow>(cfg, "reservation_counts", "day.asc,hour.asc,item_type.asc");
      const data = fromCounts(rows, new Date().toISOString().slice(0, 10));
      if (data.cells.length === 0) {
        return Response.json({ error: "There are no reservation counts yet. Load the iCrew reservations export into the reservation_counts table." }, { status: 503, headers: NO_STORE });
      }
      return Response.json(data, { headers: NO_STORE });
    } catch (error) {
      console.error("Could not load reservation counts", error);
      return Response.json(
        { error: "The reservation figures could not be loaded. If the reservation_counts table has not been set up yet, see db/reservation_counts.sql." },
        { status: 502, headers: NO_STORE },
      );
    }
  }
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") {
    return Response.json(sampleReservations(), { headers: NO_STORE });
  }
  return Response.json(
    { error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
    { status: 500, headers: NO_STORE },
  );
}
