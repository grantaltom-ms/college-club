import type { DeparturePreview, DepartureLine } from "@/club/engine/departure";

function Group({ title, lines, testId, limit }: { title: string; lines: DepartureLine[]; testId: string; limit?: number }) {
  if (lines.length === 0) return null;
  const shown = limit === undefined ? lines : lines.slice(0, limit);
  return (
    <div data-testid={testId}>
      <h3>
        {title} <span className="club-count">({lines.length})</span>
      </h3>
      <ul>
        {shown.map((l) => (
          <li key={l.id} data-testid={`${testId}-line`}>
            {l.what}, {l.when}: {l.who}
            {l.detail ? ` (${l.detail})` : ""}
          </li>
        ))}
      </ul>
      {lines.length > shown.length && <p className="club-meta">&hellip;and {lines.length - shown.length} more.</p>}
    </div>
  );
}

/**
 * Staff read this before they confirm: everything the step will cancel, worked out without changing anything.
 * `limit` caps how many lines each list shows, for a read-back that covers many households at once.
 */
export function DeparturePreviewView({ preview, limit }: { preview: DeparturePreview; limit?: number }) {
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
      <Group title="Boat and space bookings cancelled" lines={preview.bookings} testId="preview-bookings" limit={limit} />
      <Group title="Seats on other people's boats given up (those bookings stay)" lines={preview.crewSeats} testId="preview-crew" limit={limit} />
      <Group title="Class places cancelled" lines={preview.signUps} testId="preview-classes" limit={limit} />
      <Group title="Event RSVPs cancelled" lines={preview.rsvps} testId="preview-events" limit={limit} />
      <p className="club-meta">Waiting lists move up behind anyone who gives up a place or spots. Nothing in the past is touched.</p>
    </div>
  );
}
