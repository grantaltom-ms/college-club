-- Private boats: a boat that belongs to members rather than to the club, and the list of who may use it.
--
-- The building comparison: a reserved parking spot. The office paints the owners' names on it, an owner can hand out a visitor
-- pass, and nobody else may park there. Every name painted on or scrubbed off is kept on the list, so the list is also the
-- record of who was let on and who was taken off.
--
-- The database refuses these on its own, whatever the app does:
-- - a boat turning private, or ceasing to be private, after it exists;
-- - a list line on a club boat;
-- - a line being removed, or changed in any way except being ended, once, with who ended it and why;
-- - the same person on one boat's list twice at the same time;
-- - an owner added by anyone but staff, and an invitation by a member who is not an owner of that boat at that moment;
-- - a booking on a private boat by someone not on its list, or someone not on its list put in one of its other seats, or a
--   booking at all while the boat has no owner on its list.
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

alter table club.items add column is_private boolean not null default false;

create table club.item_access (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references club.items (id) on delete restrict,
  member_id uuid not null references club.members (id) on delete restrict,
  kind text not null check (kind in ('owner', 'invited')),
  added_at timestamptz not null,
  added_by_kind text not null check (added_by_kind in ('staff', 'member')),
  -- Which member, when a member added the line.
  added_by_id text check (char_length(added_by_id) <= 64),
  added_by_label text not null check (char_length(added_by_label) between 1 and 120),
  ended_at timestamptz,
  ended_by_kind text check (ended_by_kind in ('staff', 'member')),
  ended_by_id text check (char_length(ended_by_id) <= 64),
  ended_by_label text check (char_length(ended_by_label) between 1 and 120),
  ended_reason text check (char_length(ended_reason) between 1 and 200),
  seq bigint generated always as identity,
  constraint item_access_end_is_complete check (
    (ended_at is null) = (ended_by_kind is null) and (ended_at is null) = (ended_by_label is null) and (ended_at is null) = (ended_reason is null)
  ),
  constraint item_access_ends_after_added check (ended_at is null or ended_at >= added_at),
  constraint item_access_added_by_member_is_named check ((added_by_kind = 'member') = (added_by_id is not null)),
  constraint item_access_ended_by_member_is_named check (ended_by_kind is null or (ended_by_kind = 'member') = (ended_by_id is not null)),
  -- Owners are named by staff. Members can only invite.
  constraint item_access_owners_are_named_by_staff check (kind = 'invited' or added_by_kind = 'staff')
);

create unique index item_access_seq_idx on club.item_access (seq);
-- One person is on one boat's list once at a time. Ended lines stay as the record.
create unique index item_access_one_active_idx on club.item_access (item_id, member_id) where ended_at is null;
create index item_access_member_idx on club.item_access (member_id) where ended_at is null;

/* ---------- A boat is private from the day it is made, or never ---------- */

create function club.guard_item_privacy() returns trigger language plpgsql as $$
begin
  if new.is_private is distinct from old.is_private then
    raise exception 'A boat cannot turn private, or stop being private, after it has been made.';
  end if;
  return new;
end $$;

create trigger items_privacy_is_fixed before update on club.items
  for each row execute function club.guard_item_privacy();

/* ---------- The list: added to, ended once, never removed ---------- */

create function club.guard_item_access_insert() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from club.items where id = new.item_id and is_private) then
    raise exception 'Only a private boat has a list of owners and invited people.';
  end if;
  if new.kind = 'invited' and new.added_by_kind = 'member' then
    if not exists (
      select 1 from club.item_access a
       where a.item_id = new.item_id and a.member_id::text = new.added_by_id and a.kind = 'owner' and a.ended_at is null
    ) then
      raise exception 'Only an owner of the boat, or club staff, can invite someone to it.';
    end if;
  end if;
  return new;
end $$;

create trigger item_access_insert_guard before insert on club.item_access
  for each row execute function club.guard_item_access_insert();

create function club.guard_item_access() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.ended_at is null and new.ended_at is not null
       and new.id = old.id and new.item_id = old.item_id and new.member_id = old.member_id and new.kind = old.kind
       and new.added_at = old.added_at and new.added_by_kind = old.added_by_kind
       and new.added_by_id is not distinct from old.added_by_id and new.added_by_label = old.added_by_label and new.seq = old.seq then
      return new;
    end if;
    raise exception 'A line on a boat''s list cannot be changed. It can only be ended, once.';
  end if;
  raise exception 'A line on a boat''s list cannot be removed.';
end $$;

create trigger item_access_no_change before update or delete on club.item_access
  for each row execute function club.guard_item_access();
create trigger item_access_no_truncate before truncate on club.item_access
  for each statement execute function club.guard_item_access();

/* ---------- Who may book, and sit in, a private boat ---------- */

create function club.guard_private_booking() returns trigger language plpgsql as $$
begin
  if exists (select 1 from club.items where id = new.item_id and is_private) then
    if not exists (select 1 from club.item_access where item_id = new.item_id and ended_at is null and kind = 'owner') then
      raise exception 'This private boat has no owner right now, so it cannot be booked.';
    end if;
    if not exists (select 1 from club.item_access where item_id = new.item_id and member_id = new.booker_id and ended_at is null) then
      raise exception 'Only the owners of a private boat, and people an owner has invited, can book it.';
    end if;
  end if;
  return new;
end $$;

create trigger bookings_private_boat_guard before insert on club.bookings
  for each row execute function club.guard_private_booking();

create function club.guard_private_crew() returns trigger language plpgsql as $$
declare
  v_item uuid;
begin
  select item_id into v_item from club.bookings where id = new.booking_id;
  if exists (select 1 from club.items where id = v_item and is_private) then
    if not exists (select 1 from club.item_access where item_id = v_item and member_id = new.member_id and ended_at is null) then
      raise exception 'Only the owners of a private boat, and people an owner has invited, can be in it.';
    end if;
  end if;
  return new;
end $$;

create trigger booking_crew_private_boat_guard before insert on club.booking_crew
  for each row execute function club.guard_private_crew();

/* ---------- Locked to the owner ---------- */

alter table club.item_access enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
