/**
 * Email addresses as the sign-in compares them: trimmed and lower case. Returns null for anything that is clearly not an
 * address, so the sign-in form can say so without ever looking anything up. (Whether an address belongs to a member is
 * deliberately never told to the person typing it.)
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  // One @, something before it, a dotted domain after it, no spaces or angle brackets anywhere.
  if (!/^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/.test(email)) return null;
  if (email.includes("..") || email.startsWith(".") || email.endsWith(".")) return null;
  return email;
}
