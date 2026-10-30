import Link from "next/link";
import { notFound } from "next/navigation";
import { EQUIPMENT_COLUMNS } from "@/club/engine/equipment-import";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { SignedOut } from "../../SignedOut";
import { EquipmentForm } from "./EquipmentForm";

/** Staff only: the unit list. Upload the sheet of the club's boats, kayaks, paddle boards and work rooms, see exactly what it would add, then add them. */
export default async function EquipmentImportPage() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const required = new Set(["Name", "Type", "Seats", "Owned by"]);
  return (
    <section>
      <h1>Load the equipment list</h1>
      <p>
        For putting the club&rsquo;s real boats, kayaks, paddle boards and work rooms into the booking system from a sheet staff prepared. You will see exactly what the file would add before anything is saved. This only ever adds: an item that is
        already here is left alone, so a second upload never changes or removes anything.
      </p>
      <h2>Getting the sheet ready</h2>
      <ol className="club-list">
        <li>
          Start from the starter sheet you were sent, or from <a href="/api/club/equipment/template" data-testid="equip-template">the blank template</a> (a CSV file you can open in Excel or Google Sheets). Delete the template&rsquo;s five example rows.
        </li>
        <li>
          <strong>One row for each item.</strong> Columns:{" "}
          {EQUIPMENT_COLUMNS.map((c, i) => (
            <span key={c}>
              {i > 0 && ", "}
              <strong>{c}</strong>
              {required.has(c) ? " (required)" : " (optional)"}
            </span>
          ))}
          . Columns that start with &ldquo;Hint&rdquo; are for your eyes and are not used.
        </li>
        <li>
          <strong>Type</strong> is Shell, Kayak, Paddle Board, Work Space, Dock Space, Room Space or Gym Space. <strong>Seats</strong> is 1, 2 or 4 for a shell and 1 or 2 for a kayak. <strong>Skill level needed</strong> can stay empty to use the boat class&rsquo;s usual level, or say None.{" "}
          <strong>Owned by</strong> is Club or Private. <strong>In service</strong> is Yes or No; a No item is added out of service, with its Notes as the reason.
        </li>
        <li>
          <strong>Private boats:</strong> only its owners, and the people they invite, can see or book a private boat, and its skill level is not checked. Put the owners in <strong>Owner emails</strong>, each as an email address or a full name, separated by semicolons (a shared email address needs the full name instead). A private boat with no owner is still added, but starts locked until you add an owner on the <Link href="/club/admin/boats">Private boats</Link> screen.
        </li>
        <li>
          <strong>Pools:</strong> a Dock Space, Room Space or Gym Space row is one pool of places, like a parking lot: put how many people it holds at once in <strong>Places</strong> (1 to 500) and leave Seats and Owner emails empty. Members book a time and see how many places are left; nobody is given a place number. A class running in a room takes the whole room while it runs.
        </li>
        <li>Save it as CSV (in Excel: Save As, then CSV Comma delimited) and choose it below.</li>
      </ol>
      <p className="club-meta">
        Anything wrong in the file is listed with its row number, and nothing can be added until it is fixed. <Link href="/club/admin">Back to the Staff office</Link>
      </p>
      <EquipmentForm />
    </section>
  );
}
