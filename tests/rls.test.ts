import { test, before, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { ANON, SERVICE, Session, U, addDays, admin, jobPayload, seedUsers, user } from "./db";
import { ROLES, permissions, workflow } from "../src/lib/admin/permissions";
import { departments, qualifications, states } from "../src/lib/data/demo/reference-seed";

before(async () => { await seedUsers(); });
afterEach(async () => { await Session.closeAll(); });

const save = (s: Session, payload: object, id: string | null = null) => s.q<{ save_job: string }>("select save_job($1, $2::jsonb)", [id, JSON.stringify(payload)]).then((r) => r[0].save_job);
const status = async (s: Session, id: string) => (await s.peek("select status from jobs where id=$1", [id]))[0]?.status;
const transition = (s: Session, id: string, to: string, comment: string | null = null, last: string | null = null) =>
  s.q("select transition_job($1, $2::content_status, $3, $4::date)", [id, to, comment, last]);

describe("parity: database == TypeScript sources of truth", () => {
  test("role_permissions matches src/lib/admin/permissions.ts", async () => {
    const c = await admin();
    const { rows } = await c.query("select role::text, action from role_permissions order by 1,2");
    await c.end();
    const expected = ROLES.flatMap((r) => permissions[r].map((a) => `${r}|${a}`)).sort();
    assert.deepEqual(rows.map((r) => `${r.role}|${r.action}`).sort(), expected);
  });
  test("workflow_transitions matches", async () => {
    const c = await admin();
    const { rows } = await c.query("select kind k, from_status::text f, to_status::text t, permission p from workflow_transitions");
    await c.end();
    assert.deepEqual(rows.map((r) => `${r.k}|${r.f}>${r.t}:${r.p}`).sort(), workflow.map((w) => `${w.kind}|${w.from}>${w.to}:${w.action}`).sort());
  });
  test("seeded states, departments, qualifications equal the reference seed file (fresh database)", async () => {
    const c = await admin();
    const s = (await c.query("select slug from states")).rows.map((r) => r.slug).sort();
    const d = (await c.query("select slug from departments")).rows.map((r) => r.slug).sort();
    const q = (await c.query("select slug from qualifications")).rows.map((r) => r.slug).sort();
    await c.end();
    assert.deepEqual(s, states.map((x) => x.slug).sort());
    assert.deepEqual(d, departments.map((x) => x.slug).sort());
    assert.deepEqual(q, qualifications.map((x) => x.slug).sort());
    assert.equal(states.length, 36);
  });
});

describe("anonymous and ordinary users", () => {
  test("anon sees only live/expired jobs, never drafts; editorial notes are unreachable", async () => {
    const s = await Session.open();
    await s.as(user(U.ed));
    const draft = await save(s, jobPayload({ title: "Draft Only Recruitment" }));
    const live = await save(s, jobPayload({ title: "Live Recruitment Notice" }));
    await transition(s, live, "review"); await transition(s, live, "published");
    await s.as(ANON);
    const ids = (await s.q("select id from jobs_v")).map((r) => r.id);
    assert.ok(ids.includes(live)); assert.ok(!ids.includes(draft), "draft leaked to anon");
    assert.equal((await s.q("select id from jobs")).length, 1);
    assert.match(await s.fails("select * from job_internal") ?? "", /permission denied/);
    assert.match(await s.fails("select * from audit_logs") ?? "", /permission denied/);
    assert.match(await s.fails("select * from admin_users") ?? "", /permission denied/);
    assert.match(await s.fails("select * from role_permissions") ?? "", /permission denied/);
    // internal columns are not in the public view / table
    assert.equal((await s.q("select column_name from information_schema.columns where table_name='jobs_v' and column_name like '%editorial%'")).length, 0);
    await s.close();
  });
  test("anon cannot write or call editing RPCs", async () => {
    const s = await Session.open(); await s.as(ANON);
    await s.su(); const org = (await s.q("insert into organizations (slug,name,level) values ('anon-test-org','Anon Test Org','central') returning id"))[0].id; await s.as(ANON);
    assert.match(await s.fails("insert into jobs (slug,title,organization_id,level) values ('x-y','Hacked title',$1,'central')", [org]) ?? "", /permission denied|row-level security/);
    assert.match(await s.fails("insert into organizations (slug,name,level) values ('evil','Evil Org','central')") ?? "", /permission denied|row-level security/);
    assert.match(await s.fails("select save_job(null, $1::jsonb)", [JSON.stringify(jobPayload())]) ?? "", /permission denied|Not allowed|row-level security/);
    assert.match(await s.fails("select expire_overdue_jobs()") ?? "", /permission denied|Not allowed/);
    assert.match(await s.fails("select admin_dashboard_stats()") ?? "", /permission denied|Not allowed/);
    await s.close();
  });
  test("a signed-in non-staff user is treated like anon for CMS data and cannot self-promote", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await save(s, jobPayload()); await transition(s, id, "review"); await transition(s, id, "published");
    const draft = await save(s, jobPayload({ title: "Another Draft Job" }));
    await s.as(user(U.plain));
    assert.equal((await s.q("select id from jobs where id=$1", [draft])).length, 0, "plain user can read a draft");
    assert.equal((await s.q("select id from jobs where id=$1", [id])).length, 1);
    assert.equal((await s.q("update jobs set title='Hijacked title' where id=$1 returning id", [id])).length, 0, "non-staff update must affect 0 rows");
    assert.equal((await s.q("delete from jobs where id=$1 returning id", [id])).length, 0);
    assert.equal((await s.peek("select title from jobs where id=$1", [id]))[0].title, "Junior Assistant Recruitment 2026");
    assert.match(await s.fails("insert into admin_users (user_id, role) values ($1,'super_admin')", [U.plain]) ?? "", /row-level security|Not allowed/);
    assert.equal((await s.q("select * from admin_users")).length, 0);
    assert.match(await s.fails("select save_job(null, $1::jsonb)", [JSON.stringify(jobPayload())]) ?? "", /row-level security|Not allowed|permission/);
    assert.match(await s.fails("delete from audit_logs") ?? "", /permission denied/);
    await s.close();
  });
});

