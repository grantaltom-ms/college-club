import Link from "next/link";
import { notFound } from "next/navigation";
import { listTourRequests, tourNotifyAddress } from "@/club/engine/tours";
import { requireClub } from "@/club/guard";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { TOUR_RULES } from "@/club/settings/tour-rules";
import { getTourStore } from "@/club/store/tours-instance";
import { formatMoment } from "@/club/time";
import { SignedOut } from "../../SignedOut";
import { FollowUpButton } from "./FollowUpButton";

/** Staff only: the cards visitors left through the public Request a tour form, newest first. */
export default async function TourRequestsPage() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const { items, total, newCount } = await listTourRequests(getTourStore(), TOUR_RULES, toEngineActor(actor));
  return (
    <section>
      <h1>Tour requests</h1>
      <p data-testid="tour-counts">
        {total === 0 ? "No one has asked for a tour yet." : `${newCount} to follow up, ${total} in all.`}
      </p>
      <p className="club-meta">
        These come from the Request a tour form on the public website. Each request is also emailed to {tourNotifyAddress()} once real email is switched on. Call or email the person, then mark it followed up so the next person at the desk can see it is done.{" "}
        <Link href="/club/admin">Back to the staff office</Link>
      </p>
      {TOUR_RULES.placeholder && (
        <p className="club-placeholder" data-testid="placeholder-note">
          <strong>Placeholder numbers.</strong> The limits that stop a flood of fake requests are stand-ins until club staff confirm them.
        </p>
      )}
      {items.length > 0 && (
        <ul className="club-cards" data-testid="tour-list">
          {items.map((r) => (
            <li key={r.id} className="club-card" data-testid="tour-request">
              <h3>{r.name}</h3>
              <p className="club-meta">Received {formatMoment(r.createdAt)}</p>
              <p>
                <a href={`mailto:${r.email}`}>{r.email}</a>
                {r.phone !== "" && (
                  <>
                    {" "}
                    · <a href={`tel:${r.phone.replace(/\D/g, "")}`}>{r.phone}</a>
                  </>
                )}
              </p>
              {r.note !== "" && <p style={{ whiteSpace: "pre-wrap" }}>{r.note}</p>}
              {r.status === "new" ? (
                <>
                  <p>
                    <strong data-testid="tour-status">New</strong>
                  </p>
                  <FollowUpButton id={r.id} name={r.name} />
                </>
              ) : (
                <p className="club-meta" data-testid="tour-status">
                  Followed up by {r.followedUpBy} on {formatMoment(r.followedUpAt!)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {total > items.length && <p className="club-meta">Showing the newest {items.length} of {total}.</p>}
    </section>
  );
}
