/**
 * Phase 3 — database tests (local PostgreSQL 16, Supabase roles impersonated as PostgREST does). SYNTHETIC data only.
 * Source registry, source health, ingestion records, review workflow (approve / reject / merge / apply changes),
 * duplicate detection, change history (versions), verification status, broken links, categories, qualification merge,
 * organization usage, content health.
 */
import { test, before, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { ANON, SERVICE, Session, U, admin, jobPayload, seedUsers, user } from "./db";

before(async () => { await seedUsers(); });
afterEach(async () => { await Session.closeAll(); });

async function org(name: string, website = "https://e2e-board.example.gov.in") {
  const c = await admin();
  const r = await c.query("insert into organizations (name, slug, level, official_website) values ($1, lower(regexp_replace($1,'[^a-zA-Z0-9]+','-','g')), 'central', $2) returning id", [name, website]);
  await c.end(); return r.rows[0].id as string;
}
const src = (o: string, over: Record<string, unknown> = {}) => ({
  name: "E2E Synthetic Board Source", organization_id: o, source_type: "RECRUITMENT_BOARD", official_domain: "e2e-board.example.gov.in",
  base_url: "https://e2e-board.example.gov.in/", recruitment_url: "https://e2e-board.example.gov.in/recruitment", status: "ACTIVE", is_synthetic: true, ...over,
});
const insert = async (s: Session, table: string, row: Record<string, unknown>) => {
  const cols = Object.keys(row);
  const r = await s.q(`insert into ${table} (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning *`, cols.map((c) => (typeof row[c] === "object" && row[c] !== null && !Array.isArray(row[c]) ? JSON.stringify(row[c]) : row[c])));
  return r[0] as Record<string, any>;
};
const item = (o: string, sourceId: string | null, over: Record<string, unknown> = {}) => ({
  source_id: sourceId, suggested_kind: "job", title: "Recruitment of Junior Clerk 2026 (synthetic)", organization_id: o,
  extracted: { title: "Recruitment of Junior Clerk 2026 (synthetic)", organization_name: "E2E Phase3 Board", level: "central", state_slug: "all-india",
    advertisement_no: "E2E/P3/2026/01", last_date: "2099-10-30", total_vacancies: 245, qualification_slugs: ["12th-pass"],
    notification_url: "https://e2e-board.example.gov.in/n/clerk.pdf", source_name: "E2E Synthetic Board Source", source_url: "https://e2e-board.example.gov.in/n/clerk.pdf" },
  confidence: "HIGH", confidence_score: 0.9, content_hash: "h1", is_synthetic: true, item_url: "https://e2e-board.example.gov.in/n/clerk.pdf", ...over,
});

describe("source registry", () => {
  test("CRUD + permissions + RLS: content manager manages sources, SEO manager and anon cannot even read them", async () => {
    const o = await org("E2E Registry Board"); const s = await Session.open();
    await s.as(user(U.cm));
    const row = await insert(s, "government_sources", src(o, { name: "E2E Registry Source" }));
    assert.equal(row.slug, "e2e-registry-source");
    assert.equal(row.active, true);
    assert.ok(row.next_check_at, "an ACTIVE source is scheduled straight away");
    await s.q("update government_sources set notes='checked listing layout' where id=$1", [row.id]);
    assert.ok((await s.peek("select 1 from audit_logs where entity='government_sources' and entity_id=$1", [row.id])).length >= 2, "source changes are audited");
  });
  test("SEO manager can read (staff) but not write; anon cannot read", async () => {
    const o = await org("E2E Registry Board 2"); const s = await Session.open();
    await s.as(SERVICE); const row = await insert(s, "government_sources", src(o, { name: "E2E Registry Source 2", official_domain: "e2e-board.example.gov.in" }));
    await s.as(user(U.seo));
    assert.equal((await s.q("select id from government_sources where id=$1", [row.id])).length, 1);
    assert.match((await s.fails("update government_sources set notes='x' where id=$1 returning id", [row.id])) ?? "no error", /no error/, "RLS silently filters the update");
    assert.equal((await s.peek("select notes from government_sources where id=$1", [row.id]))[0].notes, null);
    await s.as(ANON);
    assert.match((await s.fails("select id from government_sources")) ?? "", /permission denied/);
  });
  test("listing URLs must live on the registered official domain; bad types / statuses are rejected", async () => {
    const o = await org("E2E Domain Board"); const s = await Session.open(); await s.as(user(U.cm));
    assert.match((await s.fails("insert into government_sources (name, organization_id, source_type, official_domain, base_url, recruitment_url) values ('X1', $1, 'RECRUITMENT_BOARD', 'e2e-board.example.gov.in', 'https://e2e-board.example.gov.in', 'https://jobs-aggregator.example.com/e2e')", [o])) ?? "", /domain_chk/);
    assert.equal((await s.fails("insert into government_sources (name, organization_id, source_type, official_domain, base_url, recruitment_url) values ('X2', $1, 'RECRUITMENT_BOARD', 'e2e-board.example.gov.in', 'https://e2e-board.example.gov.in', 'https://recruitment.e2e-board.example.gov.in/list')", [o])), null, "sub-domains are fine");
    assert.match((await s.fails("insert into government_sources (name, source_type, official_domain, base_url) values ('X3', 'PRIVATE_PORTAL', 'x.example.com', 'https://x.example.com')")) ?? "", /source_type/);
    assert.match((await s.fails("insert into government_sources (name, source_type, official_domain, base_url, status) values ('X4', 'PSU', 'x.example.com', 'https://x.example.com', 'ON')")) ?? "", /status/);
  });
  test("health: success, repeated failures → ERROR with back-off, blocked stops scheduling, pause/resume", async () => {
    const o = await org("E2E Health Board"); const s = await Session.open(); await s.as(SERVICE);
    const row = await insert(s, "government_sources", src(o, { name: "E2E Health Source", check_interval_hours: 6 }));
    await s.q("select record_source_check($1, true, 200::smallint, null, 3, 1, false)", [row.id]);
    let h = (await s.q("select * from government_sources where id=$1", [row.id]))[0];
    assert.equal(h.failure_count, 0); assert.equal(h.last_new_count, 3); assert.ok(h.last_success_at);
    for (let i = 0; i < 3; i++) await s.q("select record_source_check($1, false, 503::smallint, 'HTTP 503', 0, 0, false)", [row.id]);
    h = (await s.q("select *, extract(epoch from next_check_at - now())/3600 as hrs from government_sources where id=$1", [row.id]))[0];
    assert.equal(h.status, "ERROR"); assert.equal(h.failure_count, 3); assert.equal(h.total_failures, 3);
    assert.ok(Number(h.hrs) > 6 * 7, "backs off to interval × 2^failures");
    await s.q("select record_source_check($1, true, 200::smallint, null, 0, 0, false)", [row.id]);
    assert.equal((await s.q("select status from government_sources where id=$1", [row.id]))[0].status, "ACTIVE", "recovers after a good check");
    await s.q("select record_source_check($1, false, 403::smallint, 'HTTP 403 access restricted', 0, 0, true)", [row.id]);
    h = (await s.q("select status, next_check_at from government_sources where id=$1", [row.id]))[0];
    assert.equal(h.status, "BLOCKED"); assert.equal(h.next_check_at, null, "a blocked source is never retried automatically");
    await s.as(user(U.cm));
    assert.match((await s.fails("select record_source_check($1, true, 200::smallint, null, 0, 0, false)", [row.id])) ?? "", /permission denied|Only the ingestion/);
    await s.q("update government_sources set status='ACTIVE' where id=$1", [row.id]);
    assert.ok((await s.q("select next_check_at from government_sources where id=$1", [row.id]))[0].next_check_at, "resuming schedules a check");
    await s.q("update government_sources set status='PAUSED' where id=$1", [row.id]);
    assert.equal((await s.q("select count(*)::int n from due_sources(20) where id=$1", [row.id]))[0].n, 0);
  });
  test("due_sources: only due, schedulable sources, high priority first", async () => {
    const o = await org("E2E Due Board"); const s = await Session.open(); await s.as(SERVICE);
    const a = await insert(s, "government_sources", src(o, { name: "E2E Due Low", source_priority: "low" }));
    const b = await insert(s, "government_sources", src(o, { name: "E2E Due High", source_priority: "high" }));
    await insert(s, "government_sources", src(o, { name: "E2E Due Paused", status: "PAUSED" }));
    await s.q("update government_sources set next_check_at = now() - interval '1 minute' where id in ($1,$2)", [a.id, b.id]);
    const ids = (await s.q("select id from due_sources(20)")).map((r) => r.id);
    assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id));
    assert.ok(!(await s.q("select name from due_sources(20)")).some((r) => r.name === "E2E Due Paused"));
  });
});

