import { NextResponse, type NextRequest } from "next/server";
import { EMAIL_LISTS_COOKIE } from "@/lib/email-lists-lock";
import { sameOrigin } from "@/lib/same-origin";

/** Locks the list builder on this browser: its pass is thrown away. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return new NextResponse(null, { status: 403 });
  const response = NextResponse.redirect(new URL("/email?locked=1#lists", request.url), 303);
  response.cookies.delete(EMAIL_LISTS_COOKIE);
  return response;
}
