-- Damage reports: a work order for a boat or space, and the log of everything that happened to it.
--
-- The building comparison: the maintenance request box. A tenant drops in a request (what is wrong, where, how it happened, how
-- serious). The office triages it (how urgent, who is on it), can close the unit until it is fixed, and closes the request with what
-- was done and what it cost. What the tenant wrote is never rewritten, a closed request stays closed, and every step is a line in
-- the request's own log.
--
-- The database refuses these on its own, whatever the app does:
-- - a report or a log line being removed, or a log line being changed;
-- - the words the filer wrote (item, who, when, what, where, how, major) changing after the report is filed;
-- - a closed report (repaired or dismissed) changing in any way, and a status moving anywhere but forward
--   (open, then being fixed, then repaired or dismissed);
-- - a closed report without its closing details (when and who repaired, or the reason), or closing details on one that is not closed;
-- - a report without its "filed" line, and a status, priority or assignee changing without a matching line in the log, written in
--   the same change and at the same moment;
-- - a member writing any log line but "filed" or a note, a note by anyone but the person who filed the report, and a note on a
--   closed report by a member;
-- - a member filing a report on a private boat they are not on the list of.
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

create table club.damage_reports (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references club.items (id) on delete restrict,
  reported_by_kind text not null check (reported_by_kind in ('member', 'staff')),
  -- Which member, when a member filed it.
  reported_by_id text check (char_length(reported_by_id) <= 64),
  reported_by_label text not null check (char_length(reported_by_label) between 1 and 120),
  reported_at timestamptz not null,
  description text not null check (char_length(description) between 1 and 1000),
  location text not null default '' check (char_length(location) <= 300),
  how_it_happened text not null default '' check (char_length(how_it_happened) <= 1000),
  major boolean not null,
  priority smallint not null check (priority between 1 and 4),
  status text not null default 'open' check (status in ('open', 'in_progress', 'repaired', 'dismissed')),
  updated_at timestamptz not null,
  assigned_to text check (char_length(assigned_to) between 1 and 120),
  closed_at timestamptz,
  repaired_on date,
  repaired_by text check (char_length(repaired_by) between 1 and 120),
  repair_minutes integer check (repair_minutes between 0 and 60000),
  cost_cents integer check (cost_cents between 0 and 10000000),
  repair_notes text check (char_length(repair_notes) between 1 and 2000),
  dismissed_reason text check (char_length(dismissed_reason) between 1 and 200),
  seq bigint generated always as identity,
  constraint damage_reports_filer_is_named check ((reported_by_kind = 'member') = (reported_by_id is not null)),
  constraint damage_reports_updated_after_filed check (updated_at >= reported_at),
  constraint damage_reports_closing_is_complete check ((status in ('repaired', 'dismissed')) = (closed_at is not null)),
  constraint damage_reports_closed_after_filed check (closed_at is null or closed_at >= reported_at),
  constraint damage_reports_repair_is_complete check ((status = 'repaired') = (repaired_on is not null and repaired_by is not null)),
  constraint damage_reports_repair_only_when_repaired check (
    status = 'repaired' or (repaired_on is null and repaired_by is null and repair_minutes is null and cost_cents is null and repair_notes is null)
  ),
  constraint damage_reports_dismissal_is_complete check ((status = 'dismissed') = (dismissed_reason is not null))
);

create unique index damage_reports_seq_idx on club.damage_reports (seq);
create index damage_reports_item_idx on club.damage_reports (item_id);
create index damage_reports_open_idx on club.damage_reports (status) where status in ('open', 'in_progress');

create table club.damage_log (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references club.damage_reports (id) on delete restrict,
  at timestamptz not null,
  kind text not null check (kind in ('filed', 'note', 'assigned', 'priority_changed', 'started', 'taken_out_of_service', 'returned_to_service', 'repaired', 'dismissed')),
  by_kind text not null check (by_kind in ('member', 'staff')),
  by_id text check (char_length(by_id) <= 64),
  by_label text not null check (char_length(by_label) between 1 and 120),
  text text not null check (char_length(text) between 1 and 1500),
  seq bigint generated always as identity,
  constraint damage_log_member_is_named check ((by_kind = 'member') = (by_id is not null))
);

create unique index damage_log_seq_idx on club.damage_log (seq);
create index damage_log_report_idx on club.damage_log (report_id);
-- A report is filed once.
create unique index damage_log_one_filed_idx on club.damage_log (report_id) where kind = 'filed';

/* ---------- A report: filed once, triaged while open, closed for good ---------- */

create function club.guard_damage_report_insert() returns trigger language plpgsql as $$
begin
  if new.status <> 'open' then
    raise exception 'A damage report starts open.';
  end if;
  -- A private boat is not shown to members who are not on its list, so they cannot report on it either.
  if new.reported_by_kind = 'member' and exists (select 1 from club.items where id = new.item_id and is_private) then
    if not exists (select 1 from club.item_access where item_id = new.item_id and member_id::text = new.reported_by_id and ended_at is null) then
      raise exception 'Only the people on a private boat''s list can report damage on it.';
    end if;
  end if;
  return new;
