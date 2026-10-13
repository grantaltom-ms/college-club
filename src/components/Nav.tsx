"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/timing", label: "Timing" },
  { href: "/email", label: "Email" },
  { href: "/members", label: "Members" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label="Dashboard sections">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
