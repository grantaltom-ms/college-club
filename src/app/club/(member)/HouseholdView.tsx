import { bookingBlockReason } from "@/club/engine/eligibility";
import { fullName, historyOf, membersOf, qualificationsOf } from "@/club/engine/queries";
import { formatDay, formatMoment } from "@/club/time";
import type { ClubState, Household, Member } from "@/club/types";

const ROLE = { primary: "Primary adult", additional: "Additional adult" } as const;
const STATUS = { active: "Active", removed: "Left the household", household_ended: "Membership ended" } as const;

function Slot({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value ?? "not linked yet"}</dd>
    </>
  );
}

function MemberCard({ state, member, household, staff }: { state: ClubState; member: Member; household: Household; staff: boolean }) {
  const quals = qualificationsOf(state, member.id);
  const block = bookingBlockReason(member, household);
  return (
    <li className="club-card" data-testid="member-row" data-status={member.status}>
      <h3>{fullName(member)}</h3>
      <p className="club-meta">
        {ROLE[member.role]} · <span className={`club-chip club-chip-${member.status}`}>{STATUS[member.status]}</span>
      </p>
      <p>
        {member.email}
        {member.phone ? ` · ${member.phone}` : ""}
      </p>
      <p data-testid="booking-status">{block ? <strong>Cannot book: {block}</strong> : "Can make new bookings."}</p>
      {quals.length === 0 ? (
        <p className="club-meta">No rowing qualifications.</p>
      ) : (
        <ul className="club-list" aria-label={`Qualifications for ${fullName(member)}`}>
          {quals.map((q) => (
            <li key={q.qualification.code}>
              {q.qualification.name}
              <span className="club-meta">
                {" "}
                · granted {formatMoment(q.grantedAt)} by {q.grantedBy}
              </span>
            </li>
          ))}
        </ul>
      )}
      {staff && (
        <dl className="club-slots" aria-label={`Linked accounts for ${fullName(member)}`}>
          <Slot label="Brivo credential" value={member.brivoCredentialId} />
          <Slot label="Mailchimp contact" value={member.mailchimpContactId} />
          <dt>Login</dt>
          <dd data-testid="login-state">{member.loginId ? "has signed in" : "has not signed in yet"}</dd>
        </dl>
      )}
    </li>
  );
}

/** One household: who is in it, what they may do, and the file of everything that changed. Read only. */
export function HouseholdView({ state, household, viewerIsStaff }: { state: ClubState; household: Household; viewerIsStaff: boolean }) {
  const members = membersOf(state, household.id);
  const history = historyOf(state, household.id);
  return (
    <article>
      <h1 data-testid="household-name">{household.displayName}</h1>
      <p className="club-meta" data-testid="household-facts">
        {household.membershipType} · joined {formatDay(household.joinedOn)} ·{" "}
        {household.status === "ended" ? (
          <strong>membership ended {formatDay(household.endedOn!)}</strong>
        ) : (
          <span className="club-chip club-chip-active">Active</span>
        )}
      </p>
      {viewerIsStaff && (
        <dl className="club-slots" aria-label="Household records">
          <Slot label="QuickBooks ID" value={household.quickbooksId} />
          <dt>Notes</dt>
          <dd>{household.notes || "none"}</dd>
        </dl>
      )}

      <h2>Adults</h2>
      <ul className="club-cards" aria-label="Adults in this household">
        {members.map((m) => (
          <MemberCard key={m.id} state={state} member={m} household={household} staff={viewerIsStaff} />
        ))}
      </ul>

      <h2>History</h2>
      <ol className="club-history" aria-label="Household history">
        {history.map((e) => (
          <li key={e.id} data-kind={e.kind}>
            <span className="club-meta">{formatMoment(e.at)}</span>
            <span>{e.summary}</span>
            <span className="club-meta">by {e.actor.label}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}
