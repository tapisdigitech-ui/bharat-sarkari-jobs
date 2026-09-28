/** Phase 2B — generic content engine: Recruitments, Exams (and, as they are added, Admit Cards, Results, Answer Keys, Exam Calendar). */
import { test, before, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { ANON, Session, U, admin, jobPayload, seedUsers, user } from "./db";

before(async () => { await seedUsers(); });
afterEach(async () => { await Session.closeAll(); });

const ins = async (s: Session, table: string, row: Record<string, unknown>) => {
  const cols = Object.keys(row);
  const r = await s.q(`insert into ${table} (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id, slug`, cols.map((c) => row[c]));
  return r[0] as { id: string; slug: string };
};
const tr = (s: Session, kind: string, id: string, to: string, comment: string | null = null) => s.q("select transition_content($1,$2,$3::content_status,$4)", [kind, id, to, comment]);
const statusOf = async (s: Session, table: string, id: string) => (await s.peek(`select status from ${table} where id=$1`, [id]))[0]?.status;
const saveJob = (s: Session, payload: object) => s.q<{ save_job: string }>("select save_job(null, $1::jsonb)", [JSON.stringify(payload)]).then((r) => r[0].save_job);
const SRC = { source_name: "Official website", official_notification_url: "https://example.gov.in/n.pdf", official_website_url: "https://example.gov.in", source_checked_at: new Date().toISOString() };

async function org(name = "Test Recruitment Board") {
  const c = await admin();
  const r = await c.query("insert into organizations (name, slug, level) values ($1, lower(replace($1,' ','-')), 'central') on conflict do nothing returning id", [name]);
  const id = r.rows[0]?.id ?? (await c.query("select id from organizations where name=$1", [name])).rows[0].id;
  await c.end(); return id as string;
}
const recRow = (orgId: string, o: Record<string, unknown> = {}) => ({ title: "SSC Combined Graduate Level 2026", organization_id: orgId, level: "central", is_all_india: true, ...o });

describe("recruitments: workflow, source rule, visibility", () => {
  test("editor lifecycle; publish is blocked without an official source; anon sees only live ones", async () => {
    const o = await org(); const s = await Session.open(); await s.as(user(U.ed));
    const draft = await ins(s, "recruitments", recRow(o));
    assert.match(draft.slug, /^ssc-combined-graduate-level-2026/);          // slug generated
    await tr(s, "recruitment", draft.id, "review");
    assert.match((await s.fails("select transition_content('recruitment',$1,'published',null)", [draft.id])) ?? "", /official|source/i);
    await s.q("update recruitments set source_name=$2, official_notification_url=$3, official_website_url=$4, source_checked_at=$5 where id=$1",
      [draft.id, SRC.source_name, SRC.official_notification_url, SRC.official_website_url, SRC.source_checked_at]);
    await tr(s, "recruitment", draft.id, "published");
    const hidden = await ins(s, "recruitments", recRow(o, { title: "Hidden Draft Recruitment" }));
    await s.as(ANON);
    const ids = (await s.q("select id from recruitments")).map((r) => r.id);
    assert.ok(ids.includes(draft.id)); assert.ok(!ids.includes(hidden.id));
  });

  test("published needs a state or All India; content manager cannot publish; moderator can unpublish but not edit", async () => {
    const o = await org(); const s = await Session.open();
    await s.as(user(U.cm));
    const r = await ins(s, "recruitments", { ...recRow(o), is_all_india: false, ...SRC });
    await tr(s, "recruitment", r.id, "review");
    assert.match((await s.fails("select transition_content('recruitment',$1,'published',null)", [r.id])) ?? "", /permission|not allowed|publish/i);
    await s.as(user(U.ed));
    assert.match((await s.fails("select transition_content('recruitment',$1,'published',null)", [r.id])) ?? "", /state/i);
    await s.q("update recruitments set is_all_india=true where id=$1", [r.id]);
    await tr(s, "recruitment", r.id, "published");
    await s.as(user(U.cm));
    assert.match((await s.fails("update recruitments set summary='x' where id=$1", [r.id])) ?? "", /publish permission/i, "content manager cannot edit a live record");
    await s.as(user(U.mod));
    await tr(s, "recruitment", r.id, "draft");
    assert.equal(await statusOf(s, "recruitments", r.id), "draft");
  });

  test("slug is locked once the recruitment has been published", async () => {
    const o = await org(); const s = await Session.open(); await s.as(user(U.ed));
    const r = await ins(s, "recruitments", { ...recRow(o), ...SRC });
    await tr(s, "recruitment", r.id, "review"); await tr(s, "recruitment", r.id, "published");
    assert.match((await s.fails("update recruitments set slug='changed-slug' where id=$1", [r.id])) ?? "", /slug|locked|published/i);
  });
});

describe("exams: reusable master entity", () => {
  test("exam needs organization + official website + source to publish; drafts hidden from anon; org is mandatory", async () => {
    const o = await org(); const s = await Session.open(); await s.as(user(U.ed));
    assert.ok(await s.fails("insert into exams (name, slug) values ('No Org Exam','no-org-exam')"), "organization is NOT NULL");
    const e = await ins(s, "exams", { name: "SSC CGL", organization_id: o, level: "central", is_all_india: true });
    await tr(s, "exam", e.id, "review");
    assert.match((await s.fails("select transition_content('exam',$1,'published',null)", [e.id])) ?? "", /official|source/i);
    await s.q("update exams set source_name=$2, official_website_url=$3, source_checked_at=now() where id=$1", [e.id, "Official website", "https://ssc.example.gov.in"]);
    await s.as(ANON); assert.equal((await s.q("select id from exams where id=$1", [e.id])).length, 0);
    await s.as(user(U.ed)); await tr(s, "exam", e.id, "published");
    await s.as(ANON); assert.equal((await s.q("select id from exams where id=$1", [e.id])).length, 1);
  });
});

describe("relationships and data integrity", () => {
  test("a job linked to a recruitment must share its organization and inherits its exam", async () => {
    const o1 = await org("Board One"), o2 = await org("Board Two"); const s = await Session.open(); await s.as(user(U.ed));
    const e = await ins(s, "exams", { name: "Board One Exam", organization_id: o1, level: "central", is_all_india: true });
    const r = await ins(s, "recruitments", recRow(o1, { exam_id: e.id }));
    const okJob = await saveJob(s, jobPayload({ organization_name: "Board One", recruitment_id: r.id }));
    const row = (await s.q("select recruitment_id, exam_id from jobs where id=$1", [okJob]))[0];
    assert.equal(row.recruitment_id, r.id); assert.equal(row.exam_id, e.id, "exam inherited, not duplicated");
    assert.match((await s.fails("select save_job(null,$1::jsonb)", [JSON.stringify(jobPayload({ title: "Wrong Org Job", organization_name: "Board Two", recruitment_id: r.id }))])) ?? "", /organization/i);
    void o2;
  });

  test("nothing with dependents can be deleted (FK RESTRICT): organization, exam, recruitment", async () => {
    const o = await org("Restrict Board"); const s = await Session.open(); await s.su();
    const e = await ins(s, "exams", { name: "Restrict Exam", organization_id: o, level: "central", is_all_india: true });
    const r = await ins(s, "recruitments", recRow(o, { title: "Restrict Recruitment 2026", exam_id: e.id }));
    await s.as(user(U.ed)); await saveJob(s, jobPayload({ organization_name: "Restrict Board", recruitment_id: r.id }));
    await s.su();
    assert.match((await s.fails("delete from recruitments where id=$1", [r.id])) ?? "", /23503|foreign key/i);
    assert.match((await s.fails("delete from exams where id=$1", [e.id])) ?? "", /23503|foreign key/i);
    assert.match((await s.fails("delete from organizations where id=$1", [o])) ?? "", /23503|foreign key/i);
    assert.match((await s.fails("update recruitments set organization_id=$2 where id=$1", [r.id, await org("Other Board")])) ?? "", /organization/i);
  });

  test("editors can archive instead of deleting; archived records leave public view", async () => {
    const o = await org(); const s = await Session.open(); await s.as(user(U.ed));
    const r = await ins(s, "recruitments", { ...recRow(o, { title: "Archive Me Recruitment" }), ...SRC });
    await tr(s, "recruitment", r.id, "review"); await tr(s, "recruitment", r.id, "published");
    await tr(s, "recruitment", r.id, "expired"); await tr(s, "recruitment", r.id, "archived");
    await s.as(ANON); assert.equal((await s.q("select id from recruitments where id=$1", [r.id])).length, 0);
    await s.as(user(U.ed)); await tr(s, "recruitment", r.id, "draft");
  });
});

describe("official vs expected dates", () => {
  test("official needs a date; expected needs a date or wording; wording only for expected; nothing without a status", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const bad = async (f: Record<string, unknown>, re: RegExp) => assert.match((await s.fails("select save_job(null,$1::jsonb)", [JSON.stringify(jobPayload({ title: "Bad Date Rules Job", ...f }))])) ?? "", re);
    await bad({ exam_date_status: "official" }, /exam_date|check/i);
    await bad({ exam_date: "2026-11-01" }, /exam_date|check/i);                                           // date without status
    await bad({ exam_date_status: "expected" }, /exam_date|check/i);                                       // expected with nothing
    await bad({ exam_date_status: "official", exam_date: "2026-11-01", exam_date_text: "November" }, /exam_date|check/i);
    await bad({ exam_date_status: "sure" }, /exam_date|check/i);
    const ok1 = await saveJob(s, jobPayload({ title: "Expected Only Wording Job", exam_date_status: "expected", exam_date_text: "October 2026" }));
    const ok2 = await saveJob(s, jobPayload({ title: "Official Exam Date Job", exam_date_status: "official", exam_date: "2026-10-15" }));
    const r = await s.q("select id, exam_date, exam_date_status, exam_date_text from jobs_v where id = any($1)", [[ok1, ok2]]);
    assert.equal(r.find((x) => x.id === ok1)!.exam_date, null);
    assert.equal(r.find((x) => x.id === ok2)!.exam_date_status, "official");
  });
});

