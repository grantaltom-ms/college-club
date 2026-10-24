import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { memberChoices, visitorRows } from "@/club/engine/billing-views";
import { formatMoney, visitorRuleWords } from "@/club/engine/billing-words";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { BILLING_RULES } from "@/club/settings/billing-rules";
import { getClubStore } from "@/club/store/instance";
import { formatDay, pacificDate } from "@/club/time";
import { SignedOut } from "../../SignedOut";
import { VoidForm } from "../VoidForm";
import { VisitorsForm } from "./VisitorsForm";

/** Staff only: the visitors members brought, signed in on the front-desk iPad or entered here. */
export default async function VisitorsPage() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const state = await (await getClubStore()).read();
  const rows = visitorRows(state, BILLING_RULES);
  return (
    <section>
      <h1>Visitors</h1>
      <p data-testid="visitor-rule">{visitorRuleWords(BILLING_RULES.defaults)}</p>
      {BILLING_RULES.placeholder && (
        <p className="club-placeholder" data-testid="placeholder-note">
          <strong>Placeholder numbers.</strong> The free number and the fee are stand-ins until club staff confirm them.
        </p>
      )}
      <p>
        Members sign their own visitors in on the front-desk iPad. Only a count is kept: no visitor names. Staff can enter or correct them here. Each member&apos;s visitors are counted per day, and the fee is billed in that day&apos;s month.
      </p>
      <h2>Record visitors</h2>
      <VisitorsForm members={memberChoices(state)} today={pacificDate(clubNow())} />
      <h2>Recent visitors</h2>
      {rows.length === 0 ? (
        <p data-testid="no-visitors">No visitors have been recorded yet.</p>
      ) : (
        <ul className="club-cards" aria-label="Recent visitors" data-testid="visitors">
          {rows.map((r) => (
            <li key={r.id} className="club-card" data-testid="visitor-row" data-status={r.status}>
              <h3>
                {r.memberName} · {r.visitors} visitor{r.visitors === 1 ? "" : "s"}
              </h3>
              <p className="club-meta">
                {formatDay(r.day)} · {r.via === "ipad" ? "signed in on the iPad" : `entered by ${r.enteredBy}`}
                {r.householdName ? ` · ${r.householdName}` : ""}
              </p>
              {r.status === "voided" ? (
                <p className="club-meta" data-testid="visitor-voided">
                  Voided: {r.voidReason}
                </p>
              ) : (
                <p className="club-meta" data-testid="visitor-day">
                  {r.dayTotal} that day{r.dayFeeCents > 0 ? `, so the fee is ${formatMoney(r.dayFeeCents)}` : ", no fee"}.
                </p>
              )}
              {r.status === "recorded" && r.billedIn && (
                <p className="club-meta" data-testid="visitor-billed">
                  Billed in {r.billedIn}. It can no longer be voided: add an adjustment instead.
                </p>
              )}
              {r.canVoid && <VoidForm kind="visitors" id={r.id} label={`${r.memberName}'s ${r.visitors} visitors on ${formatDay(r.day)}`} />}
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link href="/club/admin">Back to the staff office</Link>
      </p>
    </section>
  );
}
