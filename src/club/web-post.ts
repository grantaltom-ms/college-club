import { NextResponse, type NextRequest } from "next/server";
import { clubNow } from "./clock";
import { clubEnabled } from "./enabled";
import { ClubError } from "./errors";
import { getCurrentActor, toEngineActor, type CurrentActor } from "./identity";
import { getClubStore } from "./store/instance";
import type { Ctx } from "./engine/households";

/** What every club form handler starts with: the area must be on, someone must be acting, and the form must be readable. */
export async function startPost(request: NextRequest): Promise<{ response: NextResponse } | { actor: CurrentActor; ctx: Ctx; form: FormData; store: Awaited<ReturnType<typeof getClubStore>> }> {
  if (!clubEnabled()) return { response: new NextResponse(null, { status: 404 }) };
  const actor = await getCurrentActor();
  if (!actor) return { response: see(request, "/club/act-as") };
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { response: see(request, "/club?notice=invalid") };
  }
  return { actor, ctx: { actor: toEngineActor(actor), now: clubNow() }, form, store: await getClubStore() };
}

/** Send the browser to another page after a form post ("see other"), so reloading never repeats the post. */
export function see(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

/** A text field from a form, trimmed and capped. */
export function field(form: FormData, name: string, max = 300): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function fields(form: FormData, name: string, limit = 12): string[] {
  return form
    .getAll(name)
    .filter((v): v is string => typeof v === "string")
    .slice(0, limit);
}

/** The short code a refusal turns into when the browser is sent back to a page. */
export function noticeCode(e: unknown): string {
  if (e instanceof ClubError && e.code !== "refused") return e.code;
  throw e;
}
