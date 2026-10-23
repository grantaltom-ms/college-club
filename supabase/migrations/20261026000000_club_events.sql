-- CCS member system, step 4: events with RSVPs, guests, and an optional limit with a waiting list.
--
-- Same rules as before: everything lives in the "club" schema, nothing is applied to the live Supabase project in
-- Phase 1, and the tables are closed to everyone but the owner (row level security on, no policies).
--
-- What the database guarantees by itself, whoever is writing:
--   * an event with a limit never has more people going than its limit (a member and each guest count as one place);
--   * a name is on an event's list at most once at a time;
--   * an RSVP only moves forward: nobody with places goes back to waiting, and a finished RSVP cannot be revived;
--   * a cancelled event cannot be brought back, and its limit cannot be cut below the people already going.
-- The softer rules (when RSVP closes, guest limits, the order the waiting list moves up) are in the app, where they
-- can explain a refusal in words. The event rules live in a table below that staff edit as data later.

/* ---------- Rules as data ---------- */

-- One row. Values mirror src/club/settings/event-rules.json.
create table club.event_rule_defaults (
  id boolean primary key default true check (id),
  placeholder boolean not null default true,
  rules jsonb not null check (jsonb_typeof(rules) = 'object')
);

/* ---------- Events and RSVPs ---------- */

create table club.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  location text not null default '' check (char_length(location) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Places in total, adults and guests together. Null means no limit.
  capacity integer check (capacity between 1 and 2000),
  -- Price of one place in cents, recorded for billing later. Null means free or not stated. Nothing is charged here.
  price_cents integer check (price_cents between 0 and 1000000),
  reply_by timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now(),
  created_by_kind text not null check (created_by_kind in ('staff', 'system')),
  created_by_label text not null check (char_length(created_by_label) between 1 and 120),
  status_changed_at timestamptz not null default now(),
  cancelled_by_kind text check (cancelled_by_kind in ('staff', 'system')),
  cancelled_by_label text check (char_length(cancelled_by_label) between 1 and 120),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  seq bigint generated always as identity,
  constraint events_ends_after_start check (ends_at > starts_at),
  constraint events_reply_by_before_start check (reply_by is null or reply_by <= starts_at),
  constraint events_cancel_matches_status check ((status = 'cancelled') = (cancelled_by_kind is not null and cancelled_by_label is not null))
);

create unique index events_seq_idx on club.events (seq);
create index events_time_idx on club.events (starts_at);

-- A name on an event's list: with places ("going") or waiting in order ("waitlisted").
create table club.event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references club.events (id) on delete restrict,
  member_id uuid not null references club.members (id) on delete restrict,
  guests integer not null default 0 check (guests between 0 and 20),
  status text not null check (status in ('going', 'waitlisted', 'cancelled', 'late_cancelled', 'attended', 'no_show')),
  -- Price of one place in cents when the RSVP was made.
  price_cents integer check (price_cents between 0 and 1000000),
  via text not null default 'page' check (via in ('page', 'email_link')),
  created_at timestamptz not null default now(),
  created_by_kind text not null check (created_by_kind in ('member', 'staff')),
  created_by_id text check (char_length(created_by_id) <= 64),
  created_by_label text not null check (char_length(created_by_label) between 1 and 120),
  status_changed_at timestamptz not null default now(),
  -- Set when the waiting list moved this person up to places.
  promoted_at timestamptz,
  cancelled_by_kind text check (cancelled_by_kind in ('member', 'staff', 'system')),
  cancelled_by_id text check (char_length(cancelled_by_id) <= 64),
  cancelled_by_label text check (char_length(cancelled_by_label) between 1 and 120),
  cancel_reason text check (char_length(cancel_reason) <= 300),
  -- Creation order. The waiting list moves up in this order.
  seq bigint generated always as identity,
  constraint event_rsvps_cancel_matches_status check ((status in ('cancelled', 'late_cancelled')) = (cancelled_by_kind is not null and cancelled_by_label is not null))
);

create unique index event_rsvps_seq_idx on club.event_rsvps (seq);
-- On the list at most once at a time. (Someone who cancelled and comes back gets a new line at the end.)
create unique index event_rsvps_one_live on club.event_rsvps (event_id, member_id) where status in ('going', 'waitlisted');
create index event_rsvps_member_idx on club.event_rsvps (member_id);
create index event_rsvps_event_idx on club.event_rsvps (event_id, status);

/* ---------- Rules the database enforces on its own ---------- */

