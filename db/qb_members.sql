-- The QuickBooks member list, which is the roster for the dashboard.
-- Run this once in the Supabase SQL editor for the College Club project, then load the rows
-- (see "To load or refresh" below). The dashboard refuses to load until this table has rows.
--
-- One row is one QuickBooks record, which is one household. Each row says which usage record
-- (a `members.member_name`) its visits come from. The member list holds names, so it is never
-- committed to the repository and never sent to the browser: only the server reads it.

create table if not exists public.qb_members (
  id bigint generated always as identity primary key,
  qb_name text not null,
  qb_member_type text not null check (qb_member_type in ('Resident', 'Intermediate', 'Non-Resident')),
  qb_member_number text,
  -- QuickBooks stamped everyone who existed when it was loaded with 2019-10-18, so that day means "on or before".
  qb_created_on date not null,
  qb_company_field text,
  -- matched, household_partner and spelling take visits from usage_member_name. door_only_no_icrew has a door
  -- fob but no reservation record, so door_entries_if_door_only stands in for visit days. no_record counts as no visits.
  link text not null check (link in ('matched', 'household_partner', 'spelling', 'door_only_no_icrew', 'no_record')),
  usage_member_name text,
  door_entries_if_door_only integer,
  note text,
  -- The day this QuickBooks list was taken.
  roster_as_of date not null,
  check (link not in ('matched', 'household_partner', 'spelling') or usage_member_name is not null),
  check (link <> 'door_only_no_icrew' or door_entries_if_door_only is not null)
);

-- No usage record may feed two QuickBooks records, or its visits would be counted twice.
create unique index if not exists qb_members_usage_member_name_key
  on public.qb_members (usage_member_name)
  where usage_member_name is not null;

-- Locked to the server: row level security with no policies means only the
-- service role key (set in Vercel, never in the browser) can read it.
alter table public.qb_members enable row level security;

-- To load or refresh with a new QuickBooks list:
--   1. truncate public.qb_members;
--   2. Insert the new rows (the Table Editor's CSV import works, or an insert script kept outside the repository).
