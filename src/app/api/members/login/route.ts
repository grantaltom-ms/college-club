import { SESSION_COOKIE, SESSION_SECONDS, createSession, safeEqual } from "@/lib/auth";

export async function POST(request: Request) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return Response.json({ error: "The members page is locked until a password is set." }, { status: 503 });
  }
  let given = "";
  try {
    const body = await request.json();
    given = typeof body?.password === "string" ? body.password : "";
  } catch {
    // An unreadable body counts as a wrong password.
  }
  if (!safeEqual(given, password)) {
    // A short pause makes guessing passwords slow.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return Response.json({ error: "That password is not right." }, { status: 401 });
  }
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${SESSION_COOKIE}=${await createSession(password)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`,
      },
    },
  );
}
