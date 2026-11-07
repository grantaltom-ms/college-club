-- Monthly membership counts for the Membership tab: one row per month.
-- Run this once in the Supabase SQL editor for the College Club project.
--
-- Counts only. No member names are stored here, so the tab can stay public
-- like the rest of the dashboard.
--
-- Source: the Membership Committee's "Membership Count" workbooks in the
-- Board Shared File (OneDrive), Total Dues Paying row of each monthly sheet,
-- plus the committee's trend workbook for the reason and category columns.
-- Columns: previous_total is the previous month's total, resignations are
-- the members who left, applicants_for_approval are the new members up for
-- approval, transferred counts category moves, with_months_approvals is the
-- sheet's own total after that month's approvals (the DUES-PAYING total), and
-- waitlist is the waitlist count where the sheet shows one.
--
-- The reason and category columns (added Nov 2026) come from the trend
-- workbook:
--   resignations_moved, resignations_not_using, resignations_other: why the
--     members who left, left. They can add up to one more or one less than
--     the month's resignations (the row's note says so). Left empty (null)
--     for a month the workbook does not cover (Jun 2025); a gap, not zero.
--   cat_resident, cat_intermediate, cat_nonresident, cat_suburban,
--     cat_honorary: the members in each category that month.
--   total_all_categories: the five categories added together. It is NOT the
--     same count as with_months_approvals (dues-paying): it includes the
--     Suburban and Honorary members. Never treat them as one series.
-- There is deliberately no applications or sign-ups column.
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
  resignations_moved integer,
  resignations_not_using integer,
  resignations_other integer,
  cat_resident integer,
  cat_intermediate integer,
  cat_nonresident integer,
  cat_suburban integer,
  cat_honorary integer,
  total_all_categories integer,
  note text,
  unique (year, month)
);

-- A table made before the reason and category columns existed keeps its old
-- shape under "create table if not exists", so add the nine new columns to it.
-- Safe to run on a table that already has them.
alter table public.membership_monthly
  add column if not exists resignations_moved integer,
  add column if not exists resignations_not_using integer,
  add column if not exists resignations_other integer,
  add column if not exists cat_resident integer,
  add column if not exists cat_intermediate integer,
  add column if not exists cat_nonresident integer,
  add column if not exists cat_suburban integer,
  add column if not exists cat_honorary integer,
  add column if not exists total_all_categories integer;

create index if not exists membership_monthly_year_month_idx on public.membership_monthly (year, month);

-- Locked to the server: row level security with no policies means only the
-- service role key (set in Vercel, never in the browser) can read it.
alter table public.membership_monthly enable row level security;

-- To load or refresh:
--   1. truncate public.membership_monthly;
--   2. Import db/membership_monthly.csv (28 months, Jul 2024 to Oct 2026) into
--      the table with the Supabase Table Editor, matching columns by name (an
--      empty transferred, waitlist, reason or category cell loads as null).
-- Until this table is loaded, the Membership tab shows a plain
-- "could not be loaded" message and the rest of the site is unaffected. Until
-- the nine new columns are filled, the "Why members leave" and "Membership
-- mix" sections say their figures are not loaded yet.
