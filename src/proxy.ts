import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const result = checkAuth(
    request.headers.get("authorization"),
    process.env.DASHBOARD_PASSWORD,
    process.env.REQUIRE_PASSWORD === "1",
  );
  if (result === "ok") return NextResponse.next();
  if (result === "not-configured") {
    return new NextResponse("This dashboard is locked until DASHBOARD_PASSWORD is set.", { status: 503 });
  }
  return new NextResponse("Sign in to see member data.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="CCS usage dashboard", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
