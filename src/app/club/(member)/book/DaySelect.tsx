"use client";

import { useRouter } from "next/navigation";

/** Compact day control: a single dropdown of the days still open to book, instead of a wall of day chips. */
export function DaySelect({
  days,
  day,
  today,
  labels,
  hrefs,
}: {
  days: string[];
  day: string;
  today: string;
  labels: Record<string, string>;
  hrefs: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <p className="club-book-day-select">
      <label htmlFor="book-day">
        <span className="club-book-day-label">Day</span>
      </label>
      <select
        id="book-day"
        aria-label="Pick a day"
        data-testid="day-select"
        value={day}
        onChange={(e) => {
          const next = hrefs[e.target.value];
          if (next) router.push(next);
        }}
      >
        {days.map((d) => (
          <option key={d} value={d}>
            {d === today ? `Today · ${labels[d]}` : labels[d]}
          </option>
        ))}
      </select>
    </p>
  );
}
