import { NextResponse, type NextRequest } from "next/server";
import { FINANCIALS_COOKIE } from "@/lib/financials-lock";
import { sameOrigin } from "@/lib/same-origin";

/** Locks Financials on this browser: its pass is thrown away. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return new NextResponse(null, { status: 403 });
  const response = NextResponse.redirect(new URL("/financials?locked=1", request.url), 303);
  response.cookies.delete(FINANCIALS_COOKIE);
  return response;
}
