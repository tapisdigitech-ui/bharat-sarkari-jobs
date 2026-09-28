# Staging runbook (Phase 3.7)

How to take the project from "local PostgreSQL/RLS tests pass" to "validated on a real Supabase project and a real
deployment". Every step writes its evidence to `docs/staging/`. Nothing in this runbook creates credentials: you create the
projects and paste the values into your own terminal / Vercel; the scripts only read the documented variables.

Until every step below has been run against the real project, the status stays: **Supabase implementation prepared; local
PostgreSQL/RLS tests pass; real Supabase validation pending.**

## 0. Where the scripts can run

The scripts need network access to `*.supabase.co`, the staging site and (for probes) government websites. They run on any
machine with Node 20+ (and `psql`/`pg_dump` for the database drills, Python 3 + Playwright for the browser check). The
Claude session that prepared this phase could not reach those hosts (its network policy blocks them), which is why none of
the real runs have happened yet — see `docs/PHASE_3_7_REPORT.md`.

| Tool | Needed for | Check |
|---|---|---|
| Node 20+ and `npm ci` | validate.ts, site.ts, create-admin | `node -v` |
| PostgreSQL client tools, **same major version as the Supabase server or newer** | upgrade-test.sh, backup-restore.sh | `pg_dump --version` vs Supabase → Settings → Infrastructure |
| Supabase CLI (optional) | `supabase db push` (records migration history) | `supabase --version` |
| Python 3 + `pip install playwright` + `playwright install chromium` | staging_browser.py | `python3 -c "import playwright"` |

## 1. Variables (only these)

| Variable | Where it comes from | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API (staging project) | app, all scripts |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page (anon / publishable key) | app, all scripts |
| `SUPABASE_SERVICE_ROLE_KEY` | same page (service_role / secret key) — server and operator only | app (server), scripts |
| `NEXT_PUBLIC_SITE_URL` | the staging deployment URL (https) | app, site.ts, browser check |
| `CRON_SECRET` | generate: `openssl rand -base64 32` | app (Vercel), site.ts |
| `DATABASE_URL` | Supabase → Connect → connection string (session pooler) — operator only, never in Vercel | upgrade-test.sh, backup-restore.sh |
| `NEW_DATABASE_URL` | connection string of a **second, empty** scratch project — operator only | upgrade-test.sh, then (after re-creating it) backup-restore.sh |

