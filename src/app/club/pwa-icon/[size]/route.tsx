import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { clubEnabled } from "@/club/enabled";
import { iconElement, parseIconSize, whiteLogoDataUri } from "@/club/pwa";

/** The member app's home-screen icon at 180, 192 or 512 pixels. "Page not found" for any other size, and wherever the member area is off. */
export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  await connection();
  if (!clubEnabled()) return new Response(null, { status: 404 });
  const size = parseIconSize((await params).size);
  if (!size) return new Response(null, { status: 404 });
  const logo = await whiteLogoDataUri(new URL(request.url).origin);
  return new ImageResponse(iconElement(size, logo), { width: size, height: size, headers: { "Cache-Control": "public, max-age=3600" } });
}
