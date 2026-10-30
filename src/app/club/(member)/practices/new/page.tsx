import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { activeCoaches, canRunPractices, reservableBoats } from "@/club/engine/practices";
import { requireClub } from "@/club/guard";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { PRACTICE_RULES } from "@/club/settings/practice-rules";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { pacificDate } from "@/club/time";
import { PracticePlaceholderNote } from "../../PlaceholderNote";
import { SignedOut } from "../../SignedOut";
import { NewPracticeForm } from "../PracticeForms";

/** Coaches and staff set up a practice: when, which boats to reserve, and who runs it. Anyone else gets "page not found". */
export default async function NewPracticePage() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  const state = await (await getClubStore()).read();
  if (!canRunPractices(state, toEngineActor(actor))) notFound();
  const limits = PRACTICE_RULES.defaults;

  return (
    <section>
      <h1>Set up a practice</h1>
      <p>
        <Link href="/club/practices">Back to practices</Link>
      </p>
      <PracticePlaceholderNote />
      <NewPracticeForm
        boats={reservableBoats(state, RULE_BOOK)}
        coaches={activeCoaches(state)}
        canNameCoach={actor.kind === "staff"}
        today={pacificDate(clubNow())}
        limits={{ name: limits.nameMax, notes: limits.notesMax, boats: limits.maxBoats }}
      />
    </section>
  );
}
