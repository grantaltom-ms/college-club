-- The test outbox, kept in the shared test database (Nov 5, 2026).
--
-- In a test build nothing is ever emailed: the club's "emails" (sign-in links, and the notices about waiting lists, cancelled
-- events and boats taken out of service) are written here and shown on the test outbox page. Until now they lived in one running
-- server's memory, so on a preview made of several servers the page showed only the emails that one server had sent.
--
-- The building comparison: the carbon-copy book at the front desk. Every letter the office would have posted is copied into it in
-- the order it was written, nobody tears a page out, and anyone at the desk can read it.
--
-- This table exists only for test builds. The real sender (Resend) never writes here, and the page that reads it does not exist
-- on the live site. The database refuses, on its own, to change or remove a copy, or to empty the book.
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

create table club.test_mail (
  seq bigint generated always as identity primary key,
  sent_at timestamptz not null,
  to_email text not null check (char_length(to_email) between 3 and 320),
  subject text not null check (char_length(subject) between 1 and 500),
  body text not null check (char_length(body) <= 50000)
);
create index test_mail_newest_idx on club.test_mail (seq desc);

create function club.test_mail_guard() returns trigger language plpgsql as $$
begin
  raise exception 'A test email cannot be changed or removed.';
end $$;

create trigger test_mail_no_change before update or delete on club.test_mail for each row execute function club.test_mail_guard();
create trigger test_mail_no_truncate before truncate on club.test_mail for each statement execute function club.test_mail_guard();

alter table club.test_mail enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
