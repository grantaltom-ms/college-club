-- Monthly membership counts for the Membership tab: one row per month.
-- Run this once in the Supabase SQL editor for the College Club project.
--
-- Counts only. No member names are stored here, so the tab can stay public
-- like the rest of the dashboard.
--
-- Source: the Membership Committee's "Membership Count" workbooks in the
-- Board Shared File (OneDrive), Total Dues Paying row of each monthly sheet.
-- Columns: previous_total is the previous month's total, resignations are
-- the members who left, applicants_for_approval are the new members up for
-- approval, transferred counts category moves, with_months_approvals is the
-- sheet's own total after that month's approvals, and waitlist is the
-- waitlist count where the sheet shows one.
--
-- The figures are copied exactly as shown in the workbooks, even where a
-- sheet does not add up (see the flags on the Membership page). Do not
-- "fix" a row here: fix the workbook, then reload this table.

create table if not exists public.membership_monthly (
  id bigint generated always as identity primary key,
  year smallint not null,
  month smallint not null check (month between 1 and 12),
  previous_total integer not null,
  resignations integer not null,
  applicants_for_approval integer not null,
  transferred integer,
  with_months_approvals integer not null,
  waitlist integer,
  note text,
  unique (year, month)
);

create index if not exists membership_monthly_year_month_idx on public.membership_monthly (year, month);

-- Locked to the server: row level security with no policies means only the
-- service role key (set in Vercel, never in the browser) can read it.
alter table public.membership_monthly enable row level security;

-- To load or refresh:
--   1. truncate public.membership_monthly;
--   2. Import db/membership_monthly.csv into the table with the Supabase
--      Table Editor (an empty transferred or waitlist cell loads as null).
-- Until this table is loaded, the Membership tab shows a plain
-- "could not be loaded" message and the rest of the site is unaffected.
