/**
 * RLS ROLE MATRIX (Phase 3.6 item 6) — local PostgreSQL with the real migrations; NOT real Supabase.
 *
 * Every case runs as each of 8 identities exactly the way PostgREST would (SET LOCAL ROLE + request.jwt.claims):
 *   anon · authenticated (no staff role) · moderator · editor · seo_manager · content_manager · admin · super_admin
 * and the expectation comes from the permission model (src/lib/admin/permissions.ts — tests/rls.test.ts proves the database
 * tables match it). "Denied" means the DATABASE refused: an error, or zero rows visible/affected. Every write is rolled back
 * to a savepoint, so each case sees the same data.
 *
 * Output: a matrix printed to stdout (and docs/rls-matrix-run.txt when RLS_MATRIX_OUT is set).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { ANON, Session, U, admin, seedUsers, user, type Actor } from "./db";
import { seedContentMatrix, type Row } from "./fixtures/content-matrix";
import { can, type Action, type Role } from "../src/lib/admin/permissions";

type Who = "anon" | "authenticated" | Role;
const WHO: Who[] = ["anon", "authenticated", "moderator", "editor", "seo_manager", "content_manager", "admin", "super_admin"];
const actor: Record<Who, Actor> = {
  anon: ANON, authenticated: user(U.plain), moderator: user(U.mod), editor: user(U.ed), seo_manager: user(U.seo),
  content_manager: user(U.cm), admin: user(U.adm), super_admin: user(U.sa),
};
const isStaff = (w: Who) => w !== "anon" && w !== "authenticated";
const has = (a: Action) => (w: Who) => isStaff(w) && can(w as Role, a);
const nobody = () => false, everyone = () => true;

interface Case { table: string; op: "SELECT" | "INSERT" | "UPDATE" | "DELETE"; what: string; sql: string; params: () => unknown[]; allow: (w: Who) => boolean }
const cases: Case[] = [];
const ctx: Record<string, string> = {};
let rows: Row[] = [];
const idOf = (kind: Row["kind"], state: Row["state"]) => rows.find((r) => r.kind === kind && r.state === state)!.id;

const KINDS: { kind: Row["kind"]; perm: string; table: string; minimal: string }[] = [
  { kind: "job", perm: "job", table: "jobs", minimal: `(slug, title, organization_id, level) values ('rlsm-'||gen_random_uuid(), 'RLS matrix job', $1, 'central')` },
  { kind: "recruitment", perm: "recruitment", table: "recruitments", minimal: `(title, organization_id, is_all_india) values ('RLS matrix recruitment', $1, true)` },
  { kind: "exam", perm: "exam", table: "exams", minimal: `(name, slug, organization_id, level) values ('RLS matrix exam', 'rlsm-'||gen_random_uuid(), $1, 'central')` },
  { kind: "admit_card", perm: "admit_card", table: "admit_cards", minimal: `(title, organization_id, is_all_india) values ('RLS matrix admit card', $1, true)` },
  { kind: "result", perm: "result", table: "results", minimal: `(title, organization_id, is_all_india) values ('RLS matrix result', $1, true)` },
  { kind: "answer_key", perm: "answer_key", table: "answer_keys", minimal: `(title, organization_id, is_all_india) values ('RLS matrix answer key', $1, true)` },
  { kind: "calendar", perm: "exam_calendar", table: "exam_calendar", minimal: `(title, organization_id, is_all_india) values ('RLS matrix calendar', $1, true)` },
];
const edited = (t: string) => (t === "exams" ? "overview" : t === "recruitments" || t === "jobs" ? "summary" : "description");

for (const k of KINDS) {
  const T = k.table, P = (v: string) => `${k.perm}:${v}` as Action;
  cases.push(
    { table: T, op: "SELECT", what: "published", sql: `select id from ${T} where id=$1`, params: () => [idOf(k.kind, "published")], allow: everyone },
    { table: T, op: "SELECT", what: "expired (opens by URL)", sql: `select id from ${T} where id=$1`, params: () => [idOf(k.kind, "expired")], allow: everyone },
    { table: T, op: "SELECT", what: "draft", sql: `select id from ${T} where id=$1`, params: () => [idOf(k.kind, "draft")], allow: isStaff },
    { table: T, op: "SELECT", what: "review", sql: `select id from ${T} where id=$1`, params: () => [idOf(k.kind, "review")], allow: isStaff },
    { table: T, op: "SELECT", what: "unpublished", sql: `select id from ${T} where id=$1`, params: () => [idOf(k.kind, "unpublished")], allow: isStaff },
    { table: T, op: "SELECT", what: "archived", sql: `select id from ${T} where id=$1`, params: () => [idOf(k.kind, "archived")], allow: isStaff },
    { table: T, op: "INSERT", what: "new draft", sql: `insert into ${T} ${k.minimal} returning id`, params: () => [ctx.org], allow: has(P("create")) },
    { table: T, op: "INSERT", what: "new row already published", sql: `insert into ${T} ${k.minimal.replace(") values (", ", status) values (").replace(/\)$/, ", 'published')")} returning id`, params: () => [ctx.org], allow: nobody },
    { table: T, op: "UPDATE", what: "edit a draft", sql: `update ${T} set ${edited(T)}='rls matrix edit' where id=$1 returning id`, params: () => [idOf(k.kind, "draft")], allow: has(P("edit")) },
    { table: T, op: "UPDATE", what: "edit a published record", sql: `update ${T} set ${edited(T)}='rls matrix edit' where id=$1 returning id`, params: () => [idOf(k.kind, "published")], allow: has(P("publish")) },
    { table: T, op: "UPDATE", what: "publish (review → published)", sql: `update ${T} set status='published' where id=$1 returning id`, params: () => [idOf(k.kind, "review")], allow: has(P("publish")) },
    { table: T, op: "UPDATE", what: "publish skipping review (draft → published)", sql: `update ${T} set status='published' where id=$1 returning id`, params: () => [idOf(k.kind, "draft")], allow: nobody },
    { table: T, op: "UPDATE", what: "unpublish (published → draft)", sql: `update ${T} set status='draft' where id=$1 returning id`, params: () => [idOf(k.kind, "published")], allow: has(P("unpublish")) },
    { table: T, op: "UPDATE", what: "archive (expired → archived)", sql: `update ${T} set status='archived' where id=$1 returning id`, params: () => [idOf(k.kind, "expired")], allow: has(P("expire")) },
    { table: T, op: "DELETE", what: "a draft", sql: `delete from ${T} where id=$1 returning id`, params: () => [idOf(k.kind, "draft")], allow: has(P("delete")) },
    { table: T, op: "DELETE", what: "a published record", sql: `delete from ${T} where id=$1 returning id`, params: () => [idOf(k.kind, "published")], allow: nobody },
  );
}

// Job children (vacancies) follow the parent's visibility and edit rights.
cases.push(
  { table: "job_vacancies", op: "SELECT", what: "of a published job", sql: `select 1 from job_vacancies where job_id=$1`, params: () => [idOf("job", "published")], allow: everyone },
  { table: "job_vacancies", op: "SELECT", what: "of a draft job", sql: `select 1 from job_vacancies where job_id=$1`, params: () => [idOf("job", "draft")], allow: isStaff },
  { table: "job_vacancies", op: "INSERT", what: "on a draft job", sql: `insert into job_vacancies (job_id, post_name, count) values ($1, 'RLS post', 1) returning job_id`, params: () => [idOf("job", "draft")], allow: has("job:edit") },
  { table: "job_internal", op: "SELECT", what: "editorial notes", sql: `select 1 from job_internal where job_id=$1`, params: () => [idOf("job", "draft")], allow: isStaff },
  { table: "content_internal", op: "SELECT", what: "internal notes", sql: `select 1 from content_internal limit 1`, params: () => [], allow: isStaff },
);

// Reference data: public read, managed by reference:manage.
for (const t of ["states", "districts", "departments", "qualifications", "categories", "reservation_categories", "result_types", "answer_key_types"]) {
  cases.push(
    { table: t, op: "SELECT", what: "all rows", sql: `select 1 from ${t} limit 1`, params: () => [], allow: everyone },
    { table: t, op: "UPDATE", what: "rename", sql: `update ${t} set name = name || '' where id = (select min(id) from ${t}) returning id`, params: () => [], allow: has("reference:manage") },
    { table: t, op: "DELETE", what: "unused row", sql: `delete from ${t} where slug=$1 returning id`, params: () => [ctx[`del_${t}`]], allow: has("reference:manage") },
  );
}
cases.push(
  { table: "organizations", op: "SELECT", what: "all rows", sql: `select 1 from organizations limit 1`, params: () => [], allow: everyone },
  { table: "organizations", op: "INSERT", what: "new organization", sql: `insert into organizations (name, slug, level) values ('RLS Org', 'rlsm-org-'||gen_random_uuid(), 'central') returning id`, params: () => [], allow: (w) => has("reference:manage")(w) || has("job:create")(w) },
  { table: "organizations", op: "UPDATE", what: "rename", sql: `update organizations set short_name='RLS' where id=$1 returning id`, params: () => [ctx.org], allow: has("reference:manage") },
  { table: "organizations", op: "DELETE", what: "unused organization", sql: `delete from organizations where id=$1 returning id`, params: () => [ctx.orgUnused], allow: has("reference:manage") },
);

// Sources and ingestion: staff-only, never public.
cases.push(
  { table: "government_sources", op: "SELECT", what: "registry", sql: `select 1 from government_sources where id=$1`, params: () => [ctx.src], allow: isStaff },
  { table: "government_sources", op: "INSERT", what: "new source", sql: `insert into government_sources (name, source_type, official_domain, base_url) values ('RLS Source', 'RECRUITMENT_BOARD', 'rlsm.gov.in', 'https://rlsm.gov.in') returning id`, params: () => [], allow: has("source:manage") },
  { table: "government_sources", op: "UPDATE", what: "change URL", sql: `update government_sources set notes='rls' where id=$1 returning id`, params: () => [ctx.src], allow: has("source:manage") },
  { table: "government_sources", op: "DELETE", what: "an unused source", sql: `delete from government_sources where id=$1 returning id`, params: () => [ctx.srcUnused], allow: has("source:manage") },
  { table: "government_sources", op: "DELETE", what: "a source with history (archive instead)", sql: `delete from government_sources where id=$1 returning id`, params: () => [ctx.src], allow: nobody },
  { table: "ingestion_runs", op: "SELECT", what: "runs", sql: `select 1 from ingestion_runs where id=$1`, params: () => [ctx.run], allow: isStaff },
  { table: "ingestion_runs", op: "INSERT", what: "fake run", sql: `insert into ingestion_runs (trigger) values ('manual') returning id`, params: () => [], allow: nobody },
  { table: "source_documents", op: "SELECT", what: "documents", sql: `select 1 from source_documents where id=$1`, params: () => [ctx.doc], allow: isStaff },
  { table: "source_documents", op: "DELETE", what: "a document", sql: `delete from source_documents where id=$1 returning id`, params: () => [ctx.doc], allow: nobody },
  { table: "discovered_items", op: "SELECT", what: "review queue", sql: `select 1 from discovered_items where id=$1`, params: () => [ctx.item], allow: isStaff },
  { table: "discovered_items", op: "INSERT", what: "fake discovery", sql: `insert into discovered_items (suggested_kind, title, extracted, confidence, confidence_score, content_hash) values ('job','x','{}','LOW',0,'h'||gen_random_uuid()) returning id`, params: () => [], allow: nobody },
  { table: "discovered_items", op: "UPDATE", what: "review decision", sql: `update discovered_items set review_note='rls' where id=$1 returning id`, params: () => [ctx.item], allow: has("ingestion:review") },
  { table: "discovered_items", op: "DELETE", what: "a discovery", sql: `delete from discovered_items where id=$1 returning id`, params: () => [ctx.item], allow: nobody },
  { table: "link_checks", op: "SELECT", what: "link history", sql: `select 1 from link_checks limit 1`, params: () => [], allow: isStaff },
  { table: "link_checks", op: "INSERT", what: "fake check", sql: `insert into link_checks (url, outcome) values ('https://x.gov.in','ok') returning id`, params: () => [], allow: nobody },
  { table: "content_versions", op: "SELECT", what: "history", sql: `select 1 from content_versions limit 1`, params: () => [], allow: isStaff },
  { table: "content_versions", op: "UPDATE", what: "rewrite history", sql: `update content_versions set reason='forged' where id=(select min(id) from content_versions) returning id`, params: () => [], allow: nobody },
  { table: "content_versions", op: "DELETE", what: "erase history", sql: `delete from content_versions where id=(select min(id) from content_versions) returning id`, params: () => [], allow: nobody },
  { table: "reference_imports", op: "SELECT", what: "LGD provenance", sql: `select 1 from reference_imports limit 1`, params: () => [], allow: isStaff },
  { table: "reference_imports", op: "INSERT", what: "fake import", sql: `insert into reference_imports (dataset, source_name, source_url, retrieved_on, file_sha256) values ('lgd_states','x','https://x.gov.in',current_date,repeat('c',64)) returning id`, params: () => [], allow: nobody },
);

// Verification, evidence and the official-updates chain (0024).
cases.push(
  { table: "official_updates", op: "SELECT", what: "of a published job", sql: `select 1 from official_updates where content_id=$1`, params: () => [idOf("job", "published")], allow: everyone },
  { table: "official_updates", op: "SELECT", what: "of a draft job", sql: `select 1 from official_updates where content_id=$1`, params: () => [idOf("job", "draft")], allow: isStaff },
  { table: "official_updates", op: "INSERT", what: "add an update", sql: `insert into official_updates (kind, content_id, update_type, title) values ('job',$1,'corrigendum','RLS matrix corrigendum') returning id`, params: () => [idOf("job", "published")], allow: (w) => has("job:edit")(w) || has("job:publish")(w) },
  { table: "official_updates", op: "UPDATE", what: "withdraw an update", sql: `update official_updates set is_withdrawn=true where content_id=$1 returning id`, params: () => [idOf("job", "published")], allow: (w) => has("job:edit")(w) || has("job:publish")(w) },
  { table: "official_updates", op: "DELETE", what: "erase history", sql: `delete from official_updates where content_id=$1 returning id`, params: () => [idOf("job", "published")], allow: nobody },
  { table: "field_evidence", op: "SELECT", what: "editorial evidence", sql: `select 1 from field_evidence where content_id=$1`, params: () => [idOf("job", "published")], allow: isStaff },
  { table: "field_evidence", op: "INSERT", what: "forged evidence", sql: `insert into field_evidence (kind, content_id, field, excerpt) values ('job',$1,'last_date','forged') returning id`, params: () => [idOf("job", "published")], allow: nobody },
  { table: "field_verifications", op: "SELECT", what: "decisions", sql: `select 1 from field_verifications where subject_id=$1`, params: () => [ctx.item], allow: isStaff },
  { table: "field_verifications", op: "INSERT", what: "verify a discovery field", sql: `insert into field_verifications (subject_kind, subject_id, field, status) values ('discovery',$1,'last_date','verified') returning id`, params: () => [ctx.item], allow: has("ingestion:review") },
  { table: "field_verifications", op: "DELETE", what: "erase a decision", sql: `delete from field_verifications where subject_id=$1 returning id`, params: () => [ctx.item], allow: nobody },
);

// Operational tables (0025): rate-limit counters are server-only; cron runs are readable by staff.
cases.push(
  { table: "rate_limits", op: "SELECT", what: "counters", sql: `select 1 from rate_limits limit 1`, params: () => [], allow: nobody },
  { table: "rpc", op: "UPDATE", what: "rate_limit_hit (burn someone's bucket)", sql: `select rate_limit_hit('loginIp:0123456789abcdef', 1, 60) as id`, params: () => [], allow: nobody },
  { table: "rpc", op: "DELETE", what: "cleanup_operational_data", sql: `select cleanup_operational_data(7) as id`, params: () => [], allow: nobody },
  { table: "cron_runs", op: "SELECT", what: "run history", sql: `select 1 from cron_runs limit 1`, params: () => [], allow: isStaff },
  { table: "cron_runs", op: "INSERT", what: "forged run", sql: `insert into cron_runs (job) values ('expire') returning id`, params: () => [], allow: nobody },
);

// Phase 3.7 diagnostics (0026): probe results and effort metrics are staff-only and written only by the server; the
// schema audit, demo scan and cron lock are callable by the service role alone.
cases.push(
  { table: "source_probes", op: "SELECT", what: "probe results", sql: `select 1 from source_probes where source_id=$1`, params: () => [ctx.src], allow: isStaff },
  { table: "source_probes", op: "INSERT", what: "forged PASS", sql: `insert into source_probes (source_id, runtime, request_url, verdict) values ($1,'forged','https://rlsm-src.gov.in','PASS') returning id`, params: () => [ctx.src], allow: nobody },
  { table: "source_probes", op: "UPDATE", what: "BLOCKED → PASS", sql: `update source_probes set verdict='PASS' where source_id=$1 returning id`, params: () => [ctx.src], allow: nobody },
  { table: "source_probes", op: "DELETE", what: "erase a probe", sql: `delete from source_probes where source_id=$1 returning id`, params: () => [ctx.src], allow: nobody },
  { table: "editorial_effort", op: "SELECT", what: "review timings", sql: `select 1 from editorial_effort where id=$1`, params: () => [ctx.item], allow: isStaff },
  { table: "rpc", op: "SELECT", what: "ops_schema_audit", sql: `select ops_schema_audit() as id`, params: () => [], allow: nobody },
  { table: "rpc", op: "SELECT", what: "ops_demo_scan", sql: `select ops_demo_scan() as id`, params: () => [], allow: nobody },
  { table: "rpc", op: "INSERT", what: "cron_begin (take the cron lock)", sql: `select cron_begin('links', 15) as id`, params: () => [], allow: nobody },
);

// Staff, permissions and audit: the security core.
cases.push(
  { table: "admin_users", op: "SELECT", what: "other staff", sql: `select 1 from admin_users where user_id=$1`, params: () => [U.ed], allow: (w) => w === "editor" || has("users:manage")(w) },
  { table: "admin_users", op: "INSERT", what: "grant a role to a plain user", sql: `insert into admin_users (user_id, role) values ($1, 'editor') returning user_id`, params: () => [U.plain], allow: has("users:manage") },
  { table: "admin_users", op: "UPDATE", what: "promote the moderator", sql: `update admin_users set role='super_admin' where user_id=$1 returning user_id`, params: () => [U.mod], allow: (w) => w === "super_admin" },
  { table: "admin_users", op: "DELETE", what: "remove the editor", sql: `delete from admin_users where user_id=$1 returning user_id`, params: () => [U.ed], allow: has("users:manage") },
  { table: "role_permissions", op: "SELECT", what: "matrix", sql: `select 1 from role_permissions limit 1`, params: () => [], allow: isStaff },
  { table: "role_permissions", op: "INSERT", what: "self-grant", sql: `insert into role_permissions (role, action) values ('moderator','job:publish') returning role`, params: () => [], allow: nobody },
  { table: "role_permissions", op: "DELETE", what: "revoke", sql: `delete from role_permissions where role='editor' and action='job:publish' returning role`, params: () => [], allow: nobody },
  { table: "workflow_transitions", op: "INSERT", what: "new shortcut", sql: `insert into workflow_transitions (kind, from_status, to_status, permission) values ('job','draft','published','job:edit') returning kind`, params: () => [], allow: nobody },
  { table: "audit_logs", op: "SELECT", what: "audit trail", sql: `select 1 from audit_logs limit 1`, params: () => [], allow: has("audit:view") },
  { table: "audit_logs", op: "INSERT", what: "forged entry", sql: `insert into audit_logs (action, entity) values ('forged','jobs') returning id`, params: () => [], allow: nobody },
  { table: "audit_logs", op: "UPDATE", what: "rewrite", sql: `update audit_logs set action='x' where id=(select min(id) from audit_logs) returning id`, params: () => [], allow: nobody },
  { table: "audit_logs", op: "DELETE", what: "erase", sql: `delete from audit_logs where id=(select min(id) from audit_logs) returning id`, params: () => [], allow: nobody },
);

// RPC entry points (SECURITY DEFINER / workflow functions) re-check permissions themselves.
cases.push(
  { table: "rpc", op: "UPDATE", what: "transition_job → published", sql: `select transition_job($1,'published'::content_status,null,null) as id`, params: () => [idOf("job", "review")], allow: has("job:publish") },
  { table: "rpc", op: "UPDATE", what: "transition_content(exam) → published", sql: `select transition_content('exam',$1,'published'::content_status,null) as id`, params: () => [idOf("exam", "review")], allow: has("exam:publish") },
  { table: "rpc", op: "INSERT", what: "save_job (new draft)", sql: `select save_job(null, $1::jsonb) as id`, params: () => [JSON.stringify({ title: "RLS matrix RPC job", organization_name: "CMX Synthetic Recruitment Board", level: "central", job_type: "permanent", state_slug: "delhi" })], allow: has("job:create") },
);

const table: string[] = [];
const mismatches: string[] = [];

before(async () => {
  await seedUsers();
  rows = (await seedContentMatrix()).rows;
  const c = await admin();
  try {
  ctx.org = (await c.query("select id from organizations where slug='cmx-synthetic-recruitment-board'")).rows[0].id;
  ctx.orgUnused = (await c.query("insert into organizations (name, slug, level) values ('RLS Unused Org','rlsm-unused-org','central') returning id")).rows[0].id;
  ctx.src = (await c.query("insert into government_sources (slug, name, source_type, official_domain, base_url) values ('rlsm-src','RLS Matrix Source','RECRUITMENT_BOARD','rlsm-src.gov.in','https://rlsm-src.gov.in') returning id")).rows[0].id;
  ctx.srcUnused = (await c.query("insert into government_sources (slug, name, source_type, official_domain, base_url) values ('rlsm-unused','RLS Unused Source','RECRUITMENT_BOARD','rlsm-unused.gov.in','https://rlsm-unused.gov.in') returning id")).rows[0].id;
  await c.query("insert into content_internal (kind, content_id, editorial_notes) values ('recruitment', $1, 'INTERNAL-ONLY rls matrix note') on conflict do nothing", [idOf("recruitment", "draft")]);
  ctx.run = (await c.query("insert into ingestion_runs (trigger, source_id) values ('manual', $1) returning id", [ctx.src])).rows[0].id;
  ctx.doc = (await c.query("insert into source_documents (run_id, source_id, source_url, document_type, document_hash, parser_version) values ($1,$2,'https://rlsm-src.gov.in/n.pdf','pdf',repeat('a',64),'t') returning id", [ctx.run, ctx.src])).rows[0].id;
  ctx.item = (await c.query("insert into discovered_items (run_id, source_id, document_id, suggested_kind, title, extracted, confidence, confidence_score, content_hash) values ($1,$2,$3,'job','RLS item','{}','LOW',0.1,'h2') returning id", [ctx.run, ctx.src, ctx.doc])).rows[0].id;
  await c.query("insert into link_checks (url, outcome) values ('https://rlsm-src.gov.in/n.pdf','ok')");
  await c.query("insert into rate_limits (bucket, window_start, hits) values ('rlsm:bucket-000001', now(), 1)");
  await c.query("insert into cron_runs (job, ok) values ('expire', true)");
  await c.query("insert into source_probes (source_id, runtime, request_url, robots_outcome, verdict, notes) values ($1,'rls matrix','https://rlsm-src.gov.in','refused','BLOCKED','fixture')", [ctx.src]);
  for (const st of ["published", "draft"] as const) await c.query("insert into official_updates (kind, content_id, update_type, title) values ('job',$1,'extension','RLS matrix extension')", [idOf("job", st)]);
  await c.query("insert into field_evidence (kind, content_id, field, excerpt) values ('job',$1,'last_date','Last date: …')", [idOf("job", "published")]);
  await c.query("insert into field_verifications (subject_kind, subject_id, field, status, verified_by) values ('discovery',$1,'title','verified',$2)", [ctx.item, U.ed]);
  await c.query("insert into reference_imports (dataset, source_name, source_url, retrieved_on, file_sha256) values ('lgd_states','RLS','https://lgdirectory.gov.in',current_date,repeat('b',64))");
  // one unused row per reference table, for DELETE cases
  const stateId = (await c.query("select min(id) id from states")).rows[0].id;
  const del = async (t: string, sql: string, p: unknown[] = []) => { await c.query(sql, p); ctx[`del_${t}`] = "rlsm-del"; };
  await del("states", "insert into states (slug, name, kind) values ('rlsm-del','RLS Del State','state')");
  await del("districts", "insert into districts (state_id, slug, name) values ($1,'rlsm-del','RLS Del District')", [stateId]);
  await del("departments", "insert into departments (slug, name) values ('rlsm-del','RLS Del Dept')");
  await del("qualifications", "insert into qualifications (slug, name, page_title, rank) values ('rlsm-del','RLS Del Q','RLS Del Q Jobs',99)");
  await del("categories", "insert into categories (slug, name) values ('rlsm-del','RLS Del Cat')");
  await del("reservation_categories", "insert into reservation_categories (slug, name) values ('rlsm-del','RLS Del RC')");
  await del("result_types", "insert into result_types (slug, name) values ('rlsm-del','RLS Del RT')");
  await del("answer_key_types", "insert into answer_key_types (slug, name) values ('rlsm-del','RLS Del AKT')");
  } finally { await c.end(); }
});
after(async () => {
  await Session.closeAll();
  // Remove the committed fixtures so other test files (which may run before or after this one) see a clean database.
  const c = await admin();
  try {
    await c.query("delete from field_verifications where subject_id in (select id from discovered_items where source_id in (select id from government_sources where slug like 'rlsm-%'))");
    await c.query("delete from discovered_items where source_id in (select id from government_sources where slug like 'rlsm-%')");
    await c.query("delete from source_documents where source_id in (select id from government_sources where slug like 'rlsm-%')");
    await c.query("delete from ingestion_runs where source_id in (select id from government_sources where slug like 'rlsm-%')");
    await c.query("delete from government_sources where slug like 'rlsm-%'");
    await c.query("delete from link_checks where url like 'https://rlsm-src.gov.in/%'");
    await c.query("delete from rate_limits where bucket like 'rlsm:%'"); await c.query("delete from cron_runs");
    await c.query("delete from reference_imports where source_name = 'RLS'");
    for (const t of ["districts", "states", "departments", "qualifications", "categories", "reservation_categories", "result_types", "answer_key_types"]) await c.query(`delete from ${t} where slug = 'rlsm-del'`);
    await c.query("delete from organizations where slug = 'rlsm-unused-org'");
  } finally { await c.end(); }
  if (process.env.RLS_MATRIX_OUT) writeFileSync(process.env.RLS_MATRIX_OUT, table.join("\n") + "\n");
});

test(`RLS matrix: ${cases.length} cases × ${WHO.length} identities`, async () => {
  const s = await Session.open();
  const short: Record<Who, string> = { anon: "anon", authenticated: "user", moderator: "mod", editor: "edit", seo_manager: "seo", content_manager: "cm", admin: "admin", super_admin: "super" };
  table.push(`RLS matrix — local PostgreSQL (all migrations in supabase/migrations), NOT real Supabase. ✓ = database allowed, · = database refused, ✗ = MISMATCH with the permission model`);
  table.push(["table".padEnd(22), "op".padEnd(6), "case".padEnd(44), ...WHO.map((w) => short[w].padStart(5))].join(" "));
  for (const c of cases) {
    const cells: string[] = [];
    for (const w of WHO) {
      await s.su(); await s.as(actor[w]);
      await s.c.query("savepoint m");
      let allowed: boolean;
      try { const r = await s.c.query(c.sql, c.params()); allowed = (r.rowCount ?? r.rows.length) > 0 && r.rows.some((x) => Object.values(x).some((v) => v !== null)); }
      catch { allowed = false; }
      await s.c.query("rollback to savepoint m");
      const want = c.allow(w);
      if (allowed !== want) mismatches.push(`${c.table} ${c.op} "${c.what}" as ${w}: database ${allowed ? "ALLOWED" : "REFUSED"}, model says ${want ? "allow" : "refuse"}`);
      cells.push((allowed === want ? (allowed ? "✓" : "·") : "✗").padStart(5));
    }
    table.push([c.table.padEnd(22), c.op.padEnd(6), c.what.slice(0, 44).padEnd(44), ...cells].join(" "));
  }
  await s.close();
  table.push(`\n${cases.length * WHO.length - mismatches.length}/${cases.length * WHO.length} cells match the permission model.`);
  if (mismatches.length) table.push("MISMATCHES:\n  " + mismatches.join("\n  "));
  console.log(table.join("\n"));
  assert.deepEqual(mismatches, []);
});
