/** Compare two strings without bailing out at the first difference. */
export function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const SESSION_COOKIE = "ccs_members";
/** How long one sign-in lasts. */
export const SESSION_SECONDS = 12 * 60 * 60;

async function sign(password: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`ccs-members:${password}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A sign-in token: an expiry time plus a signature only someone who knows the password could make. */
export async function createSession(password: string, nowMs = Date.now()): Promise<string> {
  const expires = Math.floor(nowMs / 1000) + SESSION_SECONDS;
  return `${expires}.${await sign(password, String(expires))}`;
}

export async function verifySession(token: string | undefined, password: string | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!token || !password) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires)) return false;
  if (Number(expires) * 1000 < nowMs) return false;
  return safeEqual(signature, await sign(password, expires));
}

export function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}
