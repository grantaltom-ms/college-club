"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { TodayRow } from "@/club/engine/today";
import { memberCount } from "@/club/today-words";

/**
 * The two lists on Today at the Club, each folded away until someone opens it: a shared front-desk screen shows only counts until a
 * member of staff asks for the names. The page also asks the server for fresh figures by itself every `refreshSeconds`, and again
 * when the screen is woken up or its tab comes back into view, so it never goes quietly stale. A refresh keeps whatever is open.
 */
export function TodaySections({ here, upcoming, refreshSeconds }: { here: TodayRow[]; upcoming: TodayRow[]; refreshSeconds: number }) {
  useRefreshing(refreshSeconds);
  return (
    <div className="club-now-sections" data-refresh-seconds={refreshSeconds}>
      <Section testId="today-here" title="Who's here now?" rows={here} empty="Nobody's checked in or mid-reservation right now." />
      <Section testId="today-upcoming" title="Upcoming reservations" rows={upcoming} empty="Nobody else is booked in for the rest of today." />
    </div>
  );
}

function useRefreshing(seconds: number) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => router.refresh();
    const timer = window.setInterval(refresh, seconds * 1000);
    const wake = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [router, seconds]);
}

/** One folded list. `defaultOpen` exists only so a test can look inside without a browser; the page never sets it. */
export function Section({ testId, title, rows, empty, defaultOpen = false }: { testId: string; title: string; rows: TodayRow[]; empty: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const panel = useId();
  return (
    <section className="club-card club-now-section" data-testid={testId} data-open={open ? "" : undefined}>
      <h2>
        <button type="button" className="club-now-toggle" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
          <span className="club-now-title">{title}</span>
          <span className="club-now-count" data-testid={`${testId}-count`}>
            {" "}
            — {memberCount(rows.length)}
          </span>
          <span className="club-now-chevron" aria-hidden="true" />
        </button>
      </h2>
      {open && (
        <div id={panel} className="club-now-panel">
          {rows.length === 0 ? (
            <p className="club-meta" data-testid={`${testId}-empty`}>
              {empty}
            </p>
          ) : (
            <ul className="club-now-list" data-testid={`${testId}-list`}>
              {rows.map((row) => (
                <li key={row.memberId} className="club-now-row" data-testid="today-row" data-hello={row.hello?.kind}>
                  <span className="club-now-name">{row.name}</span>
                  <span className="club-now-what">
                    {row.what.map((w, i) => (
                      <span key={`${w.title}:${i}`} className="club-now-item">
                        {w.title} <span className="club-now-cat">{w.category}</span>
                      </span>
                    ))}
                  </span>
                  {row.hello && (
                    <span className="club-now-hello" data-testid="today-hello">
                      {row.hello.words}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