-- An event can be edited (title, place, times, price, reply-by), but not brought back once cancelled, and its limit
-- cannot go below the people already going.
create function club.guard_event() returns trigger language plpgsql as $$
declare
  v_going integer;
begin
  if new.status is distinct from old.status and old.status <> 'scheduled' then
    raise exception 'A cancelled event cannot be brought back. Schedule a new one.';
  end if;
  if new.capacity is not null and new.capacity is distinct from old.capacity then
    select coalesce(sum(1 + guests), 0) into v_going from club.event_rsvps where event_id = new.id and status = 'going';
    if new.capacity < v_going then
      raise exception 'The limit cannot go below the % people already going.', v_going using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger events_guard before update on club.events
  for each row execute function club.guard_event();

-- Places are never over-filled, and an RSVP only moves forward. Locks the event's row first, so everyone touching one
-- event's list takes turns.
create function club.guard_event_rsvp() returns trigger language plpgsql as $$
declare
  v_event club.events%rowtype;
  v_taken integer;
begin
  select * into v_event from club.events where id = new.event_id for update;

  if tg_op = 'INSERT' then
    if v_event.status <> 'scheduled' and new.status in ('going', 'waitlisted') then
      raise exception 'That event was cancelled.' using errcode = '23514';
    end if;
  else
    if new.event_id is distinct from old.event_id or new.member_id is distinct from old.member_id then
      raise exception 'An RSVP cannot be moved to another event or another person.';
    end if;
    if new.status is distinct from old.status then
      if old.status not in ('going', 'waitlisted') then
        raise exception 'An RSVP that is already % cannot change again.', replace(old.status, '_', ' ');
      end if;
      if old.status = 'going' and new.status = 'waitlisted' then
        raise exception 'Someone with places cannot go back to the waiting list.';
      end if;
      if old.status = 'waitlisted' and new.status not in ('going', 'cancelled') then
        raise exception 'Someone waiting can only get places or leave the list.';
      end if;
    end if;
    if new.guests is distinct from old.guests and old.status not in ('going', 'waitlisted') then
      raise exception 'The guest count of a finished RSVP cannot change.';
    end if;
  end if;

  if new.status = 'going' and v_event.capacity is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'going' or new.guests is distinct from old.guests) then
    select coalesce(sum(1 + guests), 0) into v_taken from club.event_rsvps where event_id = new.event_id and status = 'going' and id is distinct from new.id;
    if v_taken + 1 + new.guests > v_event.capacity then
      raise exception 'That event is full.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger event_rsvps_guard before insert or update on club.event_rsvps
  for each row execute function club.guard_event_rsvp();

/* ---------- Ending a membership also cancels future RSVPs, still as one step ---------- */

-- Replaces the step 3 version. Same job and the same result as before, plus: every future event RSVP of these adults,
-- with places or waiting, is cancelled (not late: it was not their choice) and written to the household's file.
-- This function gives the places back but does not move the waiting list up: that needs the event rules, so the app does it.
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
  v_rsvps integer;
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

  update club.event_rsvps r
     set status = 'cancelled', status_changed_at = p_now, cancelled_by_kind = p_actor_kind, cancelled_by_label = p_actor_label,
         cancel_reason = 'The household''s membership ended'
    from club.events e
   where r.event_id = e.id and r.member_id = any (v_adults) and r.status in ('going', 'waitlisted') and e.status = 'scheduled' and e.starts_at > p_now;
  get diagnostics v_rsvps = row_count;

  if v_rsvps > 0 then
    insert into club.household_history (household_id, kind, summary, actor_kind, actor_id, actor_label, details)
    values (
      p_household_id,
      'rsvps_cancelled',
      format('%s future event RSVP%s cancelled because the membership ended.', v_rsvps, case when v_rsvps = 1 then '' else 's' end),
      p_actor_kind, p_actor_id, p_actor_label,
      jsonb_build_object('count', v_rsvps)
    );
  end if;
  return cardinality(v_adults);
end $$;

revoke all on function club.end_household(uuid, date, text, text, text, timestamptz) from public;

-- The household's file gets one more kind of line.
alter table club.household_history drop constraint household_history_kind_check;
alter table club.household_history add constraint household_history_kind_check check (
  kind in ('joined', 'member_added', 'member_removed', 'primary_changed', 'type_changed', 'qualification_granted', 'bookings_cancelled', 'signups_cancelled', 'rsvps_cancelled', 'membership_ended')
);

/* ---------- Locked to the owner ---------- */

alter table club.event_rule_defaults enable row level security;
alter table club.events enable row level security;
alter table club.event_rsvps enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
