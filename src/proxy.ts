import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE, DEMO_KEYPAD_PATH, decideGate } from "@/club/demo-gate";

/**
 * The demo keypad's door (see src/club/demo-gate.ts). It looks at every request, but with the keypad off, which is every
 * request on the live site and in development, it lets everything through at once and touches nothing. With the keypad on, an
 * address inside the member area or the public-site preview without a good 30-day pass is sent to the keypad.
 *
 * It covers everything except the framework's own files, and decides by address inside `decideGate`, so a strangely written
 * address cannot slip past a pattern here. Next.js runs this before the pages. Buttons that run on the server are posts to their
 * page's address, so they are covered too, but they check who is allowed themselves as well: this is a second lock, not the only one.
 */
export function proxy(request: NextRequest) {
  const decision = decideGate({
    method: request.method,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    pass: request.cookies.get(DEMO_COOKIE)?.value,
    now: new Date(),
  });
  if (decision.kind === "allow") return NextResponse.next();

  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (decision.kind === "keypad") {
    const url = request.nextUrl.clone();
    url.pathname = DEMO_KEYPAD_PATH;
    url.search = `?next=${encodeURIComponent(decision.next)}`;
    return NextResponse.redirect(url, { status: 307, headers });
  }
  return new NextResponse("The demo is locked. Open the demo page and type the demo password.", { status: 401, headers });
}

export const config = {
  // Everything but the framework's built files; the decision is made by address inside the function.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
