# validate — REHEARSAL — local Supabase API stand-in + local PostgreSQL, NOT Supabase

Run at 2026-09-28T18:16:41.140Z. 10 PASS · 0 FAIL · 6 INFO · 0 NOT RUN.

> **REHEARSAL.** This run used the local stand-in (tests/harness), not a Supabase project and not a deployment. It proves the script works; it proves nothing about staging.

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
| PostgreSQL server version | — | 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) | INFO |
| Extensions | — | {"citext":"public","pg_trgm":"public","plpgsql":"pg_catalog","pgcrypto":"public"} | INFO |
| Object counts | — | {"states":36,"tables":58,"indexes":217,"policies":127,"triggers":88,"districts":0,"functions":86,"foreign_keys":98,"role_permissions":222,"workflow_transitions":84} | INFO |
| Applied migrations recorded by the Supabase CLI | 24 rows | no supabase_migrations table — applied outside `supabase db push`? | INFO |
| Local baseline NOT written | — | this is a plain --rehearsal run; pass --write-baseline on a clean run to (re)establish docs/staging/local-schema-baseline.json | INFO |

## Cleanup

| Check | Expected | Got | Result |
|---|---|---|---|
| Fixtures and throw-away accounts removed | nothing left | jobs left: 0 | PASS |
| Kept on purpose | — | audit_logs rows written by this run (append-only) and the cron_runs rows of the lock check | INFO |

