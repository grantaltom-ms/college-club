-- CCS member system, step 2: bookable items, their rules as data, out-of-service periods, and bookings.
--
-- Same rules as step 1: everything lives in the "club" schema, nothing is applied to the live Supabase project
-- in Phase 1, and the tables are closed to everyone but the owner (row level security on, no policies).
--
-- THE POINT OF THIS FILE: two members can never hold the same boat at overlapping times. That is enforced by
-- the database itself (an exclusion constraint), so it holds even when two requests arrive at the same instant.
-- The booking rules (hours, limits, skill levels) stay in the app, where they can explain a refusal in words,
-- and the app reads them from the rule tables below, which staff edit as data.

create extension if not exists btree_gist;

/* ---------- Rules as data ---------- */

-- The house rules for everything bookable. One row. Values mirror src/club/settings/booking-rules.json.
create table club.booking_rule_defaults (
  id boolean primary key default true check (id),
  -- True while the numbers are placeholders until staff confirm them.
  placeholder boolean not null default true,
  rules jsonb not null check (jsonb_typeof(rules) = 'object')
);

-- A kind of item the rules attach to: "all singles".
create table club.item_classes (
  code text primary key check (code ~ '^[a-z0-9-]+$'),
  booking_type text not null check (booking_type in ('Shell', 'Kayak', 'Paddle Board', 'Dock Space', 'Gym Space', 'Room Space', 'Work Space')),
  name text not null check (char_length(name) between 1 and 80),
  -- 1 single, 2 double, 4 quad or four.
  seats integer not null check (seats between 1 and 12),
  required_qualification text references club.qualifications (code),
  -- Overrides of the defaults for this class, as a partial set of rules.
  rules jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object')
);

create table club.items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  class_code text not null references club.item_classes (code),
  -- Overrides of the class rules for this one item.
  rule_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(rule_overrides) = 'object'),
  -- 'class': use the class's qualification. 'none': this item needs none. 'code': this item needs the one below.
  qualification_mode text not null default 'class' check (qualification_mode in ('class', 'none', 'code')),
  required_qualification text references club.qualifications (code),
  created_at timestamptz not null default now(),
  constraint items_qualification_matches_mode check ((qualification_mode = 'code') = (required_qualification is not null))
);

/* ---------- Out of service ---------- */

-- A stretch of time when an item cannot be booked. Bookings already made are kept, never cancelled by this.
create table club.out_of_service (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references club.items (id) on delete restrict,
  from_at timestamptz not null,
  -- Null until staff return the item to service.
  until_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  expected_return date,
  created_by_kind text not null check (created_by_kind in ('staff', 'system')),
  created_by_label text not null check (char_length(created_by_label) between 1 and 120),
  created_at timestamptz not null default now(),
  constraint out_of_service_ends_after_start check (until_at is null or until_at > from_at)
);

create index out_of_service_item_idx on club.out_of_service (item_id, from_at);

/* ---------- Bookings ---------- */

create table club.bookings (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references club.items (id) on delete restrict,
  -- The booker owns the booking and is in the boat.
  booker_id uuid not null references club.members (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Every booking ends in one of these. cancelled and late_cancelled free the slot.
  status text not null default 'upcoming' check (status in ('upcoming', 'completed', 'cancelled', 'late_cancelled', 'no_show')),
  created_at timestamptz not null default now(),
  created_by_kind text not null check (created_by_kind in ('member', 'staff')),
  created_by_label text not null check (char_length(created_by_label) between 1 and 120),
  status_changed_at timestamptz not null default now(),
  cancelled_by_kind text check (cancelled_by_kind in ('member', 'staff', 'system')),
  cancelled_by_label text check (char_length(cancelled_by_label) between 1 and 120),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  -- Set when staff booked past the club rules: why, by whom, and which rules were set aside.
  override_reason text check (char_length(btrim(override_reason)) between 1 and 300),
  override_by_label text check (char_length(override_by_label) between 1 and 120),
  override_waived text[],
  constraint bookings_ends_after_start check (ends_at > starts_at),
  constraint bookings_cancel_matches_status check ((status in ('cancelled', 'late_cancelled')) = (cancelled_by_kind is not null and cancelled_by_label is not null)),
  constraint bookings_override_is_complete check ((override_reason is null) = (override_by_label is null) and (override_reason is null) = (override_waived is null)),
  -- NO DOUBLE BOOKING, EVER. Two bookings that hold a slot (upcoming, completed or no-show) cannot overlap on one item.
  -- Cancelled and late-cancelled bookings no longer hold it. Back to back (one ends as the next starts) is fine.
  constraint bookings_no_double_booking exclude using gist (item_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('upcoming', 'completed', 'no_show'))
);

create index bookings_booker_idx on club.bookings (booker_id, starts_at);
create index bookings_item_time_idx on club.bookings (item_id, starts_at);

-- Other members in a multi-seat boat. Never includes the booker. A crew member who left stays on record, marked removed.
create table club.booking_crew (
  booking_id uuid not null references club.bookings (id) on delete restrict,
  member_id uuid not null references club.members (id) on delete restrict,
  removed_at timestamptz,
  removed_reason text check (char_length(removed_reason) <= 300),
  primary key (booking_id, member_id),
  constraint booking_crew_removal_is_complete check ((removed_at is null) = (removed_reason is null))
);

create index booking_crew_member_idx on club.booking_crew (member_id);

/* ---------- Rules the database enforces on its own ---------- */

-- Requests for the same item line up one at a time. Without this, two bookings that collide each wait on the other's
-- unsaved row, and Postgres only breaks that standoff after about a second, with a "deadlock" error instead of a clean
-- "slot taken". With it, the second request waits for the first to finish, then meets the exclusion constraint at once.
-- (The lock lasts until the end of the transaction that is booking, and is per item, so different boats never wait.)
create function club.lock_item_for_booking() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.item_id::text, 0));
  return new;
