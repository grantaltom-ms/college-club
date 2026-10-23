import { NextResponse, type NextRequest } from "next/server";
import { getLoginDeps } from "@/club/auth/deps";
import { signOut } from "@/club/auth/login";
import { clubNow } from "@/club/clock";
import { clubEnabled } from "@/club/enabled";
import { ACTOR_COOKIE, SESSION_COOKIE } from "@/club/identity";
import { sameOrigin, see } from "@/club/web-post";

/** Signs this browser out: the club forgets the key, and the cookies go. (The "who is this device" memory stays.) */
export async function POST(request: NextRequest) {
  if (!clubEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  await signOut(await getLoginDeps(), { secret: request.cookies.get(SESSION_COOKIE)?.value, now: clubNow() });
  const response = see(request, "/club/sign-in?out=1");
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(ACTOR_COOKIE);
  return response;
}
