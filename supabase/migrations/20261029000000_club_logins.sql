-- Step 6: real logins. One-time sign-in links and signed-in browsers.
--
-- The building comparison: a sign-in link is a one-time key left in a mailbox; a session is the key a signed-in browser holds.
-- Only fingerprints (SHA-256) of the secrets are kept, so a copy of this database cannot be used to sign in.
-- Nothing is deleted: a used link and a signed-out browser are marked, not removed. Each row can change exactly once
-- (used, or signed out) and nothing else about it can ever change.
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

/* ---------- Sign-in links ---------- */

create table club.login_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  -- A link is short-lived: it must expire after it was made, and within 24 hours. (Hours, not days, so a clock change never moves the ceiling.)
  constraint login_tokens_lifetime check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  -- A link can only be used while it is alive.
  constraint login_tokens_used_while_alive check (used_at is null or (used_at >= created_at and used_at <= expires_at))
);

create index login_tokens_email_idx on club.login_tokens (email, created_at desc);

/* ---------- Signed-in browsers ---------- */

create table club.sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  subject_kind text not null check (subject_kind in ('member', 'staff')),
  member_id uuid references club.members (id) on delete restrict,
  staff_email text check (staff_email = lower(staff_email) and char_length(staff_email) between 3 and 254),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  -- A member session names the member and nothing else; a staff session names the staff email and nothing else.
  constraint sessions_subject_matches check (
    (subject_kind = 'member' and member_id is not null and staff_email is null)
    or (subject_kind = 'staff' and staff_email is not null and member_id is null)
  ),
  -- Staying signed in has a ceiling, whatever the app asks for: 90 days of 24 hours.
  constraint sessions_lifetime check (expires_at > created_at and expires_at <= created_at + interval '2160 hours'),
  constraint sessions_revoked_after_made check (revoked_at is null or revoked_at >= created_at)
);

create index sessions_member_idx on club.sessions (member_id) where member_id is not null;
create index sessions_staff_idx on club.sessions (staff_email) where staff_email is not null;

/* ---------- Each row changes once and is never removed ---------- */

create function club.guard_login_token() returns trigger language plpgsql as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'Sign-in links are never removed.';
  end if;
  if new.id is distinct from old.id
    or new.token_hash is distinct from old.token_hash
    or new.email is distinct from old.email
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at then
    raise exception 'A sign-in link cannot be changed, only used.';
  end if;
  if old.used_at is not null and new.used_at is distinct from old.used_at then
    raise exception 'A sign-in link can only be used once.';
  end if;
  return new;
end $$;

create trigger login_tokens_guard before update or delete on club.login_tokens
  for each row execute function club.guard_login_token();
create trigger login_tokens_no_truncate before truncate on club.login_tokens
  for each statement execute function club.guard_login_token();

create function club.guard_session() returns trigger language plpgsql as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'Sessions are never removed.';
  end if;
  if new.id is distinct from old.id
    or new.token_hash is distinct from old.token_hash
    or new.subject_kind is distinct from old.subject_kind
    or new.member_id is distinct from old.member_id
    or new.staff_email is distinct from old.staff_email
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at then
    raise exception 'A session cannot be changed, only signed out.';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A session that is signed out stays signed out.';
  end if;
  return new;
end $$;

create trigger sessions_guard before update or delete on club.sessions
  for each row execute function club.guard_session();
create trigger sessions_no_truncate before truncate on club.sessions
  for each statement execute function club.guard_session();

/* ---------- Locked to the owner ---------- */

alter table club.login_tokens enable row level security;
alter table club.sessions enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
