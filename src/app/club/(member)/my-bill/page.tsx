import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { type HouseholdBillMonth, householdBill, householdBillMonth } from "@/club/engine/billing-views";
import { formatMoney } from "@/club/engine/billing-words";
import { householdOf } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { canViewHousehold, getCurrentActor } from "@/club/identity";
import { BILLING_RULES } from "@/club/settings/billing-rules";
import { getClubStore } from "@/club/store/instance";
import { formatDay, pacificDate } from "@/club/time";
import { SignedOut } from "../SignedOut";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

function BillLines({ month }: { month: HouseholdBillMonth }) {
  if (month.lines.length === 0) {
    return <p data-testid="bill-empty">Nothing on this month&apos;s bill yet.</p>;
  }
  return (
    <>
      <ul className="club-list" aria-label={`${month.label} charges`} data-testid="bill-lines">
        {month.lines.map((l, i) => (
          <li key={i} data-testid="bill-line" data-kind={l.kind}>
            {l.description} · <span className="club-money">{formatMoney(l.amountCents)}</span>
            {l.amountCents < 0 ? " · credit" : ""}
          </li>
        ))}
      </ul>
      <p data-testid="bill-total">
        Total · <strong className="club-money">{formatMoney(month.totalCents)}</strong>
      </p>
    </>
  );
}

function MonthCard({ month, href }: { month: HouseholdBillMonth; href: string }) {
  return (
    <li className="club-card" data-testid={month.status === "closed" ? "closed-bill" : "awaiting-bill"} data-month={month.month}>
      <h3>
        <Link href={href}>{month.label}</Link>
        {" · "}
        <span className="club-money">{formatMoney(month.totalCents)}</span>
      </h3>
      <p className="club-meta">
        {month.status === "closed"
          ? `Invoice ${month.invoiceNo} · closed${month.closedAt ? ` on ${formatDay(pacificDate(new Date(month.closedAt)))}` : ""}`
          : "Not billed yet · these lines will go on the next monthly invoice"}
      </p>
    </li>
  );
}

/**
 * A member's household bill: this month so far, any earlier months not yet closed, and every closed invoice. Read only.
 * Staff acting as a member see that member's household; staff can also open a household from the desk with ?household=.
 */
export default async function MyBillPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;

  const params = await searchParams;
  const askedHousehold = one(params.household);
  const askedMonth = one(params.month);
  const state = await (await getClubStore()).read();
  const now = clubNow();

  let householdId: string | null = null;
  if (actor.kind === "member") {
    // A member only ever sees their own household. A forged ?household= for someone else looks like a missing page.
    if (askedHousehold && askedHousehold !== actor.household.id) notFound();
    householdId = actor.household.id;
  } else if (askedHousehold) {
    const household = householdOf(state, askedHousehold);
    if (!household || !canViewHousehold(actor, household.id)) notFound();
    householdId = household.id;
  } else {
    return (
      <section>
        <h1>My bill</h1>
        <p>
          Members see their household&apos;s charges here. Staff who are looking up one household can open its bill from that household&apos;s page, or{" "}
          <Link href="/club/act-as">act as a test member</Link> to see the screen the way they would. To close a month and make the QuickBooks files, use{" "}
          <Link href="/club/admin/billing">Monthly billing</Link>.
        </p>
      </section>
    );
  }

  const view = householdBill(state, BILLING_RULES, householdId, now);
  if (!view) notFound();

  const focused = askedMonth ? householdBillMonth(view, askedMonth) : null;
  if (askedMonth && !focused) notFound();

  const backHref = actor.kind === "staff" ? `/club/my-bill?household=${householdId}` : "/club/my-bill";
  const monthHref = (month: string) => {
    const q = new URLSearchParams();
    if (actor.kind === "staff") q.set("household", householdId!);
    q.set("month", month);
    return `/club/my-bill?${q.toString()}`;
  };

  if (focused) {
    return (
      <section>
        <h1>My bill</h1>
        <p className="club-meta" data-testid="bill-household">
          {view.householdName}
        </p>
        {view.placeholder && (
          <p className="club-placeholder" data-testid="placeholder-note">
            <strong>Placeholder numbers.</strong> The dues, the visitor fee and the other amounts are stand-ins until club staff and the bookkeeper confirm them.
          </p>
        )}
        <h2 data-testid="bill-month-heading">
          {focused.label}
          {focused.status === "open" ? " · so far" : " · billed"}
        </h2>
        {focused.status === "closed" && (
          <p className="club-meta" data-testid="closed-bill-meta">
            Invoice {focused.invoiceNo}
            {focused.closedAt ? ` · closed on ${formatDay(pacificDate(new Date(focused.closedAt)))}` : ""}
            {focused.closedBy ? ` by ${focused.closedBy}` : ""}. These lines are frozen.
          </p>
        )}
        {focused.status === "open" && focused.month === view.current.month && (
          <p data-testid="open-bill-note">These are the charges that will go on {focused.label}&apos;s invoice when staff close the month. Nothing here can be changed from this screen.</p>
        )}
        {focused.status === "open" && focused.month !== view.current.month && (
          <p data-testid="awaiting-bill-note">This month has finished, but staff have not closed it yet. These lines will go on the invoice when they do.</p>
        )}
        <BillLines month={focused} />
        <p className="club-meta">
          <Link href={backHref} data-testid="bill-back">
            Back to My bill
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1>My bill</h1>
      <p>
        What {view.householdName} will be charged on the monthly invoice: dues, event tickets, visitor fees, and bar and snack-bar charges. This screen is read-only. Ask club staff if something looks wrong.
      </p>
      {view.placeholder && (
        <p className="club-placeholder" data-testid="placeholder-note">
          <strong>Placeholder numbers.</strong> The dues, the visitor fee and the other amounts are stand-ins until club staff and the bookkeeper confirm them.
        </p>
      )}

      <h2 data-testid="current-month-heading">{view.current.label} · so far</h2>
      <p data-testid="open-bill-note">Running total for this month. It will be frozen when staff close {view.current.label}.</p>
      <BillLines month={view.current} />

      {view.awaiting.length > 0 && (
        <>
          <h2>Earlier months, not billed yet</h2>
          <p className="club-meta">These months have finished, but staff have not closed them yet.</p>
          <ul className="club-cards" aria-label="Earlier months not billed yet" data-testid="awaiting-bills">
            {view.awaiting.map((m) => (
              <MonthCard key={m.month} month={m} href={monthHref(m.month)} />
            ))}
          </ul>
        </>
      )}

      <h2>Past bills</h2>
      {view.closed.length === 0 ? (
        <p data-testid="no-closed-bills">No month has been billed for this household yet.</p>
      ) : (
        <ul className="club-cards" aria-label="Past bills" data-testid="closed-bills">
          {view.closed.map((m) => (
            <MonthCard key={m.month} month={m} href={monthHref(m.month)} />
          ))}
        </ul>
      )}

      {actor.kind === "staff" && (
        <p className="club-meta">
          <Link href={`/club/household/${householdId}`}>Back to the household</Link>
          {" · "}
          <Link href="/club/admin/billing">Monthly billing</Link>
        </p>
      )}
    </section>
  );
}
