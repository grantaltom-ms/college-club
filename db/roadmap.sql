-- Tables for the Goals page (roadmap items and their notes).
-- Run this once in the Supabase SQL editor for the College Club project, then run
-- db/roadmap_seed.sql to load the starting content.
--
-- Both tables are locked to the server: row level security is on with no policies, so only
-- the service role key (set in Vercel, never in the browser) can read or change them.

create table if not exists public.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  -- A subitem points at its parent; deleting the parent deletes its subitems.
  parent_id uuid references public.roadmap_items (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  group_name text check (char_length(group_name) <= 80),
  status text not null default 'Not started' check (status in ('Not started', 'In progress', 'Waiting', 'Done')),
  due_date date,
  owner text check (char_length(owner) <= 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roadmap_items_parent_idx on public.roadmap_items (parent_id);

create table if not exists public.roadmap_notes (
  id uuid primary key default gen_random_uuid(),
  -- Deleting an item deletes its notes.
  item_id uuid not null references public.roadmap_items (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists roadmap_notes_item_idx on public.roadmap_notes (item_id, created_at desc);

alter table public.roadmap_items enable row level security;
alter table public.roadmap_notes enable row level security;
