-- Named resignations, for the "Who resigns for not using it" section of the Membership page.
-- Run this once in the Supabase SQL editor for the College Club project.
--
-- One row per household that resigned. This table DOES hold member names, so it is never sent to the
-- browser: the dashboard's server joins it to the members table and sends only counts, averages and
-- percentages (src/lib/leavers.ts). Row level security is on with no policies, so nothing is readable
-- through the public API; only the server's secret key reads it.
--
-- Columns:
--   member_name  the name exactly as in members.member_name (the usage record the household's visits
--                come from). A name with no usage record is counted but cannot be compared.
--   resigned_on  the day the board accepted the resignation (the board meeting date).
--   reason       moved, not_using or other. Use not_using where the sheet says not using it / too busy,
--                or gives no reason and the person rarely used the club (under 1 visit day a month).
--   note         the reason as written on the board sheet. Stays on the server.
--
-- Add each month's resignations as new rows. Never truncate: past months are the history the
-- comparison grows from. The real rows (with names) are kept outside this repo.
create table if not exists public.resignations (
  id bigint generated always as identity primary key,
  member_name text not null,
  resigned_on date not null,
  reason text not null check (reason in ('moved', 'not_using', 'other')),
  note text,
  unique (member_name, resigned_on)
);

alter table public.resignations enable row level security;
