# Phase 3.7 — Real Supabase + staging + server-side pilot: report

## Status in one paragraph

**A real Supabase project ("Sarkari Job") now exists and its credentials are configured in `.env.local` and structurally
verified** (project ref confirmed by decoding the provided keys' claims, key kinds correct, no secret-in-`NEXT_PUBLIC_`
leak). **No real-environment test has actually executed against it yet.** The session doing this work still cannot reach
`efnpntynhitwmbarfbex.supabase.co` — the outbound proxy explicitly denies the connection at the organization-policy level
(re-checked 28 Sep 2026; see BLOCKERS below for the exact diagnostic), and the linked Mac has no project folder connected,
so nothing can run there either. No staging deployment and no second (scratch) Supabase project exist yet. The wording
therefore stays: **Supabase project created and credentials configured; local PostgreSQL/RLS tests pass; real Supabase
validation still pending on network access.** **GO/NO-GO: NO-GO** (section 18).

## Phase 3.7 status — the four categories this report tracks

### 1. REAL SUPABASE ENVIRONMENT RESULTS

| Check | Result |
|---|---|
| Project exists, URL/anon/service credentials configured in `.env.local` | **PASS** — verified structurally (key kinds, `ref` claims, no leak to `NEXT_PUBLIC_`); never printed |
| Read-only connectivity test (URL, DB reachability, Postgres version, existing tables) | **NOT RUN — blocked** |
| Current migration state on the real project | **NOT RUN — blocked** |
| Migrations applied (0001–0026, 23 files) | **NOT RUN** |
| Post-migration verification (tables, RLS, policies, functions/triggers, indexes, FKs, anon/authenticated/service-role permissions) | **NOT RUN** |
| Real Supabase security/RLS tests (`validate.ts`, `site.ts`, `staging_browser.py` against the real project — anonymous, non-staff, every staff role, forged publish, privilege escalation, unpublished/archived protection, RLS boundaries, service-role isolation, open redirect, admin session behaviour) | **NOT RUN — blocked** |
| First admin created | **NOT RUN** (gated on the above per the documented order) |
| Admin verified (auth, role, admin pages, logout, unauthorized roles blocked) | **NOT RUN** |
| Pilot/source seed data | **NOT RUN** |
| `npm run validate` executed with the real project's credentials live | **NOT RUN** (the suite itself only runs against local PostgreSQL/the stand-in — see Local rehearsal) |
| Deployment to Vercel | **NOT DONE** (intentionally withheld per instruction) |

### 2. LOCAL REHEARSAL RESULTS (unchanged since 26 Sep 2026 — not evidence about the real project)

`npm run validate`: 14/14 stages PASS. `npm run db:migrations`: 16/16 checks PASS, 23 files, 22 upgrade paths, fresh ==
upgraded schema. RLS matrix (`tests/rls-matrix.test.ts`): 1,624/1,624 cells. Full `rehearse.sh` kit (local PostgreSQL 16 +
API stand-in + a local production-configured build): `validate.ts --rehearsal` 60 PASS / 1 FAIL (expected — no source
probed from a "deployment") / 2 NOT RUN; negative control caught every injected RLS hole; `upgrade-test.sh --rehearsal`
PASS; `backup-restore.sh --rehearsal` PASS; `site.ts --rehearsal` 45 PASS / 1 FAIL (rehearsal's own synthetic content,
correctly flagged); `staging_browser.py --rehearsal` 42/42; `scan-build.ts` FAIL (one real finding — `contact@example.com`
placeholder, a production blocker, see section 13). Four real defects (D1–D4, below) were found this way and fixed in the
codebase. Full detail: sections 1–16 below.

### 3. NOT RUN

Every real-environment item listed in category 1 above, plus: 20–50 real records processed and field-validated (section
6–7), one real corrigendum through the official-updates chain (section 8), one real expiry (section 9), human-effort
measurement and the scalability estimate that depends on it (sections 15–16), the backup/restore drill between the real
project and a second empty one (section 11), and the server-side source pilot (sections 4–5).

### 4. BLOCKERS

1. **Network: this session cannot reach the real Supabase project.** Re-verified 28 Sep 2026 with a direct connection
   attempt and the proxy's own diagnostic, which recorded: `{"kind":"connect_rejected","detail":"gateway answered 403 to
   CONNECT (policy denial or upstream failure)","host":"efnpntynhitwmbarfbex.supabase.co:443"}`. This is an
   organization-level network policy, not a transient failure.
