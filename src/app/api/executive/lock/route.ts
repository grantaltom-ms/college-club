import { NextResponse, type NextRequest } from "next/server";
import { EXECUTIVE_COOKIE } from "@/lib/executive-lock";
import { sameOrigin } from "@/lib/same-origin";

/** Ends this browser's editing pass. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers)) return new NextResponse(null, { status: 403 });
  const response = NextResponse.redirect(new URL("/executive", request.url), 303);
  response.cookies.delete(EXECUTIVE_COOKIE);
  return response;
}
