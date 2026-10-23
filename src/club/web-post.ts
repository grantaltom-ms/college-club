import { NextResponse, type NextRequest } from "next/server";
import { clubNow } from "./clock";
import { clubEnabled } from "./enabled";
import { ClubError } from "./errors";
import { fullName, memberById } from "./engine/queries";
import { getCurrentActor, getRsvpLinkActor, ipadCodeIsGenuine, toEngineActor, type CurrentActor } from "./identity";
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

/**
 * What every emailed-link form handler starts with. The member area must be on, the form must be readable, and the link
 * must be genuine (this event, this member, the right secret code). Anything else answers "not found" and does nothing:
 * the same answer for every wrong link, so a stranger learns nothing. The link signs nobody in and sets no cookie.
 */
export async function startLinkPost(request: NextRequest): Promise<{ response: NextResponse } | { ctx: Ctx; form: FormData; store: Awaited<ReturnType<typeof getClubStore>>; link: { eventId: string; memberId: string; token: string } }> {
  const notFound = { response: new NextResponse(null, { status: 404 }) };
  if (!clubEnabled()) return notFound;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return notFound;
  }
  const id = (name: string) => /^[0-9a-f-]{36}$/.test(field(form, name)) ? field(form, name) : "";
  const token = field(form, "token", 100);
  const link = { eventId: id("event"), memberId: id("member"), token };
  if (!link.eventId || !link.memberId || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return notFound;
  const owner = await getRsvpLinkActor(link);
  if (!owner) return notFound;
  return { ctx: { actor: { kind: "member", memberId: owner.member.id, label: fullName(owner.member) }, now: clubNow() }, form, store: await getClubStore(), link };
}

/**
 * What every front-desk iPad form handler starts with. The member area must be on, the form must be readable, and the
 * private iPad code must be genuine; the person is whoever was picked on the iPad. Anything else answers "not found" and
 * does nothing: the same answer for every wrong address. The iPad signs nobody in and sets no cookie.
 */
export async function startIpadPost(request: NextRequest): Promise<{ response: NextResponse } | { ctx: Ctx; form: FormData; store: Awaited<ReturnType<typeof getClubStore>>; code: string; memberId: string }> {
  const notFound = { response: new NextResponse(null, { status: 404 }) };
  if (!clubEnabled()) return notFound;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return notFound;
  }
  const code = field(form, "code", 100);
  const memberId = /^[0-9a-f-]{36}$/.test(field(form, "member")) ? field(form, "member") : "";
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code) || !memberId || !ipadCodeIsGenuine(code)) return notFound;
  const store = await getClubStore();
  const member = memberById(await store.read(), memberId);
  if (!member) return notFound;
  return { ctx: { actor: { kind: "member", memberId, label: fullName(member) }, now: clubNow() }, form, store, code, memberId };
}