describe("role permissions and workflow", () => {
  test("content manager: create + submit for review; cannot publish, edit live, or delete", async () => {
    const s = await Session.open(); await s.as(user(U.cm));
    const id = await save(s, jobPayload({ title: "Content Manager Job" }));
    assert.equal(await status(s, id), "draft");
    await transition(s, id, "review");
    assert.match(await s.fails("select transition_job($1,'published')", [id]) ?? "", /Not allowed to change status/);
    await s.as(user(U.ed)); await transition(s, id, "published");
    await s.as(user(U.cm));
    assert.match(await s.fails("select save_job($1,$2::jsonb)", [id, JSON.stringify(jobPayload({ title: "Sneaky edit of live job" }))]) ?? "", /requires publish permission|row-level security/);
    assert.match(await s.fails("select transition_job($1,'draft')", [id]) ?? "", /Not allowed/);
    assert.equal((await s.q("delete from jobs where id=$1 returning id", [id])).length, 0);
    await s.close();
  });
  test("strict workflow: draft cannot jump to published; publish requires official source info", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await save(s, jobPayload());
    assert.match(await s.fails("select transition_job($1,'published')", [id]) ?? "", /Not allowed to change status from draft to published/);
    const bare = await save(s, jobPayload({ title: "No Source Job Here", source_name: "", notification_url: "", official_website_url: "", mark_source_checked: false, qualification_slugs: [] }));
    await transition(s, bare, "review");
    const err = await s.fails("select transition_job($1,'published')", [bare]) ?? "";
    assert.match(err, /missing required official information/);
    for (const f of ["source name", "source last checked", "official notification URL", "qualification"]) assert.match(err, new RegExp(f), `should mention ${f}`);
    assert.equal(await status(s, bare), "review");
    await s.close();
  });
  test("full lifecycle by editor: draft → review → published → (edit) updated → unpublished → review → published → expired → extended → archived", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await save(s, jobPayload({ last_date: addDays(30) }));
    await transition(s, id, "review"); await transition(s, id, "published");
    let row = (await s.q("select status, published_at, posted_at from jobs where id=$1", [id]))[0];
    assert.equal(row.status, "published"); assert.ok(row.published_at); assert.ok(row.posted_at);
    await save(s, jobPayload({ title: "Junior Assistant Recruitment 2026 (corrected)", last_date: addDays(30) }), id);
    assert.equal(await status(s, id), "updated");
    await transition(s, id, "draft", "pulled for fixes");
    assert.equal(await status(s, id), "draft");
    assert.equal((await s.as(ANON).then(() => s.q("select id from jobs where id=$1", [id]))).length, 0, "unpublished job still public");
    await s.as(user(U.ed)); await transition(s, id, "review"); await transition(s, id, "published");
    await transition(s, id, "expired");
    assert.equal(await status(s, id), "expired");
    assert.equal(await s.fails("select transition_job($1,'updated')", [id]), null, "re-publishing a manually expired job with a still-valid last date is allowed");
    assert.equal(await status(s, id), "updated");
    await s.close();
  });
  test("extend an expired job requires a future last date; then archive; delete only draft/archived", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await save(s, jobPayload({ last_date: addDays(10) }));
    await transition(s, id, "review"); await transition(s, id, "published"); await transition(s, id, "expired");
    // last_date is still in the future here (manually expired) → extension with an explicit past date must fail
    assert.match(await s.fails("select transition_job($1,'updated',null,$2::date)", [id, addDays(-2)]) ?? "", /last date .* is in the past/);
    await transition(s, id, "updated", null, addDays(20));
    assert.equal(await status(s, id), "updated");
    assert.equal((await s.q("delete from jobs where id=$1 returning id", [id])).length, 0, "live job must not be deletable");
    await transition(s, id, "expired"); await transition(s, id, "archived");
    assert.equal((await s.q("delete from jobs where id=$1 returning id", [id])).length, 1, "archived job should be deletable by editor");
    const d = await save(s, jobPayload({ title: "Disposable draft job" }));
    assert.equal((await s.q("delete from jobs where id=$1 returning id", [d])).length, 1);
    await s.close();
  });
  test("moderator: can send back / unpublish / expire, cannot publish or edit", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await save(s, jobPayload()); await transition(s, id, "review");
    await s.as(user(U.mod)); await transition(s, id, "draft", "needs source");
    assert.equal(await status(s, id), "draft");
    await s.as(user(U.ed)); await transition(s, id, "review"); await transition(s, id, "published");
    await s.as(user(U.mod));
    assert.match(await s.fails("select save_job($1,$2::jsonb)", [id, JSON.stringify(jobPayload({ title: "Moderator edit attempt" }))]) ?? "", /requires publish permission|row-level|Not allowed/);
    await transition(s, id, "expired");
    await s.as(user(U.ed)); const id2 = await save(s, jobPayload({ title: "Second job for moderator" })); await transition(s, id2, "review");
    await s.as(user(U.mod)); assert.match(await s.fails("select transition_job($1,'published')", [id2]) ?? "", /Not allowed/);
    assert.match(await s.fails("select save_job(null,$1::jsonb)", [JSON.stringify(jobPayload())]) ?? "", /row-level|Not allowed/);
    await s.close();
  });
  test("SEO manager: can read drafts (staff) but cannot create or edit jobs", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await save(s, jobPayload({ title: "Draft visible to staff" }));
    await s.as(user(U.seo));
    assert.equal((await s.q("select id from jobs where id=$1", [id])).length, 1);
    assert.match(await s.fails("select save_job(null,$1::jsonb)", [JSON.stringify(jobPayload())]) ?? "", /row-level|Not allowed/);
    assert.match(await s.fails("select save_job($1,$2::jsonb)", [id, JSON.stringify(jobPayload({ title: "SEO edit attempt title" }))]) ?? "", /row-level|Not allowed|not editable|not accessible/);
    assert.match(await s.fails("select transition_job($1,'review')", [id]) ?? "", /Not allowed|not accessible/);
    await s.close();
  });
  test("internal notes are staff-only and editors cannot read audit logs, moderators can", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await save(s, jobPayload());
    assert.equal((await s.q("select editorial_notes from job_internal where job_id=$1", [id]))[0].editorial_notes, "INTERNAL-ONLY note");
    assert.equal((await s.q("select * from audit_logs")).length, 0, "editor lacks audit:view");
    await s.as(user(U.mod));
    assert.ok((await s.q("select * from audit_logs where entity='jobs'")).length > 0);
    assert.match(await s.fails("update audit_logs set action='x'") ?? "", /permission denied/);
    assert.match(await s.fails("delete from audit_logs") ?? "", /permission denied/);
    await s.as(user(U.plain)); assert.equal((await s.q("select * from job_internal")).length, 0);
    await s.close();
  });
});

