# Backup and recovery

Status: **written and rehearsed locally (Phase 3.7 drill); never rehearsed on a real Supabase project** (there is no project yet).
Everything marked "rehearsed" below was run against the local PostgreSQL 16 test database only.

## 1. Database backups

| Layer | What it gives | Action |
|---|---|---|
| Supabase automated backups | Daily snapshots (plan-dependent retention); Point-in-Time Recovery is a paid add-on | Before launch: choose a plan with **PITR** for production. Record the retention in the table at the end. |
| Our own logical dump | Independent of the provider; restorable into any PostgreSQL 16 | Nightly `pg_dump` from a scheduled job **outside** Supabase (GitHub Actions or a small VM), encrypted, kept 30 days + monthly copies for 12 months |
| Before every migration | A known-good point | `pg_dump --format=custom` immediately before `supabase db push` |

Logical dump and restore — **use `scripts/staging/backup-restore.sh`** (Phase 3.7). It is the procedure below, scripted and
verified:

```bash
DATABASE_URL=<source> NEW_DATABASE_URL=<a NEW, EMPTY project> bash scripts/staging/backup-restore.sh
```

1. `pg_dump --format=custom --no-owner --schema=public [--schema=supabase_migrations]` — schema, data, grants and RLS policies
   (read-only on the source). **Keep the privileges**: they are part of the security model.
2. `pg_dump --data-only --table=auth.users --table=auth.identities` — accounts only; the new project has its own `auth` schema.
3. In the target: the same extensions in the same schemas, then restore the auth data, then `public` (skipping the
   `SCHEMA public` entry, which already exists).
4. **Re-assert the exact API-role privileges of the source** (revoke all + re-grant, tables/views/sequences/functions for
   `public`, `anon`, `authenticated`, `service_role`) and remove TRUNCATE/REFERENCES/TRIGGER from the schema defaults.
5. Verify: row counts and per-table content checksums identical, RLS/policy/trigger/function/grant counts identical,
   `ops_schema_audit()` clean on the copy. Only then point a site at it (and run `docs/SUPABASE_SMOKE_TEST.md`).

**The Phase 3.6 version of this section would not have worked** (found by the Phase 3.7 restore drill, local rehearsal):
`--no-privileges` dropped every grant/revoke, and a new Supabase project's default privileges then give `anon` and
`authenticated` ALL (including TRUNCATE, which ignores RLS) on every restored table; dumping the whole `auth` schema clashes
with the new project's own; and the restore stopped at `government_sources` because a CHECK-constraint function called
another function without a schema (pg_restore uses an empty `search_path`) — fixed in migration 0026.

**Rehearsed locally (Phase 3.7):** local test database → fresh local database: PASS (docs/staging/rehearsal/). **Not yet
done:** the same drill between two real Supabase projects (docs/STAGING_RUNBOOK.md step 7) — mandatory before production.

## 2. Migration rollback

Migrations are forward-only SQL files. Rollback = restore the pre-migration dump into a new project, or run a hand-written
reverse migration. Rules:

1. Take the pre-migration dump (above). 2. Apply to **staging** first and run the smoke test. 3. Apply to production in a quiet
hour. 4. If anything fails: put the site in read-only mode (unpublish nothing — just stop editors), restore the dump into a new
project, switch `NEXT_PUBLIC_SUPABASE_URL` / keys, redeploy.

Migrations that change data (e.g. `0013` backfill) are written row-by-row with triggers disabled and `check_violation` caught, so
a partial run never flips live records to "updated" (bug found and fixed in Phase 3 by the strict upgrade test).

## 3. Content recovery (a record was changed or unpublished by mistake)

Nothing is hard-deleted in normal operation (archive over delete; `status = 'archived'`). To recover:

| Situation | How |
|---|---|
| Wrong edit on a published record | `content_versions` holds a full snapshot of every published version (who, when, why, changed fields). Open the record → Version history → copy the old values back through the editor (the change is itself versioned and audited). |
| Record unpublished/archived by mistake | Workflow transition back to `review` → `published` (audited). |
| A change applied from a corrigendum was wrong | Same as a wrong edit; the version row names the discovery (`app.change_discovery`) that caused it. |
| Row really deleted (only possible for staff with delete rights on drafts) | `audit_logs` keeps the full `before` row as JSON — re-insert it via SQL, then re-run the publish gate. |

**Rehearsed locally:** version snapshots, apply-change versions and audit rows are asserted in the DB tests and in
`tests/live/replay-pilot.ts` (real-text replay).

## 4. Version recovery (content_versions)

`content_versions` rows are append-only (no UPDATE/DELETE policy for staff). Retention: keep forever (small: one row per
published change). Export monthly with the logical dump.

## 5. Audit retention

`audit_logs` is append-only for staff; only `service_role` / the database owner can delete. Keep **at least 3 years** online
(recruitment disputes run long), then move to cold storage (CSV export) rather than delete. Size check: `select pg_size_pretty(pg_total_relation_size('audit_logs'));`
— review quarterly.

## 6. Source-document metadata retention

`source_documents` keeps URL, final URL, HTTP status, **SHA-256**, size, type, parser version and extraction status **forever**
(evidence of what the official site said and when). The extracted text is kept only for review and purged after 30 days
(`purge_old_document_text`, run by the daily link cron). We never keep a permanent copy of an official PDF; the SHA-256 lets anyone
prove later whether a document changed.

## Sign-off

| Date | Project | Backup type / retention | Restore rehearsed? | By |
|---|---|---|---|---|
| _(not yet)_ | | | | |
