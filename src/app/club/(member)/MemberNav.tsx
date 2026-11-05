"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type MemberNavLink = {
  href: string;
  label: string;
  /**
   * Groups links in the phone menu so it reads like a desk, not a laundry list. "me" is a member's own account (My household, My
   * bookings, My classes, My bill, My boats): one dropdown called My account on a wide screen, one labelled group on a phone.
   */
  group: "go" | "me" | "coach" | "mine" | "desk" | "account";
};

const GROUP_LABEL: Record<MemberNavLink["group"], string> = {
  go: "Book and join",
  me: "My account",
  coach: "Coaching",
  mine: "My club",
  desk: "Staff desk",
  account: "Account",
};

const GROUP_ORDER: MemberNavLink["group"][] = ["go", "me", "coach", "mine", "desk", "account"];

/**
 * The member-area menu. On a phone it collapses behind a Menu button (same idea as the public site header); from 900px the
 * links sit in one wrap-friendly row. Link names stay exactly as the pages and browser tests already use them.
 */
export function MemberNav({
  homeHref,
  homeLabel,
  homeGroup = "mine",
  links,
  showSignOut,
  acting,
}: {
  homeHref: string;
  homeLabel: string;
  /** Where the home link sits: a member's household is the first thing in My account; staff's Households list is a plain link. */
  homeGroup?: MemberNavLink["group"];
  links: MemberNavLink[];
  showSignOut: boolean;
  /** Who is signed in (or being acted as), written out. It sits at the right of the bar, as in the design package. */
  acting: string;
}) {
  const pathname = usePathname() ?? "";
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  // The My account dropdown, on a wide screen. Like the phone menu it closes by itself when a page is chosen (the address changes).
  const [accountAt, setAccountAt] = useState<string | null>(null);
  const accountOpen = accountAt === pathname;
  const header = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const accountGroup = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountAt(null);
      accountButton.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && accountGroup.current?.contains(event.target)) return;
      setAccountAt(null);
    };
    const onFocusMoves = (event: FocusEvent) => {
      if (event.target instanceof Node && !accountGroup.current?.contains(event.target)) setAccountAt(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocusMoves);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onFocusMoves);
    };
  }, [accountOpen]);

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

  const close = () => {
    setOpenAt(null);
    setAccountAt(null);
  };
  const allLinks: MemberNavLink[] = [{ href: homeHref, label: homeLabel, group: homeGroup }, ...links];
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
            const isAccount = group === "me";
            return (
              <div key={group} ref={isAccount ? accountGroup : undefined} className={`club-nav-group${isAccount ? " club-nav-account" : ""}`} data-group={group}>
                <p className="club-nav-group-label">{GROUP_LABEL[group]}</p>
                {isAccount && (
                  // On a wide screen the My account links sit behind this button; on a phone the button is hidden and the links are
                  // listed under the "My account" label in the menu panel, where they are one tap away.
                  <button
                    ref={accountButton}
                    type="button"
                    className="club-account-button"
                    aria-expanded={accountOpen}
                    aria-controls="club-account-menu"
                    data-active={items.some((i) => isHere(i.href)) ? "" : undefined}
                    onClick={() => setAccountAt(accountOpen ? null : pathname)}
                  >
                    My account
                  </button>
                )}
                <ul id={isAccount ? "club-account-menu" : undefined} data-open={isAccount && accountOpen ? "" : undefined}>
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
