import { NextResponse, type NextRequest } from "next/server";
import { getLoginDeps } from "@/club/auth/deps";
import { requestSignInLink } from "@/club/auth/login";
import { clubNow } from "@/club/clock";
import { clubEnabled } from "@/club/enabled";
import { field, see, sameOrigin, siteOrigin } from "@/club/web-post";

/**
 * "Email me a sign-in link". The answer is the same whether or not the address belongs to anyone, so the form cannot be used
 * to find out who is a member. The address is never put in the web address of the page it sends the browser to.
 */
export async function POST(request: NextRequest) {
  if (!clubEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return see(request, "/club/sign-in?notice=email");
  }
  const origin = siteOrigin(request);
  const deps = await getLoginDeps();
  if (!origin) return see(request, "/club/sign-in?notice=off");
  const result = await requestSignInLink(deps, { email: field(form, "email", 320), origin, now: clubNow() });
  if (result === "invalid") return see(request, "/club/sign-in?notice=email");
  if (result === "off") return see(request, "/club/sign-in?notice=off");
  return see(request, "/club/sign-in?sent=1");
}
