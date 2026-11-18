-- Saved email lists, for the list builder at the top of the Email page (Nov 18, 2026).
-- Run this once in the Supabase SQL editor for the College Club project.
--
-- One row per saved list: its name, what the person typed, the filters it stands for, and the Mailchimp tag it keeps up to
-- date. It holds no member names or addresses: those are worked out again from qb_members, members, member_interests,
-- member_rowing and Mailchimp every time the list is refreshed (every night, and before a draft is made).
-- Row level security is on with no policies, so only the server's secret key reads or writes it.
create table if not exists public.saved_email_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  request text not null default '' check (char_length(request) <= 1000),
  rule jsonb not null,
  mailchimp_tag_id bigint not null,
  mailchimp_tag_name text not null,
  households integer not null default 0 check (households >= 0),
  emails integer not null default 0 check (emails >= 0),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  last_draft_url text,
  last_draft_at timestamptz,
  unique (mailchimp_tag_id)
);

create unique index if not exists saved_email_lists_name_key on public.saved_email_lists (lower(name));

alter table public.saved_email_lists enable row level security;
