import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mailer, OutgoingMail } from "@/club/auth/mail";
import { MemoryTourStore } from "@/club/store/tours";

/**
 * The public Request a tour form's server action, called directly with the page's own ingredients replaced by fakes: whether the
 * public site is on, the clock, the list of requests, and who sends email. The rules live in the engine (tours.test.ts); this
 * holds the action to its own job: answer "not found" when the site is off, hand the engine only what was typed, never lose a
 * saved request to a failed email, and say the right thing back.
 */
const NOW = new Date("2026-10-28T20:00:00Z");
const h = vi.hoisted(() => ({ enabled: true, store: null as unknown, mailer: null as unknown, notifyTo: undefined as string | undefined }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/site/enabled", () => ({ siteEnabled: () => h.enabled }));
vi.mock("@/club/clock", () => ({ clubNow: () => NOW }));
vi.mock("@/club/store/tours-instance", () => ({ getTourStore: () => h.store }));
vi.mock("@/club/auth/mail", () => ({ getMailer: () => h.mailer }));

import { requestTour } from "./actions";
import { IDLE } from "./state";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries({ name: "Ada Quill", email: "ada@example.com", phone: "", note: "", website: "", ...fields })) data.set(k, v);
  return data;
};
const store = () => h.store as MemoryTourStore;
const sent: OutgoingMail[] = [];

beforeEach(() => {
  h.enabled = true;
  h.store = new MemoryTourStore();
  sent.length = 0;
  const mailer: Mailer = { send: async (mail) => void sent.push(mail) };
  h.mailer = mailer;
  delete process.env.CLUB_TOUR_NOTIFY_TO;
});

describe("the Request a tour action", () => {
  it("answers 'not found', and saves nothing, when the public site is switched off", async () => {
    h.enabled = false;
    await expect(requestTour(IDLE, form({}))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await store().list(10)).total).toBe(0);
    expect(sent).toEqual([]);
  });

  it("saves the request, thanks the person by first name, and tells the membership office", async () => {
    expect(await requestTour(IDLE, form({ phone: "(206) 555-0100", note: "Two of us." }))).toEqual({ kind: "sent", firstName: "Ada" });
    const list = await store().list(10);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: "Ada Quill", email: "ada@example.com", phone: "(206) 555-0100", note: "Two of us.", createdAt: NOW.toISOString() });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("membership@collegeclubseattle.com");
    expect(sent[0].subject).toBe("New tour request: Ada Quill");
    expect(sent[0].text).toContain("Email: ada@example.com");
  });

  it("tells the address in CLUB_TOUR_NOTIFY_TO instead, when one is set", async () => {
    process.env.CLUB_TOUR_NOTIFY_TO = "Front.Desk@Example.org";
    await requestTour(IDLE, form({}));
    expect(sent[0].to).toBe("front.desk@example.org");
  });

  it("still saves and thanks when no email sender is switched on", async () => {
    h.mailer = null;
    expect(await requestTour(IDLE, form({}))).toEqual({ kind: "sent", firstName: "Ada" });
    expect((await store().list(10)).total).toBe(1);
  });

  it("still saves and thanks when the email cannot be sent, and the request stays on the staff list", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.mailer = { send: async () => Promise.reject(new Error("Resend did not answer in time.")) } satisfies Mailer;
    expect(await requestTour(IDLE, form({}))).toEqual({ kind: "sent", firstName: "Ada" });
    expect((await store().list(10)).total).toBe(1);
    expect(log).toHaveBeenCalledWith("Could not email a tour request notice: Resend did not answer in time.");
    log.mockRestore();
  });

  it("hands back every problem, and what was typed, so nothing has to be typed again", async () => {
    const state = await requestTour(IDLE, form({ name: " ", email: "nope", phone: "call me", note: "hello" }));
    expect(state).toEqual({
      kind: "error",
      errors: { name: "Please tell us your name.", email: "That email address does not look right. Please check it and try again.", phone: "That phone number does not look right. Leave it blank, or use digits like (206) 555-0100." },
      values: { name: " ", email: "nope", phone: "call me", note: "hello" },
    });
    expect((await store().list(10)).total).toBe(0);
    expect(sent).toEqual([]);
  });

  it("thanks a robot, saves nothing and sends nothing", async () => {
    expect(await requestTour(IDLE, form({ website: "http://spam.example" }))).toEqual({ kind: "sent", firstName: "Ada" });
    expect((await store().list(10)).total).toBe(0);
    expect(sent).toEqual([]);
  });

  it("thanks, but does not save or email again, once an address has used its three requests for the day", async () => {
    for (let i = 0; i < 5; i += 1) expect(await requestTour(IDLE, form({}))).toEqual({ kind: "sent", firstName: "Ada" });
    expect((await store().list(10)).total).toBe(3);
    expect(sent).toHaveLength(3);
  });

  it("asks people to phone, and says so, when the whole site is getting too many", async () => {
    for (let i = 0; i < 30; i += 1) await requestTour(IDLE, form({ email: `p${i}@example.com` }));
    expect(await requestTour(IDLE, form({ email: "late@example.com" }))).toEqual({ kind: "busy" });
    expect((await store().list(100)).total).toBe(30);
  });

  it("reads only the fields it knows, and cuts anything absurdly long before it goes further", async () => {
    const data = form({ name: "x".repeat(100_000), note: "n".repeat(100_000) });
    data.set("is_admin", "true");
    const state = await requestTour(IDLE, data);
    expect(state.kind).toBe("error");
    if (state.kind !== "error") throw new Error("expected an error");
    expect(state.values.name.length).toBe(400);
    expect(state.values.note.length).toBe(5000);
    expect(Object.keys(state.errors).sort()).toEqual(["name", "note"]);
  });

  it("treats a file or a missing field in the form as nothing typed", async () => {
    const data = new FormData();
    data.set("name", new File(["x"], "x.txt"));
    expect(await requestTour(IDLE, data)).toMatchObject({ kind: "error", errors: { name: "Please tell us your name.", email: "That email address does not look right. Please check it and try again." } });
  });
});
