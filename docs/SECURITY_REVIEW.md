# Application security review (Phase 3.6)

Scope: the code in this repository, reviewed and tested on **local PostgreSQL + the local Supabase API stand-in**.
Supabase implementation prepared; local PostgreSQL/RLS tests pass; real Supabase validation pending.

The rule throughout: **the database is the security boundary.** The UI hides what a role cannot do, the server actions check
again, and RLS + triggers refuse anything that gets past both. Every row below says how it was checked.

| Area | Finding / control | How verified | Result |
|---|---|---|---|
| Authentication | Supabase Auth (email + password). Sign-in requires an **active staff row** checked under RLS; one generic error for wrong email/password; public sign-up to be disabled on the project (`SUPABASE_SETUP.md` §2, §6). | E2E admin suite (login, inactive staff, sign-out); `scripts/rls-check.ts` | PASS locally |
| Session handling | Cookies `httpOnly`, `sameSite=lax`, `secure` in production; the proxy refreshes the session but is **not** the boundary — every admin page and action re-reads the user (`auth.getUser`) and role. | code; E2E: anon → login redirect on every admin path | PASS |
| Authorization (app) | Every exported server action calls a guard (`assertPermission` / `requireStaff` / `getStaff`) before touching data. | `tests/security.test.ts` scans every `"use server"` file | PASS (static check) |
| Authorization (database) | 8 identities × 195 cases (SELECT/INSERT/UPDATE/DELETE + workflow RPCs) on every important table, compared with the permission model. | `tests/rls-matrix.test.ts` → `docs/rls-matrix-run.txt`: **1,560/1,560 cells** | PASS locally |
| RLS coverage | RLS on every table; every view `security_invoker`; every SECURITY DEFINER function pins `search_path`; anon can call no write RPC; API roles hold no TRUNCATE/REFERENCES/TRIGGER (fixed in 0021). | `npm run db:migrations` audit | PASS |
| Privilege escalation | Self-grant of a role, promotion to super admin by an admin, forged audit/version rows, forged discoveries, forged evidence: all refused by the database. | RLS matrix rows `admin_users`, `role_permissions`, `audit_logs`, `content_versions`, `field_evidence` | PASS |
| Public content exposure | Drafts, review, unpublished, archived never public; expired opens by URL only; internal notes never rendered. | `tests/data-contract.test.ts`, `tests/e2e/content-safety.ts` (36 surfaces, detail URLs, sitemap, JSON-LD, search) | PASS locally |
| CSRF | Mutations are Next.js **server actions** (POST, same-origin checked by Next via the `Origin` header) or cron GETs protected by a bearer secret. No state-changing GET routes; no CORS headers are set. | code review; security test: the only API routes are cron | PASS (by design) |
| XSS | React escapes all text. The only `dangerouslySetInnerHTML` is JSON-LD, which escapes `<` to prevent `</script>` breakout. Admin-entered text is rendered as text (no HTML/Markdown rendering). | code review (`grep dangerouslySetInnerHTML`) | PASS |
| SQL injection | No SQL string building in the app: supabase-js query builder + RPC parameters. SQL functions that build dynamic SQL use `format('%I')` / `using` parameters (e.g. `apply_discovery_changes`, `content_is_public`) and whitelist column names. | code review of every `execute format` | PASS |
| Open redirects | `safeNext` accepts only same-site `/admin…` paths (rejects `//host`, `\`, absolute URLs, the login page). | `tests/security.test.ts` (9 hostile inputs) | PASS |
| Unsafe URL handling | Official URLs must be http(s) (DB checks); publishing needs an official link on a registered official domain or .gov.in/.nic.in (0022); public pages show each external link's host; external links open with `rel="noopener noreferrer"`. The crawler refuses private/loopback addresses (SSRF), redirects are re-checked, `ALLOW_PRIVATE_SOURCE_HOSTS` is ignored on the live site. | `tests/trust.test.ts`, `tests/ingestion.test.ts` (SSRF cases), env tests | PASS |
| File upload | The only upload is the CSV import (staff, `ingestion:run`): size-capped, parsed as text, every row goes to the review queue, never straight to public content. No file storage bucket exists. | code; E2E phase 3 (CSV import) | PASS |
| PDF handling | PDFs are parsed in-process with pdf.js (unpdf) from memory, size-capped (15 MB), never stored permanently (text kept 30 days for review); a malformed PDF fails that notice only. | failure drill ("malformed PDF": SAFE) | PASS |
| Server actions | Input validated with zod or explicit checks; control characters stripped; lengths capped; UUIDs validated before queries. | code review; E2E invalid-input cases | PASS |
| API routes | Only `/api/cron/*`: GET, bearer secret compared in constant time, secret ≥ 16 chars required, per-job rate limit, generic error bodies. | `tests/security.test.ts`, E2E 401 checks | PASS |
| Cron endpoints | 401 without/with a wrong secret; 429 above 30 runs/hour per job; each run recorded in `cron_runs`. | E2E; unit tests | PASS locally |
| Rate limiting | Failed sign-ins (per IP 30 / per account 8 per 15 min — successful sign-ins never count), search 90/min per IP, admin actions 240/min per person, source checks 60/h, imports 30/h, cron 30/h per job. Shared DB store; fails open (logged) if the store is down. | `tests/security.test.ts`; E2E login limit | PASS locally |
| Secret exposure | Service-role key read in one server-only module; never in a client bundle (build scan); no `.env*` or key-shaped value committed; server refuses to start if a secret is in a `NEXT_PUBLIC_` variable. | `tests/architecture.test.ts`, `tests/env.test.ts`, `scripts/check-bundle-secrets.ts` | PASS |
| Logging | Structured JSON; keys like password/token/secret/cookie redacted; JWTs, secret keys, bearer tokens and email local-parts removed from any value. | `tests/security.test.ts` | PASS |
| Admin route protection | proxy (optimistic) + page guards + action guards + RLS; admin pages `noindex`, `no-store`, disallowed in robots.txt; draft previews need a signed, expiring, per-staff token. | E2E (preview token tampering, cross-staff token) | PASS |
| Security headers | HSTS (2 years), X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy. | `next.config.ts` | PASS · **CSP not yet set** |

## Open items (not fixed in Phase 3.6)

1. **Content-Security-Policy** — add in Report-Only on staging, then enforce.
2. **Alerting** — failures are logged as structured JSON (`src/lib/log.ts`) and recorded in `cron_runs` / `ingestion_runs`,
   but nothing notifies a person yet (Sentry or a log drain alert).
3. **MFA for staff** — Supabase Auth supports TOTP; enable for admin/super admin once the project exists.
4. **Real-project verification** — everything above ran against local PostgreSQL and a stand-in for Supabase's APIs.
