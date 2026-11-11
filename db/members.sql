-- members: one row per member usage record (visit days, door entries, iCrew bookings).
-- The rows hold member names, so they are never committed; they are loaded in the
-- Supabase SQL editor from a load file kept outside the repo.
--
-- Nov 2026: the monthly visit-day columns run to November. Running this file adds
-- the two new columns to a table made before then; it is safe to run again.
-- A table that does not have them yet reads as no visits in October and November.

alter table public.members add column if not exists visit_days_2026_10 integer;
alter table public.members add column if not exists visit_days_2026_11 integer;
