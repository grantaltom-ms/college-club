import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { chargeRows, householdChoices } from "@/club/engine/billing-views";
import { formatMoney } from "@/club/engine/billing-words";
import { snackBarMonth, snackCountWords } from "@/club/engine/snacks";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { formatDay, pacificDate } from "@/club/time";
import { SignedOut } from "../../SignedOut";
import { VoidForm } from "../VoidForm";
import { ChargeForm } from "./ChargeForm";

/** Staff only: bar and snack-bar sales, and adjustments, entered on a household's account. */
export default async function ChargesPage() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const state = await (await getClubStore()).read();
  const rows = chargeRows(state);
  const snacks = snackBarMonth(state, pacificDate(clubNow()));
  return (
    <section>
      <h1>Charges</h1>
      <p>
        Bar and snack-bar sales, and adjustments (a credit, or an extra charge), go on a household&apos;s account here. Each is billed in the month of the day it happened, on that household&apos;s invoice for the month.
        Once a month is closed, nothing can be dated in it: put a mistake right with an adjustment dated today. <Link href="/club/admin/billing">Monthly billing</Link>
      </p>
      <p data-testid="snack-month">
        {snacks.purchases === 0
          ? `Snack bar iPad, ${snacks.label}: nothing has been put on accounts yet.`
          : `Snack bar iPad, ${snacks.label}: ${snackCountWords(snacks.items)} in ${snacks.purchases} ${snacks.purchases === 1 ? "purchase" : "purchases"}, ${formatMoney(snacks.totalCents)}. Members add these themselves; void a wrong one below.`}
      </p>
      <h2>Add a charge</h2>
      <ChargeForm households={householdChoices(state)} today={pacificDate(clubNow())} />
      <h2>Recent charges</h2>
      {rows.length === 0 ? (
        <p data-testid="no-charges">No charges have been entered yet.</p>
      ) : (
        <ul className="club-cards" aria-label="Recent charges" data-testid="charges">
          {rows.map((r) => (
            <li key={r.id} className="club-card" data-testid="charge-row" data-status={r.status}>
              <h3>
                {r.householdName} · <span className="club-money">{formatMoney(r.amountCents)}</span>
              </h3>
              <p className="club-meta">
                {r.kindLabel} · {formatDay(r.day)}
                {r.memberName ? ` · ${r.memberName}'s tab` : ""} · entered by {r.enteredBy}
              </p>
              <p>{r.description}</p>
              {r.status === "voided" && (
                <p className="club-meta" data-testid="charge-voided">
                  Voided: {r.voidReason}
                </p>
              )}
              {r.status === "open" && r.billedIn && (
                <p className="club-meta" data-testid="charge-billed">
                  Billed in {r.billedIn}. It can no longer be voided: add an adjustment instead.
                </p>
              )}
              {r.canVoid && <VoidForm kind="charge" id={r.id} label={`${r.householdName}'s ${formatMoney(r.amountCents)} charge`} />}
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
