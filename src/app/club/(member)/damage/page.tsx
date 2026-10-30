import Link from "next/link";
import { myDamageReports, reportableItems } from "@/club/engine/damage";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { DAMAGE_RULES } from "@/club/settings/damage-rules";
import { getClubStore } from "@/club/store/instance";
import { formatDay, formatMoment, pacificDate } from "@/club/time";
import { idParam } from "@/club/web";
import { viewerOf } from "@/club/web-actor";
import { SignedOut } from "../SignedOut";
import { DamageNoteForm, FileDamageForm } from "./DamageForms";

type Search = Record<string, string | string[] | undefined>;

/**
 * Report damage on a boat or space, and see the reports you have filed. Open to anyone signed in. Everyone who books a boat reads the
 * "what is wrong" and "where" of its open reports; how it happened is for staff only.
 */
export default async function DamagePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  const params = await searchParams;
  const state = await (await getClubStore()).read();
  const items = reportableItems(state, viewerOf(actor));
  const mine = actor.kind === "member" ? myDamageReports(state, actor.member.id) : [];
  const limits = DAMAGE_RULES.defaults;

  return (
    <section>
      <h1>Report damage</h1>
      <p>
        Tell the club when something is broken or looks unsafe. Staff see every report. Everyone who books a boat reads what is wrong and where on the boat, so those two boxes should not name anyone. <Link href="/club/book">Back to Book</Link>
        {actor.kind === "staff" && (
          <>
            {" "}
            &middot; <Link href="/club/admin/damage">Damage reports (staff)</Link>
          </>
        )}
      </p>
      <p className="club-meta">
        A report marked major does not close the boat by itself: club staff look at it first and decide. If someone is hurt or a boat is unsafe on the water right now, call the club first.
      </p>

      <FileDamageForm items={items} selected={idParam(params.item) ?? ""} limits={{ description: limits.descriptionMax, location: limits.locationMax, how: limits.howMax }} />

      {actor.kind === "member" && (
        <>
          <h2>Your reports</h2>
          {mine.length === 0 ? (
            <p data-testid="no-damage-reports">You have not reported any damage.</p>
          ) : (
            <ul className="club-cards" aria-label="Your damage reports">
              {mine.map((r) => (
                <li key={r.reportId} className="club-card" data-testid="my-damage-report" data-item={r.itemName} data-status={r.status}>
                  <h3>
                    {r.itemName}
                    {r.major && <span className="club-tag">Major</span>}
                  </h3>
                  <p>{r.description}</p>
                  <p className="club-meta">
                    <span data-testid="damage-status">{r.statusWords}</span> &middot; reported {formatDay(pacificDate(new Date(r.reportedAt)))}
                    {r.repairedOn ? ` · repaired ${formatDay(r.repairedOn)}` : ""}
                    {r.dismissedReason ? ` · dismissed: ${r.dismissedReason}` : ""}
                  </p>
                  {r.notes.length > 0 && (
                    <ul className="club-list" aria-label="Your notes">
                      {r.notes.map((n) => (
                        <li key={n.at + n.text}>
                          {n.text} <span className="club-meta">&middot; {formatMoment(n.at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(r.status === "open" || r.status === "in_progress") && <DamageNoteForm reportId={r.reportId} label="Add something to this report" />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
