import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { aroundNow, reservationsFor } from "@/club/engine/attendance";
import { fullName, householdOf } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { getClubStore } from "@/club/store/instance";
import { NOTICES } from "@/club/web";
import { SignedOut } from "../../SignedOut";
import { AttendanceRowView } from "../AttendanceRowView";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";
const MOST_PEOPLE = 6;

/**
 * Staff only: check someone in when they cannot do it themselves (the iPad is busy, broken, or they have no phone on them).
 * Search by name or email to see what a person is down for, or look at everything around now.
 */
export default async function CheckIn({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const now = clubNow();
  const query = await searchParams;
  const q = one(query.q).trim().slice(0, 60);
  const state = await (await getClubStore()).read();
  const notice = NOTICES[one(query.notice)];
  const back = q ? `/club/admin/check-in?q=${encodeURIComponent(q)}` : "/club/admin/check-in";

  const needle = q.toLowerCase();
  const found = q
    ? state.members
        .filter((m) => m.status === "active" && (fullName(m).toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle)))
        .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    : [];
  const shown = found.slice(0, MOST_PEOPLE);

  return (
    <section>
      <h1>Check someone in</h1>
      <p className="club-meta">For when a member cannot check themselves in. Check-in opens {ATTENDANCE_RULES.defaults.checkInOpensMinutesBefore} minutes before the start (placeholder).</p>
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      {one(query.checked) && (
        <p className="club-success" role="status" data-testid="checked">
          Saved. The change is on the check-in record.
        </p>
      )}
      <form method="get" action="/club/admin/check-in" className="club-form" role="search">
        <p>
          <label htmlFor="q">Name or email</label>
          <input id="q" name="q" type="text" maxLength={60} defaultValue={q} autoComplete="off" />
        </p>
        <p>
          <button type="submit" className="club-button">
            Find
          </button>
        </p>
      </form>

      {q ? (
        <>
          {found.length === 0 && <p data-testid="no-match">Nobody active matches &ldquo;{q}&rdquo;.</p>}
          {found.length > shown.length && <p className="club-meta">Showing the first {shown.length} of {found.length}. Type more of the name to narrow it down.</p>}
          {shown.map((m) => {
            const rows = reservationsFor(state, m.id, now, ATTENDANCE_RULES);
            return (
              <div key={m.id} data-testid="person">
                <h2>
                  {fullName(m)} <span className="club-meta">· {householdOf(state, m.householdId)?.displayName}</span>
                </h2>
                {rows.length === 0 ? (
                  <p className="club-meta" data-testid="person-empty">
                    Nothing booked, signed up for or RSVPed to from yesterday to tomorrow.
                  </p>
                ) : (
                  <ul className="club-cards" aria-label={`Reservations for ${fullName(m)}`}>
                    {rows.map((row) => (
                      <AttendanceRowView key={`${row.kind}-${row.id}`} state={state} row={row} back={back} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </>
      ) : (
        <>
          <h2>Around now</h2>
          <p className="club-meta">Everything that started in the last two hours or starts in the next two.</p>
          {(() => {
            const rows = aroundNow(state, now, ATTENDANCE_RULES);
            return rows.length === 0 ? (
              <p data-testid="around-empty">Nothing is on around now.</p>
            ) : (
              <ul className="club-cards" aria-label="Around now" data-testid="around-now">
                {rows.map((row) => (
                  <AttendanceRowView key={`${row.kind}-${row.id}`} state={state} row={row} back={back} />
                ))}
              </ul>
            );
          })()}
        </>
      )}
      <p>
        <Link href="/club/admin">Back to the staff office</Link>
      </p>
    </section>
  );
}