2. **Linked Mac has no connected folder.** `mohammads-macbook-air-local` is online (re-checked 28 Sep 2026) but
   `connectedFolders: []` — there is nowhere for `device_bash` to run the staging scripts (`scripts/staging/*`,
   `upgrade-test.sh`, `backup-restore.sh`) from that machine either.
3. **No second, empty Supabase project** for the upgrade-path test and, afterward, the backup/restore drill.
4. **No staging deployment** (separate Vercel project, region `bom1`, with `CRON_SECRET` set and `ALLOW_INDEXING` unset).
5. Until 1 or 2 is resolved, every item in category 1 stays NOT RUN, and by the documented order (STAGING_RUNBOOK.md),
   migrations must not be applied before a read-only connection test has confirmed the project is the intended
   empty/new one — so migrations have deliberately not been attempted.

**What would unblock this immediately:** either (a) connect a project folder on the linked Mac (e.g. this project's
folder, if it lives there) via "Add folder" in the Claude desktop app, so `device_bash` can run the staging kit with
Node 20+/`psql`/`pg_dump`/Python+Playwright installed there, or (b) run `npx tsx scripts/staging/validate.ts` (and the
rest of `docs/STAGING_RUNBOOK.md`) yourself with the credentials already in `.env.local`, and share the resulting
`docs/staging/*.md` files back for this report.

### Addendum — 28 Sep 2026: handoff folder found stale, fixed in place; local checks re-verified

A folder was connected on the linked Mac (`/Users/mohammadsameer/Downloads/bharat-sarkari-jobs-phase3-7-staging`), but
inspection showed it held an **older snapshot** (its `PHASE_3_7_REPORT.md` was 19,890 bytes — an earlier revision of this
report, predating the real-project credential work and the four-category structure above — versus 25,414+ bytes in the
authoritative copy). It was updated **in place** with the current project files (source, all 23 migrations, `scripts/staging/`,
`tests/`, current docs) via the device bridge; `.env.local`, `node_modules`, and `.next` remain absent from that folder.
This was a file-sync fix only — no code logic changed as a result.

Local checks were re-run against the authoritative source immediately beforehand, all against **local PostgreSQL /
the API stand-in only, not the real Supabase project**:

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | PASS — 0 errors |
| `npm run lint` (`eslint .`) | PASS — 0 errors |
| Unit suite (`architecture`, `env`, `security`, `seo`, `fixture-library` — 47 tests) | 46/47 PASS; the 1 "failure" is `architecture.test.ts`'s repo-wide secret scan flagging `.env.local` itself, which is expected (it is the file meant to hold the real key locally) and is independently confirmed git-ignored by the adjacent test — not a leak |
| `npm run db:migrations` | **16/16 PASS** — order confirmed `0001`→`0016` then `0020`→`0026` (23 files), fresh install, all 22 upgrade paths, legacy-data upgrade, schema equivalence, RLS/search_path/FK-index/privilege audits |
| Repo-wide secret scan (JWT-shaped, `sb_secret_…`, `sb_publishable_…`, PEM-key patterns) outside `.env.local` | **NONE found** |

No migration was applied to the real Supabase project, nothing was deployed, and no real-environment result changed —
this addendum documents a workspace-sync and local-verification fix only. **GO/NO-GO remains NO-GO** (section 18):
the real connectivity blockers below are unchanged.

What *was* done is everything that can be done before the credentials arrive, so that the real run is one command per
step and cannot be quietly substituted by the local stand-in:

1. A **staging validation kit** that uses only the documented variables and refuses to run against anything that is not a
   real Supabase project / https deployment unless explicitly told `--rehearsal` (docs/STAGING_RUNBOOK.md):
   `scripts/staging/validate.ts` (database, auth, 35-case × 8-identity RLS attack over the real APIs, public read, audit,
   cron lock, demo scan, effort, probes), `site.ts` (SEO blocking, security, cron, secrets in JS, demo words, response
   times), `tests/e2e/staging_browser.py` (auth by clicking, performance, accessibility), `upgrade-test.sh`,
   `backup-restore.sh`, `scan-build.ts`, and `rehearse.sh` which runs all of them locally.
2. **Server-side source probe** (Admin → Sources → Server-side probe): runs on the deployed server, records request, robots,
   HTTP status, redirect, content type, size, duration, discovery and first-notice extraction per source, never works
   around protection, and exports the source-by-source table.
