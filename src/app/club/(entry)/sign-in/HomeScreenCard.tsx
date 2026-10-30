"use client";

import { useRef, useSyncExternalStore } from "react";

/** The browser's "install this site" offer (Chrome and Edge on Android and desktop). Not in TypeScript's own list of events yet. */
interface InstallOffer extends Event {
  prompt(): Promise<unknown>;
}

/** What the card should show: nothing, the iPhone steps, or an Install button. Kept outside React because the browser decides, and can change its mind. */
let offer: InstallOffer | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onOffer = (event: Event) => {
    event.preventDefault();
    offer = event as InstallOffer;
    tell();
  };
  const onInstalled = () => {
    offer = null;
    tell();
  };
  window.addEventListener("beforeinstallprompt", onOffer);
  window.addEventListener("appinstalled", onInstalled);
  const display = window.matchMedia("(display-mode: standalone)");
  display.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("beforeinstallprompt", onOffer);
    window.removeEventListener("appinstalled", onInstalled);
    display.removeEventListener("change", onChange);
  };
}

type Show = "hidden" | "ios" | "install";

function currentShow(): Show {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "hidden"; // already running like an app: nothing to suggest
  if (offer) return "install";
  const iPhoneOrIPad = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iPhoneOrIPad ? "ios" : "hidden";
}

/**
 * "Keep the club on your home screen": a tip for people on a phone's browser, not already using the site like an app. On an
 * iPhone it says how; where the browser offers to install the site, it is a button. On a desktop, or in the installed app, it
 * is not there at all. It draws nothing until the browser has been asked, so there is no flash and nothing to mismatch.
 */
export function HomeScreenCard() {
  const show = useSyncExternalStore(subscribe, currentShow, (): Show => "hidden");
  const installing = useRef(false);
  if (show === "hidden") return null;
  return (
    <aside className="ds-card ds-card-oyster" aria-label="Keep the club on your home screen" data-testid="home-screen-card">
      <h2>Keep the club on your home screen</h2>
      {show === "ios" ? (
        <p>Tap Share, then Add to Home Screen. It opens like an app, with no download needed.</p>
      ) : (
        <>
          <p>Install it for an icon on your home screen. It opens like an app, with no download needed.</p>
          <button
            type="button"
            className="ds-button ds-button-install"
            data-testid="home-screen-install"
            onClick={async () => {
              if (!offer || installing.current) return;
              installing.current = true;
              try {
                await offer.prompt();
              } finally {
                offer = null;
                installing.current = false;
                tell();
              }
            }}
          >
            Install
          </button>
        </>
      )}
    </aside>
  );
}