Vercel (staging): `DATA_SOURCE=supabase`, the three Supabase variables, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`,
`PREVIEW_SECRET`. **Do not set `ALLOW_INDEXING`** — staging must stay out of search engines (robots `Disallow: /`, every
page `noindex`). Vercel runs cron jobs only for the *production* deployment of a Vercel project, so use a separate Vercel
project for staging (its production deployment is staging). Check your plan's limits for cron frequency (`sources` runs
every 3 hours) and function duration (`maxDuration = 300` on the cron and probe routes); a plan that does not allow them
fails the deploy — record that as a finding rather than changing the schedule silently.

## 2. Database: fresh install + upgrade

1. Staging project (region Mumbai, `ap-south-1`): `supabase link --project-ref <ref>` then `supabase db push`
   (applies all 23 files in `supabase/migrations` and records them). Fresh install = this project.
2. Scratch project, empty: `NEW_DATABASE_URL=… DATABASE_URL=… bash scripts/staging/upgrade-test.sh`
   → installs the Phase 3.6 schema (0001–0025), writes data through it, applies 0026 on top twice (idempotence), checks the
   data, and compares the upgraded schema + grants with the fresh staging install. Evidence: `docs/staging/upgrade-<ref>.md`.
3. Delete the scratch project (it is no longer empty) and create a new empty one for step 7.

## 3. First administrator

`NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run admin:create -- --email you@… --name "…" --role super_admin`

## 4. Database, auth and RLS against the real project

`npx tsx scripts/staging/validate.ts` (with the three Supabase variables). It creates throw-away accounts for every role,
attacks the REST/Auth APIs directly (35 cases × 8 identities), checks sign-in, sign-out, forged/`alg none` tokens,
self-escalation through user metadata, disabling and role changes on live tokens, public read, the audit log, the cron lock,
demo markers in the database, then removes its fixtures. Optional: `--wait-expiry` (waits one token lifetime) to prove an
expired token is refused. Evidence: `docs/staging/validate-<ref>.md|json`. It compares object counts with
`docs/staging/local-schema-baseline.json` (written by the local rehearsal) to surface any difference from local PostgreSQL.

## 5. Deploy staging, then check the site

1. Deploy (Vercel, region `bom1`). Confirm `/robots.txt` says `Disallow: /`.
2. `npx tsx scripts/staging/site.ts` (all variables above). SEO blocking + sitemap/canonical/JSON-LD correctness, security
   headers, admin/API routes without a session, cron (401 / 401 / real `expire` and `cleanup` runs / two simultaneous runs →
   one 409 / `cron_runs` rows), secrets in the downloaded JavaScript, demo words on rendered pages, response times and page
   weight vs the Phase 3.6 baseline. `--no-cron` skips executing cron jobs.
3. `python3 tests/e2e/staging_browser.py` — sign-in/out, wrong password vs unknown email, tampered and removed cookies,
   non-staff user, moderator on administrator pages, role change and disabling while signed in, cookie flags, browser
   timings and axe on real pages.

## 6. Server-side source pilot

1. Register the pilot's official sources in **Admin → Sources** (only official domains; `REVIEW_REQUIRED` until checked).
   Suggested mix: Central (SSC, UPSC), Delhi (DSSSB), Uttar Pradesh (UPSSSC, UPPSC), Bihar (BPSC, BSSC). Choose the adapter
   and settings per source (docs/SOURCE_VALIDATION.md, docs/EXTRACTION_TESTING.md).
2. **Admin → Sources → Server-side probe → "Probe next sources"**. This runs *on the deployed server* (the page shows the
   runtime, e.g. `vercel production bom1`; a local run is labelled "not a deployment" and does not count). Per source it
   records robots, request, HTTP status, redirect, content type, size, duration, discovery count and first-notice
   extraction. A robots refusal, 401/403/429, CAPTCHA or anti-bot page is recorded as **BLOCKED** and is never retried or
   worked around: operate that source manually.
3. Download the Markdown table (same page) — it is the source-by-source table of the report.

## 7. Backup → restore drill (mandatory before production)

`DATABASE_URL=<staging> NEW_DATABASE_URL=<new empty project> bash scripts/staging/backup-restore.sh`
Dumps (read-only), restores into the empty project, re-asserts the exact API-role privileges, then compares row counts,
per-table checksums, RLS/policy/trigger/function/grant counts and runs `ops_schema_audit()` on the copy. Records the time
taken. Evidence: `docs/staging/backup-restore-<ref>.md`.

## 8. Editorial pilot (20–50 real records)

Follow docs/CONTENT_OPERATIONS.md for each record: discovery (or manual entry for MANUAL/BLOCKED sources) → review →
field-by-field verification against the official document → approval → publish. Record the field comparison for every
record in `docs/staging/FIELD_VALIDATION.md` (template in that file). Run at least one corrigendum/extension through the
official-updates chain and one record through deadline → expiry. The review screens time themselves
(`review_started_at`, `editorial_effort`); re-run `validate.ts --only=effort,probes,demo` at the end to capture effort,
the source table and the final demo scan.

## 9. Close-out

Copy the numbers from `docs/staging/*.md` into `docs/PHASE_3_7_REPORT.md` (sections 1–18) and fill the GO/NO-GO list.
Any FAIL is a blocker until fixed and re-run; a NOT RUN is a blocker until run.

## Rehearsal (what was run without the real project)

`bash scripts/staging/rehearse.sh` runs every script above against the local stand-in and local databases with
`--rehearsal`; outputs go to `docs/staging/rehearsal/` and are labelled REHEARSAL. A rehearsal proves the scripts work and
catch problems (it includes a negative control that injects RLS holes and must be caught); it proves nothing about staging.
