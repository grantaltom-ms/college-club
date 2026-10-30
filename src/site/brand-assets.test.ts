import { existsSync } from "node:fs";
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
});

describe("the hero photo switch", () => {
  it("is either off, or points at a file that exists and describes what it shows", () => {
    if (HERO_PHOTO === null) return;
    expect(existsSync(publicFile(HERO_PHOTO.src)), HERO_PHOTO.src).toBe(true);
    expect(HERO_PHOTO.alt.trim().length).toBeGreaterThan(10);
  });
});
