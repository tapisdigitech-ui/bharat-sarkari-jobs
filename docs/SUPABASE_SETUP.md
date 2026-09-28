# Supabase connection plan (Phase 3.6)

**Status: Supabase implementation prepared; local PostgreSQL/RLS tests pass; real Supabase validation pending.**
No Supabase project exists yet. Everything below has been rehearsed against local PostgreSQL 16 with a stand-in for the
Supabase API (`tests/harness/`), which is **not** Supabase. Each step says what the local rehearsal proved and what can
only be proved on the real project.

Do this first for a **staging** project. Production repeats the same steps later with its own keys and data.

---

## 1. Create the Supabase project

- Region: **ap-south-1 (Mumbai)** — closest to readers and to the government sites the crawler reads.
- Postgres version: 16.x (the migrations were written and verified on 16).
- Plan: one with **Point-in-Time Recovery** for production (`docs/DISASTER_RECOVERY.md` §1). Staging can use daily backups.
- Name projects so they cannot be confused: `bsj-staging`, `bsj-production`.
- Record the project ref and database password in the team password manager — never in the repository.

## 2. Configure authentication

- Authentication → Providers → **Email**: enabled. Other providers: off.
- **Disable public sign-ups** (Authentication → Settings → "Allow new users to sign up": off). Staff accounts are
  created only with `npm run admin:create` (step 5). The public site has no user accounts yet (alerts/saved jobs are
  future work), so nothing needs sign-up.
- Email confirmations: on. Minimum password length: 12.
- Site URL: the staging URL (e.g. `https://staging.<domain>`); Redirect URLs: the same host only.
- Leave Supabase Auth's own rate limits on (the app adds its own: `src/lib/rate-limit.ts`).

*Local rehearsal:* sign-in, session refresh, sign-out and "active staff only" were exercised through the stand-in's GoTrue
subset. *Needs the real project:* real GoTrue behaviour (email flows, its rate limits, token lifetimes).

## 3. Run the migrations

Apply every file in `supabase/migrations/` **in filename order** (order and review: `docs/MIGRATIONS.md`):

```bash
supabase link --project-ref <staging-ref>
supabase db push              # applies 0001 … 0026 (23 files) and records them in supabase_migrations.schema_migrations
```

Then, only for a pilot, the official-source registry: run `supabase/seed/pilot_sources.sql` once in the SQL editor.
**Never** run anything under `tests/` against Supabase (the harness bootstrap creates stand-in roles).

Checks right after `db push`:

```sql
select count(*) from supabase_migrations.schema_migrations;                          -- 23 rows: 0001…0016 and 0020…0026
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;             -- 0 rows: RLS on every table
select count(*) from role_permissions;                                                 -- matches src/lib/admin/permissions.ts
```

