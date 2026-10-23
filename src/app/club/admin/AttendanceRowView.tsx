import { fullName, memberById } from "@/club/engine/queries";
import type { AttendanceRow } from "@/club/engine/attendance";
import { formatDayLong, formatRange, pacificDate } from "@/club/time";
import type { ClubState } from "@/club/types";
import { AttendanceButtons } from "../AttendanceButtons";

const KIND = { booking: "Booking", class: "Class", event: "Event" } as const;

export function statusWords(row: AttendanceRow): string {
  if (row.outcome === "attended") return "Checked in";
  if (row.outcome === "no_show") return row.automatic ? "No-show (marked automatically)" : "No-show";
  return row.started ? "Not checked in" : "Not here yet";
}

/** One reservation on a staff list: what, when, who, where it stands, and the buttons that fit. */
export function AttendanceRowView({ state, row, back }: { state: ClubState; row: AttendanceRow; back: string }) {
  const person = fullName(memberById(state, row.memberId)!);
  return (
    <li className="club-card" data-testid="attendance-row" data-kind={row.kind} data-outcome={row.outcome ?? "none"}>
      <h3>{row.title}</h3>
      <p>
        {formatDayLong(pacificDate(new Date(row.startsAt)))}, {formatRange(row.startsAt, row.endsAt)}
      </p>
      <p className="club-meta">
        {KIND[row.kind]} · {person}
        {row.withNames.length > 0 ? ` with ${row.withNames.join(", ")}` : ""} · <span data-testid="attendance-status">{statusWords(row)}</span>
      </p>
      <AttendanceButtons row={row} who={person} back={back} />
    </li>
  );
}
