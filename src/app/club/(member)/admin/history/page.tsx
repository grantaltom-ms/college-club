import Link from "next/link";
import { notFound } from "next/navigation";
import { nameReport, searchHistory } from "@/club/engine/history";
import { ICREW_COLUMNS } from "@/club/engine/icrew";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { getHistoryStore } from "@/club/store/history-instance";
import { formatDay, formatMoment, formatRange } from "@/club/time";
import { HISTORY_LIST_LIMIT } from "@/club/web-history";
import { SignedOut } from "../../SignedOut";
import { HistoryForm } from "./HistoryForm";

const MATCH_WORDS = { one: "one member", many: "more than one member", none: "no member" } as const;

/** Staff only: the filing cabinet of old iCrew bookings. Upload a report, see exactly what it would add, add it, and look people up. */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const params = await searchParams;
  const typed = (Array.isArray(params.name) ? params.name[0] : params.name)?.slice(0, 80) ?? "";
  const history = await getHistoryStore();
  const members = (await (await getClubStore()).read()).members;
  const [summary, names, search] = await Promise.all([history.summary(), nameReport(history, members), searchHistory(history, members, typed)]);

  return (
    <section>
      <h1>Old bookings</h1>
      <p>
        The bookings from iCrew, kept as a record. They are a filing cabinet, not part of today&apos;s calendar: they never count against anyone&apos;s limits, never become a no-show and never appear on a bill. The import only ever adds, and a booking
        that is already stored is skipped.
      </p>
      <h2 data-testid="history-total">
        {summary.rows === 0 ? "Nothing stored yet" : `${summary.rows.toLocaleString("en-US")} old booking${summary.rows === 1 ? "" : "s"} stored`}
      </h2>
      {summary.firstDay && summary.lastDay && (
        <p data-testid="history-range">
          From {formatDay(summary.firstDay)} to {formatDay(summary.lastDay)}.
        </p>
      )}
      {summary.imports.length > 0 && (
        <table className="club-table" data-testid="history-imports">
          <caption>Files added so far, newest first</caption>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Added</th>
              <th scope="col">By</th>
              <th scope="col">Bookings</th>
            </tr>
          </thead>
          <tbody>
            {summary.imports.map((i) => (
              <tr key={i.id} data-testid="history-import">
                <td>{i.fileName}</td>
                <td>{formatMoment(i.importedAt)}</td>
                <td>{i.importedBy}</td>
                <td>
                  {i.rowsAdded.toLocaleString("en-US")} added, {i.rowsSkipped.toLocaleString("en-US")} skipped
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Adding a report</h2>
      <ol className="club-list">
        <li>
          In iCrew, run the <strong>Reservations</strong> report for the dates you want and save it as a CSV file. A year of bookings is about 3.4 MB, and one file can be up to 4 MB (about 30,000 rows); for more, export a shorter date range and upload the
          pieces one after another.
        </li>
        <li>
          The file needs these columns: {ICREW_COLUMNS.map((c, i) => (
            <span key={c}>
              {i > 0 && ", "}
              <strong>{c}</strong>
            </span>
          ))}
          . It is how iCrew writes it, so you should not need to change anything. <a href="/api/club/history/template" data-testid="history-template">The blank template</a> shows the layout; delete its three example rows.
        </li>
        <li>Only days that have already passed are kept. Today and later days are left out, because those bookings can still change in iCrew.</li>
        <li>Choose the file below and check it. You will see what it would add before anything is saved.</li>
      </ol>
      <HistoryForm />

      <h2>Find a person&apos;s old bookings</h2>
      <form method="get" className="club-form" data-testid="history-search">
        <p>
          <label htmlFor="history-name">Name (at least three letters)</label>
          <input id="history-name" name="name" defaultValue={typed} autoComplete="off" />{" "}
          <button type="submit" className="club-button">
            Find
          </button>
        </p>
      </form>
      {search.tooShort && (
        <p className="club-meta" data-testid="history-too-short">
          Type at least three letters of the name.
        </p>
      )}
      {typed !== "" && !search.tooShort && (
        <>
          <p data-testid="history-found-count">
            {search.found.length === 0 ? "No old bookings found for that name." : `${search.found.length}${search.found.length === 100 ? " (the most shown)" : ""} old booking${search.found.length === 1 ? "" : "s"}, newest first.`}
          </p>
          {search.found.length > 0 && (
            <ul className="club-cards" aria-label="Old bookings found">
              {search.found.map((f) => (
                <li key={f.reservation.id} className="club-card" data-testid="history-found">
                  <h3>
                    {f.reservation.itemType} &middot; {f.reservation.itemName}
                  </h3>
                  <p>
                    {formatDay(f.reservation.day)}, {formatRange(f.reservation.startsAt, f.reservation.endsAt)} &middot; iCrew ID {f.reservation.sourceId}
                  </p>
                  <p className="club-meta">
                    Reserved by {f.reservation.bookedBy}
                    {f.reservation.rowers ? ` · rowers: ${f.reservation.rowers}` : ""}
                    {f.reservation.oars ? ` · oars: ${f.reservation.oars}` : ""}
                  </p>
                  <p className="club-meta">Names: {f.people.map((p) => `${p.name} (${MATCH_WORDS[p.matches]})`).join(", ")}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {summary.rows > 0 && (
        <>
          <h2>Names that match no member ({names.none.length})</h2>
          <p className="club-meta" data-testid="history-name-totals">
            {names.total} different names in the archive: {names.matchedOne} match exactly one member, {names.many.length} match more than one, {names.none.length} match no member. A member only sees bookings whose name matches only them.
          </p>
          {names.none.length === 0 ? (
            <p>Every name matches a member.</p>
          ) : (
            <ul className="club-list" data-testid="history-unmatched">
              {names.none.slice(0, HISTORY_LIST_LIMIT).map((n) => (
                <li key={n.key}>
                  {n.name} ({n.rows.toLocaleString("en-US")})
                </li>
              ))}
            </ul>
          )}
          {names.none.length > HISTORY_LIST_LIMIT && <p className="club-meta">&hellip;and {names.none.length - HISTORY_LIST_LIMIT} more.</p>}
          {names.many.length > 0 && (
            <>
              <h2>Names more than one member shares ({names.many.length})</h2>
              <ul className="club-list" data-testid="history-shared">
                {names.many.slice(0, HISTORY_LIST_LIMIT).map((n) => (
                  <li key={n.key}>
                    {n.name} ({n.rows.toLocaleString("en-US")} bookings, {n.members} members)
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <p className="club-meta">
        <Link href="/club/admin">Back to the staff office</Link>
      </p>
    </section>
  );
}
