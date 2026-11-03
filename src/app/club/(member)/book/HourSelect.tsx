"use client";

import { useRouter } from "next/navigation";

/**
 * Compact hour dropdown. Choosing an hour reloads the page with ?hour=.
 * For shells (`requireHour`), an hour is required before the dense free list appears;
 * the empty option says "Choose an hour" instead of "All open hours".
 */
export function HourSelect({
  hours,
  hour,
  hrefs,
  requireHour = false,
}: {
  hours: { value: number; label: string }[];
  hour: number | null;
  hrefs: { all: string; byHour: Record<number, string> };
  requireHour?: boolean;
}) {
  const router = useRouter();
  return (
    <p className="club-book-day-select club-book-hour">
      <label htmlFor="book-hour">
        <span className="club-book-day-label">Hour</span>
      </label>
      <select
        id="book-hour"
        aria-label="Pick an hour"
        data-testid="hour-select"
        value={hour === null ? "" : String(hour)}
        onChange={(e) => {
          const v = e.target.value;
          router.push(v === "" ? hrefs.all : hrefs.byHour[Number(v)] ?? hrefs.all);
        }}
      >
        <option value="">{requireHour ? "Choose an hour" : "All open hours"}</option>
        {hours.map((h) => (
          <option key={h.value} value={String(h.value)}>
            {h.label}
          </option>
        ))}
      </select>
    </p>
  );
}
