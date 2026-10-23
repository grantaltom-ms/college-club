import { describe, expect, it } from "vitest";
import { identityKey, parseIdentityKey } from "./identities";

describe("sign-in choices as form values", () => {
  it("round-trip for a member and for staff", () => {
    const member = { kind: "member" as const, memberId: "00000000-0000-4000-8000-000000000002" };
    const staff = { kind: "staff" as const, email: "alex.staffer@example.org" };
    expect(identityKey(member)).toBe("member:00000000-0000-4000-8000-000000000002");
    expect(identityKey(staff)).toBe("staff:alex.staffer@example.org");
    expect(parseIdentityKey(identityKey(member))).toEqual(member);
    expect(parseIdentityKey(identityKey(staff))).toEqual(staff);
  });

  it("lower-cases a staff address and refuses everything else", () => {
    expect(parseIdentityKey("staff:Alex.Staffer@Example.org")).toEqual({ kind: "staff", email: "alex.staffer@example.org" });
    for (const bad of [undefined, null, 5, "", "member", "member:", "member:abc", "member:../../etc/passwd", "MEMBER:00000000-0000-4000-8000-000000000002", "staff", "staff:", "staff:not-an-address", "staff:a@b", "admin:x", " member:00000000-0000-4000-8000-000000000002"]) {
      expect(parseIdentityKey(bad), String(bad)).toBeNull();
    }
  });
});
