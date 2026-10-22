-- CCS member system, step 3: fitness classes with a number of chairs and a waiting list.
--
-- Same rules as before: everything lives in the "club" schema, nothing is applied to the live Supabase project in
-- Phase 1, and the tables are closed to everyone but the owner (row level security on, no policies).
--
-- What the database guarantees by itself, whoever is writing:
--   * a class never has more people in chairs than it has chairs;
--   * a room (gym, room space) is never used by two classes at once, nor by a class and a member's booking at once
--     (the two checks share one lock per room, so two requests arriving together cannot both get in);
--   * a name is on a session's sign-up sheet at most once at a time;
--   * a finished sign-up cannot be revived, and nobody with a chair goes back to waiting.
-- The softer rules (when sign-up opens, limits, "one place at a time", the order the waiting list moves up) are in the
-- app, where they can explain a refusal in words. The class rules live in tables below that staff edit as data later.

/* ---------- Rules as data ---------- */

-- One row. Values mirror src/club/settings/class-rules.json.
create table club.class_rule_defaults (
  id boolean primary key default true check (id),
  placeholder boolean not null default true,
  rules jsonb not null check (jsonb_typeof(rules) = 'object')
);

/* ---------- Classes, sessions, sign-ups ---------- */

-- A kind of class: "Morning Yoga".
create table club.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  instructor text not null default '' check (char_length(instructor) <= 120),
  default_capacity integer not null check (default_capacity between 1 and 200),
  default_minutes integer not null check (default_minutes between 15 and 480),
  room_item_id uuid references club.items (id) on delete restrict,
  -- Overrides of the class rules for this class only, as a partial set of rules.
  rules jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object'),
  created_at timestamptz not null default now(),
  seq bigint generated always as identity
);

create unique index classes_seq_idx on club.classes (seq);

-- One dated occurrence of a class, with a number of chairs.
create table club.class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references club.classes (id) on delete restrict,
  -- The gym or room it holds for its whole length, or null for a class that needs none.
  room_item_id uuid references club.items (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity between 1 and 200),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  created_by_kind text not null check (created_by_kind in ('staff', 'system')),
  created_by_label text not null check (char_length(created_by_label) between 1 and 120),
  status_changed_at timestamptz not null default now(),
  cancelled_by_kind text check (cancelled_by_kind in ('staff', 'system')),
  cancelled_by_label text check (char_length(cancelled_by_label) between 1 and 120),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  seq bigint generated always as identity,
  constraint class_sessions_ends_after_start check (ends_at > starts_at),
  constraint class_sessions_cancel_matches_status check ((status = 'cancelled') = (cancelled_by_kind is not null and cancelled_by_label is not null)),
  -- A room is held by one class at a time. (A cancelled class lets go of it.)
  constraint class_sessions_room_not_double_used exclude using gist (room_item_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status = 'scheduled' and room_item_id is not null)
);

create unique index class_sessions_seq_idx on club.class_sessions (seq);
create index class_sessions_time_idx on club.class_sessions (starts_at);

-- A name on a session's sign-up sheet: in a chair ("enrolled") or waiting in order ("waitlisted").
create table club.class_signups (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references club.class_sessions (id) on delete restrict,
  member_id uuid not null references club.members (id) on delete restrict,
  status text not null check (status in ('enrolled', 'waitlisted', 'cancelled', 'late_cancelled', 'attended', 'no_show')),
  created_at timestamptz not null default now(),
  created_by_kind text not null check (created_by_kind in ('member', 'staff')),
  created_by_id text check (char_length(created_by_id) <= 64),
  created_by_label text not null check (char_length(created_by_label) between 1 and 120),
  status_changed_at timestamptz not null default now(),
  -- Set when the waiting list moved this person up to a chair.
  promoted_at timestamptz,
  cancelled_by_kind text check (cancelled_by_kind in ('member', 'staff', 'system')),
  cancelled_by_id text check (char_length(cancelled_by_id) <= 64),
  cancelled_by_label text check (char_length(cancelled_by_label) between 1 and 120),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  -- Creation order. The waiting list moves up in this order.
  seq bigint generated always as identity,
  constraint class_signups_cancel_matches_status check ((status in ('cancelled', 'late_cancelled')) = (cancelled_by_kind is not null and cancelled_by_label is not null))
);

create unique index class_signups_seq_idx on club.class_signups (seq);
-- On the sheet at most once at a time. (Someone who left and comes back gets a new line at the end.)
create unique index class_signups_one_live on club.class_signups (session_id, member_id) where status in ('enrolled', 'waitlisted');
create index class_signups_member_idx on club.class_signups (member_id);
create index class_signups_session_idx on club.class_signups (session_id, status);

/* ---------- Rules the database enforces on its own ---------- */

-- A session's room, class, times and maker cannot change (cancel it and schedule a new one). It can be cancelled once,
-- and its chairs can change, but not below the number already taken.
create function club.guard_class_session() returns trigger language plpgsql as $$
declare
  v_enrolled integer;
begin
  if new.class_id is distinct from old.class_id
    or new.room_item_id is distinct from old.room_item_id
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at then
    raise exception 'A class session cannot be moved. Cancel it and schedule a new one.';
  end if;
  if new.status is distinct from old.status and old.status <> 'scheduled' then
    raise exception 'A cancelled class cannot be brought back. Schedule a new one.';
  end if;
  if new.capacity is distinct from old.capacity then
    select count(*) into v_enrolled from club.class_signups where session_id = new.id and status = 'enrolled';
    if new.capacity < v_enrolled then
      raise exception 'Chairs cannot go below the % people already in them.', v_enrolled using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger class_sessions_guard before update on club.class_sessions
  for each row execute function club.guard_class_session();

