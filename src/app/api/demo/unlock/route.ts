import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, DEMO_KEYPAD_PATH, DEMO_PASS_DAYS, demoGateState, demoNext, demoPassword, demoPasswordMatches, makeDemoPass } from "@/club/demo-gate";
import { sameOrigin } from "@/lib/same-origin";

/**
 * Checks the demo password. Right: this browser gets a 30-day pass and goes on to the page it asked for. Wrong: back to the
 * keypad after a short wait. Where the keypad is off (the live site, development) this does not exist.
 */
export async function POST(request: NextRequest) {
  if (demoGateState() === "off") return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request.headers)) return new NextResponse(null, { status: 403 });
  const password = demoPassword();
  const form = await request.formData().catch(() => null);
  const typed = form?.get("password");
  const next = demoNext(String(form?.get("next") ?? ""));
  if (!password || typeof typed !== "string" || !demoPasswordMatches(typed, password)) {
    // A second's wait on every wrong answer makes guessing by machine slow.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const back = new URL(DEMO_KEYPAD_PATH, request.url);
    back.search = `?wrong=1&next=${encodeURIComponent(next)}`;
    return NextResponse.redirect(back, 303);
  }
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(DEMO_COOKIE, makeDemoPass(password, new Date()), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: DEMO_PASS_DAYS * 24 * 60 * 60,
  });
  return response;
}
