# Backup → restore drill — REHEARSAL — local test database → fresh local database (NOT Supabase)

Run at 2026-09-26T08:07:18Z. Source is only read (pg_dump). Connection strings are not recorded.

> **REHEARSAL.** Local databases; proves the procedure and the script, not the Supabase backup.

| Step | Result | Detail |
|---|---|---|
| Dump public schema + data + grants + policies (no supabase_migrations schema) | PASS | 0.2 s |
| Dump auth users/identities (data only) | PASS | 0.2 s |
| Dump size | INFO | 512 KB for 443 public rows |
| Restore into the new database | PASS | 1.3 s; pg_restore errors: public 0, auth 0; API-role privileges re-asserted: yes (1836 statements) |
| Row counts identical in every public table | PASS | identical (58 tables) |
| Content checksums identical (md5 of every row, every table) | PASS | identical |
| Security shape identical (RLS flags, policies, triggers, functions, views, API grants, auth users) | PASS | source {"rls_on" : 58, "policies" : 127, "triggers" : 88, "functions" : 200, "views" : 5, "anon_grants" : 129, "authenticated_grants" : 215, "anon_executable_functions" : 162, "authenticated_executable_functions" : 190, "auth_users" : 2} / restored {"rls_on" : 58, "policies" : 127, "triggers" : 88, "functions" : 200, "views" : 5, "anon_grants" : 129, "authenticated_grants" : 215, "anon_executable_functions" : 162, "authenticated_executable_functions" : 190, "auth_users" : 2} |
| ops_schema_audit() on the restored copy: no RLS gaps, no dangerous grants | PASS | {"tables_without_rls": [], "restore_unsafe_functions": [], "api_role_dangerous_grants": [], "write_functions_callable_by_anon": [], "definer_functions_without_search_path": []} |

Recovery time measured for this data size: 1.7 s (dump + restore; excludes creating the project and switching the app's environment variables — see docs/DISASTER_RECOVERY.md).

Result: **PASS** — the dump restores into a clean database with identical data and the same security configuration.