describe("review workflow", () => {
  test("pipeline-only inserts; approve creates a linked DRAFT (never published); decisions are final and stamped", async () => {
    const o = await org("E2E Phase3 Board"); const s = await Session.open();
    await s.as(SERVICE); const so = await insert(s, "government_sources", src(o, { name: "E2E Review Source" }));
    const it = await insert(s, "discovered_items", item(o, so.id));
    await s.as(user(U.ed));
    assert.match((await s.fails("insert into discovered_items (suggested_kind,title,extracted,confidence,confidence_score,content_hash) values ('job','x','{}','HIGH',1,'h')")) ?? "", /permission denied/, "browsers never insert queue items");
    assert.match((await s.fails("update discovered_items set confidence='HIGH', content_hash='other' where id=$1", [it.id])) ?? "", /Only review fields/);
    const payload = { ...it.extracted, mark_source_checked: true, source_type: "official_notification" };
    const id = (await s.q("select approve_discovery($1,'job',$2::jsonb,'checked against the PDF',false,true) as id", [it.id, JSON.stringify(payload)]))[0].id;
    const job = (await s.peek("select status, advertisement_no, last_date::text, verification_status from jobs where id=$1", [id]))[0];
    assert.equal(job.status, "review", "approval never publishes; it can only submit for review");
    assert.equal(job.advertisement_no, "E2E/P3/2026/01"); assert.equal(job.last_date, "2099-10-30");
    assert.equal(job.verification_status, "SOURCE_CHECKED");
    const decided = (await s.q("select review_status, reviewed_by, resulting_id from discovered_items where id=$1", [it.id]))[0];
    assert.equal(decided.review_status, "approved"); assert.equal(decided.reviewed_by, U.ed); assert.equal(decided.resulting_id, id);
    assert.equal((await s.q("select relation from source_content_links where source_id=$1 and content_id=$2", [so.id, id]))[0].relation, "origin");
    assert.match((await s.fails("update discovered_items set review_status='rejected', review_note='x' where id=$1", [it.id])) ?? "", /already approved/);
  });
  test("reject needs a reason; ignored/rejected items can be reopened; request review", async () => {
    const o = await org("E2E Reject Board"); const s = await Session.open(); await s.as(SERVICE);
    const a = await insert(s, "discovered_items", item(o, null, { content_hash: "r1" }));
    await s.as(user(U.cm));
    assert.match((await s.fails("update discovered_items set review_status='rejected' where id=$1", [a.id])) ?? "", /reason/);
    await s.q("update discovered_items set review_status='rejected', review_note='Not an official notice' where id=$1", [a.id]);
    await s.q("update discovered_items set review_status='pending' where id=$1", [a.id]);
    await s.q("update discovered_items set review_status='needs_review', review_note='Senior editor please compare the vacancy table' where id=$1", [a.id]);
    assert.equal((await s.q("select review_status from discovered_items where id=$1", [a.id]))[0].review_status, "needs_review");
    await s.as(user(U.seo));
    assert.equal((await s.q("update discovered_items set review_status='ignored' where id=$1 returning id", [a.id])).length, 0, "no ingestion:review → no change");
  });
  test("LOW confidence needs confirmation + note + a reviewer who can publish", async () => {
    const o = await org("E2E Low Board"); const s = await Session.open(); await s.as(SERVICE);
    const it = await insert(s, "discovered_items", item(o, null, { confidence: "LOW", confidence_score: 0.3, content_hash: "l1" }));
    const payload = JSON.stringify({ ...it.extracted });
    await s.as(user(U.cm));
    assert.match((await s.fails("select approve_discovery($1,'job',$2::jsonb,'n',true,false)", [it.id, payload])) ?? "", /publish/);
    await s.as(user(U.ed));
    assert.match((await s.fails("select approve_discovery($1,'job',$2::jsonb,null,false,false)", [it.id, payload])) ?? "", /Low-confidence/);
    assert.ok((await s.q("select approve_discovery($1,'job',$2::jsonb,'Compared every field with the scanned PDF',true,false) as id", [it.id, payload]))[0].id);
  });
  test("duplicate warning must be resolved before approval; merge links the extra source", async () => {
    const o = await org("E2E Dup Board"); const s = await Session.open();
    await s.as(user(U.ed));
    const existing = (await s.q("select save_job(null,$1::jsonb) as id", [JSON.stringify(jobPayload({ organization_name: "E2E Dup Board", advertisement_no: "E2E/DUP/9", title: "Recruitment of Tax Assistant 2026 (synthetic)" }))]))[0].id;
    await s.as(SERVICE);
    const so = await insert(s, "government_sources", src(o, { name: "E2E Dup Source" }));
    const cands = await s.q("select * from find_duplicate_candidates('job', $1::jsonb)", [JSON.stringify({ organization_id: null, advertisement_no: "E2E/DUP/9", title: "Tax Assistant Recruitment 2026" })]);
    assert.equal(cands[0].id, existing); assert.ok(cands[0].reasons.includes("advertisement number")); assert.ok(Number(cands[0].score) >= 0.7);
    const fuzzy = await s.q("select * from find_duplicate_candidates('job', $1::jsonb)", [JSON.stringify({ title: "Recruitment of Tax Assistant 2026 synthetic" })]);
    assert.ok(fuzzy.some((c) => c.id === existing && c.reasons.some((r: string) => r.startsWith("similar title"))), "fuzzy similarity is reported as a reason");
    const urlHit = await s.q("select * from find_duplicate_candidates('job', $1::jsonb)", [JSON.stringify({ title: "zzz", notification_url: "https://EXAMPLE.gov.in/notice.pdf/" })]);
    assert.ok(urlHit.some((c) => c.id === existing && c.reasons.includes("official URL")), "URL match is normalised (case, trailing slash)");
    const it = await insert(s, "discovered_items", item(o, so.id, { content_hash: "d1", duplicate_kind: "job", duplicate_id: existing, duplicate_score: 0.8, duplicate_reasons: ["advertisement number"] }));
    await s.as(user(U.ed));
    assert.match((await s.fails("select approve_discovery($1,'job',$2::jsonb,null,false,false)", [it.id, JSON.stringify(it.extracted)])) ?? "", /duplicate/);
    await s.q("select merge_discovery($1,'job',$2,'Same notification (same advertisement number)')", [it.id, existing]);
    assert.equal((await s.q("select review_status from discovered_items where id=$1", [it.id]))[0].review_status, "merged");
    assert.equal((await s.q("select relation from source_content_links where source_id=$1 and content_id=$2", [so.id, existing]))[0].relation, "reference");
  });
});