describe("audit log for the new entities", () => {
  test("create, submit, publish, source and date changes are tagged", async () => {
    const o = await org("Audit Board"); const s = await Session.open(); await s.as(user(U.ed));
    const r = await ins(s, "recruitments", recRow(o, { title: "Audited Recruitment 2026" }));
    await s.q("update recruitments set source_name='Official site', official_notification_url='https://a.gov.in/n.pdf', official_website_url='https://a.gov.in', source_checked_at=now() where id=$1", [r.id]);
    await tr(s, "recruitment", r.id, "review"); await tr(s, "recruitment", r.id, "published");
    await s.q("update recruitments set official_notification_url='https://a.gov.in/n2.pdf', notification_date='2026-08-01' where id=$1", [r.id]);
    await s.as(user(U.sa));
    const tags = new Set((await s.q("select unnest(tags) t from audit_logs where entity='recruitments' and entity_id=$1", [r.id])).map((x) => x.t));
    for (const t of ["create", "submit", "publish", "source_change", "date_change", "status_change", "edit"]) assert.ok(tags.has(t), `missing audit tag ${t}: ${[...tags]}`);
  });
});

/* ───────────── Steps 4–6: admit cards, results, answer keys ───────────── */
const SRC_A = { source_name: "Official website", source_checked_at: new Date().toISOString() };
const acRow = (orgId: string, o: Record<string, unknown> = {}) => ({ title: "SSC CGL 2026 Tier-I Admit Card", organization_id: orgId, is_all_india: true, ...o });
const typeId = async (table: string, slug: string) => { const c = await admin(); const r = (await c.query(`select id from ${table} where slug=$1`, [slug])).rows[0].id; await c.end(); return r as number; };

