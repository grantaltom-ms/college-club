import { describe, expect, it } from "vitest";
import { INSTALL_CAPTURE_SCRIPT, INSTALL_OFFER_EVENT } from "./install-offer";

/** The early script, run against a stand-in for the browser's window, to see exactly what it listens for and keeps. */
function run() {
  const handlers = new Map<string, (event: unknown) => void>();
  const told: string[] = [];
  const win: Record<string, unknown> = {
    addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
    dispatchEvent: (event: { type: string }) => told.push(event.type),
  };
  class FakeEvent {
    constructor(public type: string) {}
  }
  new Function("window", "Event", INSTALL_CAPTURE_SCRIPT)(win, FakeEvent);
  return { handlers, told, win };
}

describe("the script that catches the browser's install offer while the page loads", () => {
  it("listens for the offer and for the site being installed, and for nothing else", () => {
    expect([...run().handlers.keys()].sort()).toEqual(["appinstalled", "beforeinstallprompt"]);
  });

  it("keeps an offer on the window, stops the browser's own mini-bar, and tells the card", () => {
    const { handlers, told, win } = run();
    let prevented = false;
    const offer = { type: "beforeinstallprompt", preventDefault: () => (prevented = true) };
    handlers.get("beforeinstallprompt")!(offer);
    expect(prevented).toBe(true);
    expect(win.__ccsInstallOffer).toBe(offer);
    expect(told).toEqual([INSTALL_OFFER_EVENT]);
  });

  it("forgets the offer, and tells the card, when the site is installed some other way", () => {
    const { handlers, told, win } = run();
    handlers.get("beforeinstallprompt")!({ preventDefault: () => undefined });
    handlers.get("appinstalled")!({});
    expect(win.__ccsInstallOffer).toBeNull();
    expect(told).toEqual([INSTALL_OFFER_EVENT, INSTALL_OFFER_EVENT]);
  });

  it("keeps the newest offer if the browser makes another", () => {
    const { handlers, win } = run();
    const first = { preventDefault: () => undefined };
    const second = { preventDefault: () => undefined };
    handlers.get("beforeinstallprompt")!(first);
    handlers.get("beforeinstallprompt")!(second);
    expect(win.__ccsInstallOffer).toBe(second);
  });
});
