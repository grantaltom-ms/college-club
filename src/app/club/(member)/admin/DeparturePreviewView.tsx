import type { DeparturePreview, DepartureLine } from "@/club/engine/departure";

function Group({ title, lines, testId }: { title: string; lines: DepartureLine[]; testId: string }) {
  if (lines.length === 0) return null;
  return (
    <div data-testid={testId}>
      <h3>
        {title} <span className="club-count">({lines.length})</span>
      </h3>
      <ul>
        {lines.map((l) => (
          <li key={l.id} data-testid={`${testId}-line`}>
            {l.what}, {l.when}: {l.who}
            {l.detail ? ` (${l.detail})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Staff read this before they confirm: everything the step will cancel, worked out without changing anything. */
export function DeparturePreviewView({ preview }: { preview: DeparturePreview }) {
  if (preview.total === 0) {
    return (
      <p data-testid="preview-empty" className="club-meta">
        Nothing is booked, signed up for or RSVPed to from now on, so nothing will be cancelled.
      </p>
    );
  }
  return (
    <div className="club-preview" data-testid="preview">
      <p>
        <strong>{preview.total}</strong> thing{preview.total === 1 ? "" : "s"} will change:
      </p>
      <Group title="Boat and space bookings cancelled" lines={preview.bookings} testId="preview-bookings" />
      <Group title="Seats on other people's boats given up (those bookings stay)" lines={preview.crewSeats} testId="preview-crew" />
      <Group title="Class places cancelled" lines={preview.signUps} testId="preview-classes" />
      <Group title="Event RSVPs cancelled" lines={preview.rsvps} testId="preview-events" />
      <p className="club-meta">Waiting lists move up behind anyone who gives up a chair or spots. Nothing in the past is touched.</p>
    </div>
  );
}
