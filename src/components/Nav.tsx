"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "/", label: "Summary" },
  { href: "/shells", label: "Shells" },
  { href: "/email", label: "Email" },
  { href: "/membership", label: "Membership" },
  { href: "/goals", label: "Goals" },
];

/** The pages grouped under the Usage menu, in menu order. */
const USAGE_LINKS = [
  { href: "/visits", label: "Visits" },
  { href: "/timing", label: "Timing" },
  { href: "/reservations", label: "Reservations" },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const usageActive = USAGE_LINKS.some((l) => l.href === pathname);

  // The menu is keyed by page, so navigating (by a menu link, a card link,
  // or the browser's back button) starts it closed on the new page.
  // Clicking anywhere outside the menu closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const closeAndFocusButton = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <nav className="site-nav" aria-label="Dashboard sections">
      {LINKS.slice(0, 1).map((l) => (
        <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
      <div
        key={pathname}
        className="nav-dropdown"
        ref={wrapperRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeAndFocusButton();
        }}
      >
        <button
          type="button"
          ref={buttonRef}
          className={`nav-usage-button${usageActive ? " nav-active" : ""}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-current={usageActive ? "page" : undefined}
          onClick={() => setOpen((prev) => !prev)}
        >
          Usage
        </button>
        {open && (
          <div className="nav-menu" role="menu" aria-label="Usage">
            {USAGE_LINKS.map((l) => (
              <Link
                key={l.href}
                role="menuitem"
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>
      {LINKS.slice(1).map((l) => (
        <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
