import { NextResponse, type NextRequest } from "next/server";
import { FINANCIALS_COOKIE, financialsPassword, makeUnlockToken, passwordMatches, UNLOCK_DAYS } from "@/lib/financials-lock";
import { sameOrigin } from "@/lib/same-origin";

/** Checks the Financials password. Right: this browser gets a 30-day pass. Wrong: back to the box, after a short wait. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return new NextResponse(null, { status: 403 });
  const password = financialsPassword();
  const form = await request.formData().catch(() => null);
  const typed = form?.get("password");
  if (!password || typeof typed !== "string" || !passwordMatches(typed, password)) {
    // A second's wait on every wrong answer makes guessing by machine slow.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return NextResponse.redirect(new URL("/financials?wrong=1", request.url), 303);
  }
  const response = NextResponse.redirect(new URL("/financials", request.url), 303);
  response.cookies.set(FINANCIALS_COOKIE, makeUnlockToken(password, new Date()), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: UNLOCK_DAYS * 24 * 60 * 60,
  });
  return response;
}