3. **Measurement plumbing** for human effort (review start/finish, corrections, fields verified per record).
4. **A local rehearsal of the whole kit** — which found **four real defects**, fixed below. A rehearsal proves the scripts
   work and catch problems (a negative control with injected RLS holes was caught); it is not evidence about staging.

### Defects found by the rehearsal (all fixed, all would have reached staging/production)

| # | Defect | Impact | Fix |
|---|---|---|---|
| D1 | On a non-indexable deployment (staging, preview, demo) every page built with `buildMetadata` had **no noindex**: the page's `robots: undefined` replaced the root layout's noindex. Only robots.txt protected staging. | Staging/preview pages could be indexed from external links; the Phase 3.6 page-level SEO tests ran with indexing on. | `buildMetadata` decides noindex itself; every response also gets `X-Robots-Tag: noindex, nofollow` when indexing is off; unit test added. Re-check: all 35 sitemap pages + 9 page types noindex. |
| D2 | **A `pg_dump` of the database could not be restored.** `pg_restore` uses an empty `search_path`; the `government_sources` domain CHECK calls `url_in_domain()` → `url_host()` unqualified → COPY failed, then every FK to it failed. | The documented backup was unrestorable. | Migration 0026 pins `search_path` on every function used by a constraint/index/default (6); `ops_schema_audit()` and `npm run db:migrations` now check it. |
| D3 | **A restored copy would be more open than the original.** A new Supabase project's default privileges give `anon`/`authenticated` ALL (incl. TRUNCATE, which ignores RLS) on each restored table, and the documented command used `--no-privileges`. | After a disaster recovery, API roles would regain TRUNCATE and every revoked privilege. | `backup-restore.sh` re-asserts the source's exact API-role privileges and compares them; docs/BACKUP_RECOVERY.md rewritten. |
| D4 | The documented dump also copied the whole `auth` schema into a project that has its own. | Restore would fail/clash. | Only `auth.users`/`auth.identities` data are dumped. |

