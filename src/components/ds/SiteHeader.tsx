"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NavItem } from "@/site/content";

/**
 * The sticky header on every public page: the logo, a Member login pill, and a menu of the public pages. On a phone the menu
 * is a panel under the header opened by the Menu button (the page behind stops scrolling, Escape closes it, Tab stays inside
 * the header, and moving to another page closes it); from 900px up the pages sit inline and the Menu button goes away.
 * "Member login" is at the top as a pill and again at the bottom of the phone menu.
 */
export function SiteHeader({ nav, memberLoginHref, children }: { nav: NavItem[]; memberLoginHref: string; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  // The menu is open "at" the page it was opened on, so going to another page closes it with no extra step.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const header = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const page = document.documentElement;
    const scrollBefore = page.style.overflow;
    page.style.overflow = "hidden";
    header.current?.querySelector<HTMLElement>(".ds-nav a")?.focus();

    const wide = window.matchMedia("(min-width: 900px)");
    const closeWhenWide = () => {
      if (wide.matches) setOpenAt(null);
    };
    wide.addEventListener("change", closeWhenWide);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenAt(null);
        menuButton.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !header.current) return;
      const reachable = [...header.current.querySelectorAll<HTMLElement>("a[href], button")].filter((el) => el.offsetParent !== null);
      if (reachable.length === 0) return;
      const first = reachable[0];
      const last = reachable[reachable.length - 1];
      const here = document.activeElement;
      if (!header.current.contains(here) || (event.shiftKey && here === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && here === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      page.style.overflow = scrollBefore;
      wide.removeEventListener("change", closeWhenWide);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header ref={header} className="ds-header ds-ui" data-open={open ? "" : undefined} data-testid="site-header">
      <div className="ds-header-bar">
        <Link href="/site" className="ds-logo-link" onClick={() => setOpenAt(null)}>
          {children}
        </Link>
        <nav id="ds-main-nav" className="ds-nav" aria-label="Main">
          <ul>
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined} onClick={() => setOpenAt(null)}>
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="ds-nav-member">
              <a href={memberLoginHref} data-track="member-login-menu">
                Member login
              </a>
            </li>
          </ul>
        </nav>
        <div className="ds-header-actions">
          <a href={memberLoginHref} className="ds-pill-link" data-track="member-login-header" data-testid="member-login-header">
            <span>Member login</span>
          </a>
          <button ref={menuButton} type="button" className="ds-menu-button" aria-expanded={open} aria-controls="ds-main-nav" onClick={() => setOpenAt(open ? null : pathname)}>
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {open && <div className="ds-scrim" aria-hidden="true" onClick={() => setOpenAt(null)} />}
    </header>
  );
}