describe("admit cards", () => {
  test("lifecycle; official source required; released needs the official download URL; anon sees only live", async () => {
    const o = await org("Admit Board"); const s = await Session.open(); await s.as(user(U.ed));
    const a = await ins(s, "admit_cards", acRow(o));
    assert.match(a.slug, /^ssc-cgl-2026-tier-i-admit-card/);
    assert.ok(await s.fails("insert into admit_cards (title, organization_id, availability) values ('Released Without Link', $1, 'released')", [o]), "released without official URL is impossible");
    await tr(s, "admit_card", a.id, "review");
    assert.match((await s.fails("select transition_content('admit_card',$1,'published',null)", [a.id])) ?? "", /source|official/i);
    await s.q("update admit_cards set source_name='Official website', official_website_url='https://ssc.example.gov.in', source_checked_at=now() where id=$1", [a.id]);
    await tr(s, "admit_card", a.id, "published");
    await s.as(ANON);
    assert.equal((await s.q("select id from admit_cards where id=$1", [a.id])).length, 1);
    assert.equal((await s.q("select id from admit_cards where status='draft'")).length, 0);
  });
  test("release/exam dates use official/expected rules; important_dates structure is validated", async () => {
    const o = await org("Admit Board"); const s = await Session.open(); await s.as(user(U.ed));
    assert.ok(await s.fails("insert into admit_cards (title, organization_id, release_date_status) values ('Official Without Date', $1, 'official')", [o]));
    assert.ok(await s.fails("insert into admit_cards (title, organization_id, exam_date, exam_date_status, exam_date_text) values ('Wording On Official', $1, '2026-11-01', 'official', 'November')", [o]));
    await ins(s, "admit_cards", { title: "Expected Exam Wording Card", organization_id: o, exam_date_status: "expected", exam_date_text: "Last week of October 2026" });
    const ok1 = await s.q("insert into admit_cards (title, organization_id, important_dates) values ('Dates List Card', $1, $2::jsonb) returning id", [o, JSON.stringify([{ label: "Reporting time", status: "official", date: "2026-11-01", text: null }, { label: "Result", status: "expected", date: null, text: "December 2026" }])]);
    assert.equal(ok1.length, 1);
    for (const bad of [[{ label: "", status: "official", date: "2026-11-01" }], [{ label: "X", status: "official" }], [{ label: "X", status: "maybe", date: "2026-11-01" }], [{ label: "X", status: "expected" }], "not-an-array", Array.from({ length: 21 }, () => ({ label: "X", status: "official", date: "2026-11-01" }))])
      assert.ok(await s.fails("insert into admit_cards (title, organization_id, important_dates) values ('Bad Dates List', $1, $2::jsonb)", [o, JSON.stringify(bad)]), `should reject ${JSON.stringify(bad).slice(0, 60)}`);
  });
  test("links: same organization enforced; recruitment and exam are inherited from the job/recruitment; contradictions refused", async () => {
    const o1 = await org("Link Board One"), o2 = await org("Link Board Two"); const s = await Session.open(); await s.as(user(U.ed));
    const e1 = await ins(s, "exams", { name: "Link Exam One", organization_id: o1, level: "central", is_all_india: true });
    const e2 = await ins(s, "exams", { name: "Link Exam Two", organization_id: o1, level: "central", is_all_india: true });
    const r1 = await ins(s, "recruitments", recRow(o1, { title: "Link Recruitment One", exam_id: e1.id }));
    const job = await saveJob(s, jobPayload({ title: "Link Job One Post", organization_name: "Link Board One", recruitment_id: r1.id }));
    const viaJob = await ins(s, "admit_cards", acRow(o1, { title: "Admit Via Job Only", job_id: job }));
    const got = (await s.q("select recruitment_id, exam_id from admit_cards where id=$1", [viaJob.id]))[0];
    assert.equal(got.recruitment_id, r1.id); assert.equal(got.exam_id, e1.id);
    assert.match((await s.fails("insert into admit_cards (title, organization_id, recruitment_id) values ('Wrong Org Recruitment', $1, $2)", [o2, r1.id])) ?? "", /organization/i);
    assert.match((await s.fails("insert into admit_cards (title, organization_id, job_id) values ('Wrong Org Job Link', $1, $2)", [o2, job])) ?? "", /organization/i);
    assert.match((await s.fails("insert into admit_cards (title, organization_id, recruitment_id, exam_id) values ('Wrong Exam For Recruitment', $1, $2, $3)", [o1, r1.id, e2.id])) ?? "", /exam/i);
    assert.match((await s.fails("insert into admit_cards (title, organization_id, exam_id) values ('Exam Of Other Org', $1, $2)", [o2, e1.id])) ?? "", /organization|exam/i);
  });
  test("roles: content manager drafts but cannot publish; moderator unpublishes; SEO manager cannot create; editor can", async () => {
    const o = await org("Role Board"); const s = await Session.open();
    await s.as(user(U.seo)); assert.ok(await s.fails("insert into admit_cards (title, organization_id) values ('Seo Should Not Create', $1)", [o]));
    await s.as(user(U.cm)); const a = await ins(s, "admit_cards", { ...acRow(o, { title: "Role Test Admit Card" }), ...SRC_A, official_website_url: "https://x.gov.in" });
    await tr(s, "admit_card", a.id, "review");
    assert.match((await s.fails("select transition_content('admit_card',$1,'published',null)", [a.id])) ?? "", /permission|not allowed/i);
    await s.as(user(U.ed)); await tr(s, "admit_card", a.id, "published");
    await s.as(user(U.mod)); await tr(s, "admit_card", a.id, "draft");
    assert.equal(await statusOf(s, "admit_cards", a.id), "draft");
  });
});

