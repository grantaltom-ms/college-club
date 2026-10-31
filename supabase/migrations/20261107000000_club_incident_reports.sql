-- Incident reports: a capsize, an injury or a near-miss, written up by staff or a coach, and the log of everything that happened to it.
--
-- The building comparison: the incident log in the manager's office. Whoever was on the scene writes down what happened, who was
-- involved and who was hurt. The office adds what caused it and what will change, notes who is following up, links the work order if
-- a boat was damaged, and files it away. What the person on the scene wrote is never rewritten, a filed-away report never changes,
-- and every step is a line in the report's own log.
--
-- The database refuses these on its own, whatever the app does:
-- - a report, a person, a boat or a log line being removed, or a person, a boat or a log line being changed;
-- - the words the filer wrote (who, when, what, where, on the water, conditions, first aid, emergency services) changing after the
--   report is filed;
-- - a closed report changing in any way, a closed report without its closing note, and closing details on one that is open;
-- - a member filing a report who is not an active coach, and a new report that already has staff's review fields filled in;
-- - first aid notes without first aid given, and emergency notes without emergency services called;
-- - people and boats being added at any time but in the very change that files the report, a member named from the list who is not
--   an active member, and the same member (or the same typed name) twice on one report;
-- - a report without its "filed" line, and the review fields (cause, what will change, who is following up, the damage report
--   linked) or the status changing without a matching line in the log, written in the same change and at the same moment;
-- - a member writing any log line but "filed" or a note, a note by anyone but the person who filed the report, and a note on a
--   closed report by a member.
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

create table club.incidents (
  id uuid primary key default gen_random_uuid(),
  reported_by_kind text not null check (reported_by_kind in ('member', 'staff')),
  -- Which member, when a coach filed it.
  reported_by_id text check (char_length(reported_by_id) <= 64),
  reported_by_label text not null check (char_length(reported_by_label) between 1 and 120),
  reported_at timestamptz not null,
  occurred_at timestamptz not null,
  what_happened text not null check (char_length(what_happened) between 1 and 3000),
  location text not null default '' check (char_length(location) <= 400),
  on_the_water boolean not null,
  conditions text not null default '' check (char_length(conditions) <= 600),
  first_aid_given boolean not null,
  first_aid_notes text not null default '' check (char_length(first_aid_notes) <= 600),
  emergency_called boolean not null,
  emergency_notes text not null default '' check (char_length(emergency_notes) <= 400),
  status text not null default 'open' check (status in ('open', 'closed')),
  updated_at timestamptz not null,
  cause text check (char_length(cause) between 1 and 2000),
  what_will_change text check (char_length(what_will_change) between 1 and 2000),
  follow_up_by text check (char_length(follow_up_by) between 1 and 120),
  damage_report_id uuid references club.damage_reports (id) on delete restrict,
  closed_at timestamptz,
  closed_note text check (char_length(closed_note) between 1 and 2000),
  -- The change this report was filed in, so the people and boats can only be added in that same change.
  created_xact xid8 not null default pg_current_xact_id(),
  seq bigint generated always as identity,
  constraint incidents_filer_is_named check ((reported_by_kind = 'member') = (reported_by_id is not null)),
  constraint incidents_occurred_before_filed check (occurred_at <= reported_at),
  constraint incidents_updated_after_filed check (updated_at >= reported_at),
  constraint incidents_closing_is_complete check ((status = 'closed') = (closed_at is not null) and (closed_at is null) = (closed_note is null)),
  constraint incidents_closed_after_filed check (closed_at is null or closed_at >= reported_at),
  constraint incidents_first_aid_notes_need_first_aid check (first_aid_given or first_aid_notes = ''),
  constraint incidents_emergency_notes_need_a_call check (emergency_called or emergency_notes = '')
);

create unique index incidents_seq_idx on club.incidents (seq);
create index incidents_open_idx on club.incidents (status) where status = 'open';
create index incidents_damage_idx on club.incidents (damage_report_id) where damage_report_id is not null;

