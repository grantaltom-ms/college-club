import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { planBilling, suggestedMonth, type PlannedInvoice } from "@/club/engine/billing";
import { qboInvoiceFiles } from "@/club/engine/billing-files";
import { closedInvoices, closedMonths, linesComplete } from "@/club/engine/billing-views";
import { formatMoney, isMonth, monthLabel } from "@/club/engine/billing-words";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { BILLING_RULES } from "@/club/settings/billing-rules";
import { getClubStore } from "@/club/store/instance";
import { formatDay, pacificDate } from "@/club/time";
import { SignedOut } from "../../SignedOut";
import { CloseMonthForm } from "./CloseMonthForm";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/** How many households' invoices the page lists before saying "and N more". */
const LIST_LIMIT = 50;

function Invoices({ invoices, rules }: { invoices: PlannedInvoice[]; rules: typeof BILLING_RULES }) {
  return (
    <>
      <ul className="club-cards" aria-label="Invoices" data-testid="invoices">
        {invoices.slice(0, LIST_LIMIT).map((inv) => (
          <li key={inv.invoiceNo} className="club-card" data-testid="invoice">
            <h3>
              {inv.householdName} · <span className="club-money">{formatMoney(inv.totalCents)}</span>
            </h3>
            <p className="club-meta">
              Invoice {inv.invoiceNo} · QuickBooks ID {inv.quickbooksId ?? "none yet"}
            </p>
            <ul className="club-list">
              {inv.lines.map((l, i) => (
                <li key={i} data-testid="invoice-line">
                  {l.description} · <span className="club-money">{formatMoney(l.amountCents)}</span>
                  {l.taxable ? " · taxable" : ""}
                  {l.amountCents < 0 ? " · credit" : ""}
                  <span className="sr-only"> ({rules.defaults.items[l.kind]})</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {invoices.length > LIST_LIMIT && <p className="club-meta">&hellip;and {invoices.length - LIST_LIMIT} more invoices.</p>}
    </>
  );
}

/** Staff only: preview a month, close it, and download the QuickBooks files. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const asked = one((await searchParams).month);
  const month = isMonth(asked) ? asked : suggestedMonth(state, now);
  const closed = state.billingRuns.find((r) => r.month === month);
  const history = closedMonths(state);
  const rules = BILLING_RULES;

  return (
    <section>
      <h1>Monthly billing</h1>
      <p>
        Close a month that has finished to freeze every household&apos;s bill and make the files for QuickBooks. A bill is: monthly dues, event tickets for everyone who held spots, visitor fees, and bar and snack-bar charges. Months are closed in order, and a
        closed month is never reopened: put a mistake right with an <Link href="/club/admin/charges">adjustment</Link> dated today, and it goes on the next bill.
      </p>
      {rules.placeholder && (
        <p className="club-placeholder" data-testid="placeholder-note">
          <strong>Placeholder numbers and names.</strong> The dues, the visitor fee and the QuickBooks names are stand-ins until club staff and the bookkeeper confirm them.
        </p>
      )}

      <form method="get" className="club-form" data-testid="month-form">
        <p>
          <label htmlFor="billing-month">Month</label>
          <input id="billing-month" type="month" name="month" defaultValue={month} required />
        </p>
        <p>
          <button type="submit" className="club-button">
            Show this month
          </button>
        </p>
      </form>

      {closed ? <ClosedMonth state={state} runMonth={month} /> : <Preview state={state} month={month} now={now} />}

      <h2>Closed months</h2>
      {history.length === 0 ? (
        <p data-testid="no-closed-months">No month has been closed yet.</p>
      ) : (
        <ul className="club-list" data-testid="closed-months">
          {history.map((h) => (
            <li key={h.month} data-testid="closed-month">
              <Link href={`/club/admin/billing?month=${h.month}`}>{h.label}</Link> · {h.invoiceCount} invoice{h.invoiceCount === 1 ? "" : "s"} · {formatMoney(h.totalCents)} · closed by {h.closedBy} on {formatDay(pacificDate(new Date(h.createdAt)))}
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

function Preview({ state, month, now }: { state: Awaited<ReturnType<Awaited<ReturnType<typeof getClubStore>>["read"]>>; month: string; now: Date }) {
  const plan = planBilling(state, BILLING_RULES, month, now);
  const label = isMonth(month) ? monthLabel(month) : "That month";
  return (
    <>
      <h2>{label}: what closing it would do</h2>
      {plan.problems.length > 0 && (
        <section className="club-alert" role="alert" data-testid="billing-problems">
          <h3>{plan.problems.length === 1 ? "This month cannot be closed yet" : `${plan.problems.length} problems stop this month being closed`}</h3>
          <ul className="club-list">
            {plan.problems.slice(0, LIST_LIMIT).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          {plan.problems.length > LIST_LIMIT && <p className="club-meta">&hellip;and {plan.problems.length - LIST_LIMIT} more.</p>}
        </section>
      )}
      {plan.notices.length > 0 && (
        <div data-testid="billing-notices">
          <h3>Worth a look</h3>
          <ul className="club-list">
            {plan.notices.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.invoices.length > 0 || plan.problems.length === 0 ? (
        <>
          <p data-testid="billing-summary">
            {plan.invoices.length} invoice{plan.invoices.length === 1 ? "" : "s"}, <strong>{formatMoney(plan.totalCents)}</strong> in all
            {plan.creditLines > 0 ? `, including ${plan.creditLines} credit line${plan.creditLines === 1 ? "" : "s"} (${formatMoney(plan.creditCents)})` : ""}.
          </p>
          <Invoices invoices={plan.invoices} rules={BILLING_RULES} />
        </>
      ) : null}
      {plan.problems.length === 0 && <CloseMonthForm month={month} label={label} fingerprint={plan.fingerprint} />}
    </>
  );
}

function ClosedMonth({ state, runMonth }: { state: Awaited<ReturnType<Awaited<ReturnType<typeof getClubStore>>["read"]>>; runMonth: string }) {
  const run = state.billingRuns.find((r) => r.month === runMonth)!;
  if (!linesComplete(state, run)) {
    return (
      <>
        <h2>{monthLabel(runMonth)} is closed</h2>
        <p className="club-alert" role="alert" data-testid="lines-missing">
          Closed by {run.createdBy.label} on {formatDay(pacificDate(new Date(run.createdAt)))}: {run.invoiceCount} invoice{run.invoiceCount === 1 ? "" : "s"}, {formatMoney(run.totalCents)} in all. This month is older than the records loaded on this screen, so its invoices and files cannot be
          shown safely here. Ask for help.
        </p>
      </>
    );
  }
  const lines = state.billingLines.filter((l) => l.runId === run.id);
  const files = qboInvoiceFiles({ run, lines, households: state.households, rules: BILLING_RULES });
  const invoices = closedInvoices(state, run);
  const items = BILLING_RULES.defaults.items;
  return (
    <>
      <h2>{monthLabel(runMonth)} is closed</h2>
      <p data-testid="closed-summary">
        Closed by {run.createdBy.label} on {formatDay(pacificDate(new Date(run.createdAt)))}: {run.invoiceCount} invoice{run.invoiceCount === 1 ? "" : "s"}, <strong>{formatMoney(run.totalCents)}</strong> in all. These lines are frozen.
      </p>

      <h3>The files</h3>
      <ul className="club-list" data-testid="billing-files">
        {files.parts.map((part) => (
          <li key={part.number}>
            <a href={`/api/club/billing/${runMonth}/qbo/${part.number}`} data-testid="qbo-part">
              QuickBooks invoices, part {part.number} of {part.of}
            </a>{" "}
            ({part.invoices} invoice{part.invoices === 1 ? "" : "s"}, {part.rows} rows)
          </li>
        ))}
        {files.parts.length === 0 && <li data-testid="no-qbo-parts">There is nothing to import into QuickBooks for this month.</li>}
        <li>
          <a href={`/api/club/billing/${runMonth}/charges`} data-testid="charges-file">
            Plain charges file
          </a>{" "}
          (every line, credits and the tax flag included)
        </li>
      </ul>
      {files.creditLines > 0 && (
        <p className="club-placeholder" data-testid="credits-note">
          {files.creditLines} credit line{files.creditLines === 1 ? "" : "s"} ({formatMoney(files.creditCents)}) {files.creditLines === 1 ? "is" : "are"} not in the QuickBooks files, because QuickBooks does not import negative amounts. {files.creditLines === 1 ? "It is" : "They are"} in the plain
          charges file, to enter in QuickBooks by hand.
        </p>
      )}

      <h3>Importing into QuickBooks Online</h3>
      <ol className="club-list" data-testid="qbo-steps">
        <li>
          In QuickBooks Online choose Settings (the gear), then Import data, then Invoices. Upload each part, one at a time. QuickBooks takes up to 100 invoices and 1,000 rows in one file, which is why a big month comes in parts.
        </li>
        <li>On its matching screen the columns should line up on their own. Choose the date format MM/DD/YYYY.</li>
        <li>
          The customers must already exist in QuickBooks under the same names as the households, and these products or services under exactly these names:{" "}
          {Object.values(items)
            .filter((name, i, all) => all.indexOf(name) === i)
            .join(", ")}
          .
        </li>
        {BILLING_RULES.defaults.taxable.length === 0 ? (
          <li data-testid="billing-tax-note">
            These files charge no sales tax on any line. QuickBooks refuses invoice imports if sales tax is turned on in the account, so if an import is refused, ask the bookkeeper. The plain charges file has every line, for entering another way.
          </li>
        ) : (
          <li data-testid="billing-tax-note">QuickBooks cannot take sales tax in an import, and cannot import invoices at all if sales tax is turned on in the account. The plain charges file has every line, with a Taxable column, for entering another way.</li>
        )}
      </ol>

      <h3>Invoices</h3>
      <Invoices invoices={invoices} rules={BILLING_RULES} />
    </>
  );
}