end $$;

create trigger bookings_serialize before insert on club.bookings
  for each row execute function club.lock_item_for_booking();

-- A booking cannot be moved or handed to someone else (cancel it and book again), and once it has an outcome it is final.
create function club.guard_booking() returns trigger language plpgsql as $$
begin
  if new.item_id is distinct from old.item_id
    or new.booker_id is distinct from old.booker_id
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at then
    raise exception 'A booking cannot be moved or handed over. Cancel it and book again.';
  end if;
  if new.status is distinct from old.status and old.status <> 'upcoming' then
    raise exception 'A booking that is already % cannot change again.', replace(old.status, '_', ' ');
  end if;
  return new;
end $$;

create trigger bookings_guard before update on club.bookings
  for each row execute function club.guard_booking();

-- The booker is already in the boat, so cannot also be listed as crew.
create function club.guard_booking_crew() returns trigger language plpgsql as $$
begin
  if exists (select 1 from club.bookings where id = new.booking_id and booker_id = new.member_id) then
    raise exception 'The person who booked is already in the boat; list only the other crew.';
  end if;
  return new;
end $$;

create trigger booking_crew_guard before insert on club.booking_crew
  for each row execute function club.guard_booking_crew();

/* ---------- Ending a membership now also cancels future bookings, still as one step ---------- */

-- Replaces the step 1 version. Same job, plus: cancels every adult's future bookings, takes them off other people's
-- boats as crew, and writes both to the household's file. Bookings that have started and past ones are left alone.
-- p_now is the moment of the change (the app passes its own clock; it defaults to the database's).
drop function club.end_household(uuid, date, text, text, text);

create function club.end_household(
  p_household_id uuid,
  p_ended_on date,
  p_actor_kind text,
  p_actor_id text,
  p_actor_label text,
  p_now timestamptz default now()
) returns integer language plpgsql as $$
declare
  v_household club.households%rowtype;
  v_adults uuid[];
  v_cancelled integer;
begin
  select * into v_household from club.households where id = p_household_id for update;
  if not found then
    raise exception 'That household no longer exists.' using errcode = 'P0002';
  end if;
  if v_household.status = 'ended' then
    raise exception 'That household''s membership already ended on %.', to_char(v_household.ended_on, 'FMMon FMDD, YYYY');
  end if;
  if p_ended_on < v_household.joined_on then
    raise exception 'A membership cannot end before it began.';
  end if;

  select coalesce(array_agg(id), '{}') into v_adults from club.members where household_id = p_household_id and status = 'active';

  update club.members set status = 'household_ended' where household_id = p_household_id and status = 'active';
  update club.households set status = 'ended', ended_on = p_ended_on where id = p_household_id;

  insert into club.household_history (household_id, kind, summary, actor_kind, actor_id, actor_label, details)
  values (
    p_household_id,
    'membership_ended',
    format('Membership ended on %s. %s adult%s can no longer book.', to_char(p_ended_on, 'FMMon FMDD, YYYY'), cardinality(v_adults), case when cardinality(v_adults) = 1 then '' else 's' end),
    p_actor_kind, p_actor_id, p_actor_label,
    jsonb_build_object('endedOn', p_ended_on, 'adults', cardinality(v_adults))
  );

  -- Future bookings of these adults are cancelled (not late: it was not their choice).
  update club.bookings
     set status = 'cancelled', status_changed_at = p_now, cancelled_by_kind = p_actor_kind, cancelled_by_label = p_actor_label,
         cancel_reason = 'The household''s membership ended'
   where booker_id = any (v_adults) and status = 'upcoming' and starts_at > p_now;
  get diagnostics v_cancelled = row_count;

  -- Where they were only crew on someone else's future booking, they are taken off and the booking stays.
  update club.booking_crew c
     set removed_at = p_now, removed_reason = 'The household''s membership ended'
    from club.bookings b
   where c.booking_id = b.id and c.member_id = any (v_adults) and c.removed_at is null and b.status = 'upcoming' and b.starts_at > p_now;

  if v_cancelled > 0 then
    insert into club.household_history (household_id, kind, summary, actor_kind, actor_id, actor_label, details)
    values (
      p_household_id,
      'bookings_cancelled',
      format('%s future booking%s cancelled because the membership ended.', v_cancelled, case when v_cancelled = 1 then '' else 's' end),
      p_actor_kind, p_actor_id, p_actor_label,
      jsonb_build_object('count', v_cancelled)
    );
  end if;
  return cardinality(v_adults);
end $$;

revoke all on function club.end_household(uuid, date, text, text, text, timestamptz) from public;

/* ---------- Locked to the owner ---------- */

alter table club.booking_rule_defaults enable row level security;
alter table club.item_classes enable row level security;
alter table club.items enable row level security;
alter table club.out_of_service enable row level security;
alter table club.bookings enable row level security;
alter table club.booking_crew enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
