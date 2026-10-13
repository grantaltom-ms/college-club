import { liveConfig, loadLiveData } from "@/lib/supabase";
import { sampleData } from "@/lib/sample";

export async function GET() {
  const cfg = liveConfig();
  if (cfg) {
    try {
      return Response.json(await loadLiveData(cfg), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("Could not load dashboard data", error);
      return Response.json(
        { error: "The member database could not be reached. Try again in a minute." },
        { status: 502 },
      );
    }
  }
  // Sample data is for development and tests only. Production must never show it as if it were real.
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") {
    return Response.json(sampleData(), { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(
    { error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
    { status: 500 },
  );
}
