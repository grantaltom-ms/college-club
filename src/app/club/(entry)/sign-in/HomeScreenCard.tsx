"use client";

import { useRef, useSyncExternalStore } from "react";
import { INSTALL_OFFER_EVENT } from "@/club/install-offer";

/** The browser's "install this site" offer (Chrome and Edge on Android and desktop). Not in TypeScript's own list of events yet. */
interface InstallOffer extends Event {
  prompt(): Promise<unknown>;
}

declare global {
  interface Window {
    /** The browser's install offer, kept by the early script in the sign-in layout (see src/club/install-offer.ts) or by this card. */
    __ccsInstallOffer?: InstallOffer | null;
  }
}

/** What the card should show: nothing, the iPhone steps, or an Install button. Kept outside React because the browser decides, and can change its mind. */
const offerNow = (): InstallOffer | null => (typeof window === "undefined" ? null : (window.__ccsInstallOffer ?? null));
const changed = () => window.dispatchEvent(new Event(INSTALL_OFFER_EVENT));

function subscribe(onChange: () => void) {
  // The page's early script catches an offer that comes while the page loads. These listeners cover the rest (for example a visit
  // reached without a full page load, where that script does not run), and `INSTALL_OFFER_EVENT` is how either says it changed.
  const onOffer = (event: Event) => {
    event.preventDefault();
    window.__ccsInstallOffer = event as InstallOffer;
    onChange();
  };
  const onInstalled = () => {
    window.__ccsInstallOffer = null;
    onChange();
  };
  window.addEventListener("beforeinstallprompt", onOffer);
  window.addEventListener("appinstalled", onInstalled);
  window.addEventListener(INSTALL_OFFER_EVENT, onChange);
  const display = window.matchMedia("(display-mode: standalone)");
  display.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("beforeinstallprompt", onOffer);
    window.removeEventListener("appinstalled", onInstalled);
    window.removeEventListener(INSTALL_OFFER_EVENT, onChange);
    display.removeEventListener("change", onChange);
  };
}

type Show = "hidden" | "ios" | "install";

function currentShow(): Show {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "hidden"; // already running like an app: nothing to suggest
  if (offerNow()) return "install";
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
              const current = offerNow();
              if (!current || installing.current) return;
              installing.current = true;
              try {
                await current.prompt();
              } finally {
                window.__ccsInstallOffer = null;
                installing.current = false;
                changed();
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
