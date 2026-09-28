/** Operations diagnostics (migration 0026): schema audit, demo scan, review-effort timing, cron single-run lock. Local PostgreSQL. */
import { test, before, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { ANON, SERVICE, Session, U, admin, seedUsers, user } from "./db";

before(async () => { await seedUsers(); });
afterEach(async () => { await Session.closeAll(); });

describe("ops_schema_audit / ops_demo_scan", () => {
  test("only the service role may call them; the audit finds no problems", async () => {
    const s = await Session.open();
    for (const who of [ANON, user(U.plain), user(U.sa)]) {
      await s.as(who);
      assert.ok(await s.fails("select ops_schema_audit()"), "not callable");
      assert.ok(await s.fails("select ops_demo_scan()"), "not callable");
    }
    await s.as(SERVICE);
    const a = (await s.q("select ops_schema_audit() a"))[0].a;
    for (const k of ["tables_without_rls", "definer_functions_without_search_path", "views_not_security_invoker", "foreign_keys_without_index", "api_role_dangerous_grants", "write_functions_callable_by_anon", "restore_unsafe_functions"])
      assert.deepEqual(a[k], [], k);
    assert.deepEqual(a.rls_tables_without_policy, ["rate_limits"], "deny-all by design");
    assert.ok(a.counts.role_permissions > 100);
  });
  test("demo scan catches a published record whose title or source looks synthetic", async () => {
    const c = await admin();
    const org = (await c.query("insert into organizations (name, slug, level) values ('Ops Scan Board','ops-scan-board','central') returning id")).rows[0].id;
    await c.query("insert into recruitments (title, organization_id, is_all_india, status, source_name, official_website_url, source_checked_at) values ('Placeholder Recruitment 2026', $1, true, 'published', 'x', 'https://x.gov.in', now())", [org]);
    await c.end();
    const s = await Session.open(); await s.as(SERVICE);
    const scan = (await s.q("select ops_demo_scan() d"))[0].d;
    assert.equal(scan.recruitments.length, 1);
    assert.equal(scan.recruitments[0].title, "Placeholder Recruitment 2026");
  });
});

describe("human effort", () => {
  test("review start is stamped once, only for reviewers; editorial_effort derives the timings", async () => {
    const c = await admin();
    const d = (await c.query("insert into discovered_items (suggested_kind, title, extracted, confidence, confidence_score, content_hash) values ('job','Effort item','{}','HIGH',0.9,'effort-1') returning id")).rows[0].id;
    await c.end();
    const s = await Session.open();
    await s.as(user(U.seo)); await s.q("select mark_review_started($1)", [d]);
    assert.equal((await s.peek("select review_started_at from discovered_items where id=$1", [d]))[0].review_started_at, null, "SEO manager is not a reviewer");
    await s.as(user(U.ed)); await s.q("select mark_review_started($1)", [d]);
    const first = (await s.peek("select review_started_at from discovered_items where id=$1", [d]))[0].review_started_at;
    assert.ok(first);
    await s.q("select mark_review_started($1)", [d]);
    assert.equal(String((await s.peek("select review_started_at from discovered_items where id=$1", [d]))[0].review_started_at), String(first), "never moved");
    await s.q("update discovered_items set extracted = '{\"last_date\":\"2026-12-01\"}' where id=$1", [d]);
    await s.q("insert into field_verifications (subject_kind, subject_id, field, status, verified_by) values ('discovery',$1,'last_date','verified',$2)", [d, U.ed]);
    const e = (await s.q("select corrections, fields_verified, review_started_at is not null started from editorial_effort where id=$1", [d]))[0];
    assert.equal(Number(e.corrections), 1); assert.equal(Number(e.fields_verified), 1); assert.equal(e.started, true);
    await s.as(SERVICE);
    assert.equal(Number((await s.q("select corrections from editorial_effort where id=$1", [d]))[0].corrections), 1, "the measurement script (service role) sees it too");
    await s.as(ANON);
    assert.ok(await s.fails("select * from editorial_effort"), "not public");
  });
});

describe("cron single-run lock", () => {
  test("a second run of the same job is refused while the first is unfinished; abandoned runs are closed", async () => {
    const s = await Session.open(); await s.as(SERVICE);
    await s.q("delete from cron_runs where job in ('sources','links')");
    const a = (await s.q("select cron_begin('sources', 15) id"))[0].id;
    assert.ok(a);
    assert.equal((await s.q("select cron_begin('sources', 15) id"))[0].id, null, "already running");
    assert.ok((await s.q("select cron_begin('links', 15) id"))[0].id, "other jobs are independent");
    await s.q("update cron_runs set started_at = now() - interval '20 minutes' where id=$1", [a]);
    const b = (await s.q("select cron_begin('sources', 15) id"))[0].id;
    assert.ok(b, "the abandoned run no longer blocks");
    assert.match((await s.q("select error from cron_runs where id=$1", [a]))[0].error, /abandoned/);
    await s.as(user(U.sa));
    assert.ok(await s.fails("select cron_begin('expire', 15)"), "only the server may start cron runs");
  });
});
