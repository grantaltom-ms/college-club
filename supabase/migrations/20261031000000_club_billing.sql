-- Step 9: charges, visitors and the monthly billing run.
--
-- The building comparison: the rent ledger. Staff write bar and snack-bar sales and adjustments into it, the front-desk
-- iPad logs visitors, and once a month the office closes the month: every household's statement is worked out and
-- frozen, and a file for QuickBooks is made from it. A closed month is never reopened. A mistake found later is put
-- right with an adjustment dated in an open month, so nothing is ever billed twice.
--
-- The database refuses these on its own, whatever the app does:
-- - a charge or a visitor entry dated in a month that was already closed, or voided after its month closed;
-- - changing or removing a closed month, or any line on its invoices;
-- - closing months out of order, or a run whose lines do not add up to what the run says;
-- - changing a household's QuickBooks ID without a matching line in the household's file.
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

/* ---------- A new kind of line in the household's file: the QuickBooks link ---------- */

alter table club.household_history drop constraint household_history_kind_check;
alter table club.household_history add constraint household_history_kind_check check (
  kind in ('joined', 'member_added', 'member_removed', 'member_updated', 'primary_changed', 'type_changed', 'qualification_granted', 'bookings_cancelled', 'signups_cancelled', 'rsvps_cancelled', 'quickbooks_linked', 'membership_ended')
);

-- A household's QuickBooks ID can be set or corrected, never cleared, and never without a line saying what it was and what
-- it is now. Checked at the end of the change, so the line may be written after the record it explains.
create function club.require_quickbooks_line() returns trigger language plpgsql as $$
begin
  if new.quickbooks_id is not distinct from old.quickbooks_id then
    return null;
  end if;
  if new.quickbooks_id is null then
    raise exception 'A household''s QuickBooks ID can be corrected but not cleared.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from club.household_history h
    where h.household_id = new.id
      and h.kind = 'quickbooks_linked'
      and h.details ->> 'to' = new.quickbooks_id
      and (h.details ->> 'from') is not distinct from old.quickbooks_id
  ) then
    raise exception 'A household''s QuickBooks ID cannot change without a matching line in its file.' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger households_quickbooks_line after update of quickbooks_id on club.households
  deferrable initially deferred for each row execute function club.require_quickbooks_line();

/* ---------- Closed months ---------- */

create table club.billing_runs (
  id uuid primary key default gen_random_uuid(),
  -- The month that was billed, Pacific, YYYY-MM. Each month is closed once.
  month text not null unique check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at timestamptz not null,
  created_by_kind text not null check (created_by_kind = 'staff'),
  created_by_label text not null check (char_length(created_by_label) between 1 and 120),
  invoice_count integer not null check (invoice_count >= 0),
  total_cents bigint not null,
  seq bigint generated always as identity unique
);

create table club.billing_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references club.billing_runs (id) on delete restrict,
  household_id uuid not null references club.households (id) on delete restrict,
  -- Shared by all of one household's lines in one run.
  invoice_no text not null check (char_length(invoice_no) between 1 and 21),
  kind text not null check (kind in ('dues', 'event_tickets', 'visitor_fees', 'bar', 'snack_bar')),
  description text not null check (char_length(description) between 1 and 300),
  quantity integer not null check (quantity >= 1),
  unit_cents integer not null,
  amount_cents integer not null,
  taxable boolean not null,
  adjustment boolean not null,
  seq bigint generated always as identity unique,
  constraint billing_lines_amount_is_quantity_times_unit check (amount_cents = quantity * unit_cents),
  -- Only an adjustment can be a credit.
  constraint billing_lines_credit_is_adjustment check (adjustment or amount_cents >= 0)
);

create index billing_lines_run_idx on club.billing_lines (run_id, seq);
create index billing_lines_household_idx on club.billing_lines (household_id);

-- The two tables are only ever added to.
create function club.billing_is_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'A closed month and its invoice lines can only be added to, never changed or removed.';
end $$;

create trigger billing_runs_no_change before update or delete on club.billing_runs for each row execute function club.billing_is_append_only();
create trigger billing_runs_no_truncate before truncate on club.billing_runs for each statement execute function club.billing_is_append_only();
create trigger billing_lines_no_change before update or delete on club.billing_lines for each row execute function club.billing_is_append_only();
create trigger billing_lines_no_truncate before truncate on club.billing_lines for each statement execute function club.billing_is_append_only();

