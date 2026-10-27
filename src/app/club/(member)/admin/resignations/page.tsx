import Link from "next/link";
import { notFound } from "next/navigation";
import { RESIGNATION_COLUMNS } from "@/club/engine/resignations";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { RESIGNATION_RULES } from "@/club/settings/resignation-rules";
import { SignedOut } from "../../SignedOut";
import { ResignationsForm } from "./ResignationsForm";

/** Staff only: move-out day. Upload a list of households that resigned, see exactly what ending them would do, then end them. */
export default async function ResignationsPage() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const max = RESIGNATION_RULES.defaults.maxHouseholdsPerFile;
  return (
    <section>
      <h1>End memberships from a file</h1>
      <p>
        For a batch of resignations. You will see exactly which households the file would end, and everything that would be cancelled, before anything happens. Each household ends today, the same way it does in the household desk: its adults are signed out and
        blocked from booking, their future bookings, class places and event RSVPs are cancelled, and the waiting lists move up behind them. Ending a membership is final. This tool only ever ends households: nobody is added or changed, and a household that has already
        ended is skipped.
      </p>
      <h2>Getting the file ready</h2>
      <ol className="club-list">
        <li>
          Start from <a href="/api/club/resignations/template" data-testid="resign-template">the blank template</a> (a CSV file you can open in Excel or Google Sheets). Delete its two example rows.
        </li>
        <li>
          <strong>One row for each household.</strong> Columns: {RESIGNATION_COLUMNS.map((c, i) => (
            <span key={c}>
              {i > 0 && ", "}
              <strong>{c}</strong>
              {c === "QuickBooks ID" ? " (required)" : " (optional)"}
            </span>
          ))}
          . Households are found by their QuickBooks ID, so a household with no QuickBooks ID has to be ended in the household desk.
        </li>
        <li>
          Please include the <strong>Household name</strong> too. It is checked against the name on file, so a mistyped ID can never end the wrong household. The <strong>Note</strong> (for example, why they left) is saved in the household&apos;s file.
        </li>
        <li>
          A file can end up to <strong>{max}</strong> households. Save it as CSV (in Excel: Save As, then CSV Comma delimited) and choose it below.
        </li>
      </ol>
      <p className="club-meta">
        Anything wrong in the file is listed with its row number, and nothing can be ended until it is fixed. Dates in the file are not used: households end the day you press the button. <Link href="/club/admin">Back to the staff office</Link>
      </p>
      <ResignationsForm />
    </section>
  );
}