describe("change detection → approval → versions", () => {
  test("applying selected changes to a LIVE job needs publish permission, records version 2 with the reason and important changes", async () => {
    const o = await org("E2E Change Board"); const s = await Session.open();
    await s.as(user(U.ed));
    const jid = (await s.q("select save_job(null,$1::jsonb) as id", [JSON.stringify(jobPayload({ organization_name: "E2E Change Board", last_date: "2099-10-10", total_vacancies: 245 }))]))[0].id;
    await s.q("select transition_job($1,'review',null,null)", [jid]); await s.q("select transition_job($1,'published',null,null)", [jid]);
    const v1 = await s.q("select version, reason, status from content_versions where kind='job' and content_id=$1", [jid]);
    assert.equal(v1.length, 1); assert.equal(v1[0].reason, "Published");
    await s.as(SERVICE);
    const it = await insert(s, "discovered_items", item(o, null, { content_hash: "c2", change_target_kind: "job", change_target_id: jid,
      extracted: { last_date: "2099-10-18", total_vacancies: 260, fee_general: "Rs. 100" },
      changes: { last_date: { from: "2099-10-10", to: "2099-10-18", important: true }, total_vacancies: { from: 245, to: 260, important: true } } }));
    await s.as(user(U.cm));
    assert.match((await s.fails("select apply_discovery_changes($1, array['last_date','total_vacancies'], 'Corrigendum extends the last date')", [it.id])) ?? "", /publish permission/, "content manager cannot change live content");
    await s.as(user(U.ed));
    assert.match((await s.fails("select apply_discovery_changes($1, array['last_date'], '')", [it.id])) ?? "", /reason/);
    assert.match((await s.fails("select apply_discovery_changes($1, array['status'], 'x')", [it.id])) ?? "", /cannot be applied/);
    await s.q("select apply_discovery_changes($1, array['last_date','total_vacancies'], 'Corrigendum extends the last date')", [it.id]);
    const j = (await s.peek("select status, last_date::text, total_vacancies, fee_general from jobs where id=$1", [jid]))[0];
    assert.equal(j.status, "updated"); assert.equal(j.last_date, "2099-10-18"); assert.equal(j.total_vacancies, 260);
    assert.equal(j.fee_general, null, "an unselected change (fee) is NOT applied");
    const v = (await s.q("select * from content_versions where kind='job' and content_id=$1 order by version", [jid]));
    assert.equal(v.length, 2);
    assert.equal(v[1].reason, "Corrigendum extends the last date"); assert.equal(v[1].source, "ingestion"); assert.equal(v[1].discovery_id, it.id);
    assert.deepEqual(v[1].important_changes.last_date, { from: "2099-10-10", to: "2099-10-18" });
    assert.equal(v[1].changed_by, U.ed);
    assert.equal((await s.q("select review_status from discovered_items where id=$1", [it.id]))[0].review_status, "approved");
  });
  test("drafts are not versioned; editor reason annotation; versions are read-only", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const jid = (await s.q("select save_job(null,$1::jsonb) as id", [JSON.stringify(jobPayload({ organization_name: "E2E Version Board", last_date: "2099-01-01" }))]))[0].id;
    await s.q("select save_job($1,$2::jsonb)", [jid, JSON.stringify(jobPayload({ organization_name: "E2E Version Board", last_date: "2099-01-02" }))]);
    assert.equal((await s.q("select count(*)::int n from content_versions where content_id=$1", [jid]))[0].n, 0);
    await s.q("select transition_job($1,'review',null,null)", [jid]); await s.q("select transition_job($1,'published',null,null)", [jid]);
    await s.q("select save_job($1,$2::jsonb)", [jid, JSON.stringify(jobPayload({ organization_name: "E2E Version Board", last_date: "2099-02-01", total_vacancies: 120 }))]);
    assert.equal((await s.q("select annotate_latest_version('job',$1,'Official corrigendum no. 2') as ok", [jid]))[0].ok, true);
    const v = (await s.q("select version, reason, important_changes from content_versions where content_id=$1 order by version", [jid]));
    assert.equal(v.length, 2); assert.equal(v[1].reason, "Official corrigendum no. 2"); assert.ok(v[1].important_changes.last_date);
    assert.match((await s.fails("update content_versions set reason='rewritten' where content_id=$1", [jid])) ?? "", /permission denied/);
    await s.as(ANON); assert.match((await s.fails("select * from content_versions")) ?? "", /permission denied/);
  });
});

