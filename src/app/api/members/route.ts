import { SESSION_COOKIE, cookieValue, verifySession } from "@/lib/auth";
import { loadDashboard } from "@/lib/dashboard-data";

const NO_STORE = { "Cache-Control": "no-store" };

/** Private: the full data, with member names. Needs the members sign-in cookie. */
export async function GET(request: Request) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return Response.json({ error: "The members page is locked until a password is set." }, { status: 503, headers: NO_STORE });
  }
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (!(await verifySession(token, password))) {
    return Response.json({ error: "Sign in to see member names." }, { status: 401, headers: NO_STORE });
  }
  const result = await loadDashboard();
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers: NO_STORE });
  return Response.json(result.data, { headers: NO_STORE });
}