Local regression after all changes: **`npm run validate` — 14/14 stages PASS** (113 unit, 75 database, 35 contract tests;
migrations 16/16; RLS matrix 1,624/1,624; every browser suite green; `docs/validate-run.txt`). Rehearsal of the kit
(`docs/staging/rehearsal/`): validate 60 PASS / 1 FAIL (source probes: no source probed from a deployment — correct) /
2 NOT RUN; negative control caught every injected hole; upgrade PASS; backup/restore PASS; site 45 PASS / 1 FAIL (the
rehearsal's own synthetic content, correctly flagged); browser 42/42; build scan FAIL (`contact@example.com`, below).

Also added: a **single-run lock for cron jobs** (a second run of the same job answers 409; runs abandoned by a crash are
closed after 15 minutes).

---

## 1. Real Supabase results

**NOT RUN — blocker.** Local results for comparison (they are *not* Supabase results):

| Item | Real Supabase | Local rehearsal (PostgreSQL 16 + stand-in) |
|---|---|---|
| Migration — fresh install (23 files) | NOT RUN | PASS (`npm run db:migrations`, 16/16 checks) |
| Migration — upgrade from Phase 3.6 schema with data | NOT RUN (`upgrade-test.sh` ready) | PASS: 0026 applied on top of data and re-run; rows kept; fresh == upgraded schema+grants (4,332 normalised lines) |
| FKs / indexes / triggers / functions | NOT RUN | 98 FKs all indexed; 88 triggers; 200 functions; 217 indexes; 127 policies (baseline stored in docs/staging/local-schema-baseline.json — the real run reports any difference) |
| RLS / permissions | NOT RUN | RLS on 58/58 tables; no dangerous grants; 222 role permissions |
| Seed handling | NOT RUN | staging synthetic seed refused unless `bsj.seed_target=staging`; publishes nothing |
| Authentication | NOT RUN | section 3 |
| Public read / admin / audit / cron / security | NOT RUN | sections 2, 10, 13 |

Differences from local PostgreSQL that we already know to look for on the real project: Supabase's own default privileges
(D3 shows why they matter), extension schemas (`pg_trgm`/`citext` in `public` → linter warning), the Postgres major version
(Supabase may run a newer major than the local 16 — the operator's `pg_dump` must be at least that version), PostgREST
schema-cache reload, and real GoTrue token lifetime.

## 2. RLS results

**Real: NOT RUN — blocker.** Ready: `validate.ts` attacks PostgREST/GoTrue directly as Anonymous, a signed-in non-staff
user, Moderator, Editor, SEO Manager, Content Manager, Admin and Super Admin: SELECT/INSERT/UPDATE/DELETE and RPCs across
jobs, recruitments, organizations, reference data, sources, review queue, probes, staff, permissions, audit log, history,
rate limits, cron runs and the ops functions (35 cases × 8 identities). Publishing is proven without publishing anything:
an authorised role reaches the publish gate (SQLSTATE 23514), an unauthorised one is refused (42501).

| Local evidence | Result |
|---|---|
| REST attack matrix via the stand-in (rehearsal) | 280/280 cells match the permission model |
| SQL-level matrix (`tests/rls-matrix.test.ts`, now incl. 0026 objects) | 1,624/1,624 |
| Negative control: holes injected on purpose (anon reads audit log, staff can rewrite probe verdicts, anon TRUNCATE) | **caught** — 10 FAILs reported, as intended |

## 3. Authentication results

**Real: NOT RUN — blocker.** Rehearsal (stand-in GoTrue, local build) — every check passed:

| Check | API (validate.ts) | Browser (staging_browser.py) |
|---|---|---|
| Admin login | PASS | PASS |
| Invalid password / unknown email — same message | PASS | PASS |
| Logout — refresh token revoked, Auth server rejects old token | PASS | PASS (admin redirects, back button shows nothing) |
| Session expiry | NOT RUN (`--wait-expiry` waits one token lifetime) | PASS (removed and tampered cookies → login) |
| Unauthorized public user | PASS (metadata self-escalation grants nothing) | PASS (refused at login and at /admin) |
| Unauthorized admin access | PASS (RLS matrix) | PASS (moderator on users/sources/new-job refused; audit allowed by design) |
| Role change on a live session | PASS | PASS |
| Disabled staff on a live session | PASS | PASS |
| Browser manipulation: forged token (`role=service_role`), `alg: none`, garbage token, forged cookie, forged server action, off-site `?next=` | PASS | PASS |

Known Supabase behaviour to confirm on the real project (recorded as INFO, not hidden): after sign-out, the old *access*
token is still accepted by the REST API until it expires (stateless JWT); the admin UI rejects it immediately because every
admin request calls `getUser()`. The exposure window equals the token lifetime (default 1 hour) — measure it on staging.

## 4. Server-side source results

**NOT RUN — blocker (no deployment).** The probe is built and tested (11 tests: robots 403 → BLOCKED after one request,
robots disallow → BLOCKED, listing 403 → BLOCKED and not retried, CAPTCHA page with HTTP 200 → BLOCKED, JavaScript-only page
→ MANUAL, site down → FAILED, scanned PDF → MANUAL, readable PDF → PASS with the extraction summary, nothing ever queued for
review, probe results staff-read-only and not writable from a browser). It labels every result with its runtime; a result
not produced on a deployment says so and does not count.

## 5. Source-by-source table

No source has been probed from a server. Browser observations from Phase 3.5 (owner's Chrome, 25 Sep 2026) are in Notes
only — they are not server results.

| Source | Server Access | Robots | Discovery | Extraction | Review | Publish | Notes |
|---|---|---|---|---|---|---|---|
| Staff Selection Commission | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Browser: Angular app, 0 links in served HTML; JSON feed adapter gated on terms review → expected MANUAL |
| Union Public Service Commission | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Browser: `div.view-content` selector works; exam pages need PDF hop (detail-page adapter) |
| High Court of Delhi | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Browser: generic reader, 25 notices; robots 404 |
| DSSSB (Delhi) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Browser: robots.txt HTTP 403 → the crawler must stay out → expected BLOCKED/MANUAL |
| Delhi Police, University of Delhi, AIIMS New Delhi | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Browser: reachable, not exercised |
| UPPSC (UP) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Browser: discovery with exclude; windows in table columns (table-columns adapter) |
| UPSSSC (UP) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Browser: tested advertisement was a scanned PDF → expected MANUAL for fields |
| UPPRPB, District Administration Lucknow (UP) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Browser: reachable, not exercised |
| BPSC (Bihar) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Browser: 7 notices discovered; all tested PDFs scanned → fields manual |
| BSSC, CSBC (Bihar) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Browser: reachable, not exercised |
| NTA, Coal India, RRB Chandigarh, Employment News, Join Indian Army | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Browser: RRB domain redirect; Employment News root 404; Army → sign-in page |

After deployment this table is produced by the probe page ("Download .md") and by `validate.ts --only=probes`.

## 6. Real records processed

**0 of the required 20–50 — blocker.** No record may be created on staging before the project exists; none were fabricated.
The working sheet (per-record source, URL, checked time, verification, publication, reviewer, time) is
`docs/staging/FIELD_VALIDATION.md`.

## 7. Field-level validation

**NOT RUN.** Template ready (14 fields, OK / FIXED / N/A / WRONG, counts per field; no accuracy percentage below 50
records). The Phase 3.5 browser sample (6 documents) remains the only real field comparison, and it is not a staging result.

## 8. Corrigendum test

**NOT RUN on real data — blocker.** The chain (discovery with amendment type → change detection → review → approval → new
version → public official-updates list, unrelated fields unchanged) is covered by the local suites (`tests/verification`,
`pipeline-adapters`, content engine) with synthetic and Phase 3.5 real texts; the real run needs one real corrigendum on staging.

## 9. Expiry test

**NOT RUN on staging.** Rehearsal: the authorised `expire` cron run succeeded; the expired record's page still answers 200
without JobPosting; draft pages 404 and stay out of the sitemap. Real staging needs one record crossing its real deadline.

## 10. Cron results

**Real: NOT RUN — blocker.** Rehearsal (local build): no secret → 401, wrong secret → 401, unknown job → 404, authorised
`expire` → 200, two simultaneous `cleanup` runs → **200 + 409** (new lock), each run left a finished `cron_runs` row; DB-level
lock: second start refused, lock freed after finish, a stale run closed as abandoned. Not yet observed: the Vercel scheduler
itself (it only runs on a project's *production* deployment — use a separate Vercel project for staging), the `sources` and
`links` jobs against real sites, plan limits (3-hourly schedule, 300 s functions).

## 11. Backup/restore results

**Real: NOT RUN — mandatory blocker.** Rehearsal (local DB → fresh local DB): initially **FAIL** (D2, D3), after the fixes
**PASS**: 0 restore errors, 58 tables with identical row counts and per-table checksums, identical RLS/policy/trigger/
function/grant counts, clean audit on the copy, 1.5 s for 512 KB. Real run: `backup-restore.sh` between staging and a new
empty project.

## 12. SEO results

**Real: NOT RUN.** Rehearsal on a build configured like staging (indexing off), after fixing D1: robots `Disallow: /`;
35/35 sitemap URLs 200, on-host, self-canonical, noindex; homepage, jobs, job detail, search, exam, department
(organization), state, qualification and empty-search pages noindex; JobPosting complete with a future `validThrough`;
BreadcrumbList present; expired job: 200, no JobPosting; draft: 404, not in sitemap; unknown page: 404 + noindex.

## 13. Security results

**Real: NOT RUN.** Rehearsal: HSTS, nosniff, SAMEORIGIN, Referrer-Policy, Permissions-Policy present, no X-Powered-By;
admin pages redirect without a session and are `no-store` + noindex; staff export not served; forged server action
refused; off-site `?next=` never followed; script tag in search escaped; SQL metacharacters harmless; 12 client JS files
(578 KB) contain no service key, cron secret, `sb_secret_` key or service-role JWT; build scan: demo dataset not in any
client file. Open items: no Content-Security-Policy (documented, unchanged); rate limiting is exercised in unit/E2E
suites but not against real GoTrue's own limits.

**Demo isolation (item 18):** the rendered-page scan correctly flagged the rehearsal's synthetic content (as it must); the
build scan found one real launch item in prerendered pages: **`contact@example.com (placeholder)` on /contact and
/advertise** — a production blocker (needs a real address), acceptable on staging. The demo dataset is compiled into server
bundles only (supported local mode, refused on production by `resolveDataSource`).

## 14. Performance comparison

**Real: NOT RUN.** Rehearsal (same machine, no network — relative only): server response 5–52 ms, gzip HTML 8–16 KB,
~139–141 KB JS, CLS 0, 0 axe violations on 12 pages. Page weight matches the Phase 3.6 baseline (e.g. job detail 14 vs
15 KB, jobs 13 vs 16 KB). No regression flagged, no optimisation made. The real staging run records network timings from
India-region hosting as the new baseline; timings are deliberately not compared with the no-network Phase 3.6 numbers.

## 15. Human review effort

**No measurement — blocker for section 16.** Each review screen now records when a reviewer first opens a discovery; with
the review decision, the audit log (corrections) and field verifications, `editorial_effort` gives per record: wait before
review, review time, corrections, fields verified, time to publish. `validate.ts --only=effort` reports medians and refuses
to estimate below 20 reviewed real records.

## 16. Scalability bottleneck

**Not estimated.** The instruction is not to guess without staging measurements, and there are none. What the estimate
will be built from: median review minutes per record × 50 / 500 / 5,000, plus the share of MANUAL/BLOCKED sources (whose
records are typed by hand), plus link-check and duplicate-merge minutes per record. Phase 3.5 evidence points at source
access and scanned PDFs (manual typing) as the likely first bottleneck, but that is a hypothesis, not a finding.

## 17. Remaining blockers

1. ~~Supabase staging project credentials~~ — **done** (28 Sep 2026): project "Sarkari Job" exists; URL, anon/publishable
   key and service-role/secret key are configured in `.env.local` and verified structurally. An operator `DATABASE_URL`
   (session pooler or direct connection string, for `upgrade-test.sh`/`backup-restore.sh`) is still not provided.
2. A second, empty Supabase project for the upgrade test, then (re-created) for the restore drill.
3. A staging deployment (separate Vercel project, region `bom1`) with the documented variables and `CRON_SECRET`.
4. A machine that can reach Supabase, the deployment and government sites to run the kit — this session still cannot
   (organization network policy explicitly denies the connection, re-confirmed 28 Sep 2026); the linked Mac could if a
   project folder were connected there (with Node 20+, PostgreSQL client tools, Python Playwright) — none is connected yet.
5. Real run of every section above; server-side probes; 20–50 real records with field validation; one real corrigendum;
   one real expiry; effort measurement → scalability estimate.
6. Backup/restore between real projects (mandatory).
7. Before production (not staging): real contact e-mail instead of `contact@example.com`; legal pages; CSP decision;
   the official LGD files for Delhi, Uttar Pradesh and Bihar (still outstanding — nothing imported, nothing invented).

## 18. Final GO / NO-GO

| Gate | Status |
|---|---|
| Real Supabase | **BLOCKER — not run** |
| Real RLS | **BLOCKER — not run** (local 1,624/1,624; API rehearsal 280/280) |
| Real authentication | **BLOCKER — not run** (rehearsal all PASS) |
| Server-side source access | **BLOCKER — not tested** |
| Real extraction | **BLOCKER — not validated on staging** |
| Real review workflow | **BLOCKER — not run** |
| Corrigendum/change handling | **BLOCKER — not run on real data** |
| 20–50 real records | **BLOCKER — 0 processed** |
| Backup/restore | **BLOCKER — not run on Supabase** (rehearsal PASS after fixing D2–D4) |
| Cron | **BLOCKER — not run on staging** |
| SEO | **BLOCKER — not run on staging** (rehearsal PASS after fixing D1) |
| Security | **BLOCKER — not run on staging** |
| Demo isolation | **BLOCKER for production** (`contact@example.com` placeholder); staging scan not run |

**Recommendation: NO-GO.** Nothing in Phase 3.7 has yet been validated against the real environment. The foundation is
ready to be validated: follow `docs/STAGING_RUNBOOK.md` once the project and deployment exist, then this report's sections
are filled from `docs/staging/*.md`. Phase 4 and the listed features were not started.

## Files added or changed in Phase 3.7

- `supabase/migrations/0026_ops_diagnostics.sql` (23 files total), `src/lib/cron-auth.ts` (lock),
  `src/lib/ingestion/probe.ts`, `probe-report.ts`, `src/app/admin/(console)/sources/probe/*`, review pages (timing),
  `src/lib/seo/metadata.ts` + `next.config.ts` (D1).
- `scripts/staging/*` (common, validate, site, upgrade-test, backup-restore, scan-build, rehearse),
  `tests/e2e/staging_browser.py`, `tests/ops.test.ts`, `tests/probe.test.ts`, RLS matrix + migration check + SEO tests
  extended; stand-in gained `/auth/v1/health`, `PUT /user`, `DELETE /admin/users/:id`.
- Docs: `STAGING_RUNBOOK.md`, `staging/FIELD_VALIDATION.md`, `staging/rehearsal/*` (labelled REHEARSAL), updated
  `MIGRATIONS.md`, `BACKUP_RECOVERY.md`, `SUPABASE_SETUP.md`, `SUPABASE_SMOKE_TEST.md`.
