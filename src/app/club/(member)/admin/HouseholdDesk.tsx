import Link from "next/link";
import { fullName, membersOf, qualificationsOf } from "@/club/engine/queries";
import { memberFieldsProblem } from "@/club/engine/households";
import { MEMBERSHIP_TYPES, type ClubState, type Household } from "@/club/types";
import { QuickbooksForm } from "./households/QuickbooksForm";

type Typed = { firstName: string; lastName: string; email: string; phone: string };

/**
 * The front-desk tools for one household, shown to staff under its record: change the membership type, add an adult,
 * grant a qualification, remove an adult, end the membership. Anything that cancels bookings goes through a page that
 * shows what will be cancelled first.
 */
export function HouseholdDesk({ state, household, typed, problem }: { state: ClubState; household: Household; typed: Typed | null; problem: boolean }) {
  if (household.status === "ended") {
    return (
      <section aria-label="Staff tools" data-testid="desk">
        <h2>Staff tools</h2>
        <p className="club-meta">This membership has ended, so nothing in it can be changed except its QuickBooks ID, which the last month&apos;s bill still needs. A household that comes back is added as a new household.</p>
        <div className="club-tools">
        <div className="club-card" id="quickbooks">
          <h3>QuickBooks ID</h3>
          <p className="club-meta">The ID this household has in QuickBooks. Monthly billing needs it, and it can only be changed here, with the change written in the household&apos;s file.</p>
          <QuickbooksForm householdId={household.id} current={household.quickbooksId} />
        </div>
        </div>
      </section>
    );
  }
  const adults = membersOf(state, household.id).filter((m) => m.status === "active");
  const addProblem = problem && typed ? memberFieldsProblem(typed) : null;
  return (
    <section aria-label="Staff tools" data-testid="desk">
      <h2>Staff tools</h2>
      <div className="club-tools">
        <div className="club-card">
          <h3>Membership type</h3>
          <form method="post" action="/api/club/households/change-type" className="club-form">
            <input type="hidden" name="household" value={household.id} />
            <label htmlFor="type">Type</label>
            <select id="type" name="type" defaultValue={household.membershipType}>
              {MEMBERSHIP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <p>
              <button type="submit" className="club-button">
                Change type
              </button>
            </p>
          </form>
        </div>

        <div className="club-card" id="quickbooks">
          <h3>QuickBooks ID</h3>
          <p className="club-meta">The ID this household has in QuickBooks. Monthly billing needs it, and it can only be changed here, with the change written in the household&apos;s file.</p>
          <QuickbooksForm householdId={household.id} current={household.quickbooksId} />
        </div>

        <div className="club-card" id="add-adult">
          <h3>Add an adult</h3>
          {addProblem && (
            <p className="club-alert" role="alert" data-testid="add-problem">
              {addProblem}
            </p>
          )}
          <form method="post" action="/api/club/households/add-member" className="club-form" data-testid="add-adult-form">
            <input type="hidden" name="household" value={household.id} />
            <p>
              <label htmlFor="a-first">First name</label>
              <input id="a-first" name="firstName" type="text" maxLength={80} defaultValue={typed?.firstName ?? ""} required />
            </p>
            <p>
              <label htmlFor="a-last">Last name</label>
              <input id="a-last" name="lastName" type="text" maxLength={80} defaultValue={typed?.lastName ?? ""} required />
            </p>
            <p>
              <label htmlFor="a-email">Email</label>
              <input id="a-email" name="email" type="email" maxLength={200} defaultValue={typed?.email ?? ""} required />
            </p>
            <p>
              <label htmlFor="a-phone">Phone (optional)</label>
              <input id="a-phone" name="phone" type="tel" maxLength={40} defaultValue={typed?.phone ?? ""} />
            </p>
            <p>
              <button type="submit" className="club-button">
                Add adult
              </button>
            </p>
          </form>
        </div>
      </div>

      <h3>Adults</h3>
      <ul className="club-cards" aria-label="Adults you can change">
        {adults.map((m) => {
          const held = new Set(qualificationsOf(state, m.id).map((q) => q.qualification.code));
          const available = state.qualifications.filter((q) => !held.has(q.code));
          return (
            <li key={m.id} className="club-card" data-testid="desk-adult">
              <h4>{fullName(m)}</h4>
              {available.length > 0 ? (
                <form method="post" action="/api/club/households/grant" className="club-form">
                  <input type="hidden" name="household" value={household.id} />
                  <input type="hidden" name="member" value={m.id} />
                  <label htmlFor={`q-${m.id}`}>Grant a qualification</label>
                  <select id={`q-${m.id}`} name="code">
                    {available.map((q) => (
                      <option key={q.code} value={q.code}>
                        {q.name}
                      </option>
                    ))}
                  </select>
                  <p>
                    <button type="submit" className="club-button" aria-label={`Grant ${fullName(m)} the chosen qualification`}>
                      Grant
                    </button>
                  </p>
                </form>
              ) : (
                <p className="club-meta">Holds every qualification.</p>
              )}
              <p>
                <Link href={`/club/admin/households/${household.id}/members/${m.id}/edit`} data-testid="edit-link" aria-label={`Change details for ${fullName(m)}`}>
                  Change name, email or phone&hellip;
                </Link>
              </p>
              <p>
                <Link href={`/club/admin/households/${household.id}/remove/${m.id}`} data-testid="remove-link" aria-label={`Remove ${fullName(m)} from the household`}>
                  Remove from the household&hellip;
                </Link>
              </p>
            </li>
          );
        })}
      </ul>

      <h3>Ending the membership</h3>
      <p>
        <Link href={`/club/admin/households/${household.id}/end`} className="club-button club-button-danger" data-testid="end-link">
          End this membership&hellip;
        </Link>
      </p>
      <p className="club-meta">You will see everything that would be cancelled before anything happens.</p>
    </section>
  );
}
