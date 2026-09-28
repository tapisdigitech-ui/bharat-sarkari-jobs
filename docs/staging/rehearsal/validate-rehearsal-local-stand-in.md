# validate — REHEARSAL — local Supabase API stand-in + local PostgreSQL, NOT Supabase

Run at 2026-09-26T08:07:06.016Z. 60 PASS · 1 FAIL · 15 INFO · 2 NOT RUN.

> **REHEARSAL.** This run used the local stand-in (tests/harness), not a Supabase project and not a deployment. It proves the script works; it proves nothing about staging.

## 1. Connection

| Check | Expected | Got | Result |
|---|---|---|---|
| Auth API reachable (/auth/v1/health) | 200 | 200 | PASS |
| REST API reachable with the anon key (states) | no error, rows > 0 | 36 states | PASS |
| Round-trip time from this machine (one REST read) | — | 11 ms | INFO |

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
| Object counts | — | {"states":36,"tables":58,"indexes":217,"policies":127,"triggers":88,"districts":0,"functions":200,"foreign_keys":98,"role_permissions":222,"workflow_transitions":84} | INFO |
| Applied migrations recorded by the Supabase CLI | 23 rows | no supabase_migrations table — applied outside `supabase db push`? | INFO |
| Local baseline written | — | docs/staging/local-schema-baseline.json | INFO |

## 3. Authentication

| Check | Expected | Got | Result |
|---|---|---|---|
| Staff sign-in with the right password | session | session issued | PASS |
| Wrong password is refused | error | Invalid login credentials | PASS |
| Unknown email is refused | error | Invalid login credentials | PASS |
| Same message for wrong password and unknown email (no account enumeration) | identical | Invalid login credentials / Invalid login credentials | PASS |
| Access-token lifetime (exp − iat) | — | 3600 s | INFO |
| Token edited to role=service_role (signature no longer matches) is refused by the REST API | 401 / error | 401 JWT invalid or expired | PASS |
| alg "none" token is refused | error | 401 JWT invalid or expired | PASS |
| Garbage bearer token is refused | error | 401 | PASS |
| Plain user edits its own user_metadata to claim super_admin | — | accepted by the Auth server (expected: metadata is user-controlled and must never grant anything) | INFO |
| A plain user who writes role=super_admin into its own user_metadata is still not staff | is_staff() = false, admin_users hidden | is_staff=false, admin_users rows=0 | PASS |
| Sign-out succeeds | no error | ok | PASS |
| After sign-out the refresh token is revoked | error | Invalid Refresh Token: Refresh Token Not Found | PASS |
| After sign-out the Auth server rejects the old access token (the app checks every admin request with getUser) | error | Auth session missing! | PASS |
| After sign-out, the old access token at the REST API directly | — | still accepted until it expires (stateless JWT; 1 draft rows visible). Bounded by the token lifetime above; the app itself rejects it via getUser. | INFO |
| Disabled staff: the same, still-valid token loses access at once | draft visible before; hidden and not editable after | before 1 row, after 0 row, edit 0 row | PASS |
| Role change (editor → moderator) applies to the existing token immediately | edit allowed before, refused after | before 1 row, after Not allowed to edit jobs | PASS |
| Expired access token is refused | — | needs --wait-expiry (waits 3600 s); the app-level expiry redirect is covered by the browser check | NOT RUN |

## 4. RLS attack (direct API, 8 identities)

| Check | Expected | Got | Result |
|---|---|---|---|
| RLS attack matrix: 35 cases × 8 identities | every cell matches the permission model | 280/280 match | PASS |

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
| audit_logs: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| admin_users: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| field_evidence: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| source_probes: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| editorial_effort: nothing readable by anon | error or 0 rows | refused (401) | PASS |
| cron_runs: nothing readable by anon | error or 0 rows | refused (401) | PASS |

## 6. Audit log

| Check | Expected | Got | Result |
|---|---|---|---|
| An editor's change writes an audit row with the editor as actor | 1+ row, actor = editor | 1 row(s), actor match: true | PASS |
| Super admin cannot delete audit rows | refused | refused | PASS |
| Super admin cannot rewrite audit rows | refused | refused | PASS |
| Service role and audit rows | — | not attempted: the service role bypasses RLS by design, so append-only is enforced for every API role but not for the key itself — the key never reaches the browser (bundle scan in site.ts) | INFO |
| Staff role changes made during this run were audited | 1+ row | 9 row(s) | PASS |

## 7. Cron single-run lock (database)

| Check | Expected | Got | Result |
|---|---|---|---|
| First cron_begin takes the lock | a run id | 2 | PASS |
| Second cron_begin while the first is unfinished is refused | null | null | PASS |
| After the first run finishes, the lock is free again | a run id | 4 | PASS |
| Latest cron runs recorded on this project (scheduler evidence) | — | none — the Vercel cron has not run against this database yet | INFO |

## 8. Demo isolation (database)

| Check | Expected | Got | Result |
|---|---|---|---|
| jobs: live/expired rows whose title or URL looks like demo/synthetic/test/placeholder | none | [] | PASS |
| exams: live/expired rows whose title or URL looks like demo/synthetic/test/placeholder | none | [] | PASS |
| results: live/expired rows whose title or URL looks like demo/synthetic/test/placeholder | none | [] | PASS |
| admit_cards: live/expired rows whose title or URL looks like demo/synthetic/test/placeholder | none | [] | PASS |
| answer_keys: live/expired rows whose title or URL looks like demo/synthetic/test/placeholder | none | [] | PASS |
| recruitments: live/expired rows whose title or URL looks like demo/synthetic/test/placeholder | none | [] | PASS |
| exam_calendar: live/expired rows whose title or URL looks like demo/synthetic/test/placeholder | none | [] | PASS |
| synthetic sources | none on staging | [] | PASS |
| organizations_marked: live/expired rows whose title or URL looks like demo/synthetic/test/placeholder | none | [] | PASS |
| synthetic discoveries open | — | 1 | INFO |

## 9. Human review effort (editorial_effort)

| Check | Expected | Got | Result |
|---|---|---|---|
| Real (non-synthetic) discoveries measured | — | {"discoveries":0,"reviewed":0,"published":0,"median_wait_to_start_min":null,"median_review_min":null,"median_review_to_publish_min":null,"median_corrections":null,"median_fields_verified":null} | INFO |
| Enough reviewed records for an effort estimate | ≥ 20 | 0 | NOT RUN |

## 10. Server-side source probes

| Check | Expected | Got | Result |
|---|---|---|---|
| Official sources registered (not synthetic) | — | 0 | INFO |
| Sources probed from a deployment | all | 0/0 | **FAIL** |

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
| source_probes UPDATE verdict | · | · | · | · | · | · | · | · |
| admin_users SELECT the victim's row | · | · | · | · | · | · | ✓ | ✓ |
| admin_users UPDATE promote victim → super_admin | · | · | · | · | · | · | · | ✓ |
| admin_users UPSERT own row as super_admin | · | · | · | · | · | · | · | ✓ |
| role_permissions INSERT (self-grant) | · | · | · | · | · | · | · | · |
| audit_logs SELECT | · | · | ✓ | · | · | · | ✓ | ✓ |
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

### Source-by-source table

| Source | Server Access | Robots | Discovery | Extraction | Review | Publish | Notes |
|---|---|---|---|---|---|---|---|
