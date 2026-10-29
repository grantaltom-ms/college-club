import { connection } from "next/server";
import { clubEnabled } from "@/club/enabled";
import { memberAppManifest } from "@/club/pwa";

/** The member app's manifest. "Page not found" wherever the member area is off, including the live site. */
export async function GET() {
  await connection();
  if (!clubEnabled()) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(memberAppManifest()), { headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-store" } });
}