Also open **Database → Advisors (linter)** and record every warning in `docs/MIGRATIONS.md` ("Known, intentionally
unchanged"). Expected: "extension in public" for `pg_trgm`/`citext`.

*Phase 3.7:* `scripts/staging/validate.ts` runs these checks (and the whole audit via `ops_schema_audit()`) with only the
documented variables, and `scripts/staging/upgrade-test.sh` repeats the upgrade on a real scratch project — see
`docs/STAGING_RUNBOOK.md`.

*Local rehearsal:* fresh install, all 22 upgrade paths, a legacy-data upgrade and schema equivalence pass
(`npm run db:migrations`). *Needs the real project:* Supabase's own roles/default privileges, `db push` bookkeeping,
PostgREST schema reload.

## 4. Configure environment variables

In the hosting dashboard for the **staging** environment (never in a committed file; template: `.env.example`):

| Variable | Staging value |
|---|---|
| `DATA_SOURCE` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<staging-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **anon / publishable** key |
| `SUPABASE_SERVICE_ROLE_KEY` | the **service-role / secret** key — server-only |
| `CRON_SECRET`, `PREVIEW_SECRET` | `openssl rand -hex 32` each, different per environment |
| `NEXT_PUBLIC_SITE_URL` | `https://staging.<domain>` |
| `ALLOW_INDEXING` | `false` (staging is never indexed) |
| `ALLOW_DEMO_IN_PRODUCTION` | unset / `false` |

The server **refuses to start** on a dangerous configuration (`src/instrumentation.ts` → `validateEnv`): demo data without
the explicit switch, a service-role key in a `NEXT_PUBLIC_` variable (detected from the key's own `role` claim), missing
`CRON_SECRET`/`PREVIEW_SECRET`, test switches on the live site. Messages name variables, never values.

After the first deploy: `npm run build` locally with the staging env loaded, then `npx tsx scripts/check-bundle-secrets.ts`
— it scans every client bundle for the actual secret values and any service-role JWT.

## 5. Create the first admin

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<secret> \
  npm run admin:create -- --email you@<domain> --name "Your Name" --role super_admin
```

Run it from your own machine. Then sign in at `/admin/login`, open **Users**, and create the other staff with the least
role that fits (permission matrix: `src/lib/admin/permissions.ts`). Staff are deactivated, never deleted (their audit and
verification history references them).

## 6. Disable public sign-ups

Confirm step 2's setting is **off**, then prove it: `POST /auth/v1/signup` with the anon key must be refused. A signed-up
account would still have no staff role (RLS gives it nothing), but it should not exist.

## 7. Verify RLS on the real project

```bash
NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run rls:check
```

`scripts/rls-check.ts` signs in as throw-away accounts of each role through the **real** Supabase API and checks 35
allow/deny cases (anon reads, drafts hidden, self-promotion refused, audit append-only …). It must print 35/35.
The full 8-role × 195-case matrix (`tests/rls-matrix.test.ts`, 1,560 cells) runs against a direct database connection:
run it against the staging database only if you are comfortable pointing the test harness at it (it creates and removes
its own fixtures); otherwise `rls:check` is the real-project gate.

*Local rehearsal:* both pass locally (`docs/rls-matrix-run.txt`, `docs/pilot/rls-check-local-stub.txt`).
*Needs the real project:* the same results through real PostgREST + GoTrue.

## 8. Configure cron

Schedules live in `src/config/cron.ts` (UTC); `npm run gen:cron` writes `vercel.json`. On Vercel the crons start with the
production deployment. Staging: either enable them there too, or call them by hand:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://staging.<domain>/api/cron/expire
```

Each run writes a `cron_runs` row (visible to staff) and one structured log line. Without the secret every endpoint
answers 401. For another host: `npm run gen:cron -- --crontab`.

## 9. Run the smoke tests

Work through `docs/SUPABASE_SMOKE_TEST.md` §1–12 on staging, then:

1. `npm run rls:check` → 35/35 (step 7).
2. Create one **synthetic** draft job ("STAGING TEST — not a real recruitment"), publish it, confirm it appears on the
   public page and in `/sitemap.xml`, unpublish it, confirm it disappears from both **immediately**.
3. Registry: add one pilot source (REVIEW_REQUIRED), press **Check now**, compare the discoveries with the website.
   This is the **first real server-side source check** — record the outcome per source in `docs/pilot/SOURCE_VALIDATION.md`.
4. Call each cron endpoint once with and once without the secret.
5. Run the production-readiness SQL (`docs/PRODUCTION_READINESS.md` §2): zero demo/synthetic rows in public content.

## 10. Verify production

Only after staging passes all of the above: create the production project (steps 1–8 with production keys), deploy,
re-run steps 7 and 9.1–9.5 on production, and keep `ALLOW_INDEXING=false` until the checklist in
`docs/PRODUCTION_READINESS.md` §3 is complete.

---

### What cannot be known until the project exists

| Item | Why it needs the real project |
|---|---|
| GoTrue behaviour (email confirmation, password reset, Auth rate limits) | the stand-in implements only password/refresh grants |
| Supabase default privileges, `supabase_admin`-owned objects, extensions schema | the local bootstrap is a minimal imitation |
| `supabase db push` bookkeeping and the database linter's findings | tooling of the platform |
| PostgREST version quirks, schema-cache reload after DDL | the stand-in implements a subset of PostgREST |
| Real latency (Mumbai region) and connection limits for serverless functions | performance numbers in `docs/PERFORMANCE.md` are local only |
| How each government site treats our crawler from a data-centre IP | no server-side crawl has happened yet |
| Backups / PITR restore | a restore drill needs a real backup |
