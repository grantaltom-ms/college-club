# Database for the member system

Versioned changes live in `migrations/`, one file per change, applied in file-name order. Everything is in the
`club` schema, apart from the dashboard's tables in `public`.

**Phase 1 rule: nothing here is ever applied to the live Supabase project.** The local database and the automated
tests are the only places these files run.

## Run it on your own computer

1. Install Docker Desktop and the [Supabase CLI](https://supabase.com/docs/guides/local-development).
2. In the repo folder: `supabase start`. It creates a database on your computer and applies `migrations/`.
3. Start over from scratch any time: `supabase db reset`.
4. Put the local address from `supabase status` in `.env.local` as `CLUB_DATABASE_URL`.

(`supabase/config.toml` is written by hand and has not been tried with the CLI yet: the cloud session that wrote it
has no Docker. If `supabase start` complains, run `supabase init` in a scratch folder and compare.)

## Run the database tests

The tests make a fresh scratch database, run every migration in it, check the rules, and delete it.

```
CLUB_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test
```

Use any local or throwaway Postgres 16. The tests refuse any address that looks like a hosted Supabase project.
Without the variable they are skipped (and say so); CI always provides one.

## Adding a change

Add a new file, e.g. `20261105000000_club_bookings.sql`. Never edit one that has already been applied anywhere.
