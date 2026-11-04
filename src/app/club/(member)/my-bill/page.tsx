import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { type HouseholdBillMonth, type HouseholdBillView, householdBill, householdBillMonth } from "@/club/engine/billing-views";
import { formatMoney } from "@/club/engine/billing-words";
import { householdOf } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { canViewHousehold, getCurrentActor } from "@/club/identity";
import { BILLING_RULES } from "@/club/settings/billing-rules";
import { getClubStore } from "@/club/store/instance";
import { formatDay, pacificDate } from "@/club/time";
import { SignedOut } from "../SignedOut";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

function BillHeader({
  householdName,
  monthLabel,
  totalCents,
  monthTestId,
}: {
  householdName: string;
  monthLabel: string;
  totalCents: number;
  monthTestId?: string;
}) {
  return (
    <header className="club-bill-head">
      <p className="club-bill-eyebrow">My bill</p>
      <h1 className="sr-only">My bill</h1>
      <p className="club-bill-household" data-testid="bill-household">
        {householdName.replace(/^The\s+/i, "").replace(/\s+household$/i, "")} household
      </p>
      <div className="club-bill-head-row">
        <div>
          <p className="club-bill-month" data-testid={monthTestId}>
            {monthLabel}
          </p>
          <span className="club-bill-sun-rule" aria-hidden="true" />
        </div>
        <p className="club-bill-total" data-testid="bill-total" aria-label={`Total ${formatMoney(totalCents)}`}>
          {formatMoney(totalCents)}
        </p>
      </div>
    </header>
  );
}

function BillLines({ month }: { month: HouseholdBillMonth }) {
  if (month.lines.length === 0) {
    return <p className="club-bill-empty" data-testid="bill-empty">Nothing on this month&apos;s bill yet.</p>;
  }
  return (
    <ul className="club-bill-lines" aria-label={`${month.label} charges`} data-testid="bill-lines">
      {month.lines.map((l, i) => (
        <li key={i} className="club-bill-line" data-testid="bill-line" data-kind={l.kind}>
          <span className="club-bill-line-desc">
            {l.description}
            {l.amountCents < 0 ? " · credit" : ""}
          </span>
          <span className="club-bill-line-amt club-money">{formatMoney(l.amountCents)}</span>
        </li>
      ))}
    </ul>
  );
}

function MonthRow({ month, href }: { month: HouseholdBillMonth; href: string }) {
  return (
    <li className="club-bill-month-row" data-testid={month.status === "closed" ? "closed-bill" : "awaiting-bill"} data-month={month.month}>
      <span className="club-bill-dot" aria-hidden="true" />
      <div className="club-bill-month-main">
        <Link href={href} className="club-bill-month-link">
          {month.label}
        </Link>
        <p className="club-bill-month-meta">
          {month.status === "closed"
            ? `Invoice ${month.invoiceNo} · closed${month.closedAt ? ` on ${formatDay(pacificDate(new Date(month.closedAt)))}` : ""}`
            : "Not billed yet · goes on the next monthly invoice"}
        </p>
      </div>
      <span className="club-bill-line-amt club-money">{formatMoney(month.totalCents)}</span>
    </li>
  );
}

function PlaceholderNote() {
  return (
    <p className="club-bill-note" data-testid="placeholder-note">
      <strong>Placeholder numbers.</strong> The dues, the visitor fee and the other amounts are stand-ins until club staff and the bookkeeper confirm them.
    </p>
  );
}

function BillShell({
  view,
  month,
  monthTestId,
  note,
  children,
}: {
  view: HouseholdBillView;
  month: HouseholdBillMonth;
  monthTestId?: string;
  note?: ReactNode;
  children?: ReactNode;
}) {
  const monthLabel = month.status === "closed" ? `${month.label} · billed` : `${month.label} · so far`;
  return (
    <article className="club-bill">
      <BillHeader householdName={view.householdName} monthLabel={monthLabel} totalCents={month.totalCents} monthTestId={monthTestId} />
      {note}
      <BillLines month={month} />
      {view.placeholder && <PlaceholderNote />}
      {children}
    </article>
  );
}

/**
 * A member's household bill: this month so far, any earlier months not yet closed, and every closed invoice. Read only.
 * Staff acting as a member see that member's household; staff can also open a household from the desk with ?household=.
 * Look: "dock receipt" — dark header with the total, then a tight list of lines (My bill only).
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
    const note =
      focused.status === "closed" ? (
        <p className="club-bill-status" data-testid="closed-bill-meta">
          Invoice {focused.invoiceNo}
          {focused.closedAt ? ` · closed on ${formatDay(pacificDate(new Date(focused.closedAt)))}` : ""}
          {focused.closedBy ? ` by ${focused.closedBy}` : ""}. These lines are frozen.
        </p>
      ) : focused.month === view.current.month ? (
        <p className="club-bill-status" data-testid="open-bill-note">
          These charges go on the invoice when staff close {focused.label}. Nothing here can be changed from this screen.
        </p>
      ) : (
        <p className="club-bill-status" data-testid="awaiting-bill-note">
          This month has finished, but staff have not closed it yet. These lines will go on the invoice when they do.
        </p>
      );

    return (
      <BillShell view={view} month={focused} monthTestId="bill-month-heading" note={note}>
        <p className="club-bill-foot">
          <Link href={backHref} data-testid="bill-back">
            Back to My bill
          </Link>
        </p>
      </BillShell>
    );
  }

  return (
    <BillShell
      view={view}
      month={view.current}
      monthTestId="current-month-heading"
      note={
        <p className="club-bill-status" data-testid="open-bill-note">
          Running total for this month. It will be frozen when staff close {view.current.label}.
        </p>
      }
    >
      {view.awaiting.length > 0 && (
        <section className="club-bill-section" aria-labelledby="awaiting-heading">
          <h2 id="awaiting-heading" className="club-bill-section-title">
            Waiting to be billed
          </h2>
          <ul className="club-bill-months" aria-label="Earlier months not billed yet" data-testid="awaiting-bills">
            {view.awaiting.map((m) => (
              <MonthRow key={m.month} month={m} href={monthHref(m.month)} />
            ))}
          </ul>
        </section>
      )}

      <section className="club-bill-section" aria-labelledby="past-heading">
        <h2 id="past-heading" className="club-bill-section-title">
          Past bills
        </h2>
        {view.closed.length === 0 ? (
          <p className="club-bill-empty" data-testid="no-closed-bills">
            No month has been billed for this household yet.
          </p>
        ) : (
          <ul className="club-bill-months" aria-label="Past bills" data-testid="closed-bills">
            {view.closed.map((m) => (
              <MonthRow key={m.month} month={m} href={monthHref(m.month)} />
            ))}
          </ul>
        )}
      </section>

      {actor.kind === "staff" && (
        <p className="club-bill-foot">
          <Link href={`/club/household/${householdId}`}>Back to the household</Link>
          {" · "}
          <Link href="/club/admin/billing">Monthly billing</Link>
        </p>
      )}
    </BillShell>
  );
}
