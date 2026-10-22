-- CCS member system, step 1: households, members, qualifications and household history.
--
-- Everything lives in its own schema, "club", so it can never be confused with the dashboard's tables in
-- "public" (members, qb_members, reservation_counts and so on). Nothing here reads or changes those.
--
-- PHASE 1: do NOT apply this to the live Supabase project (hgjcnuwxhemynnvsnmou). It is for a local database
-- (Supabase CLI) and for the automated tests only.
--
-- Closed to the outside: row level security is on with no policies, and no role other than the owner is
-- granted anything. The app reaches these tables through its own database connection (CLUB_DATABASE_URL),
-- never through the public web API.

create schema if not exists club;

/* ---------- Households: the lease ---------- */

create table club.households (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 120),
  membership_type text not null check (membership_type in ('Resident', 'Intermediate', 'Non-Resident')),
  status text not null default 'active' check (status in ('active', 'ended')),
  joined_on date not null,
  ended_on date,
  -- Empty until the QuickBooks link is made.
  quickbooks_id text unique check (char_length(quickbooks_id) between 1 and 100),
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint households_end_date_matches_status check ((status = 'ended') = (ended_on is not null)),
  constraint households_end_after_join check (ended_on is null or ended_on >= joined_on)
);

/* ---------- Members: each adult on the lease ---------- */

create table club.members (
  id uuid primary key default gen_random_uuid(),
  -- A household with people in it is never deleted; ending it is a status, not a deletion.
  household_id uuid not null references club.households (id) on delete restrict,
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  -- Not unique: two partners may share one address.
  email text not null check (char_length(email) between 3 and 200),
  phone text not null default '' check (char_length(phone) <= 40),
  role text not null check (role in ('primary', 'additional')),
  -- "removed" left a household that carried on; "household_ended" lost access when the whole membership ended.
  status text not null default 'active' check (status in ('active', 'removed', 'household_ended')),
  -- Empty slots for the systems linked later. Each outside ID can belong to only one member.
  brivo_credential_id text unique check (char_length(brivo_credential_id) between 1 and 100),
  mailchimp_contact_id text unique check (char_length(mailchimp_contact_id) between 1 and 100),
  login_id uuid unique,
  created_at timestamptz not null default now()
);

create index members_household_idx on club.members (household_id);

-- At most one primary adult at a time. (Someone who has left no longer counts.)
create unique index members_one_active_primary on club.members (household_id) where role = 'primary' and status = 'active';

/* ---------- Qualifications ---------- */

create table club.qualifications (
  code text primary key,
  name text not null,
  track text not null,
  rank integer not null check (rank > 0)
);

-- PLACEHOLDER names and levels until staff confirm the real ones. Kept in step with src/club/qualifications.ts.
insert into club.qualifications (code, name, track, rank) values
  ('scull-1', 'Sculling level 1 (placeholder)', 'sculling', 1),
  ('scull-2', 'Sculling level 2 (placeholder)', 'sculling', 2),
  ('scull-3', 'Sculling level 3 (placeholder)', 'sculling', 3),
  ('sweep', 'Sweep rowing (placeholder)', 'sweep', 1);

create table club.member_qualifications (
  member_id uuid not null references club.members (id) on delete restrict,
  qualification_code text not null references club.qualifications (code),
  -- Only staff grant qualifications. A member can never grant their own.
  granted_by_kind text not null check (granted_by_kind = 'staff'),
  granted_by_label text not null check (char_length(granted_by_label) between 1 and 120),
  granted_at timestamptz not null default now(),
  primary key (member_id, qualification_code)
);

/* ---------- History: the tenant file, only ever added to ---------- */

create table club.household_history (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references club.households (id) on delete restrict,
  at timestamptz not null default now(),
  kind text not null check (
    kind in ('joined', 'member_added', 'member_removed', 'primary_changed', 'type_changed', 'qualification_granted', 'bookings_cancelled', 'membership_ended')
  ),
  -- A plain sentence staff can read.
  summary text not null check (char_length(summary) between 1 and 500),
  actor_kind text not null check (actor_kind in ('member', 'staff', 'system')),
  actor_id text,
  actor_label text not null check (char_length(actor_label) between 1 and 120),
  details jsonb not null default '{}'::jsonb
);

