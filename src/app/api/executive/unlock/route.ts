import { NextResponse, type NextRequest } from "next/server";
import { EXECUTIVE_COOKIE, executivePassword, makeEditToken, passwordMatches, UNLOCK_DAYS } from "@/lib/executive-lock";
import { sameOrigin } from "@/lib/same-origin";

/** Checks the executive editing password. Right: this browser can edit for 30 days. Wrong: back to the page, after a short wait. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return new NextResponse(null, { status: 403 });
  const password = executivePassword();
  const form = await request.formData().catch(() => null);
  const typed = form?.get("password");
  if (!password || typeof typed !== "string" || !passwordMatches(typed, password)) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return NextResponse.redirect(new URL("/executive?wrong=1#edit", request.url), 303);
  }
  const response = NextResponse.redirect(new URL("/executive", request.url), 303);
  response.cookies.set(EXECUTIVE_COOKIE, makeEditToken(password, new Date()), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: UNLOCK_DAYS * 24 * 60 * 60,
  });
  return response;
}
