"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { COMMITTEES, committeePath } from "@/lib/committees";

/** The committee pages' header: the club's name and a link to each committee's page. No link to the dashboard's menu. */
export function CommitteeHeader() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="frame">
        <span className="wordmark">College Club Seattle</span>
        <nav className="site-nav committee-nav" aria-label="Committee pages">
          {COMMITTEES.map((c) => {
            const href = committeePath(c.slug);
            return (
              <Link key={c.slug} href={href} aria-current={pathname === href ? "page" : undefined}>
                {c.name.replace(" Committee", "")}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
