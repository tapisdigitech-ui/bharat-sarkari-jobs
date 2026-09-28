# validate — REHEARSAL — local Supabase API stand-in + local PostgreSQL, NOT Supabase

Run at 2026-09-26T08:07:09.242Z. 26 PASS · 10 FAIL · 6 INFO · 0 NOT RUN.

> **REHEARSAL.** This run used the local stand-in (tests/harness), not a Supabase project and not a deployment. It proves the script works; it proves nothing about staging.

## 2. Database schema (ops_schema_audit)

| Check | Expected | Got | Result |
|---|---|---|---|
| tables without rls | none | [] | PASS |
| definer functions without search path | none | [] | PASS |
| views not security invoker | none | [] | PASS |
| foreign keys without index | none | [] | PASS |
| api role dangerous grants | none | ["jobs:anon:TRUNCATE"] | **FAIL** |
| write functions callable by anon | none | [] | PASS |
| restore unsafe functions | none | [] | PASS |
| SECURITY DEFINER functions anon can execute | only the read-only RLS helpers (can_modify_job, content_is_public, current_staff_role, has_permission, is_staff) | ["can_modify_job","content_is_public","current_staff_role","has_permission","is_staff"] | PASS |
| RLS tables with no policy | ["rate_limits"] (deny-all by design) | ["rate_limits"] | PASS |
| PostgreSQL server version | — | 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) | INFO |
| Extensions | — | {"citext":"public","pg_trgm":"public","plpgsql":"pg_catalog","pgcrypto":"public"} | INFO |
| Object counts | — | {"states":36,"tables":58,"indexes":217,"policies":129,"triggers":88,"districts":0,"functions":200,"foreign_keys":98,"role_permissions":222,"workflow_transitions":84} | INFO |
| Applied migrations recorded by the Supabase CLI | 23 rows | no supabase_migrations table — applied outside `supabase db push`? | INFO |
| Local baseline written | — | docs/staging/local-schema-baseline.json | INFO |

## 4. RLS attack (direct API, 8 identities)

| Check | Expected | Got | Result |
|---|---|---|---|
| source_probes UPDATE verdict as moderator | refused | 1 row(s) | **FAIL** |
| source_probes UPDATE verdict as editor | refused | 1 row(s) | **FAIL** |
| source_probes UPDATE verdict as seo_manager | refused | 1 row(s) | **FAIL** |
| source_probes UPDATE verdict as content_manager | refused | 1 row(s) | **FAIL** |
| source_probes UPDATE verdict as admin | refused | 1 row(s) | **FAIL** |
| source_probes UPDATE verdict as super_admin | refused | 1 row(s) | **FAIL** |
| audit_logs SELECT as anon | refused | 1 row(s) | **FAIL** |
| RLS attack matrix: 35 cases × 8 identities | every cell matches the permission model | 273/280 match | **FAIL** |

## 5. Public read (anon)

| Check | Expected | Got | Result |
|---|---|---|---|
| jobs: anon sees every published row | 0 | 0 | PASS |
| jobs: anon sees no draft/review/archived row | 0 (queries succeed) | 0 | PASS |
| recruitments: anon sees every published row | 0 | 0 | PASS |
| recruitments: anon sees no draft/review/archived row | 0 (queries succeed) | 0 | PASS |
| exams: anon sees every published row | 0 | 0 | PASS |
| exams: anon sees no draft/review/archived row | 0 (queries succeed) | 0 | PASS |
| results: anon sees every published row | 0 | 0 | PASS |
| results: anon sees no draft/review/archived row | 0 (queries succeed) | 0 | PASS |
| job_internal: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| content_internal: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| government_sources: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| discovered_items: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| audit_logs: nothing readable by anon | error or 0 rows | 1 rows | **FAIL** |
| admin_users: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| field_evidence: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| source_probes: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| editorial_effort: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| cron_runs: nothing readable by anon | error or 0 rows | refused (401) | PASS |

## Cleanup

| Check | Expected | Got | Result |
|---|---|---|---|
| Fixtures and throw-away accounts removed | nothing left | jobs left: 0 | PASS |
| Kept on purpose | — | audit_logs rows written by this run (append-only) and the cron_runs rows of the lock check | INFO |


### RLS attack matrix (✓ allowed · ✓g authorised, stopped by the publish gate · · refused · ✗ MISMATCH)

| Case | anon | authenticated | moderator | editor | seo_manager | content_manager | admin | super_admin |
|---|---|---|---|---|---|---|---|---|
| jobs SELECT a draft | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| jobs INSERT a draft | · | · | · | ✓ | · | ✓ | ✓ | ✓ |
| jobs INSERT already published | · | · | · | · | · | · | · | · |
| jobs UPDATE a draft | · | · | · | ✓ | · | ✓ | ✓ | ✓ |
| jobs UPDATE status draft → published directly | · | · | · | · | · | · | · | · |
| transition_job review → published (RPC) | · | · | · | ✓g | · | · | ✓g | ✓g |
| jobs DELETE a draft | · | · | · | ✓ | · | · | ✓ | ✓ |
| recruitments SELECT a draft | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| recruitments UPDATE a draft | · | · | · | ✓ | · | ✓ | ✓ | ✓ |
| organizations INSERT | · | · | · | ✓ | · | ✓ | ✓ | ✓ |
| states UPDATE (no-op rename) | · | · | · | · | · | ✓ | ✓ | ✓ |
| government_sources SELECT | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| government_sources UPDATE | · | · | · | · | · | ✓ | ✓ | ✓ |
| discovered_items SELECT | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| discovered_items INSERT (forged discovery) | · | · | · | · | · | · | · | · |
| discovered_items UPDATE review note | · | · | · | ✓ | · | ✓ | ✓ | ✓ |
| source_probes SELECT | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| source_probes INSERT (forged PASS) | · | · | · | · | · | · | · | · |
| source_probes UPDATE verdict | · | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| admin_users SELECT the victim's row | · | · | · | · | · | · | ✓ | ✓ |
| admin_users UPDATE promote victim → super_admin | · | · | · | · | · | · | · | ✓ |
| admin_users UPSERT own row as super_admin | · | · | · | · | · | · | · | ✓ |
| role_permissions INSERT (self-grant) | · | · | · | · | · | · | · | · |
| audit_logs SELECT | ✗ | · | ✓ | · | · | · | ✓ | ✓ |
| audit_logs INSERT (forged entry) | · | · | · | · | · | · | · | · |
| audit_logs DELETE | · | · | · | · | · | · | · | · |
| content_versions UPDATE (rewrite history) | · | · | · | · | · | · | · | · |
| rate_limits SELECT | · | · | · | · | · | · | · | · |
| cron_runs SELECT | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| cron_runs INSERT (forged run) | · | · | · | · | · | · | · | · |
| RPC ops_schema_audit | · | · | · | · | · | · | · | · |
| RPC ops_demo_scan | · | · | · | · | · | · | · | · |
| RPC cron_begin (take the cron lock) | · | · | · | · | · | · | · | · |
| RPC rate_limit_hit (burn a bucket) | · | · | · | · | · | · | · | · |
| RPC cleanup_operational_data | · | · | · | · | · | · | · | · |