-- A class cannot take a room a member has booked at that time. Shares its lock with bookings (one lock per room), so a
-- booking and a class arriving together cannot both get in.
create function club.session_room_free() returns trigger language plpgsql as $$
begin
  -- Backwards times are refused by the table's own check; do not trip over them first.
  if new.room_item_id is null or new.status <> 'scheduled' or new.ends_at <= new.starts_at then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.room_item_id::text, 0));
  if exists (
    select 1 from club.bookings b
     where b.item_id = new.room_item_id
       and b.status in ('upcoming', 'completed', 'no_show')
       and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'That room is already booked by a member at that time.' using errcode = '23P01';
  end if;
  return new;
end $$;

create trigger class_sessions_room_free before insert on club.class_sessions
  for each row execute function club.session_room_free();

-- And a member cannot book a room a class is holding.
create function club.booking_room_free() returns trigger language plpgsql as $$
begin
  if new.status not in ('upcoming', 'completed', 'no_show') or new.ends_at <= new.starts_at then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.item_id::text, 0));
  if exists (
    select 1 from club.class_sessions s
     where s.room_item_id = new.item_id
       and s.status = 'scheduled'
       and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'That room is used by a class at that time.' using errcode = '23P01';
  end if;
  return new;
end $$;

create trigger bookings_room_free before insert on club.bookings
  for each row execute function club.booking_room_free();

-- Chairs are never over-filled, and a sign-up only moves forward. Locks the session's row first, so everyone touching
-- one class's sheet takes turns.
create function club.guard_class_signup() returns trigger language plpgsql as $$
declare
  v_session club.class_sessions%rowtype;
  v_enrolled integer;
begin
  select * into v_session from club.class_sessions where id = new.session_id for update;

  if tg_op = 'INSERT' then
    if v_session.status <> 'scheduled' and new.status in ('enrolled', 'waitlisted') then
      raise exception 'That class was cancelled.' using errcode = '23514';
    end if;
  else
    if new.session_id is distinct from old.session_id or new.member_id is distinct from old.member_id then
      raise exception 'A sign-up cannot be moved to another class or another person.';
    end if;
    if new.status is distinct from old.status then
      if old.status not in ('enrolled', 'waitlisted') then
        raise exception 'A sign-up that is already % cannot change again.', replace(old.status, '_', ' ');
      end if;
      if old.status = 'enrolled' and new.status = 'waitlisted' then
        raise exception 'Someone with a chair cannot go back to the waiting list.';
      end if;
      if old.status = 'waitlisted' and new.status not in ('enrolled', 'cancelled') then
        raise exception 'Someone waiting can only get a chair or leave the list.';
      end if;
    end if;
  end if;

  if new.status = 'enrolled' and (tg_op = 'INSERT' or old.status is distinct from 'enrolled') then
    select count(*) into v_enrolled from club.class_signups where session_id = new.session_id and status = 'enrolled' and id is distinct from new.id;
    if v_enrolled >= v_session.capacity then
      raise exception 'That class is full.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger class_signups_guard before insert or update on club.class_signups
  for each row execute function club.guard_class_signup();

/* ---------- Ending a membership also takes people off class sheets, still as one step ---------- */

-- Replaces the step 2 version. Same job and the same result as before, plus: every future class sign-up of these adults,
-- in a chair or waiting, is cancelled (not late: it was not their choice) and written to the household's file.
-- This function frees the chairs but does not move the waiting list up: that needs the class rules, so the app does it.
drop function club.end_household(uuid, date, text, text, text, timestamptz);

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
  v_signups integer;
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

  update club.bookings
     set status = 'cancelled', status_changed_at = p_now, cancelled_by_kind = p_actor_kind, cancelled_by_label = p_actor_label,
         cancel_reason = 'The household''s membership ended'
   where booker_id = any (v_adults) and status = 'upcoming' and starts_at > p_now;
  get diagnostics v_cancelled = row_count;

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

  update club.class_signups g
     set status = 'cancelled', status_changed_at = p_now, cancelled_by_kind = p_actor_kind, cancelled_by_label = p_actor_label,
         cancel_reason = 'The household''s membership ended'
    from club.class_sessions s
   where g.session_id = s.id and g.member_id = any (v_adults) and g.status in ('enrolled', 'waitlisted') and s.status = 'scheduled' and s.starts_at > p_now;
  get diagnostics v_signups = row_count;

  if v_signups > 0 then
    insert into club.household_history (household_id, kind, summary, actor_kind, actor_id, actor_label, details)
    values (
      p_household_id,
      'signups_cancelled',
      format('%s future class sign-up%s cancelled because the membership ended.', v_signups, case when v_signups = 1 then '' else 's' end),
      p_actor_kind, p_actor_id, p_actor_label,
      jsonb_build_object('count', v_signups)
    );
  end if;
  return cardinality(v_adults);
end $$;

revoke all on function club.end_household(uuid, date, text, text, text, timestamptz) from public;

-- The household's file gets one more kind of line.
alter table club.household_history drop constraint household_history_kind_check;
alter table club.household_history add constraint household_history_kind_check check (
  kind in ('joined', 'member_added', 'member_removed', 'primary_changed', 'type_changed', 'qualification_granted', 'bookings_cancelled', 'signups_cancelled', 'membership_ended')
);

/* ---------- Locked to the owner ---------- */

alter table club.class_rule_defaults enable row level security;
alter table club.classes enable row level security;
alter table club.class_sessions enable row level security;
alter table club.class_signups enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