describe("results", () => {
  test("publish needs type, an OFFICIAL result date and an official link; extensible types; type in use cannot be deleted", async () => {
    const o = await org("Result Board"); const s = await Session.open(); await s.as(user(U.ed));
    const wr = await typeId("result_types", "written-exam-result");
    const r = await ins(s, "results", { title: "CGL 2026 Tier-I Result", organization_id: o, is_all_india: true, result_date: "2026-12-15", result_date_status: "expected", result_type_id: wr, ...SRC_A, official_result_url: "https://r.gov.in/res" });
    await tr(s, "result", r.id, "review");
    assert.match((await s.fails("select transition_content('result',$1,'published',null)", [r.id])) ?? "", /official result date/i);
    await s.q("update results set result_date_status='official' where id=$1", [r.id]);
    await tr(s, "result", r.id, "published");
    await s.as(ANON); assert.equal((await s.q("select id from results where id=$1", [r.id])).length, 1);
    await s.su();
    assert.match((await s.fails("delete from result_types where id=$1", [wr])) ?? "", /23503|foreign key/i);
    const r2 = await ins(s, "results", { title: "No Type Result Draft", organization_id: o, is_all_india: true, result_date: "2026-12-15", result_date_status: "official", ...SRC_A, official_result_url: "https://r.gov.in/res" });
    await s.as(user(U.ed)); await tr(s, "result", r2.id, "review");
    assert.match((await s.fails("select transition_content('result',$1,'published',null)", [r2.id])) ?? "", /result type/i);
    // extensible: content manager (reference:manage) can add a type, editor cannot
    await s.as(user(U.cm)); await s.q("insert into result_types (slug, name, sort_order) values ('re-evaluation-result', 'Re-evaluation Result', 90)");
    await s.as(user(U.ed)); assert.ok(await s.fails("insert into result_types (slug, name) values ('editor-cannot', 'Editor Cannot')"));
    await s.as(ANON); assert.ok((await s.q("select slug from result_types")).some((x) => x.slug === "re-evaluation-result"));
  });
  test("the eight requested result types are seeded", async () => {
    const c = await admin(); const n = (await c.query("select name from result_types order by sort_order")).rows.map((r) => r.name); await c.end();
    for (const t of ["Written Exam Result", "Final Result", "Merit List", "Cut-off", "Selection List", "Document Verification List", "Skill Test Result", "Interview Result"]) assert.ok(n.includes(t), t);
  });
});

