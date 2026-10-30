-- The public "Request a tour" form: a prospect leaves their name and email (and, if they like, a phone number and a note), and
-- the club's staff see it on a list.
--
-- The building comparison: the card a visitor leaves at the front desk. Cards are kept in the order they arrive, nobody tears
-- one up, and the desk can mark a card "called back" once. A tour request is a stranger, not a member, so it is stored on its
-- own and never touches households, members, bookings or billing.
--
-- The database refuses these on its own, whatever the app does:
-- - removing a request, or emptying the list;
-- - changing anything about a request except marking it followed up, once, with who did it and when;
-- - a name or email that is empty, padded with spaces, or (for the email) not lower case, and over-long notes.
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

create table club.tour_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null,
  name text not null check (char_length(name) between 1 and 120 and name = btrim(name)),
  email text not null check (char_length(email) between 3 and 254 and email = lower(btrim(email))),
  -- As the person typed it, trimmed. Empty when they left it out.
  phone text not null default '' check (char_length(phone) <= 40 and phone = btrim(phone)),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'new' check (status in ('new', 'followed_up')),
  followed_up_at timestamptz,
  followed_up_by text check (followed_up_by is null or char_length(followed_up_by) between 1 and 120),
  seq bigint generated always as identity,
  constraint tour_requests_followup_is_complete check (
    (status = 'new' and followed_up_at is null and followed_up_by is null)
    or (status = 'followed_up' and followed_up_at is not null and followed_up_by is not null)
  )
);
create unique index tour_requests_seq_idx on club.tour_requests (seq);
create index tour_requests_created_idx on club.tour_requests (created_at desc, seq desc);
create index tour_requests_email_idx on club.tour_requests (email, created_at desc);

/* ---------- Never removed; changed only by marking one followed up ---------- */

create function club.tour_requests_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'new' and new.status = 'followed_up'
       and new.id = old.id and new.created_at = old.created_at and new.name = old.name and new.email = old.email
       and new.phone = old.phone and new.note = old.note and new.seq = old.seq then
      return new;
    end if;
    raise exception 'A tour request cannot be changed. It can only be marked followed up, once.';
  end if;
  raise exception 'A tour request cannot be removed.';
end $$;

create trigger tour_requests_no_change before update or delete on club.tour_requests for each row execute function club.tour_requests_guard();
create trigger tour_requests_no_truncate before truncate on club.tour_requests for each statement execute function club.tour_requests_guard();

/* ---------- Locked to the owner ---------- */

alter table club.tour_requests enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
