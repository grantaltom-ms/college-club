import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { clubNow } from "@/club/clock";
import { snackThanks, snackPriceWords } from "@/club/engine/snacks";
import { snackPath } from "@/club/engine/ipad-address";
import { householdOf, memberById } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { snackCodeIsGenuine } from "@/club/identity";
import { SNACK_RULES } from "@/club/settings/snack-rules";
import { getClubStore } from "@/club/store/instance";
import { idParam, NOTICES } from "@/club/web";
import { AutoReturn } from "../../../ipad/AutoReturn";
import { SnackForm } from "../../SnackForm";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/** A thank-you is only shown for a purchase this fresh, so a bookmarked or reloaded address cannot replay old ones. */
const THANKS_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * The honor snack bar iPad, step two: how many snacks? The price is stated first and the total is in the button. Pressing it
 * adds one charge to the member's household account, then this page shows a thank-you and, a few seconds later, the iPad goes
 * back to its start for the next person. Looking at the page records nothing; only the button does.
 */
export default async function SnackMember({ params, searchParams }: { params: Promise<{ code: string; memberId: string }>; searchParams: Promise<Search> }) {
  await requireClub();
  const { code, memberId } = await params;
  if (!snackCodeIsGenuine(code)) notFound();
  if (!idParam(memberId)) notFound();

  const now = clubNow();
  const query = await searchParams;
  const state = await (await getClubStore()).read();
  const member = memberById(state, memberId);
  const household = member ? householdOf(state, member.householdId) : undefined;
  if (!member || member.status !== "active" || household?.status !== "active") redirect(snackPath(code));

  const rules = SNACK_RULES.defaults;
  const doneId = idParam(one(query.done));
  const done = doneId
    ? state.charges.find((c) => c.id === doneId && c.memberId === memberId && c.category === "snack_bar" && c.createdBy.kind === "member" && c.status === "open" && now.getTime() - Date.parse(c.createdAt) < THANKS_MAX_AGE_MS)
    : undefined;

  if (done) {
    return (
      <section>
        <h1>Thank you</h1>
        <p className="club-success ipad-note" role="status" data-testid="snack-done">
          {snackThanks(member.firstName, done)}
        </p>
        <AutoReturn href={snackPath(code)} seconds={rules.thankYouSeconds} strict />
      </section>
    );
  }

  const notice = NOTICES[one(query.notice)];
  return (
    <section>
      <h1>Hi, {member.firstName}</h1>
      {notice && (
        <p className="club-alert ipad-note" role="alert" data-testid="ipad-notice">
          {notice}
        </p>
      )}
      <p className="ipad-done" data-testid="snack-price">
        {snackPriceWords(SNACK_RULES)}
      </p>
      <SnackForm code={code} memberId={memberId} token={randomUUID()} max={rules.itemsPerEntryMax} priceCents={rules.priceCents} action="/api/club/snacks" />
      <p>
        <a className="ipad-back" href={snackPath(code)}>
          That is not me
        </a>
      </p>
      <AutoReturn href={snackPath(code)} seconds={rules.idleSeconds} />
    </section>
  );
}
