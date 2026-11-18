import { NextResponse, type NextRequest } from "next/server";
import { EMAIL_LISTS_COOKIE, emailListsPassword, makeListsToken, passwordMatches, UNLOCK_DAYS } from "@/lib/email-lists-lock";
import { sameOrigin } from "@/lib/same-origin";

/** Checks the list builder password. Right: this browser can use it for 30 days. Wrong: back to the page, after a short wait. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return new NextResponse(null, { status: 403 });
  const password = emailListsPassword();
  const form = await request.formData().catch(() => null);
  const typed = form?.get("password");
  if (!password || typeof typed !== "string" || !passwordMatches(typed, password)) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return NextResponse.redirect(new URL("/email?wrong=1#lists", request.url), 303);
  }
  const response = NextResponse.redirect(new URL("/email#lists", request.url), 303);
  response.cookies.set(EMAIL_LISTS_COOKIE, makeListsToken(password, new Date()), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: UNLOCK_DAYS * 24 * 60 * 60,
  });
  return response;
}
