import { describe, expect, it } from "vitest";
import { hashSecret, isSecretShape, newSecret } from "./tokens";

describe("sign-in secrets", () => {
  it("are long, random, and different every time", () => {
    const seen = new Set(Array.from({ length: 200 }, newSecret));
    expect(seen.size).toBe(200);
    for (const s of seen) expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("are fingerprinted the same way every time, and the fingerprint is not the secret", () => {
    const s = newSecret();
    expect(hashSecret(s)).toBe(hashSecret(s));
    expect(hashSecret(s)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(s)).not.toContain(s);
    expect(hashSecret(newSecret())).not.toBe(hashSecret(s));
  });

  it("are recognised by shape before anything looks them up", () => {
    expect(isSecretShape(newSecret())).toBe(true);
    for (const bad of ["", "short", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}!`, `${"A".repeat(42)} `, undefined, null, 5]) expect(isSecretShape(bad), String(bad)).toBe(false);
  });
});
