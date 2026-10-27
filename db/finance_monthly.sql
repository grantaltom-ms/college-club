-- Monthly profit-and-loss figures for the Financials tab: one row per month.
-- Run this once in the Supabase SQL editor for the College Club project.
--
-- Organizational aggregates only. No member names are stored here, so the
-- tab can stay public like the rest of the dashboard.
--
-- Source: the Finance Committee's "CCS Board Reporting Package" workbooks in
-- the Board Shared File (OneDrive), month P&L sheet of each package, plus
-- the package's labeled fiscal year-to-date figures. Columns: income is
-- Total Income, cogs is Total Cost of Goods Sold, gross_profit is Gross
-- Profit, expenses is Total Expenses, net_operating_income is Net Operating
-- Income, other_income and other_expenses are Total Other Income and Total
-- Other Expenses, net_other_income is Net Other Income, net_income is Net
-- Income, depreciation is Total Depreciation Expense, and
-- labeled_ytd_income / labeled_ytd_net_income are the package's own fiscal
-- year-to-date figures for that month.
--
-- The figures are copied exactly as shown in the packages, even where a
-- package's labeled year-to-date figures do not match the sum of its monthly
-- sheets (see the flags on the Financials page). Do not "fix" a row here:
-- fix the package, then reload this table.

create table if not exists public.finance_monthly (
  id bigint generated always as identity primary key,
  year smallint not null,
  month smallint not null check (month between 1 and 12),
  income numeric(12, 2) not null,
  cogs numeric(12, 2) not null,
  gross_profit numeric(12, 2) not null,
  expenses numeric(12, 2) not null,
  net_operating_income numeric(12, 2) not null,
  other_income numeric(12, 2) not null,
  other_expenses numeric(12, 2) not null,
  net_other_income numeric(12, 2) not null,
  net_income numeric(12, 2) not null,
  depreciation numeric(12, 2) not null,
  labeled_ytd_income numeric(12, 2) not null,
  labeled_ytd_net_income numeric(12, 2) not null,
  source_file text not null,
  note text,
  unique (year, month)
);

create index if not exists finance_monthly_year_month_idx on public.finance_monthly (year, month);

-- Locked to the server: row level security with no policies means only the
-- service role key (set in Vercel, never in the browser) can read it.
alter table public.finance_monthly enable row level security;

-- To load or refresh:
--   1. truncate public.finance_monthly;
--   2. Import db/finance_monthly.csv into the table with the Supabase
--      Table Editor (an empty note cell loads as null).
-- Until this table is loaded, the Financials tab shows a plain
-- "could not be loaded" message and the rest of the site is unaffected.