describe("verification status + links + health", () => {
  test("source check sets SOURCE_CHECKED; a monitor flag never makes a live job look 'updated'; stale content goes back to NEEDS_REVIEW", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const jid = (await s.q("select save_job(null,$1::jsonb) as id", [JSON.stringify(jobPayload({ organization_name: "E2E Verify Board", last_date: "2099-03-01" }))]))[0].id;
    await s.q("select transition_job($1,'review',null,null)", [jid]); await s.q("select transition_job($1,'published',null,null)", [jid]);
    assert.equal((await s.peek("select verification_status from jobs where id=$1", [jid]))[0].verification_status, "SOURCE_CHECKED");
    await s.as(SERVICE);
    await s.q("update jobs set source_checked_at = now() - interval '1 hour' where id=$1", [jid]);   // (separate requests in real life)
    const before = (await s.q("select status, updated_at from jobs where id=$1", [jid]))[0];
    await s.q("update jobs set verification_status='SOURCE_UNAVAILABLE' where id=$1", [jid]);
    let j = (await s.q("select status, updated_at, verification_status from jobs where id=$1", [jid]))[0];
    assert.equal(j.status, before.status, "flagging is not an editorial edit"); assert.equal(String(j.updated_at), String(before.updated_at));
    assert.equal(j.verification_status, "SOURCE_UNAVAILABLE");
    await s.as(user(U.ed));
    await s.q("update jobs set verification_status='SOURCE_CHECKED' where id=$1", [jid]);
    assert.equal((await s.peek("select verification_status from jobs where id=$1", [jid]))[0].verification_status, "SOURCE_UNAVAILABLE", "staff cannot just clear the flag…");
    await s.q("select save_job($1,$2::jsonb)", [jid, JSON.stringify(jobPayload({ organization_name: "E2E Verify Board", last_date: "2099-03-01", mark_source_checked: true }))]);
    assert.equal((await s.peek("select verification_status from jobs where id=$1", [jid]))[0].verification_status, "SOURCE_CHECKED", "…a real source re-check does");
    await s.as(SERVICE);
    await s.q("update jobs set source_checked_at = now() - interval '45 days' where id=$1", [jid]);
    await s.q("update jobs set verification_status='SOURCE_CHECKED' where id=$1", [jid]);
    assert.ok((await s.q("select mark_stale_content(30) as n"))[0].n >= 1);
    j = (await s.q("select status, verification_status from jobs where id=$1", [jid]))[0];
    assert.equal(j.verification_status, "NEEDS_REVIEW"); assert.equal(j.status, "updated");
  });
  test("link checks: latest status view, broken count, staff-only; health stats compute", async () => {
    const s = await Session.open(); await s.as(SERVICE);
    const kid = "00000000-0000-0000-0000-00000000c0de";
    await s.q("insert into link_checks (url, kind, content_id, field, outcome, http_status, consecutive_failures, checked_at) values ('https://x.example.gov.in/a','job',$1,'notification_url','ok',200,0, now() - interval '2 days'), ('https://x.example.gov.in/a','job',$1,'notification_url','not_found',404,1, now())", [kid]);
    const latest = (await s.q("select outcome, broken from link_status_latest where content_id=$1", [kid]));
    assert.equal(latest.length, 1); assert.equal(latest[0].outcome, "not_found"); assert.equal(latest[0].broken, true);
    await s.as(user(U.mod));
    const h = (await s.q("select content_health_stats() as h"))[0].h;
    for (const k of ["sources_checked_today", "sources_failing", "awaiting_review", "needs_verification", "jobs_expiring_soon", "recently_changed", "stale_content", "duplicate_warnings", "broken_links",
      "jobs_published_today", "discovered_today", "updates_today", "reviews_pending", "avg_review_hours", "source_failures_today", "records_updated_today", "records_expired_today"]) assert.ok(k in h, k);
    assert.ok(h.broken_links >= 1);
    await s.as(ANON); assert.match((await s.fails("select content_health_stats()")) ?? "", /permission denied|Not allowed/);
  });
});

