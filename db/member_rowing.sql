-- How many times each member went out in a rowing shell over a period (Nov 18, 2026), for the list builder's "rowed" filters.
-- Run this once in the Supabase SQL editor for the College Club project.
--
-- One row per household that rowed in the period. A household with no row rowed 0 times in that period.
-- Counted from iCrew's reservations report: a person counts once per shell booking they reserved or are listed on as a rower.
-- This table holds member names, so it is server-only: row level security is on with no policies. The rows are kept outside
-- this repo. To change the period, delete every row and load the new period's rows (all rows share one period).
create table if not exists public.member_rowing (
  id bigint generated always as identity primary key,
  member_name text not null,
  member_number text,
  shell_outings integer not null check (shell_outings >= 0),
  period_from date not null,
  period_to date not null,
  check (period_from <= period_to),
  unique (member_name)
);

alter table public.member_rowing enable row level security;