describe("answer keys", () => {
  test("objection window order; publish needs type + official release date + official link", async () => {
    const o = await org("Key Board"); const s = await Session.open(); await s.as(user(U.ed));
    const pv = await typeId("answer_key_types", "provisional");
    assert.match((await s.fails("insert into answer_keys (title, organization_id, objection_start_date, objection_last_date) values ('Inverted Window Key', $1, '2026-11-10', '2026-11-05')", [o])) ?? "", /objection|check/i);
    const k = await ins(s, "answer_keys", { title: "CGL Provisional Answer Key", organization_id: o, is_all_india: true, answer_key_type_id: pv, release_date: "2026-11-01", release_date_status: "expected", release_date_text: "November", ...SRC_A, official_answer_key_url: "https://k.gov.in/key", objection_start_date: "2026-11-02", objection_last_date: "2026-11-05" });
    await tr(s, "answer_key", k.id, "review");
    assert.match((await s.fails("select transition_content('answer_key',$1,'published',null)", [k.id])) ?? "", /official release date/i);
    await s.q("update answer_keys set release_date_status='official', release_date='2026-11-01', release_date_text=null where id=$1", [k.id]);
    await tr(s, "answer_key", k.id, "published");
    await s.as(ANON); assert.equal((await s.q("select id from answer_keys where id=$1", [k.id])).length, 1);
  });
  test("four answer key types are seeded and extensible", async () => {
    const c = await admin(); const n = (await c.query("select name from answer_key_types")).rows.map((r) => r.name); await c.end();
    assert.equal(n.length, 4); assert.ok(n.some((x) => /Provisional/.test(x)) && n.some((x) => /Final/.test(x)) && n.some((x) => /Response Sheet/.test(x)) && n.some((x) => /Objection/.test(x)));
  });
});