create table club.incident_people (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references club.incidents (id) on delete restrict,
  -- Set for a member picked from the list; null for someone typed in (a guest, someone from another club).
  member_id uuid references club.members (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  injured boolean not null,
  parent_told boolean not null,
  seq bigint generated always as identity
);

create unique index incident_people_seq_idx on club.incident_people (seq);
create index incident_people_incident_idx on club.incident_people (incident_id);
-- A member is on a report once, and so is a typed name.
create unique index incident_people_member_once_idx on club.incident_people (incident_id, member_id) where member_id is not null;
create unique index incident_people_name_once_idx on club.incident_people (incident_id, lower(name)) where member_id is null;

create table club.incident_boats (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references club.incidents (id) on delete restrict,
  item_id uuid not null references club.items (id) on delete restrict,
  seq bigint generated always as identity,
  constraint incident_boats_once unique (incident_id, item_id)
);

create unique index incident_boats_seq_idx on club.incident_boats (seq);

create table club.incident_log (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references club.incidents (id) on delete restrict,
  at timestamptz not null,
  kind text not null check (kind in ('filed', 'note', 'reviewed', 'closed')),
  by_kind text not null check (by_kind in ('member', 'staff')),
  by_id text check (char_length(by_id) <= 64),
  by_label text not null check (char_length(by_label) between 1 and 120),
  text text not null check (char_length(text) between 1 and 1500),
  seq bigint generated always as identity,
  constraint incident_log_member_is_named check ((by_kind = 'member') = (by_id is not null))
);

create unique index incident_log_seq_idx on club.incident_log (seq);
create index incident_log_incident_idx on club.incident_log (incident_id);
-- A report is filed once.
create unique index incident_log_one_filed_idx on club.incident_log (incident_id) where kind = 'filed';

/* ---------- A report: filed by staff or a coach, reviewed while open, closed for good ---------- */

create function club.guard_incident_insert() returns trigger language plpgsql as $$
begin
  if new.status <> 'open' then
    raise exception 'An incident report starts open.';
  end if;
  if new.cause is not null or new.what_will_change is not null or new.follow_up_by is not null or new.damage_report_id is not null then
    raise exception 'A new incident report has not been reviewed yet, so it starts without a cause, a change, a follow-up person or a damage report.';
  end if;
  if new.reported_by_kind = 'member' and not exists (
    select 1 from club.members m join club.households h on h.id = m.household_id
     where m.id::text = new.reported_by_id and m.is_coach and m.status = 'active' and h.status = 'active'
  ) then
    raise exception 'Only club staff and coaches can file an incident report.';
  end if;
  return new;
end $$;

create trigger incidents_insert_guard before insert on club.incidents
  for each row execute function club.guard_incident_insert();

create function club.guard_incident() returns trigger language plpgsql as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'An incident report cannot be removed.';
  end if;
  if old.status = 'closed' then
    raise exception 'An incident report that is already closed cannot change. If something has come back, file a new report.';
  end if;
  if new.id is distinct from old.id
    or new.reported_by_kind is distinct from old.reported_by_kind
    or new.reported_by_id is distinct from old.reported_by_id
    or new.reported_by_label is distinct from old.reported_by_label
    or new.reported_at is distinct from old.reported_at
    or new.occurred_at is distinct from old.occurred_at
    or new.what_happened is distinct from old.what_happened
    or new.location is distinct from old.location
    or new.on_the_water is distinct from old.on_the_water
    or new.conditions is distinct from old.conditions
    or new.first_aid_given is distinct from old.first_aid_given
    or new.first_aid_notes is distinct from old.first_aid_notes
    or new.emergency_called is distinct from old.emergency_called
    or new.emergency_notes is distinct from old.emergency_notes
    or new.created_xact is distinct from old.created_xact
    or new.seq is distinct from old.seq then
    raise exception 'What was written when an incident report was filed cannot be changed.';
  end if;
  return new;
end $$;

create trigger incidents_no_change before update or delete on club.incidents
  for each row execute function club.guard_incident();
create trigger incidents_no_truncate before truncate on club.incidents
  for each statement execute function club.guard_incident();

-- At the end of the change: a new report has its "filed" line, and a status or review field that changed has the matching line,
-- written at the moment the report says it changed.
create function club.check_incident_log() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from club.incident_log where incident_id = new.id and kind = 'filed') then
      raise exception 'An incident report needs its "filed" line in the log.';
    end if;
    return null;
  end if;
  if new.status is distinct from old.status then
    if not exists (select 1 from club.incident_log where incident_id = new.id and kind = 'closed' and at = new.updated_at) then
      raise exception 'An incident report''s status cannot change without a matching "closed" line in its log.';
    end if;
  end if;
  if new.cause is distinct from old.cause
    or new.what_will_change is distinct from old.what_will_change
    or new.follow_up_by is distinct from old.follow_up_by
    or new.damage_report_id is distinct from old.damage_report_id then
    if not exists (select 1 from club.incident_log where incident_id = new.id and kind = 'reviewed' and at = new.updated_at) then
      raise exception 'An incident report''s cause, change, follow-up person or damage report cannot change without a matching "reviewed" line in its log.';
    end if;
  end if;
  return null;
