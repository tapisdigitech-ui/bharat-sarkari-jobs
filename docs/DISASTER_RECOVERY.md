# Disaster recovery (Phase 3.6)

**Status:** procedures written; the database parts rehearsed on **local PostgreSQL 16 only**. No real Supabase project,
backup or deployment exists yet, so no provider restore has been rehearsed. Detailed backup mechanics and retention rules
are in `docs/BACKUP_RECOVERY.md`; this document is the runbook for when something has gone wrong.

**First rule in every scenario:** stop the damage, then preserve evidence, then restore. Never "fix" production by deleting
rows. Nothing public should ever be hard-deleted — records are unpublished or archived, updates are withdrawn.

| # | Scenario | Target to recover | Section |
|---|---|---|---|
| 1 | Database lost or corrupted | ≤ 24 h of data (nightly dump) · ≤ minutes with PITR | §1 |
| 2 | A migration failed or did damage | pre-migration state | §2 |
| 3 | Wrong content published / edited / unpublished | the previous published version | §3 |
| 4 | A bad corrigendum or source change applied | the version before it | §4 |
| 5 | Source registry damaged / a source misbehaving | the last good source configuration | §5 |
| 6 | Environment / secrets lost or leaked | a working, rotated configuration | §6 |
| 7 | A deployment broke the site | the last good deployment | §7 |

---

## 1. Database backup and restore

**Backups (production):** Supabase daily backups + **PITR** (choose the plan before launch), plus our own nightly
`pg_dump --format=custom` taken from outside Supabase and kept encrypted (30 daily + 12 monthly). A dump is also taken
immediately before every migration. Commands: `docs/BACKUP_RECOVERY.md` §1.

**Restore — always into a NEW project, never over the live one:**

1. Put the admin in read-only mode: set every staff account inactive except one super admin (Users → deactivate), so no
   editor writes into the database you are about to replace. The public site keeps serving the current data.
2. Create a new Supabase project in the same region (steps 1–2 of `docs/SUPABASE_SETUP.md`).
3. Restore: PITR in the dashboard to the chosen time, **or** `pg_restore --no-owner --dbname "$NEW_DATABASE_URL" backup.dump`.
4. Verify on the restored project: row counts per content table vs the last known numbers; `npm run rls:check` 35/35;
   `select count(*) from supabase_migrations.schema_migrations` equals the number of files in `supabase/migrations/`.
5. Point **staging** at it first, smoke-test (`docs/SUPABASE_SMOKE_TEST.md` §6–9), then switch production
   `NEXT_PUBLIC_SUPABASE_URL` / keys and redeploy (§7).
6. Re-activate staff. Note the data-loss window in the incident log.

*Rehearsed locally:* dump → restore of an old-shape database followed by every migration, with no row loss
(`tests/harness/upgrade-test.sh`, part of `npm run db:migrations`). *Not rehearsed:* a restore from a real Supabase backup.

## 2. Migration recovery

Migrations are forward-only; rollback is restore-or-reverse:

- **Failed half-way on Supabase** (`db push` stops at an error): the failing file's transaction is rolled back; earlier
  files stay applied. Fix the file **only if it has never succeeded anywhere**, re-run `db push`. If it succeeded elsewhere,
  write a new corrective migration instead — never edit an applied migration.
- **Applied but did damage**: take a dump of the damaged state (evidence), then either write a reverse migration (small,
  reviewed, tested with `npm run db:migrations`) or restore the pre-migration dump into a new project (§1).
- **Prevention:** every migration set passes `npm run db:migrations` locally (fresh, every upgrade path, legacy data,
  schema equivalence, RLS/privilege audit) and runs on staging before production.

## 3. Content restoration

