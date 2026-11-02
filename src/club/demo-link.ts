import { pickerEnabled } from "./enabled";

type Env = Partial<Record<string, string | undefined>>;

/** Where the demo's landing page is, on the demo's own address. */
export const DEMO_LANDING_PATH = "/club/start";

/**
 * The address of the demo (the test building next door), from `CCS_DEMO_URL`, as just the site's address. It is how the live
 * dashboard's "CCS System" link finds the demo: the live site itself never runs the reservation system, so the link goes to the
 * test version that does, which asks for the demo password. Only a safe address counts (https, or http for a computer's own
 * localhost, with no user name or password in it); a path or query in the setting is dropped. Anything else is ignored and the
 * link stays off, with a line in the log (never repeating what was set beyond saying it is not usable).
 */
export function demoUrl(env: Env = process.env, log: (line: string) => void = console.error): string | null {
  const value = env.CCS_DEMO_URL?.trim() ?? "";
  if (value === "") return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const safe = url.protocol === "https:" || (local && url.protocol === "http:");
    if (safe && url.username === "" && url.password === "") return url.origin;
  } catch {
    // Not an address at all: fall through.
  }
  log("CCS_DEMO_URL is not a safe web address (it must start with https://), so the live menu shows no CCS System link.");
  return null;
}

/** What the dashboard's menu bar is told to add. `systemHref` is only present for a link that leaves this site. */
export type NavExtras = { extras: string[]; systemHref?: string };

/**
 * What extras the menu bar shows right now.
 *  - A test build (development, previews, automated tests): the CCS System link, to this site's own landing page.
 *  - The live site with `CCS_DEMO_URL` set: the same link, to the demo's landing page on its own address, which has the keypad.
 *  - Anything else, which is the live site by default: nothing, and nothing about the reservation system is said.
 */
export function navExtras(env: Env = process.env, log?: (line: string) => void): NavExtras {
  if (pickerEnabled(env)) return { extras: ["system"] };
  const demo = demoUrl(env, log);
  return demo ? { extras: ["system"], systemHref: `${demo}${DEMO_LANDING_PATH}` } : { extras: [] };
}
