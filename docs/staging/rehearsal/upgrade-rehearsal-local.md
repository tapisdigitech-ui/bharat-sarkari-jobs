# Upgrade test (Phase 3.6 schema + data → Phase 3.7) — REHEARSAL — local databases (NOT Supabase)

Run at 2026-09-26T08:07:15Z. Connection strings are not recorded.

> **REHEARSAL.** Local databases; proves the script, not Supabase.

| Check | Result | Detail |
|---|---|---|
| Phase 3.6 schema (migrations through 0025) installed | INFO | 57 tables |
| Upgrade: 0026_ops_diagnostics.sql | PASS | applied on top of data |
| Re-run: 0026_ops_diagnostics.sql | PASS | idempotent |
| Upgrade duration | INFO | 0 s |
| Row counts jobs/discoveries/sources/cron runs unchanged by the upgrade | PASS | 1/1/1/2 |
| Audit log not shortened by the upgrade (append-only) | PASS | 1 |
| Existing discovery has review_started_at = null (not invented) | PASS | t |
| editorial_effort covers existing discoveries | PASS | 1 |
| The one-open-run index accepted the legacy data | PASS | 1 |
| cron_begin closes the old unfinished run once stale | PASS | abandoned |
| ops_schema_audit() after the upgrade: every list empty | PASS | 1 |
| Fresh install (DATABASE_URL) and upgraded scratch have the same schema and grants | PASS | identical (4332 normalised lines) |

Result: **PASS**
