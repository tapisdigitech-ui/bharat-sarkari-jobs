# Deployment plan (Phase 3.6)

**Status:** configuration prepared; **nothing has been deployed**. Target host: **Vercel** (Next.js 16 App Router, serverless
functions in Mumbai `bom1`). Any Node 20+ host that runs `next start` and can call HTTPS cron endpoints works the same way.

## Environments

| | Development | Demo (optional) | Staging | Production |
|---|---|---|---|---|
| Where | a laptop | separate Vercel project, preview only | Vercel project `bsj-staging` | Vercel project `bsj-production` |
| Git | any branch | `demo` branch | `staging` branch | `main` (protected; deploys only after staging passes) |
| `DATA_SOURCE` | `demo` (default) or `supabase` against local/staging | `demo` + `ALLOW_DEMO_IN_PRODUCTION=true` | `supabase` | `supabase` |
| Database | none (demo) · local PostgreSQL + stand-in for tests | none | Supabase `bsj-staging` | Supabase `bsj-production` |
| Data | built-in synthetic dataset | built-in synthetic dataset | synthetic seed + pilot sources (`supabase/seed/`) | real records only |
| Indexing | off (forced: demo) | off (forced: demo **and** preview) | off (`ALLOW_INDEXING=false`) | off until `PRODUCTION_READINESS.md` §3 is complete |
| Cron | never | never | manual or enabled | enabled |

**Demo data can never reach production by accident** — four independent locks, each tested:

1. A built app defaults to `DATA_SOURCE=supabase`; `demo` in a built app is refused unless `ALLOW_DEMO_IN_PRODUCTION=true`
   (`tests/env.test.ts`).
2. On the live site (`VERCEL_ENV=production`) the server refuses to start if `ALLOW_DEMO_IN_PRODUCTION`,
   `ALLOW_PRIVATE_SOURCE_HOSTS` or `SOURCE_MIN_DELAY_MS` is set at all (`src/instrumentation.ts`; verified locally: every
   request answers 500 rather than serving demo data).
3. Demo records never enter a sitemap and never carry JobPosting data; indexing is forced off for demo data and for
   preview deployments whatever `ALLOW_INDEXING` says.
4. Synthetic records in a database are flagged (`is_synthetic`, titles "[SYNTHETIC]") and the pre-launch SQL in
   `PRODUCTION_READINESS.md` §2 must return zero rows.

## Vercel setup (per project)

1. Import the repository; Framework: Next.js; Node 20; build command `next build`; output default.
2. **Environment variables**: exactly those in `.env.example`, set per environment (Production / Preview) in the dashboard.
   Different `CRON_SECRET` / `PREVIEW_SECRET` per project. Never paste the service-role key into a `NEXT_PUBLIC_` variable —
   the server refuses to start if you do.
3. **Region**: `vercel.json` pins functions to `bom1` (Mumbai), next to the Supabase `ap-south-1` database.
4. **Cron**: `vercel.json` `crons` is generated from `src/config/cron.ts` (`npm run gen:cron`); Vercel sends
   `Authorization: Bearer $CRON_SECRET`. Vercel runs crons for **production deployments only** — on staging call the
   endpoints manually or from an external scheduler (`npm run gen:cron -- --crontab`).
5. **Domains**: production domain on the production project; `staging.<domain>` on staging (protect it with Vercel
   password protection or deployment protection — staging must not be public).
6. Security headers (HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, nosniff) come from `next.config.ts`.
   A Content-Security-Policy is not set yet — add it in **Report-Only** first (known limitation).

## Release procedure

1. `npm run validate` locally → every stage PASS (lint, types, unit, database, migrations, browser, security, SEO, build).
2. If migrations changed: dump staging, `supabase db push` to staging, run the smoke test.
3. Merge to `staging` → Vercel deploys staging → smoke test (`docs/SUPABASE_SETUP.md` §9).
4. Dump production, `supabase db push` to production (quiet hour).
5. Merge to `main` → production deploy → check `/`, one job page, `/sitemap.xml`, `/robots.txt`, `/admin/login`, and one
   cron call with and without the secret.
6. Rollback: promote the previous deployment (`docs/DISASTER_RECOVERY.md` §7).

## What is ready / not ready

| Ready (tested locally) | Not ready / not done |
|---|---|
| Environment validation + refusal to start on dangerous config | No real deployment, domain or Vercel project |
| Cron endpoints: secret, rate limit, run log, generated schedule | CSP header |
| Bundle secret scan (`scripts/check-bundle-secrets.ts`) | Error alerting (Sentry or similar) — logs are structured JSON, but nothing pages a person |
| Security headers, noindex defaults, sitemap/robots rules | Backups/PITR plan chosen and a restore rehearsed |
| One-command validation (`npm run validate`) | First real server-side source checks |