end $$;

create constraint trigger incidents_need_a_log_line after insert or update on club.incidents
  deferrable initially deferred for each row execute function club.check_incident_log();

/* ---------- The people and boats: added with the report, never changed ---------- */

create function club.guard_incident_child_insert() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from club.incidents where id = new.incident_id and created_xact = pg_current_xact_id()) then
    raise exception 'The people and boats on an incident report can only be added when it is filed.';
  end if;
  return new;
end $$;

create trigger incident_people_insert_guard before insert on club.incident_people
  for each row execute function club.guard_incident_child_insert();
create trigger incident_boats_insert_guard before insert on club.incident_boats
  for each row execute function club.guard_incident_child_insert();

-- A member named from the list is an active member of an active household; anyone else is typed in by name.
create function club.guard_incident_person_insert() returns trigger language plpgsql as $$
begin
  if new.member_id is not null and not exists (
    select 1 from club.members m join club.households h on h.id = m.household_id
     where m.id = new.member_id and m.status = 'active' and h.status = 'active'
  ) then
    raise exception 'Only an active member can be named from the list. Type anyone else''s name instead.';
  end if;
  return new;
end $$;

create trigger incident_people_member_guard before insert on club.incident_people
  for each row execute function club.guard_incident_person_insert();

create function club.guard_incident_child() returns trigger language plpgsql as $$
begin
  raise exception 'The people and boats on an incident report cannot be changed or removed.';
end $$;

create trigger incident_people_no_change before update or delete on club.incident_people
  for each row execute function club.guard_incident_child();
create trigger incident_people_no_truncate before truncate on club.incident_people
  for each statement execute function club.guard_incident_child();
create trigger incident_boats_no_change before update or delete on club.incident_boats
  for each row execute function club.guard_incident_child();
create trigger incident_boats_no_truncate before truncate on club.incident_boats
  for each statement execute function club.guard_incident_child();

/* ---------- The log: added to, never changed ---------- */

create function club.guard_incident_log_insert() returns trigger language plpgsql as $$
declare
  v_by_kind text;
  v_by_id text;
  v_status text;
  v_at timestamptz;
begin
  select reported_by_kind, reported_by_id, status, reported_at into v_by_kind, v_by_id, v_status, v_at from club.incidents where id = new.incident_id;
  if new.at < v_at then
    raise exception 'A log line cannot be dated before the report was filed.';
  end if;
  if new.kind = 'filed' and (new.by_kind <> v_by_kind or new.by_id is distinct from v_by_id) then
    raise exception 'The "filed" line must name the person who filed the report.';
  end if;
  if new.by_kind = 'member' then
    if new.kind not in ('filed', 'note') then
      raise exception 'Coaches can only file a report and add notes to their own. Everything else is club staff''s.';
    end if;
    if new.kind = 'note' then
      if v_by_kind <> 'member' or new.by_id is distinct from v_by_id then
        raise exception 'Only club staff, or the coach who filed the report, can add a note.';
      end if;
      if v_status = 'closed' then
        raise exception 'A closed incident report only takes notes from club staff.';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger incident_log_insert_guard before insert on club.incident_log
  for each row execute function club.guard_incident_log_insert();

create function club.guard_incident_log() returns trigger language plpgsql as $$
begin
  raise exception 'A line in an incident report''s log cannot be changed or removed.';
end $$;

create trigger incident_log_no_change before update or delete on club.incident_log
  for each row execute function club.guard_incident_log();
create trigger incident_log_no_truncate before truncate on club.incident_log
  for each statement execute function club.guard_incident_log();

/* ---------- Locked to the owner ---------- */

alter table club.incidents enable row level security;
alter table club.incident_people enable row level security;
alter table club.incident_boats enable row level security;
alter table club.incident_log enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
