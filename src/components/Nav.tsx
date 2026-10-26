"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Summary" },
  { href: "/visits", label: "Visits" },
  { href: "/timing", label: "Timing" },
  { href: "/shells", label: "Shells" },
  { href: "/reservations", label: "Reservations" },
  { href: "/email", label: "Email" },
  { href: "/membership", label: "Membership" },
  { href: "/goals", label: "Goals" },
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
