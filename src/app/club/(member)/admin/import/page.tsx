import Link from "next/link";
import { notFound } from "next/navigation";
import { ROSTER_COLUMNS } from "@/club/engine/roster";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { SignedOut } from "../../SignedOut";
import { ImportForm } from "./ImportForm";

/** Staff only: move-in day. Upload the club's roster, see exactly what it would add, then add it. */
export default async function ImportPage() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  return (
    <section>
      <h1>Import households</h1>
      <p>
        Load the club&apos;s roster from a spreadsheet. You will see exactly what the file would add before anything is saved, and the import only ever adds: a household that is already here is left alone, and nobody is ever
        removed.
      </p>
      <h2>Getting the file ready</h2>
      <ol className="club-list">
        <li>
          Start from <a href="/api/club/import/template" data-testid="import-template">the blank template</a> (a CSV file you can open in Excel or Google Sheets). Delete its three example rows.
        </li>
        <li>
          <strong>One row for each adult.</strong> Every adult in a household gets their own row, with the household&apos;s QuickBooks ID, household name, membership type and join date repeated on each of them.
        </li>
        <li>
          Columns: {ROSTER_COLUMNS.map((c, i) => (
            <span key={c}>
              {i > 0 && ", "}
              <strong>{c}</strong>
              {c === "Phone" || c === "Role" ? " (optional)" : ""}
            </span>
          ))}
          . Extra columns, such as the ones in a QuickBooks export, are ignored.
        </li>
        <li>
          Membership type is <strong>Resident</strong>, <strong>Intermediate</strong> or <strong>Non-Resident</strong>. Joined is written like <strong>2020-01-15</strong> or <strong>1/15/2020</strong>. Role is Primary or Additional: if you leave
          it blank, the first adult listed for a household is the primary adult.
        </li>
        <li>Save it as CSV (in Excel: Save As, then CSV Comma delimited) and choose it below.</li>
      </ol>
      <p className="club-meta">
        Anything wrong in the file is listed with its row number, and nothing can be added until it is fixed. Sign-in links go to the email address on each adult&apos;s row, so check those. <Link href="/club/admin">Back to the staff office</Link>
      </p>
      <ImportForm />
    </section>
  );
}