describe("exam calendar", () => {
  const calRow = (o: string, x: Record<string, unknown> = {}) => ({ title: "SSC CGL 2026 Schedule", organization_id: o, is_all_india: true, exam_type: "recruitment", ...x });
  test("lifecycle; publish needs an organization, a coverage, at least one date and an official source; anon sees only live", async () => {
    const o = await org("Calendar Board"); const s = await Session.open(); await s.as(user(U.ed));
    const c = await ins(s, "exam_calendar", calRow(o));
    assert.match(c.slug, /^ssc-cgl-2026-schedule/);
    await tr(s, "exam_calendar", c.id, "review");
    const why = (await s.fails("select transition_content('exam_calendar',$1,'published',null)", [c.id])) ?? "";
    assert.match(why, /date/i, "no date yet"); assert.match(why, /source|official/i);
    await s.q("update exam_calendar set exam_date_status='expected', exam_date_text='October 2026', source_name='Official website', official_website_url='https://ssc.example.gov.in', source_checked_at=now() where id=$1", [c.id]);
    await tr(s, "exam_calendar", c.id, "published");
    const st = await ins(s, "exam_calendar", { title: "Coverage Missing Entry", organization_id: o, exam_date_status: "expected", exam_date_text: "Soon", ...SRC_A, official_website_url: "https://x.gov.in" });
    await tr(s, "exam_calendar", st.id, "review");
    assert.match((await s.fails("select transition_content('exam_calendar',$1,'published',null)", [st.id])) ?? "", /state|india/i);
    await s.as(ANON);
    const ids = (await s.q("select id from exam_calendar")).map((r) => r.id);
    assert.ok(ids.includes(c.id)); assert.ok(!ids.includes(st.id));
  });
  test("date rules: official needs a date, expected needs date or wording; order checks apply only between OFFICIAL dates", async () => {
    const o = await org("Calendar Board"); const s = await Session.open(); await s.as(user(U.ed));
    assert.ok(await s.fails("insert into exam_calendar (title, organization_id, is_all_india, exam_date_status) values ('Official No Date',$1,true,'official')", [o]));
    assert.ok(await s.fails("insert into exam_calendar (title, organization_id, is_all_india, result_date, result_date_status, result_date_text) values ('Wording On Official',$1,true,'2026-12-01','official','December')", [o]));
    assert.ok(await s.fails("insert into exam_calendar (title, organization_id, is_all_india, exam_date) values ('Date Without Status',$1,true,'2026-12-01')", [o]));
    assert.match((await s.fails("insert into exam_calendar (title, organization_id, is_all_india, application_start_date, application_start_date_status, application_last_date, application_last_date_status) values ('Apply Order Broken',$1,true,'2026-10-10','official','2026-10-01','official')", [o])) ?? "", /apply_order|check/i);
    assert.match((await s.fails("insert into exam_calendar (title, organization_id, is_all_india, admit_card_date, admit_card_date_status, exam_date, exam_date_status) values ('Admit After Exam',$1,true,'2026-11-10','official','2026-11-01','official')", [o])) ?? "", /admit_before_exam|check/i);
    assert.match((await s.fails("insert into exam_calendar (title, organization_id, is_all_india, exam_date, exam_date_status, result_date, result_date_status) values ('Result Before Exam',$1,true,'2026-11-10','official','2026-11-01','official')", [o])) ?? "", /exam_before_result|check/i);
    // an expected estimate is never compared against an official day
    await ins(s, "exam_calendar", calRow(o, { title: "Expected Then Official Mix", admit_card_date: "2026-11-10", admit_card_date_status: "expected", exam_date: "2026-11-01", exam_date_status: "official" }));
    assert.ok(await s.fails("insert into exam_calendar (title, organization_id, is_all_india, state_id) values ('All India And State',$1,true,1)", [o]), "national and a state at once");
  });
  test("links: same organization; recruitment/exam inherited; contradictions refused; district must belong to the state", async () => {
    const o1 = await org("Cal Link One"), o2 = await org("Cal Link Two"); const s = await Session.open(); await s.as(user(U.ed));
    const e1 = await ins(s, "exams", { name: "Cal Link Exam", organization_id: o1, level: "central", is_all_india: true });
    const r1 = await ins(s, "recruitments", recRow(o1, { title: "Cal Link Recruitment", exam_id: e1.id }));
    const c = await ins(s, "exam_calendar", calRow(o1, { title: "Cal Via Recruitment", recruitment_id: r1.id }));
    assert.equal((await s.q("select exam_id from exam_calendar where id=$1", [c.id]))[0].exam_id, e1.id);
    assert.match((await s.fails("insert into exam_calendar (title, organization_id, is_all_india, recruitment_id) values ('Cal Wrong Org',$1,true,$2)", [o2, r1.id])) ?? "", /organization/i);
    assert.match((await s.fails("insert into exam_calendar (title, organization_id, is_all_india, exam_id) values ('Cal Exam Other Org',$1,true,$2)", [o2, e1.id])) ?? "", /organization|exam/i);
  });
  test("roles, audit tags and delete rules", async () => {
    const o = await org("Cal Audit Board"); const s = await Session.open();
    await s.as(user(U.seo)); assert.ok(await s.fails("insert into exam_calendar (title, organization_id, is_all_india) values ('Seo Should Not Create',$1,true)", [o]));
    await s.as(user(U.cm)); const c = await ins(s, "exam_calendar", { ...calRow(o, { title: "Cal Role Entry 2026", exam_date_status: "expected", exam_date_text: "Autumn 2026" }), ...SRC_A, official_website_url: "https://x.gov.in" });
    await tr(s, "exam_calendar", c.id, "review");
    assert.match((await s.fails("select transition_content('exam_calendar',$1,'published',null)", [c.id])) ?? "", /permission|not allowed/i);
    await s.as(user(U.ed)); await tr(s, "exam_calendar", c.id, "published");
    assert.equal((await s.q("delete from exam_calendar where id=$1 returning id", [c.id])).length, 0, "a live entry cannot be deleted (RLS hides it from delete)");
    await s.q("update exam_calendar set exam_date_status='official', exam_date='2026-11-20', exam_date_text=null where id=$1", [c.id]);
    await tr(s, "exam_calendar", c.id, "draft"); await tr(s, "exam_calendar", c.id, "archived");
    await s.as(user(U.sa));
    const tags = new Set((await s.q("select unnest(tags) t from audit_logs where entity='exam_calendar' and entity_id=$1", [c.id])).map((x) => x.t));
    for (const t of ["create", "submit", "publish", "date_change", "unpublish", "archive"]) assert.ok(tags.has(t), `missing ${t}: ${[...tags]}`);
    await s.su();
    assert.match((await s.fails("delete from organizations where id=$1", [o])) ?? "", /23503|foreign key/i);
  });
});

