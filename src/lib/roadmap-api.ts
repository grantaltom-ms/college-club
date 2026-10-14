import { SESSION_COOKIE, cookieValue, verifySession } from "./auth";
import { RoadmapError, memoryStore, SupabaseStore, type RoadmapStore } from "./roadmap-store";
import { liveConfig } from "./supabase";

const NO_STORE = { "Cache-Control": "no-store" };
/** The biggest request body accepted. Notes are the longest text and are capped at 4,000 characters. */
const MAX_BODY_BYTES = 20_000;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** The real database when connected; the in-memory copy only in development or when sample data is allowed. */
export function getStore(): RoadmapStore | null {
  const cfg = liveConfig();
  if (cfg) return new SupabaseStore(cfg);
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") return memoryStore();
  return null;
}

/** Null when the visitor is signed in; otherwise the response to send back (503 with no password set, 401 without the cookie). */
export async function requireSignIn(request: Request): Promise<Response | null> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return json({ error: "The goals page is locked until a password is set." }, 503);
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (!(await verifySession(token, password))) return json({ error: "Sign in to see and change the goals." }, 401);
  return null;
}

/** The body of a request as JSON, or a ready-made error response. */
export async function readBody(request: Request): Promise<{ body: unknown } | { response: Response }> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { response: json({ error: "That is too much text to send at once. Shorten it and try again." }, 413) };
  }
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return { response: json({ error: "That is too much text to send at once. Shorten it and try again." }, 413) };
    }
    return { body: JSON.parse(text) };
  } catch {
    return { response: json({ error: "That request could not be read. Reload the page and try again." }, 400) };
  }
}

/**
 * Every roadmap route goes through here: sign-in check first, then the storage, then your code.
 * Anything unexpected becomes a plain sentence, never a stack trace.
 */
export async function withStore(request: Request, run: (store: RoadmapStore) => Promise<Response>): Promise<Response> {
  const denied = await requireSignIn(request);
  if (denied) return denied;
  const store = getStore();
  if (!store) {
    return json({ error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }, 500);
  }
  try {
    return await run(store);
  } catch (error) {
    if (error instanceof RoadmapError) return json({ error: error.message }, error.status);
    console.error("Roadmap request failed", error);
    return json({ error: "Something went wrong on our side. Try again in a minute." }, 500);
  }
}