describe("staff management guard", () => {
  test("admin cannot grant/alter super_admin; super admin can; roles can't self-escalate", async () => {
    const s = await Session.open(); await s.as(user(U.adm));
    assert.match(await s.fails("insert into admin_users (user_id, role) values ($1,'super_admin')", [U.plain]) ?? "", /Only a super admin/);
    assert.match(await s.fails("update admin_users set role='admin' where user_id=$1", [U.sa]) ?? "", /Only a super admin/);
    await s.q("insert into admin_users (user_id, role) values ($1,'editor')", [U.plain]);
    await s.as(user(U.ed));
    assert.equal((await s.q("update admin_users set role='super_admin' where user_id=$1 returning user_id", [U.ed])).length, 0, "editor must not be able to update staff rows");
    assert.equal((await s.peek("select role from admin_users where user_id=$1", [U.ed]))[0].role, "editor");
    assert.equal((await s.q("select * from admin_users")).length, 1, "editor should only read their own staff row");
    await s.as(user(U.sa)); await s.q("update admin_users set role='admin' where user_id=$1", [U.plain]);
    await s.close();
  });
  test("the last active super admin cannot be removed or demoted", async () => {
    const s = await Session.open(); await s.su();
    await s.q("delete from admin_users where user_id=$1", [U.sa2]);   // superuser: allowed (trusted)
    await s.as(user(U.sa));
    assert.match(await s.fails("update admin_users set active=false where user_id=$1", [U.sa]) ?? "", /last active super admin/);
    assert.match(await s.fails("delete from admin_users where user_id=$1", [U.sa]) ?? "", /last active super admin/);
    assert.match(await s.fails("update admin_users set role='admin' where user_id=$1", [U.sa]) ?? "", /last active super admin/);
    await s.close();
  });
  test("deactivated staff lose all privileges immediately", async () => {
    const s = await Session.open(); await s.su();
    await s.q("update admin_users set active=false where user_id=$1", [U.ed]);
    await s.as(user(U.ed));
    assert.match(await s.fails("select save_job(null,$1::jsonb)", [JSON.stringify(jobPayload())]) ?? "", /row-level|Not allowed/);
    await s.close();
  });
});