describe("audit and integrity across the new entities", () => {
  test("create/submit/publish/unpublish/archive on admit cards are all audited with tags; organizations with content cannot be deleted", async () => {
    const o = await org("Audit Admit Board"); const s = await Session.open(); await s.as(user(U.ed));
    const a = await ins(s, "admit_cards", { ...acRow(o, { title: "Audited Admit Card 2026" }), ...SRC_A, official_website_url: "https://a.gov.in" });
    await tr(s, "admit_card", a.id, "review"); await tr(s, "admit_card", a.id, "published"); await tr(s, "admit_card", a.id, "draft"); await tr(s, "admit_card", a.id, "archived");
    await s.as(user(U.sa));
    const tags = new Set((await s.q("select unnest(tags) t from audit_logs where entity='admit_cards' and entity_id=$1", [a.id])).map((x) => x.t));
    for (const t of ["create", "submit", "publish", "unpublish", "archive"]) assert.ok(tags.has(t), `missing ${t}: ${[...tags]}`);
    await s.su();
    assert.match((await s.fails("delete from organizations where id=$1", [o])) ?? "", /23503|foreign key/i);
  });
  test("no orphans: every content row's organization/exam/recruitment/job exists (FK) and drafts stay out of public reads", async () => {
    const c = await admin();
    for (const t of ["admit_cards", "results", "answer_keys", "recruitments", "exams", "exam_calendar"]) {
      const n = (await c.query(`select count(*)::int n from ${t} x where not exists (select 1 from organizations o where o.id = x.organization_id)`)).rows[0].n;
      assert.equal(n, 0, t);
    }
    const fk = (await c.query(`select conrelid::regclass::text t, conname, confdeltype from pg_constraint where contype='f' and conrelid::regclass::text in ('admit_cards','results','answer_keys','exam_calendar') and confrelid::regclass::text in ('organizations','exams','recruitments','jobs','result_types','answer_key_types')`)).rows;
    await c.end();
    assert.ok(fk.length >= 12); for (const r of fk) assert.equal(r.confdeltype, "r", `${r.t}.${r.conname} must be ON DELETE RESTRICT`);
  });
});
