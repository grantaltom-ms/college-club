import { describe, expect, it } from "vitest";
import type { Mailer, OutgoingMail } from "../auth/mail";
import type { Notice } from "../engine/notices";
import { NO_LINKS } from "../engine/notice-mail";
import { sendNotices } from "./send";

const notice = (n: number): Notice => ({ kind: "boat_damage", to: { memberId: `m${n}`, firstName: `P${n}`, email: `p${n}@example.com` }, itemName: "Heron", words: "Major damage.", bookings: [{ startsAt: "2026-10-31T18:00:00Z", endsAt: "2026-10-31T19:00:00Z" }] });
const NOW = new Date("2026-10-28T20:00:00Z");

describe("handing notices to the mailer", () => {
  it("sends each one, to the right person, and counts them", async () => {
    const sent: OutgoingMail[] = [];
    const mailer: Mailer = { async send(m) { sent.push(m); } };
    const result = await sendNotices(mailer, [1, 2, 3].map(notice), NO_LINKS, NOW);
    expect(result).toEqual({ sent: 3, failed: 0 });
    expect(sent.map((m) => m.to).sort()).toEqual(["p1@example.com", "p2@example.com", "p3@example.com"]);
  });

  it("does nothing, and says so, for no notices", async () => {
    const mailer: Mailer = { async send() { throw new Error("should not be called"); } };
    expect(await sendNotices(mailer, [], NO_LINKS, NOW)).toEqual({ sent: 0, failed: 0 });
  });

  it("keeps going when one fails, logs the reason once for it, and counts it", async () => {
    const logged: string[] = [];
    const sent: string[] = [];
    const mailer: Mailer = {
      async send(m) {
        if (m.to === "p2@example.com") throw new Error("Resend answered 500");
        sent.push(m.to);
      },
    };
    const result = await sendNotices(mailer, [1, 2, 3, 4, 5].map(notice), NO_LINKS, NOW, (l) => logged.push(l));
    expect(result).toEqual({ sent: 4, failed: 1 });
    expect(sent.sort()).toEqual(["p1@example.com", "p3@example.com", "p4@example.com", "p5@example.com"]);
    expect(logged).toEqual(['Could not email a "boat_damage" notice: Resend answered 500']);
  });

  it("never has more than four going at once, and uses all four for a long list", async () => {
    let active = 0;
    let peak = 0;
    const mailer: Mailer = {
      async send() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      },
    };
    await sendNotices(mailer, Array.from({ length: 20 }, (_, i) => notice(i)), NO_LINKS, NOW);
    expect(peak).toBe(4);
  });

  it("logs a thing that was thrown that is not an error", async () => {
    const logged: string[] = [];
    const mailer: Mailer = { async send() { throw "plain words"; } };
    await sendNotices(mailer, [notice(1)], NO_LINKS, NOW, (l) => logged.push(l));
    expect(logged).toEqual(['Could not email a "boat_damage" notice: plain words']);
  });
});
