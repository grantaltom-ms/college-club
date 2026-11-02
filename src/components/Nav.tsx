"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type NavLink = { href: string; label: string };

const SUMMARY: NavLink = { href: "/", label: "Summary" };
const GOALS: NavLink = { href: "/goals", label: "Goals" };

/** The pages grouped under the Usage menu, in menu order. */
const USAGE_LINKS: NavLink[] = [
  { href: "/visits", label: "Visits" },
  { href: "/timing", label: "Timing" },
  { href: "/reservations", label: "Reservations" },
  { href: "/shells", label: "Shells" },
];

/** The pages grouped under the Board Materials menu, in menu order. */
const BOARD_LINKS: NavLink[] = [
  { href: "/email", label: "Email" },
  { href: "/membership", label: "Membership" },
  { href: "/financials", label: "Financials" },
];

/**
 * The way into the reservation system's test landing page. It is for test builds only (development, previews, automated tests)
 * and is left out on the live site, where the reservation system does not exist yet; see /api/nav-extras.
 */
const SYSTEM_LINK: NavLink = { href: "/club/start", label: "CCS System" };

/** One top-level menu holding several pages. Keyed by page by its parent, so navigating starts it closed on the new page. */
function NavDropdown({ label, links, pathname }: { label: string; links: NavLink[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const active = links.some((l) => l.href === pathname);

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
    <div
      className="nav-dropdown"
      ref={wrapperRef}
      onKeyDown={(event) => {
        if (event.key === "Escape") closeAndFocusButton();
      }}
    >
      <button
        type="button"
        ref={buttonRef}
        className={`nav-menu-button${active ? " nav-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-current={active ? "page" : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        {label}
      </button>
      {open && (
        <div className="nav-menu" role="menu" aria-label={label}>
          {links.map((l) => (
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
  );
}

export function Nav() {
  const pathname = usePathname();
  const [showSystem, setShowSystem] = useState(false);

  // The dashboard pages are built ahead of time, so whether this is a test build is asked once when a page opens. The live site
  // answers "nothing extra", and then the menu is exactly Summary, Usage, Board Materials and Goals.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/nav-extras", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { extras?: unknown } | null) => {
        if (Array.isArray(body?.extras) && body.extras.includes("system")) setShowSystem(true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <nav className="site-nav" aria-label="Dashboard sections">
      {showSystem && <Link href={SYSTEM_LINK.href}>{SYSTEM_LINK.label}</Link>}
      <Link href={SUMMARY.href} aria-current={pathname === SUMMARY.href ? "page" : undefined}>
        {SUMMARY.label}
      </Link>
      <NavDropdown key={`usage-${pathname}`} label="Usage" links={USAGE_LINKS} pathname={pathname} />
      <NavDropdown key={`board-${pathname}`} label="Board Materials" links={BOARD_LINKS} pathname={pathname} />
      <Link href={GOALS.href} aria-current={pathname === GOALS.href ? "page" : undefined}>
        {GOALS.label}
      </Link>
    </nav>
  );
}
