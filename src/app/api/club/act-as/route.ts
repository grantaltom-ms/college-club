import { NextResponse, type NextRequest } from "next/server";
import { pickerEnabled } from "@/club/enabled";
import { ACTOR_COOKIE, parseActorCookie } from "@/club/identity";
import { memberById } from "@/club/engine/queries";
import { getClubStore } from "@/club/store/instance";

/** The "act as this test member" picker posts here. It does not exist at all unless invented data is allowed. */
export async function POST(request: NextRequest) {
  if (!pickerEnabled()) return new NextResponse(null, { status: 404 });

  const form = await request.formData();
  const choice = String(form.get("actor") ?? "");
  const back = NextResponse.redirect(new URL("/club", request.url), 303);

  if (choice === "none") {
    back.cookies.delete(ACTOR_COOKIE);
    return back;
  }
  const parsed = parseActorCookie(choice);
  if (!parsed) return NextResponse.redirect(new URL("/club/act-as", request.url), 303);
  if (parsed.kind === "member") {
    const state = await (await getClubStore()).read();
    if (!memberById(state, parsed.memberId)) return NextResponse.redirect(new URL("/club/act-as", request.url), 303);
  }
  back.cookies.set(ACTOR_COOKIE, choice, { httpOnly: true, sameSite: "lax", path: "/", secure: request.nextUrl.protocol === "https:" });
  return back;
}
