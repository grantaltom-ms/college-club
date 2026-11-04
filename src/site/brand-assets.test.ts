import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOGOS_AVAILABLE, LOGO_FILES } from "./brand-assets";
import { HERO_PHOTO } from "./hero-photo";

/**
 * Two switches say "the logo files are in the project" and "the homepage has its photo". A switch that disagrees with the files
 * would show a broken picture, or hide a real one, so each is held to the files that are really in public/.
 */
const publicFile = (address: string) => join(__dirname, "../../public", address);

describe("the logo switch", () => {
  it("is on exactly when both logo files are in public/", () => {
    const both = existsSync(publicFile(LOGO_FILES.black)) && existsSync(publicFile(LOGO_FILES.white));
    expect(LOGOS_AVAILABLE, `the logo files ${both ? "are" : "are not"} in public/, so the switch must be ${both ? "on" : "off"}`).toBe(both);
  });

  it("names the two files the design handoff names", () => {
    expect(LOGO_FILES).toEqual({ black: "/ccs-logo-black.png", white: "/ccs-logo-white.png" });
  });

  it("is on, since Grant asked for the logos on the public site, the sign-in and demo screens and the phone icons (Nov 4)", () => {
    expect(LOGOS_AVAILABLE).toBe(true);
  });

  it.each(["black", "white"] as const)("has a %s logo that is a real PNG, square, big enough for a phone icon and small enough to load fast", (tone) => {
    const bytes = readFileSync(publicFile(LOGO_FILES[tone]));
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const [width, height] = [view.getUint32(16), view.getUint32(20)];
    expect(width, "the picture is drawn into a square box, so it must be square or it would be squashed").toBe(height);
    expect(width).toBeGreaterThanOrEqual(256);
    expect(width).toBeLessThanOrEqual(1024);
    expect(bytes.length).toBeLessThan(100_000);
    expect(bytes[25], "colour type 6 is RGBA: the picture keeps its transparent background").toBe(6);
  });
});

describe("the hero photo switch", () => {
  it("is either off, or points at a file that exists and describes what it shows", () => {
    if (HERO_PHOTO === null) return;
    expect(existsSync(publicFile(HERO_PHOTO.src)), HERO_PHOTO.src).toBe(true);
    expect(HERO_PHOTO.alt.trim().length).toBeGreaterThan(10);
  });
});