end $$;

create trigger damage_reports_insert_guard before insert on club.damage_reports
  for each row execute function club.guard_damage_report_insert();

create function club.guard_damage_report() returns trigger language plpgsql as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'A damage report cannot be removed.';
  end if;
  if old.status in ('repaired', 'dismissed') then
    raise exception 'A damage report that is already % cannot change. If the damage is back, file a new report.', replace(old.status, '_', ' ');
  end if;
  if new.id is distinct from old.id
    or new.item_id is distinct from old.item_id
    or new.reported_by_kind is distinct from old.reported_by_kind
    or new.reported_by_id is distinct from old.reported_by_id
    or new.reported_by_label is distinct from old.reported_by_label
    or new.reported_at is distinct from old.reported_at
    or new.description is distinct from old.description
    or new.location is distinct from old.location
    or new.how_it_happened is distinct from old.how_it_happened
    or new.major is distinct from old.major
    or new.seq is distinct from old.seq then
    raise exception 'What was written when a damage report was filed cannot be changed.';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'open' and new.status in ('in_progress', 'repaired', 'dismissed'))
    or (old.status = 'in_progress' and new.status in ('repaired', 'dismissed'))
  ) then
    raise exception 'A damage report can only move forward: open, being fixed, then repaired or dismissed.';
  end if;
  return new;
end $$;

create trigger damage_reports_no_change before update or delete on club.damage_reports
  for each row execute function club.guard_damage_report();
create trigger damage_reports_no_truncate before truncate on club.damage_reports
  for each statement execute function club.guard_damage_report();

-- At the end of the change: a new report has its "filed" line, and a status, priority or assignee that changed has the matching
-- line, written at the moment the report says it changed.
create function club.check_damage_report_log() returns trigger language plpgsql as $$
declare
  v_kind text;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from club.damage_log where report_id = new.id and kind = 'filed') then
      raise exception 'A damage report needs its "filed" line in the log.';
    end if;
    return null;
  end if;
  if new.status is distinct from old.status then
    v_kind := case new.status when 'in_progress' then 'started' when 'repaired' then 'repaired' when 'dismissed' then 'dismissed' end;
    if not exists (select 1 from club.damage_log where report_id = new.id and kind = v_kind and at = new.updated_at) then
      raise exception 'A damage report''s status cannot change without a matching "%" line in its log.', v_kind;
    end if;
  end if;
  if new.priority is distinct from old.priority then
    if not exists (select 1 from club.damage_log where report_id = new.id and kind = 'priority_changed' and at = new.updated_at) then
      raise exception 'A damage report''s priority cannot change without a matching "priority_changed" line in its log.';
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    if not exists (select 1 from club.damage_log where report_id = new.id and kind = 'assigned' and at = new.updated_at) then
      raise exception 'Who a damage report is assigned to cannot change without a matching "assigned" line in its log.';
    end if;
  end if;
  return null;
end $$;

create constraint trigger damage_reports_need_a_log_line after insert or update on club.damage_reports
  deferrable initially deferred for each row execute function club.check_damage_report_log();

/* ---------- The log: added to, never changed ---------- */

create function club.guard_damage_log_insert() returns trigger language plpgsql as $$
declare
  v_by_kind text;
  v_by_id text;
  v_status text;
  v_at timestamptz;
begin
  select reported_by_kind, reported_by_id, status, reported_at into v_by_kind, v_by_id, v_status, v_at from club.damage_reports where id = new.report_id;
  if new.at < v_at then
    raise exception 'A log line cannot be dated before the report was filed.';
  end if;
  if new.kind = 'filed' and (new.by_kind <> v_by_kind or new.by_id is distinct from v_by_id) then
    raise exception 'The "filed" line must name the person who filed the report.';
  end if;
  if new.by_kind = 'member' then
    if new.kind not in ('filed', 'note') then
      raise exception 'Members can only file a report and add notes to their own. Everything else is club staff''s.';
    end if;
    if new.kind = 'note' then
      if v_by_kind <> 'member' or new.by_id is distinct from v_by_id then
        raise exception 'Only club staff, or the person who filed the report, can add a note.';
      end if;
      if v_status in ('repaired', 'dismissed') then
        raise exception 'A closed damage report only takes notes from club staff.';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger damage_log_insert_guard before insert on club.damage_log
  for each row execute function club.guard_damage_log_insert();

create function club.guard_damage_log() returns trigger language plpgsql as $$
begin
  raise exception 'A line in a damage report''s log cannot be changed or removed.';
end $$;

create trigger damage_log_no_change before update or delete on club.damage_log
  for each row execute function club.guard_damage_log();
create trigger damage_log_no_truncate before truncate on club.damage_log
  for each statement execute function club.guard_damage_log();

/* ---------- Locked to the owner ---------- */

alter table club.damage_reports enable row level security;
alter table club.damage_log enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
