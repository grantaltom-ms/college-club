-- What each member said they are interested in, from their membership application (Nov 18, 2026), for the list builder's
-- "interested in" filter. Run this once in the Supabase SQL editor for the College Club project.
--
-- One row per household and interest ("rowing", "learning to row" is loaded as "rowing", "happy hours & socials" ...).
-- This table holds member names, so it is never sent to anyone but a browser holding the list builder password.
-- Row level security is on with no policies. The rows themselves (with names) are kept outside this repo.
--
-- Columns:
--   member_name    the household's name exactly as in qb_members.qb_name
--   member_number  the QuickBooks member number (qb_members.qb_member_number), when known; matched first
--   interest       the interest, in a few words; the builder compares it in lower case
--   source         where it came from: application (the default), survey or staff
--   as_of          the day the answer was given or loaded
--
-- Add new members' answers as new rows. The Mailchimp interest groups are read live and added on top.
create table if not exists public.member_interests (
  id bigint generated always as identity primary key,
  member_name text not null,
  member_number text,
  interest text not null check (char_length(interest) between 1 and 80),
  source text not null default 'application' check (source in ('application', 'survey', 'staff')),
  as_of date not null default current_date,
  unique (member_name, interest)
);

alter table public.member_interests enable row level security;
