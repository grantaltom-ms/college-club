/** Compare two strings without bailing out at the first difference. */
export function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export type AuthResult = "ok" | "needs-password" | "not-configured";

/**
 * The password gate is switched on with REQUIRE_PASSWORD=1. While it is off the
 * dashboard is open to anyone with the link. Once it is on, nothing is served
 * until DASHBOARD_PASSWORD is also set.
 */
export function checkAuth(header: string | null, password: string | undefined, required: boolean): AuthResult {
  if (!required) return "ok";
  if (!password) return "not-configured";
  if (!header?.startsWith("Basic ")) return "needs-password";
  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {
    return "needs-password";
  }
  // Basic auth sends "user:password"; any user name is accepted.
  const given = decoded.slice(decoded.indexOf(":") + 1);
  return safeEqual(given, password) ? "ok" : "needs-password";
}
