"use client";

import { useEffect } from "react";

/**
 * Sends the iPad back to its start screen after a quiet spell, so the next person never sees the last person's bookings.
 * Touching the screen or typing starts the wait again.
 */
export function AutoReturn({ href, seconds }: { href: string; seconds: number }) {
  useEffect(() => {
    let timer = 0;
    const go = () => window.location.assign(href);
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(go, seconds * 1000);
    };
    restart();
    window.addEventListener("pointerdown", restart);
    window.addEventListener("keydown", restart);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", restart);
      window.removeEventListener("keydown", restart);
    };
  }, [href, seconds]);
  return (
    <p className="club-meta" data-testid="auto-return">
      This screen goes back to the start after {seconds} seconds.
    </p>
  );
}
