# validate — real Supabase project efnpntynhitwmbarfbex.supabase.co

Run at 2026-09-28T17:48:25.830Z. 11 PASS · 1 FAIL · 5 INFO · 0 NOT RUN.

## 2. Database schema (ops_schema_audit)

| Check | Expected | Got | Result |
|---|---|---|---|
| tables without rls | none | [] | PASS |
| definer functions without search path | none | [] | PASS |
| views not security invoker | none | [] | PASS |
| foreign keys without index | none | [] | PASS |
| api role dangerous grants | none | [] | PASS |
| write functions callable by anon | none | [] | PASS |
| restore unsafe functions | none | [] | PASS |
| SECURITY DEFINER functions anon can execute | only the read-only RLS helpers (can_modify_job, content_is_public, current_staff_role, has_permission, is_staff) | ["can_modify_job","content_is_public","current_staff_role","has_permission","is_staff"] | PASS |
| RLS tables with no policy | ["rate_limits"] (deny-all by design) | ["rate_limits"] | PASS |
| PostgreSQL server version | — | 17.6 | INFO |
| Extensions | — | {"citext":"public","pg_trgm":"public","plpgsql":"pg_catalog","pgcrypto":"extensions","uuid-ossp":"extensions","supabase_vault":"vault","pg_stat_statements":"extensions"} | INFO |
| Object counts | — | {"states":36,"tables":58,"indexes":217,"policies":127,"triggers":88,"districts":0,"functions":164,"foreign_keys":98,"role_permissions":222,"workflow_transitions":84} | INFO |
| Applied migrations (supabase_migrations.schema_migrations) vs 23 files | all 23 | 23 recorded; missing: none | PASS |
| Object counts equal to local PostgreSQL (tables, policies, triggers, functions, indexes, FKs, permissions, transitions) | identical | policies: local 129 vs staging 127; functions: local 200 vs staging 164 | **FAIL** |
| Reference data (states / districts) | — | local 36/0 vs staging 36/0 | INFO |

## Cleanup

| Check | Expected | Got | Result |
|---|---|---|---|
| Fixtures and throw-away accounts removed | nothing left | jobs left: 0 | PASS |
| Kept on purpose | — | audit_logs rows written by this run (append-only) and the cron_runs rows of the lock check | INFO |

