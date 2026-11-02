"use client";

import { useEffect } from "react";

/**
 * Sends the iPad back to its start screen after a quiet spell, so the next person never sees the last person's bookings.
 * Touching the screen or typing starts the wait again, unless `strict` is set (a thank-you that must always clear itself).
 */
export function AutoReturn({ href, seconds, strict = false }: { href: string; seconds: number; strict?: boolean }) {
  useEffect(() => {
    let timer = 0;
    const go = () => window.location.assign(href);
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(go, seconds * 1000);
    };
    restart();
    if (!strict) {
      window.addEventListener("pointerdown", restart);
      window.addEventListener("keydown", restart);
    }
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", restart);
      window.removeEventListener("keydown", restart);
    };
  }, [href, seconds, strict]);
  return (
    <p className="club-meta ipad-meta" data-testid="auto-return">
      This screen goes back to the start after {seconds} seconds.
    </p>
  );
}
