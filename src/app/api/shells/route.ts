import type { NextRequest } from "next/server";
import { normalizeShellOwnership, sampleShells, type ShellOwnership } from "@/lib/shells";
import { liveConfig, loadShells } from "@/lib/supabase";

const NO_STORE = { "Cache-Control": "no-store" };

function requestedOwnership(request: NextRequest): ShellOwnership[] {
  return normalizeShellOwnership(request.nextUrl.searchParams.getAll("ownership").join(","));
}

/** Public, counts only: boats, days and times. Rowers are counted on the server and never named. */
export async function GET(request: NextRequest) {
  const ownership = requestedOwnership(request);
  const clubOnly = ownership.length === 1 && ownership[0] === "club";
  const cfg = liveConfig();
  if (cfg) {
    try {
      const data = await loadShells(cfg, undefined, ownership);
      if (data.outings.length === 0 && clubOnly) {
        return Response.json({ error: "There is no shell data yet. Load the iCrew shell export into the shell_outings table." }, { status: 503, headers: NO_STORE });
      }
      return Response.json(data, { headers: NO_STORE });
    } catch (error) {
      console.error("Could not load shell data", error);
      const hint = clubOnly
        ? "If the shell_outings table has not been set up yet, see db/shell_outings.sql."
        : "If shell_outings_all has not been set up yet, member-owned boats cannot load. Club boats still load when ownership is club.";
      return Response.json({ error: `The shell data could not be loaded. ${hint}` }, { status: 502, headers: NO_STORE });
    }
  }
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") {
    const data = sampleShells(ownership);
    return Response.json({ ...data, ownership }, { headers: NO_STORE });
  }
  return Response.json(
    { error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
    { status: 500, headers: NO_STORE },
  );
}
