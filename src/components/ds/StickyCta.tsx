"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ButtonLink } from "./ButtonLink";

/**
 * The phone-only bar along the bottom with "Request a tour". It slides away while the headline's own Request a tour button is
 * on screen (so there are never two on top of each other), it is gone on the Request a tour page itself, and from 768px up
 * it does not exist (the stylesheet hides it).
 */
export function StickyCta({ href, label }: { href: string; label: string }) {
  const pathname = usePathname() ?? "";
  // "The headline's button is on screen" is remembered for the page it was seen on, so it cannot go stale on the next page.
  const [heroSeenAt, setHeroSeenAt] = useState<string | null>(null);

  useEffect(() => {
    const heroButton = document.querySelector("[data-ds-hero-cta]");
    if (!heroButton) return;
    const watcher = new IntersectionObserver(([entry]) => setHeroSeenAt(entry.isIntersecting ? pathname : null));
    watcher.observe(heroButton);
    return () => watcher.disconnect();
  }, [pathname]);

  if (pathname === href) return null;
  const hidden = heroSeenAt === pathname;
  return (
    <div className={hidden ? "ds-sticky-cta is-hidden" : "ds-sticky-cta"} data-testid="sticky-cta">
      <ButtonLink href={href} data-track="request-a-tour-sticky">
        {label}
      </ButtonLink>
    </div>
  );
}
