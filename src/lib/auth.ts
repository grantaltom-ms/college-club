/** Compare two strings without bailing out at the first difference. */
export function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export type AuthResult = "ok" | "needs-password" | "not-configured";

/**
 * The dashboard lists member names, so production refuses to serve anything
 * until a password is set. Local development skips the check when none is set.
 */
export function checkAuth(header: string | null, password: string | undefined, production: boolean): AuthResult {
  if (!password) return production ? "not-configured" : "ok";
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
