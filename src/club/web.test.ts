import { describe, expect, it } from "vitest";
import { bookingFormHref, idParam, idsParam, intParam, lengthChoices, momentParam, pickDay, typeParam } from "./web";

const ID = "00000000-0000-4000-8000-000000000007";

describe("reading the address safely", () => {
  it("shows only days on offer, and says so when the address asked for one that is not", () => {
    const days = ["2026-10-28", "2026-10-29", "2026-10-30"];
    // A day on offer: shown, no note.
    expect(pickDay("2026-10-29", days)).toEqual({ day: "2026-10-29", note: null });
    expect(pickDay(["2026-10-29", "x"], days)).toEqual({ day: "2026-10-29", note: null });
    // Nothing asked for, or not a date at all: the first day, no note (nobody asked for a particular day).
    expect(pickDay(undefined, days)).toEqual({ day: "2026-10-28", note: null });
    expect(pickDay("<script>", days)).toEqual({ day: "2026-10-28", note: null });
    expect(pickDay("2026-02-30", days)).toEqual({ day: "2026-10-28", note: null });
    // Too far ahead: the last day open, and a sentence that names both days.
    const far = pickDay("2026-12-25", days);
    expect(far.day).toBe("2026-10-30");
    expect(far.note).toBe("Friday, Dec 25 is further ahead than you can book yet. Showing Friday, Oct 30, the last day open.");
    // Exactly one day past the end is still "too far".
    expect(pickDay("2026-10-31", days).day).toBe("2026-10-30");
    // Already gone: today, with the other sentence.
    const gone = pickDay("2026-10-20", days);
    expect(gone.day).toBe("2026-10-28");
    expect(gone.note).toBe("Tuesday, Oct 20 has already passed. Showing Wednesday, Oct 28.");
  });

  it("knows the booking types and nothing else", () => {
    expect(typeParam("Shell")).toBe("Shell");
    expect(typeParam("Paddle Board")).toBe("Paddle Board");
    expect(typeParam("shell")).toBeNull();
    expect(typeParam(["Kayak"])).toBe("Kayak");
    expect(typeParam("Canoe")).toBeNull();
    expect(typeParam(undefined)).toBeNull();
  });

  it("accepts an exact UTC moment and refuses anything else", () => {
    expect(momentParam("2026-10-29T14:00:00.000Z")?.toISOString()).toBe("2026-10-29T14:00:00.000Z");
    expect(momentParam("2026-10-29T14:00:00Z")?.toISOString()).toBe("2026-10-29T14:00:00.000Z");
    for (const bad of ["2026-10-29", "2026-10-29T14:00:00", "2026-13-45T99:99:99Z", "tomorrow", "", undefined]) expect(momentParam(bad), String(bad)).toBeNull();
  });

  it("keeps numbers in range", () => {
    expect(intParam("60", 30, 120, 30)).toBe(60);
    expect(intParam("5", 30, 120, 30)).toBe(30);
    expect(intParam("9999999", 30, 120, 30)).toBe(30);
    expect(intParam("6e1", 30, 120, 30)).toBe(30);
    expect(intParam("-60", 30, 120, 30)).toBe(30);
    expect(intParam(undefined, 30, 120, 45)).toBe(45);
  });

  it("keeps IDs that look like IDs, once each, up to a limit", () => {
    expect(idsParam([ID, ID, "nope", "../x"])).toEqual([ID]);
    expect(idsParam(ID)).toEqual([ID]);
    expect(idsParam(undefined)).toEqual([]);
    expect(idsParam(Array.from({ length: 30 }, (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`))).toHaveLength(12);
    expect(idParam(ID)).toBe(ID);
    expect(idParam("x")).toBeNull();
  });
});

describe("lengths and addresses", () => {
  it("lists the lengths from the settings", () => {
    expect(lengthChoices({ slotMinutes: 30, minMinutes: 30, maxMinutes: 120 })).toEqual([30, 60, 90, 120]);
    expect(lengthChoices({ slotMinutes: 60, minMinutes: 60, maxMinutes: 60 })).toEqual([60]);
  });

  it("builds the booking form address", () => {
    const href = bookingFormHref({ itemId: ID, start: "2026-10-29T14:00:00.000Z", minutes: 60, crew: [ID], forId: ID, override: true, reason: "A lesson" });
    expect(href).toBe(`/club/book/new?item=${ID}&start=2026-10-29T14%3A00%3A00.000Z&minutes=60&crew=${ID}&for=${ID}&override=1&reason=A+lesson`);
    expect(bookingFormHref({ itemId: ID, start: "2026-10-29T14:00:00.000Z" })).toBe(`/club/book/new?item=${ID}&start=2026-10-29T14%3A00%3A00.000Z`);
  });
});
