import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, DEMO_KEYPAD_PATH, demoGateState } from "@/club/demo-gate";
import { sameOrigin } from "@/lib/same-origin";

/** Locks the demo on this browser: its pass is thrown away. Where the keypad is off this does not exist. */
export async function POST(request: NextRequest) {
  if (demoGateState() === "off") return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request.headers)) return new NextResponse(null, { status: 403 });
  const response = NextResponse.redirect(new URL(`${DEMO_KEYPAD_PATH}?locked=1`, request.url), 303);
  response.cookies.delete(DEMO_COOKIE);
  return response;
}
