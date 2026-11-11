import type { NextRequest } from "next/server";
import { canEditExecutive, EXECUTIVE_COOKIE } from "./executive-lock";
import { memoryPriorityStore, PriorityError, SupabasePriorityStore, type PriorityStore } from "./executive-store";
import { sameOrigin } from "./same-origin";
import { liveConfig } from "./supabase";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 30_000;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** The real table when connected; the in-memory copy only in development or when sample data is allowed. */
export function getPriorityStore(): PriorityStore | null {
  const cfg = liveConfig();
  if (cfg) return new SupabasePriorityStore(cfg);
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") return memoryPriorityStore();
  return null;
}

export async function readBody(request: Request): Promise<{ body: unknown } | { response: Response }> {
  const tooBig = json({ error: "That is too much text to send at once. Shorten it and try again." }, 413);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return { response: tooBig };
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return { response: tooBig };
    return { body: JSON.parse(text) };
  } catch {
    return { response: json({ error: "That request could not be read. Reload the page and try again." }, 400) };
  }
}

/** Every route goes through here. A change also needs the editing pass and a request from this site's own pages. */
export async function withPriorities(request: NextRequest, needsEdit: boolean, run: (store: PriorityStore) => Promise<Response>): Promise<Response> {
  if (needsEdit) {
    if (!sameOrigin(request.headers)) return json({ error: "That change did not come from this page." }, 403);
    if (!canEditExecutive(request.cookies.get(EXECUTIVE_COOKIE)?.value)) {
      return json({ error: "Editing is locked. Type the executive team's editing password first." }, 401);
    }
  }
  const store = getPriorityStore();
  if (!store) return json({ error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }, 500);
  try {
    return await run(store);
  } catch (error) {
    if (error instanceof PriorityError) return json({ error: error.message }, error.status);
    console.error("Priorities request failed", error);
    return json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
  }
}
