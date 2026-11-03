import { describe, expect, it } from "vitest";
import type { Mailer } from "../auth/mail";
import { classCancelMail, classWhenWords, notifyClassCancelled } from "./class-notify";
import type { AffectedSignUp } from "./classes";

const NOW = new Date("2026-10-28T20:00:00Z");

const base = {
  className: "Morning Yoga",
  when: "Thursday, Oct 29, 7:30 to 8:30 am",
  roomName: "Boathouse gym" as string | null,
  reason: "Instructor is ill",
};

const ada: AffectedSignUp = {
  signUpId: "s1",
  memberId: "m1",
  name: "Ada Quill",
  email: "ada@example.com",
  phone: "206-555-0101",
  status: "enrolled",
};

const ben: AffectedSignUp = {
  signUpId: "s2",
  memberId: "m2",
  name: "Ben Quill",
  email: "ben@example.com",
  phone: "206-555-0102",
  status: "waitlisted",
};

describe("classWhenWords", () => {
  it("matches the class page's day and clock range", () => {
    expect(
      classWhenWords({
        startsAt: "2026-10-29T14:30:00.000Z",
        endsAt: "2026-10-29T15:30:00.000Z",
      }),
    ).toBe("Thursday, Oct 29, 7:30 to 8:30 am");
  });
});

describe("classCancelMail", () => {
  it("names the class, reason, place held, and who it is for", () => {
    const mail = classCancelMail({ ...base, person: ada });
    expect(mail.to).toBe("ada@example.com");
    expect(mail.subject).toBe("Class cancelled: Morning Yoga");
    expect(mail.text).toContain("Hello Ada,");
    expect(mail.text).toContain("Morning Yoga on Thursday, Oct 29, 7:30 to 8:30 am at Boathouse gym has been cancelled.");
    expect(mail.text).toContain("Reason: Instructor is ill");
    expect(mail.text).toContain("You had a place in this class.");
    expect(mail.text).toContain("College Club Seattle");
  });

  it("tells a waiting person they were on the list, and works with no room", () => {
    const mail = classCancelMail({ ...base, roomName: null, person: ben });
    expect(mail.text).toContain("Morning Yoga on Thursday, Oct 29, 7:30 to 8:30 am has been cancelled.");
    expect(mail.text).toContain("You were on the waiting list for this class.");
    expect(mail.text).not.toContain(" at ");
  });
});

describe("notifyClassCancelled", () => {
  it("sends one email per person and returns the count", async () => {
    const sent: { to: string; subject: string }[] = [];
    const mailer: Mailer = {
      send: async (mail) => {
        sent.push({ to: mail.to, subject: mail.subject });
      },
    };
    expect(await notifyClassCancelled(mailer, base, [ada, ben], NOW)).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(sent).toEqual([
      { to: "ada@example.com", subject: "Class cancelled: Morning Yoga" },
      { to: "ben@example.com", subject: "Class cancelled: Morning Yoga" },
    ]);
  });

  it("does nothing with no mailer or nobody affected", async () => {
    expect(await notifyClassCancelled(null, base, [ada], NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
    const mailer: Mailer = { send: async () => undefined };
    expect(await notifyClassCancelled(mailer, base, [], NOW)).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

  it("counts a refused send as failed and keeps going", async () => {
    const log: string[] = [];
    const mailer: Mailer = {
      send: async (mail) => {
        if (mail.to === "ada@example.com") throw new Error("Resend refused the email (status 403).");
      },
    };
    expect(await notifyClassCancelled(mailer, base, [ada, ben], NOW, (line) => log.push(line))).toEqual({
      sent: 1,
      failed: 1,
      skipped: 0,
    });
    expect(log).toEqual(["Could not email a class cancellation notice: Resend refused the email (status 403)."]);
  });

  it("skips a blank address", async () => {
    const mailer: Mailer = { send: async () => undefined };
    const blank = { ...ada, email: "  " };
    expect(await notifyClassCancelled(mailer, base, [blank, ben], NOW)).toEqual({ sent: 1, failed: 0, skipped: 1 });
  });
});