describe("audit log, expiry, duplicate, search", () => {
  test("audit records actor and status transitions; job edits store a diff", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await save(s, jobPayload({ last_date: addDays(15) }));
    await transition(s, id, "review"); await transition(s, id, "published");
    await save(s, jobPayload({ title: "Junior Assistant Recruitment 2026 v2", last_date: addDays(15) }), id);
    await s.su();
    const logs = await s.q("select action, actor_id, before, after from audit_logs where entity='jobs' and entity_id=$1 order by id", [id]);
    const acts = logs.map((l) => l.action);
    assert.ok(acts.includes("create")); assert.ok(acts.includes("status:draft->review")); assert.ok(acts.includes("status:review->published"));
    assert.ok(logs.every((l) => l.actor_id === U.ed), "every entry should carry the editor's id");
    const edit = logs.find((l) => l.before?.title && l.after?.title);
    assert.ok(edit, "title edit should be logged"); assert.equal(edit.before.title, "Junior Assistant Recruitment 2026");
    await s.close();
  });
  test("expiry: overdue live jobs become EXPIRED; jobs without a last date or in the future stay live; drafts untouched", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const mk = async (title: string, last: string | null, publish = true) => {
      const id = await save(s, jobPayload({ title, last_date: last })); if (publish) { await transition(s, id, "review"); await transition(s, id, "published"); } return id; };
    const past = await mk("Overdue Recruitment One", addDays(3)), open = await mk("Still Open Recruitment", addDays(9)),
          nodate = await mk("No Date Recruitment Job", null), draft = await mk("Draft Overdue Recruitment", addDays(3), false);
    // simulate time passing by asking the function to evaluate 'today' = +5 days
    await s.as(SERVICE);
    const n = (await s.q("select expire_overdue_jobs($1::date) n", [addDays(5)]))[0].n;
    assert.equal(n, 1);
    await s.su();
    const st = Object.fromEntries((await s.q("select id,status from jobs where id = any($1)", [[past, open, nodate, draft]])).map((r) => [r.id, r.status]));
    assert.deepEqual(st, { [past]: "expired", [open]: "published", [nodate]: "published", [draft]: "draft" });
    const log = (await s.q("select actor_id, actor_label, action from audit_logs where entity_id=$1 and action like 'status:published->expired'", [past]))[0];
    assert.equal(log.actor_id, null); assert.equal(log.actor_label, "system:expiry");
    await s.as(ANON); assert.match(await s.fails("select expire_overdue_jobs()") ?? "", /permission denied|Not allowed/);
    await s.as(user(U.cm)); assert.match(await s.fails("select expire_overdue_jobs()") ?? "", /Not allowed/);
    await s.close();
  });
  test("duplicate creates an unpublished copy with children but no source-check stamps", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await save(s, jobPayload()); await transition(s, id, "review"); await transition(s, id, "published");
    const copy = (await s.q("select duplicate_job($1) id", [id]))[0].id;
    const c = (await s.q("select status, title, slug, source_checked_at, published_at from jobs where id=$1", [copy]))[0];
    assert.equal(c.status, "draft"); assert.match(c.title, /\(Copy\)$/); assert.equal(c.source_checked_at, null); assert.equal(c.published_at, null);
    assert.equal((await s.q("select 1 from job_vacancies where job_id=$1", [copy])).length, 2);
    assert.deepEqual((await s.q("select qualification_slugs q from jobs where id=$1", [copy]))[0].q, ["graduate"]);
    await s.close();
  });
  test("search_text / qualification_slugs / facet counts are maintained", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await save(s, jobPayload({ title: "Search Test Recruitment", organization_name: "Zebra Selection Board", qualification_slugs: ["graduate", "post-graduate"], state_slug: "bihar", last_date: addDays(20) }));
    await transition(s, id, "review"); await transition(s, id, "published");
    await s.as(ANON);
    const r = await s.q("select id from jobs_v where search_text ilike '%zebra%' and search_text ilike '%bihar%' and qualification_slugs @> array['post-graduate']");
    assert.equal(r.length, 1);
    const f = Object.fromEntries((await s.q("select key, n from job_facet_counts('state')")).map((x) => [x.key, Number(x.n)]));
    assert.equal(f["bihar"], 1);
    const fq = Object.fromEntries((await s.q("select key, n from job_facet_counts('qualification', null, null, null)")).map((x) => [x.key, Number(x.n)]));
    assert.equal(fq["graduate"], 1); assert.equal(fq["post-graduate"], 1);
    await s.close();
  });
  test("dashboard stats reflect statuses and are staff-only", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const a = await save(s, jobPayload({ title: "Dash Job Alpha", last_date: addDays(3) })); await transition(s, a, "review"); await transition(s, a, "published");
    await save(s, jobPayload({ title: "Dash Job Beta" }));
    const st = (await s.q("select admin_dashboard_stats() s"))[0].s;
    assert.equal(st.published, 1); assert.equal(st.draft, 1); assert.equal(st.closing_soon, 1);
    await s.as(user(U.plain)); assert.match(await s.fails("select admin_dashboard_stats()") ?? "", /Not allowed/);
    await s.close();
  });
  test("constraints: bad URLs, inverted ages/dates and short titles are rejected by the database", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    assert.match(await s.fails("select save_job(null,$1::jsonb)", [JSON.stringify(jobPayload({ notification_url: "javascript:alert(1)" }))]) ?? "", /jobs_url_scheme_chk/);
    assert.match(await s.fails("select save_job(null,$1::jsonb)", [JSON.stringify(jobPayload({ age_min: 40, age_max: 20 }))]) ?? "", /jobs_age_chk/);
    assert.match(await s.fails("select save_job(null,$1::jsonb)", [JSON.stringify(jobPayload({ application_start_date: addDays(10), last_date: addDays(2) }))]) ?? "", /jobs_dates_chk/);
    assert.match(await s.fails("select save_job(null,$1::jsonb)", [JSON.stringify(jobPayload({ title: "abc" }))]) ?? "", /jobs_title_chk/);
    await s.close();
  });
});