describe("reference data: categories, qualifications, organizations", () => {
  test("jobs belong to several categories; category + qualification merge move every job over and archive the old entry", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const jid = (await s.q("select save_job(null,$1::jsonb) as id", [JSON.stringify(jobPayload({ organization_name: "E2E Category Board", category_slugs: ["police", "clerical"] }))]))[0].id;
    assert.deepEqual((await s.peek("select category_slugs from jobs where id=$1", [jid]))[0].category_slugs.sort(), ["clerical", "police"]);
    await s.q("select save_job($1,$2::jsonb)", [jid, JSON.stringify(jobPayload({ organization_name: "E2E Category Board" }))]);
    assert.equal((await s.peek("select count(*)::int n from job_category_links where job_id=$1", [jid]))[0].n, 2, "a payload without categories leaves them unchanged");
    await s.as(user(U.cm));
    const ids = Object.fromEntries((await s.q("select slug, id from categories where slug in ('clerical','administrative')")).map((r) => [r.slug, r.id]));
    assert.equal((await s.q("select merge_category($1::smallint,$2::smallint) as n", [ids.clerical, ids.administrative]))[0].n, 1);
    assert.match((await s.fails("select merge_category($1::smallint,$2::smallint)", [ids.clerical, ids.administrative])) ?? "", /already merged/);
    const after = (await s.peek("select category_slugs from jobs where id=$1", [jid]))[0].category_slugs;
    assert.ok(after.includes("administrative") && !after.includes("clerical"), JSON.stringify(after));
    assert.equal((await s.peek("select is_active, merged_into_id is not null as m from categories where slug='clerical'"))[0].m, true);
    await s.as(user(U.seo));
    assert.match((await s.fails("select merge_qualification(1::smallint, 2::smallint)")) ?? "", /Not allowed/);
    await s.as(user(U.cm));
    const q = (await s.q("insert into qualifications (slug, name, page_title, rank) values ('e2e-matric-dup','E2E Matric duplicate','x',99) returning id"))[0].id;
    await s.as(user(U.ed));
    const jid2 = (await s.q("select save_job(null,$1::jsonb) as id", [JSON.stringify(jobPayload({ organization_name: "E2E Category Board", qualification_slugs: ["e2e-matric-dup"] }))]))[0].id;
    await s.as(user(U.cm));
    const tenth = (await s.q("select id from qualifications where slug='10th-pass'"))[0].id;
    assert.equal((await s.q("select merge_qualification($1::smallint,$2::smallint) as n", [q, tenth]))[0].n, 1);
    assert.deepEqual((await s.peek("select qualification_slugs from jobs where id=$1", [jid2]))[0].qualification_slugs, ["10th-pass"]);
  });
  test("reservation categories kept (renamed); organization usage counts; anon cannot call it", async () => {
    const s = await Session.open(); await s.as(ANON);
    assert.ok((await s.q("select count(*)::int n from reservation_categories"))[0].n >= 6);
    assert.ok((await s.q("select count(*)::int n from categories"))[0].n >= 16);
    await s.as(user(U.ed));
    const jid = (await s.q("select save_job(null,$1::jsonb) as id", [JSON.stringify(jobPayload({ organization_name: "E2E Usage Board" }))]))[0].id;
    const o = (await s.peek("select organization_id from jobs where id=$1", [jid]))[0].organization_id;
    const u = (await s.q("select organization_usage($1) as u", [o]))[0].u;
    assert.equal(u.jobs, 1); assert.equal(u.recruitments, 0);
    await s.as(ANON); assert.match((await s.fails("select organization_usage($1)", [o])) ?? "", /permission denied/);
  });
});
