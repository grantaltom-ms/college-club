import { NextResponse, type NextRequest } from "next/server";
import { getLoginDeps } from "@/club/auth/deps";
import { confirmSignIn } from "@/club/auth/login";
import { clubNow } from "@/club/clock";
import { clubEnabled } from "@/club/enabled";
import { ACTOR_COOKIE, REMEMBER_COOKIE, SESSION_COOKIE } from "@/club/identity";
import { LOGIN_RULES } from "@/club/settings/login-rules";
import { field, sameOrigin, see } from "@/club/web-post";
import { identityKey } from "@/club/auth/identities";

const DAY = 24 * 60 * 60;

/**
 * The button on a sign-in link's page: signs in as the person chosen. A link that does not work, or a choice it does not allow,
 * looks the same: back to the sign-in page with one plain message.
 */
export async function POST(request: NextRequest) {
  if (!clubEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return see(request, "/club/sign-in?notice=signin_link");
  }
  const signedIn = await confirmSignIn(await getLoginDeps(), { secret: field(form, "token", 100), identity: field(form, "identity", 400), now: clubNow() });
  if (!signedIn) return see(request, "/club/sign-in?notice=signin_link");

  const response = see(request, "/club");
  const secure = request.nextUrl.protocol === "https:";
  // The cookie's life is counted by the browser's own clock from now, so a frozen test clock cannot make it expire at once.
  response.cookies.set(SESSION_COOKIE, signedIn.sessionSecret, { httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: LOGIN_RULES.defaults.sessionDays * DAY });
  response.cookies.set(REMEMBER_COOKIE, identityKey(signedIn.identity), { httpOnly: true, sameSite: "lax", path: "/", secure, maxAge: 365 * DAY });
  // Someone who really signed in is no longer "acting as" a test member.
  response.cookies.delete(ACTOR_COOKIE);
  return response;
}
