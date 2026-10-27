import { describe, expect, it } from "vitest";
import { financialsPassword, financialsUnlocked, makeUnlockToken, passwordMatches, tokenValid, UNLOCK_DAYS } from "./financials-lock";

const PASSWORD = "board-room-key-2026";
const NOW = new Date("2026-10-27T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("the Financials password setting", () => {
  it("is read from private settings, trimmed", () => {
    expect(financialsPassword({ DASHBOARD_FINANCIALS_PASSWORD: `  ${PASSWORD}\n` })).toBe(PASSWORD);
  });

  it("counts as not set up when missing, empty or shorter than 8 characters", () => {
    expect(financialsPassword({})).toBeNull();
    expect(financialsPassword({ DASHBOARD_FINANCIALS_PASSWORD: "" })).toBeNull();
    expect(financialsPassword({ DASHBOARD_FINANCIALS_PASSWORD: "1234567" })).toBeNull();
    expect(financialsPassword({ DASHBOARD_FINANCIALS_PASSWORD: "12345678" })).toBe("12345678");
  });
});

describe("checking a typed password", () => {
  it("accepts exactly the password", () => {
    expect(passwordMatches(PASSWORD, PASSWORD)).toBe(true);
  });

  it("refuses anything else, including a different case, extra space or an empty box", () => {
    for (const typed of ["", "board-room-key-202", "Board-room-key-2026", `${PASSWORD} `, `${PASSWORD}x`]) {
      expect(passwordMatches(typed, PASSWORD), typed).toBe(false);
    }
  });
});

describe("the 30-day pass", () => {
  it("works right away and until just before 30 days are up", () => {
    const token = makeUnlockToken(PASSWORD, NOW);
    expect(tokenValid(token, PASSWORD, NOW)).toBe(true);
    expect(tokenValid(token, PASSWORD, new Date(NOW.getTime() + UNLOCK_DAYS * DAY - 1))).toBe(true);
  });

  it("stops at exactly 30 days", () => {
    const token = makeUnlockToken(PASSWORD, NOW);
    expect(tokenValid(token, PASSWORD, new Date(NOW.getTime() + UNLOCK_DAYS * DAY))).toBe(false);
  });

  it("stops the moment the password is changed or removed", () => {
    const token = makeUnlockToken(PASSWORD, NOW);
    expect(tokenValid(token, "a-new-board-password", NOW)).toBe(false);
    expect(tokenValid(token, null, NOW)).toBe(false);
  });

  it("refuses a missing, garbled or hand-edited pass", () => {
    const token = makeUnlockToken(PASSWORD, NOW);
    const [expires, sig] = token.split(".");
    const later = String(Number(expires) + DAY);
    for (const bad of [undefined, "", "yes", "1", sig, `${expires}.`, `${expires}.${sig.slice(1)}0`, `${later}.${sig}`, `${expires}.${sig.toUpperCase()}`, `${token}x`]) {
      expect(tokenValid(bad, PASSWORD, NOW), String(bad)).toBe(false);
    }
  });

  it("refuses a pass signed for longer than 30 days, even with the right password", () => {
    const tooLong = makeUnlockToken(PASSWORD, new Date(NOW.getTime() + 5 * DAY));
    expect(tokenValid(tooLong, PASSWORD, NOW)).toBe(false);
  });

  it("is refused when the setting is missing, even if the pass was once good", () => {
    const token = makeUnlockToken(PASSWORD, NOW);
    expect(financialsUnlocked(token, NOW, { DASHBOARD_FINANCIALS_PASSWORD: PASSWORD })).toBe(true);
    expect(financialsUnlocked(token, NOW, {})).toBe(false);
  });

  it("keeps working over many unlocks and checks", () => {
    for (let day = 0; day < 90; day++) {
      const at = new Date(NOW.getTime() + day * DAY);
      const token = makeUnlockToken(PASSWORD, at);
      expect(tokenValid(token, PASSWORD, at)).toBe(true);
      expect(tokenValid(token, PASSWORD, new Date(at.getTime() + 29 * DAY))).toBe(true);
      expect(tokenValid(token, PASSWORD, new Date(at.getTime() + 31 * DAY))).toBe(false);
    }
  });
});