-- Months are closed in order: the first run can be any month, and each one after that is the month right after the last.
create function club.guard_billing_run() returns trigger language plpgsql as $$
declare
  last_month text;
begin
  select max(month) into last_month from club.billing_runs;
  if last_month is not null
     and new.month <> to_char(to_date(last_month || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM') then
    raise exception 'Months are billed in order. After % comes %.', last_month, to_char(to_date(last_month || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM') using errcode = '23514';
  end if;
  return new;
end $$;

create trigger billing_runs_in_order before insert on club.billing_runs for each row execute function club.guard_billing_run();

-- A run must say exactly what its lines say: how many invoices, and the total. An invoice belongs to one household.
-- Checked at the end of the change, so the lines may be written after the run, and a line added to an old run later
-- would break the totals and be refused.
create function club.check_billing_run_adds_up() returns trigger language plpgsql as $$
declare
  the_run uuid;
  r club.billing_runs;
begin
  -- The same check runs for the run itself and for each of its lines.
  if tg_table_name = 'billing_runs' then
    the_run := new.id;
  else
    the_run := new.run_id;
  end if;
  select * into r from club.billing_runs where id = the_run;
  if (select count(distinct invoice_no) from club.billing_lines where run_id = the_run) <> r.invoice_count
     or (select coalesce(sum(amount_cents), 0) from club.billing_lines where run_id = the_run) <> r.total_cents then
    raise exception 'The invoice lines of a month must add up to what the month says.' using errcode = '23514';
  end if;
  if exists (select 1 from club.billing_lines where run_id = the_run group by invoice_no having count(distinct household_id) > 1) then
    raise exception 'An invoice belongs to one household.' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger billing_runs_add_up after insert on club.billing_runs
  deferrable initially deferred for each row execute function club.check_billing_run_adds_up();
create constraint trigger billing_lines_add_up after insert on club.billing_lines
  deferrable initially deferred for each row execute function club.check_billing_run_adds_up();

-- Whether a day falls in a month that was already closed.
create function club.month_is_billed(d date) returns boolean language sql stable as $$
  select exists (select 1 from club.billing_runs where month = to_char(d, 'YYYY-MM'))
$$;

/* ---------- Charges: bar, snack bar and adjustments, typed in by staff ---------- */

create table club.charges (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references club.households (id) on delete restrict,
  member_id uuid references club.members (id) on delete restrict,
  day date not null,
  category text not null check (category in ('dues', 'event_tickets', 'visitor_fees', 'bar', 'snack_bar')),
  adjustment boolean not null,
  amount_cents integer not null check (amount_cents <> 0 and abs(amount_cents) <= 10000000),
  description text not null check (char_length(description) between 1 and 200),
  created_at timestamptz not null,
  created_by_kind text not null check (created_by_kind = 'staff'),
  created_by_label text not null check (char_length(created_by_label) between 1 and 120),
  status text not null default 'open' check (status in ('open', 'voided')),
  voided_at timestamptz,
  voided_by_label text check (char_length(voided_by_label) between 1 and 120),
  void_reason text check (char_length(void_reason) between 1 and 300),
  seq bigint generated always as identity unique,
  -- A sale is a bar or snack-bar charge and is never negative. Only an adjustment can be a credit or go under another line.
  constraint charges_sale_is_positive check (adjustment or (category in ('bar', 'snack_bar') and amount_cents > 0)),
  constraint charges_void_matches_status check ((status = 'voided') = (voided_at is not null and voided_by_label is not null and void_reason is not null))
);

create index charges_day_idx on club.charges (day);
create index charges_household_idx on club.charges (household_id, day);

create function club.guard_charge() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if club.month_is_billed(new.day) then
      raise exception 'That month was already billed, so a charge cannot be dated in it. Add an adjustment dated in an open month.' using errcode = '23514';
    end if;
    if new.status <> 'open' then
      raise exception 'A charge starts open.';
    end if;
    if new.member_id is not null and not exists (select 1 from club.members where id = new.member_id and household_id = new.household_id) then
      raise exception 'A charge can only name someone in the household it is charged to.' using errcode = '23514';
    end if;
  else
    if new.id is distinct from old.id
       or new.household_id is distinct from old.household_id
       or new.member_id is distinct from old.member_id
       or new.day is distinct from old.day
       or new.category is distinct from old.category
       or new.adjustment is distinct from old.adjustment
       or new.amount_cents is distinct from old.amount_cents
       or new.description is distinct from old.description
       or new.created_at is distinct from old.created_at
       or new.created_by_label is distinct from old.created_by_label then
      raise exception 'A charge cannot be changed. Void it and enter a new one.';
    end if;
    if old.status = 'voided' then
      raise exception 'A voided charge cannot change again.';
    end if;
    if club.month_is_billed(old.day) then
      raise exception 'That charge was already billed. Add an adjustment dated in an open month instead.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger charges_guard before insert or update on club.charges for each row execute function club.guard_charge();

create function club.charges_are_never_removed() returns trigger language plpgsql as $$
begin
  raise exception 'Charges are never removed. Void one with a reason.';
end $$;

create trigger charges_no_delete before delete on club.charges for each row execute function club.charges_are_never_removed();
create trigger charges_no_truncate before truncate on club.charges for each statement execute function club.charges_are_never_removed();

/* ---------- Visitors: how many a member brought, signed in on the iPad or entered by staff ---------- */

create table club.visitor_entries (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references club.members (id) on delete restrict,
  day date not null,
  visitors integer not null check (visitors between 1 and 50),
  created_at timestamptz not null,
  created_by_kind text not null check (created_by_kind in ('member', 'staff')),
  created_by_id text,
  created_by_label text not null check (char_length(created_by_label) between 1 and 120),
  via text not null check (via in ('ipad', 'staff')),
  status text not null default 'recorded' check (status in ('recorded', 'voided')),
  voided_at timestamptz,
  voided_by_label text check (char_length(voided_by_label) between 1 and 120),
  void_reason text check (char_length(void_reason) between 1 and 300),
  seq bigint generated always as identity unique,
  -- Who did it and how must agree: the member themselves on the iPad, staff at the front desk.
  constraint visitor_entries_who_matches_how check (
    (via = 'ipad' and created_by_kind = 'member' and coalesce(created_by_id = member_id::text, false))
    or (via = 'staff' and created_by_kind = 'staff')
  ),
  constraint visitor_entries_void_matches_status check ((status = 'voided') = (voided_at is not null and voided_by_label is not null and void_reason is not null))
);

create index visitor_entries_day_idx on club.visitor_entries (day);
create index visitor_entries_member_idx on club.visitor_entries (member_id, day);

create function club.guard_visitor_entry() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if club.month_is_billed(new.day) then
      raise exception 'That month was already billed, so visitors cannot be added to it. Add an adjustment dated in an open month.' using errcode = '23514';
    end if;
    if new.status <> 'recorded' then
      raise exception 'A visitor entry starts recorded.';
    end if;
    if not exists (
      select 1 from club.members m join club.households h on h.id = m.household_id
      where m.id = new.member_id and m.status = 'active' and h.status = 'active'
    ) then
      raise exception 'Visitors can only be recorded for a member who is active in an active household.' using errcode = '23514';
    end if;
  else
    if new.id is distinct from old.id
       or new.member_id is distinct from old.member_id
       or new.day is distinct from old.day
       or new.visitors is distinct from old.visitors
       or new.created_at is distinct from old.created_at
       or new.created_by_kind is distinct from old.created_by_kind
       or new.created_by_id is distinct from old.created_by_id
       or new.created_by_label is distinct from old.created_by_label
       or new.via is distinct from old.via then
      raise exception 'A visitor entry cannot be changed. Void it and enter a new one.';
    end if;
    if old.status = 'voided' then
      raise exception 'A voided visitor entry cannot change again.';
    end if;
    if club.month_is_billed(old.day) then
      raise exception 'That month was already billed. Add an adjustment dated in an open month instead.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger visitor_entries_guard before insert or update on club.visitor_entries for each row execute function club.guard_visitor_entry();

create function club.visitor_entries_are_never_removed() returns trigger language plpgsql as $$
begin
  raise exception 'Visitor entries are never removed. Void one with a reason.';
end $$;

create trigger visitor_entries_no_delete before delete on club.visitor_entries for each row execute function club.visitor_entries_are_never_removed();
create trigger visitor_entries_no_truncate before truncate on club.visitor_entries for each statement execute function club.visitor_entries_are_never_removed();

/* ---------- Locked to the owner ---------- */

alter table club.billing_runs enable row level security;
alter table club.billing_lines enable row level security;
alter table club.charges enable row level security;
alter table club.visitor_entries enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