create index household_history_household_idx on club.household_history (household_id, at desc);

/* ---------- Rules the database enforces on its own ---------- */

create function club.history_is_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'A household''s history can only be added to, never changed or removed.';
end $$;

create trigger household_history_no_change before update or delete on club.household_history
  for each row execute function club.history_is_append_only();
create trigger household_history_no_truncate before truncate on club.household_history
  for each statement execute function club.history_is_append_only();

create function club.guard_household() returns trigger language plpgsql as $$
begin
  if old.status = 'ended' and (
    new.status is distinct from old.status
    or new.ended_on is distinct from old.ended_on
    or new.joined_on is distinct from old.joined_on
    or new.membership_type is distinct from old.membership_type
  ) then
    raise exception 'A household whose membership ended can no longer be changed.';
  end if;
  if new.status = 'ended' and old.status = 'active' and exists (
    select 1 from club.members where household_id = new.id and status = 'active'
  ) then
    raise exception 'Every adult must be taken off the household before its membership can end.';
  end if;
  return new;
end $$;

create trigger households_guard before update on club.households
  for each row execute function club.guard_household();

create function club.guard_member() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' and exists (select 1 from club.households where id = new.household_id and status = 'ended') then
      raise exception 'A household whose membership ended cannot have active members.';
    end if;
  else
    if new.household_id is distinct from old.household_id then
      raise exception 'A member cannot be moved to a different household.';
    end if;
    -- Only an active member's status can change, and only to "removed" or "household_ended". Coming back is a new record.
    if new.status is distinct from old.status and old.status <> 'active' then
      raise exception 'A member who has left or whose membership ended cannot be made active again.';
    end if;
  end if;
  return new;
end $$;

create trigger members_guard before insert or update on club.members
  for each row execute function club.guard_member();

create function club.guard_member_qualification() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from club.members where id = new.member_id and status = 'active') then
    raise exception 'A qualification can only be granted to an active member.';
  end if;
  return new;
end $$;

create trigger member_qualifications_guard before insert on club.member_qualifications
  for each row execute function club.guard_member_qualification();

/* ---------- Ending a membership, all or nothing ---------- */

-- Blocks every adult in the household, ends the household, and writes the line in its file, as one step.
-- Step 2 adds "and cancel their future bookings" to this same function, so it stays one step.
-- Returns how many adults were blocked.
create function club.end_household(
  p_household_id uuid,
  p_ended_on date,
  p_actor_kind text,
  p_actor_id text,
  p_actor_label text
) returns integer language plpgsql as $$
declare
  v_household club.households%rowtype;
  v_adults integer;
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

  update club.members set status = 'household_ended' where household_id = p_household_id and status = 'active';
  get diagnostics v_adults = row_count;
  update club.households set status = 'ended', ended_on = p_ended_on where id = p_household_id;

  insert into club.household_history (household_id, kind, summary, actor_kind, actor_id, actor_label, details)
  values (
    p_household_id,
    'membership_ended',
    format('Membership ended on %s. %s adult%s can no longer book.', to_char(p_ended_on, 'FMMon FMDD, YYYY'), v_adults, case when v_adults = 1 then '' else 's' end),
    p_actor_kind, p_actor_id, p_actor_label,
    jsonb_build_object('endedOn', p_ended_on, 'adults', v_adults)
  );
  return v_adults;
end $$;

/* ---------- Locked to the owner ---------- */

alter table club.households enable row level security;
alter table club.members enable row level security;
alter table club.qualifications enable row level security;
alter table club.member_qualifications enable row level security;
alter table club.household_history enable row level security;

revoke all on function club.end_household(uuid, date, text, text, text) from public;

-- On Supabase these roles exist and must get nothing here. On a plain Postgres they do not, so check first.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema club from anon;
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema club from authenticated;
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