| Situation | Recovery |
|---|---|
| Wrong edit on a live record | Record → **Version history** (`content_versions`: who, when, why, full snapshot) → re-enter the previous values in the editor. The restoration is itself a new version with a reason. |
| Published something that should not be public | **Unpublish** (moderator or above) — it leaves listings, search, the sitemap and structured data on the next request (tested: `tests/e2e/content-safety.ts`). Then fix and republish. |
| Unpublished / archived by mistake | Workflow back to review → publish (audited). |
| A draft was deleted (only drafts/archived rows can be deleted, by roles with delete rights) | `audit_logs.before` holds the full row as JSON: re-insert via SQL as the database owner, then publish normally so the publish gate runs. |
| Many records damaged (bulk mistake, compromised account) | Deactivate the account, list its changes: `select * from audit_logs where actor_id = '<id>' and created_at > '<time>' order by created_at;` then restore each record from its version snapshot; for large numbers restore a dump into a scratch database and copy the rows back. |

## 4. Version and official-update restoration

- `content_versions` is append-only for every API role — history cannot be rewritten through the application.
- A corrigendum applied wrongly: restore the previous values from the version before it (§3); the version row names the
  discovery that caused the change. Then **withdraw** the public official-update entry (`official_updates.is_withdrawn`) —
  entries are never deleted, and a withdrawn entry leaves the public page at once.
- Field evidence (`field_evidence`) and per-field verification history (`field_verifications`) are append-only; a wrong
  decision is corrected by recording a new decision, the old one stays for the record.

## 5. Source restoration

- Every change to `government_sources` is in `audit_logs` (before/after JSON). A bad configuration: copy the previous
  `adapter`, `adapter_config`, URLs and status back from the audit row.
- A source that misbehaves (floods the review queue, reads the wrong pages): set it to **PAUSED** — scheduled checks skip
  it; nothing already published changes. Sources with history cannot be deleted (foreign keys `on delete restrict`).
- A source whose site blocked us (403, robots refusal) is marked **BLOCKED** by the checker and not retried automatically.
  Do not work around it; operate it manually (single-URL checks) and contact the site if appropriate.
- Wrong discoveries never touch public content: reject/ignore them in the review queue.

## 6. Environment recovery (lost or leaked secrets)

1. **Leaked service-role key:** Supabase → Project Settings → API → roll the service-role / secret key **immediately**;
   update `SUPABASE_SERVICE_ROLE_KEY` in the host; redeploy. Review `audit_logs` and `cron_runs` for activity by
   `service_role` since the leak. (A leaked anon key is not a secret — RLS applies — but roll it if it was abused.)
2. **Leaked `CRON_SECRET` / `PREVIEW_SECRET`:** generate new values (`openssl rand -hex 32`), set, redeploy. Old preview
   links stop working at once. Cron runs are rate-limited per job, so a leaked cron secret cannot hammer official sites.
3. **Lost configuration:** everything needed is listed in `.env.example`; values live in the team password manager and
   the host's environment settings — never in the repository (a test fails if an `.env` file or a key-shaped value is
   committed). The server refuses to start with a dangerous configuration (`src/lib/env-rules.ts`), so a half-restored
   environment fails loudly instead of serving demo data or leaking keys.

## 7. Production deployment recovery

- **Bad deploy:** in Vercel → Deployments, **promote the previous deployment** (instant rollback). Database migrations are
  not rolled back by this — if the bad deploy included a migration, see §2 first.
- **Site down because of configuration:** the start-up check logs `[env] error: …` naming the variable; fix it in the host
  and redeploy.
- **Supabase outage:** public pages that are cached keep serving; dynamic pages show the error page (HTTP 500). Nothing to
  restore — do not switch to demo data (production refuses it). Post a status note if the outage is long.
- **Crawler outage / government site outage:** content is never removed because a source is unreachable; the link monitor
  flags records "official source unavailable" after repeated failures and a person decides.

## Incident log

| Date (IST) | What happened | Data-loss window | Recovery used | Follow-up |
|---|---|---|---|---|
| _(none yet)_ | | | | |
