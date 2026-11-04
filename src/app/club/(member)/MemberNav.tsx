"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type MemberNavLink = {
  href: string;
  label: string;
  /** Groups links in the phone menu so it reads like a desk, not a laundry list. */
  group: "go" | "mine" | "desk" | "account";
};

const GROUP_LABEL: Record<MemberNavLink["group"], string> = {
  go: "Book and join",
  mine: "My club",
  desk: "Staff desk",
  account: "Account",
};

const GROUP_ORDER: MemberNavLink["group"][] = ["go", "mine", "desk", "account"];

/**
 * The member-area menu. On a phone it collapses behind a Menu button (same idea as the public site header); from 900px the
 * links sit in one wrap-friendly row. Link names stay exactly as the pages and browser tests already use them.
 */
export function MemberNav({
  homeHref,
  homeLabel,
  links,
  showSignOut,
  acting,
}: {
  homeHref: string;
  homeLabel: string;
  links: MemberNavLink[];
  showSignOut: boolean;
  /** Who is signed in (or being acted as), written out. It sits at the right of the bar, as in the design package. */
  acting: string;
}) {
  const pathname = usePathname() ?? "";
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const header = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const page = document.documentElement;
    const scrollBefore = page.style.overflow;
    page.style.overflow = "hidden";
    header.current?.querySelector<HTMLElement>(".club-nav a")?.focus();

    // The panel opens under the bar, which is taller than it looks (the "acting as" row, and the test-build strip above it), so measure
    // where the bar ends instead of guessing: otherwise the last links fall below a short phone screen and the page behind cannot scroll.
    const bar = header.current;
    const placePanel = () => bar?.style.setProperty("--club-menu-top", `${Math.round(bar.getBoundingClientRect().bottom)}px`);
    placePanel();
    window.addEventListener("resize", placePanel);

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
      window.removeEventListener("resize", placePanel);
      bar?.style.removeProperty("--club-menu-top");
      wide.removeEventListener("change", closeWhenWide);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpenAt(null);
  const allLinks: MemberNavLink[] = [{ href: homeHref, label: homeLabel, group: "mine" }, ...links];
  /** The page you are on is marked, so the bar can underline it. The home link only counts on its own address. */
  const isHere = (href: string) => (href === homeHref ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header ref={header} className="club-header" data-open={open ? "" : undefined}>
      <div className="club-header-bar">
        <Link href="/club" className="club-brand" onClick={close}>
          {/* The words beside the mark are the link's name, so the picture itself says nothing extra. */}
          <Image src="/club-logo-mark.png" alt="" width={40} height={40} className="club-brand-mark" priority />
          <span className="club-wordmark">College Club Seattle</span>
        </Link>
        <nav id="club-member-nav" className="club-nav" aria-label="Member area">
          {GROUP_ORDER.map((group) => {
            const items = allLinks.filter((l) => l.group === group);
            if (items.length === 0 && !(group === "account" && showSignOut)) return null;
            return (
              <div key={group} className="club-nav-group" data-group={group}>
                <p className="club-nav-group-label">{GROUP_LABEL[group]}</p>
                <ul>
                  {items.map((item) => (
                    <li key={`${item.href}:${item.label}`}>
                      <Link href={item.href} onClick={close} aria-current={isHere(item.href) ? "page" : undefined}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                  {group === "account" && showSignOut && (
                    <li>
                      <form method="post" action="/api/club/sign-out">
                        <button type="submit">Sign out</button>
                      </form>
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </nav>
        <p className="club-acting" data-testid="acting-as">
          {acting}
        </p>
        <div className="club-header-actions">
          <button
            ref={menuButton}
            type="button"
            className="club-menu-button"
            aria-expanded={open}
            aria-controls="club-member-nav"
            onClick={() => setOpenAt(open ? null : pathname)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {open && <div className="club-scrim" aria-hidden="true" onClick={close} />}
    </header>
  );
}
