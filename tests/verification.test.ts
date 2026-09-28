/**
 * Per-field verification, field evidence, change approval and the official-updates chain (Phase 3.6 items 14–17).
 * Local PostgreSQL with the real migrations; identities impersonated the way PostgREST does. NOT real Supabase.
 */
import { test, before, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { ANON, Session, U, admin, addDays, jobPayload, seedUsers, user } from "./db";

before(async () => { await seedUsers(); });
afterEach(async () => { await Session.closeAll(); });

const saveJob = (s: Session, p: object) => s.q<{ save_job: string }>("select save_job(null, $1::jsonb)", [JSON.stringify(p)]).then((r) => r[0].save_job);
async function publishedJob(s: Session, title: string, last: string) {
  const id = await saveJob(s, jobPayload({ title, last_date: last, advertisement_no: "VT/2026/01" }));
  await s.q("select transition_job($1,'review',null,null)", [id]); await s.q("select transition_job($1,'published',null,null)", [id]);
  return id;
}
/** A discovery as the pipeline would queue it (inserted by the trusted role — API roles cannot insert discoveries). */
async function discovery(o: Record<string, unknown>) {
  const c = await admin();
  const row = { suggested_kind: "job", title: "Extension of last date - Advt VT/2026/01", extracted: {}, confidence: "HIGH", confidence_score: 0.9,
    content_hash: `h-${Math.random()}`, item_url: "https://vt.example.gov.in/n/extension.pdf", review_status: "pending", ...o };
  const cols = Object.keys(row);
  const r = await c.query(`insert into discovered_items (${cols.join(",")}) values (${cols.map((k, i) => (["extracted", "changes", "field_evidence"].includes(k) ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(",")}) returning id`,
    cols.map((k) => (["extracted", "changes", "field_evidence"].includes(k) ? JSON.stringify((row as Record<string, unknown>)[k]) : (row as Record<string, unknown>)[k])));
  await c.end();
  return r.rows[0].id as string;
}

describe("field verifications", () => {
  test("reviewers record per-field decisions; history is append-only; others cannot read or write", async () => {
    const d = await discovery({});
    const s = await Session.open();
    await s.as(user(U.ed));
    await s.q("insert into field_verifications (subject_kind, subject_id, field, status, value_checked, verified_by) values ('discovery',$1,'last_date','verified','{\"last_date\":\"2026-11-18\"}',$2)", [d, U.ed]);
    assert.ok(await s.fails("insert into field_verifications (subject_kind, subject_id, field, status, verified_by) values ('discovery',$1,'age','verified',$2)", [d, U.cm]), "cannot sign as someone else");
    assert.ok(await s.fails("update field_verifications set status='incorrect' where subject_id=$1", [d]), "decisions are not rewritten");
    assert.ok(await s.fails("delete from field_verifications where subject_id=$1", [d]), "decisions are not deleted");
    await s.q("insert into field_verifications (subject_kind, subject_id, field, status, note, verified_by) values ('discovery',$1,'last_date','incorrect','PDF says 20.11',$2)", [d, U.ed]);
    const latest = await s.q("select status from field_verification_latest where subject_id=$1 and field='last_date'", [d]);
    assert.equal(latest[0].status, "incorrect", "the newest decision wins; the older one stays in history");
    assert.equal((await s.q("select count(*)::int n from field_verifications where subject_id=$1", [d]))[0].n, 2);
    await s.as(user(U.seo));
    assert.ok(await s.fails("insert into field_verifications (subject_kind, subject_id, field, status, verified_by) values ('discovery',$1,'fee','verified',$2)", [d, U.seo]), "SEO manager cannot verify");
    await s.as(ANON);
    assert.ok(await s.fails("select * from field_verifications"), "anon has no access at all");
  });
});

describe("change detection → approval → official update chain", () => {
  test("a detected extension never touches the live record until a reviewer applies it; then evidence, version and the public update are recorded", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const jobId = await publishedJob(s, "Verification Chain Job 2026", addDays(20));
    await s.c.query("commit"); await s.c.query("begin"); await s.as(user(U.ed));
    const newLast = addDays(35);
    const d = await discovery({ change_target_kind: "job", change_target_id: jobId, amendment_type: "extension",
      extracted: { last_date: newLast, title: "Extension of last date - Advt VT/2026/01" }, changes: { last_date: { from: addDays(20), to: newLast, important: true } },
      field_evidence: { last_date: `The last date has been extended up to ${newLast}` } });
    const live = async () => (await s.peek("select to_char(last_date,'YYYY-MM-DD') d, status from jobs where id=$1", [jobId]))[0];
    assert.equal((await live()).d, addDays(20), "queued, not applied");
    await s.q("select apply_discovery_changes($1, array['last_date'], 'Official extension notice')", [d]);
    assert.equal((await live()).d, newLast);
    const ev = await s.q("select field, excerpt, source_url from field_evidence where kind='job' and content_id=$1", [jobId]);
    assert.deepEqual(ev.map((e) => e.field), ["last_date"]);
    const up = await s.q("select update_type, changes, official_url from official_updates where kind='job' and content_id=$1", [jobId]);
    assert.equal(up.length, 1); assert.equal(up[0].update_type, "extension"); assert.equal(up[0].changes.last_date.to, newLast);
    const versions = await s.q("select version, reason from content_versions where kind='job' and content_id=$1 order by version", [jobId]);
    assert.ok(versions.length >= 2 && versions.at(-1)!.reason === "Official extension notice", "a new version with the reason; the old one kept");
    await s.c.query("commit"); await s.c.query("begin");

    // Public: anon sees the update but never the editorial evidence.
    await s.as(ANON);
    assert.equal((await s.q("select id from official_updates where content_id=$1", [jobId])).length, 1);
    assert.ok(await s.fails("select * from field_evidence"), "evidence is editorial only");

    // History is never erased: no delete; the type cannot be rewritten; an entry can only be withdrawn.
    await s.as(user(U.adm));
    assert.ok(await s.fails("delete from official_updates where content_id=$1", [jobId]), "never deleted");
    assert.ok(await s.fails("update official_updates set update_type='cancellation' where content_id=$1", [jobId]));
    await s.q("update official_updates set is_withdrawn=true where content_id=$1", [jobId]);
    await s.as(ANON);
    assert.equal((await s.q("select id from official_updates where content_id=$1", [jobId])).length, 0, "withdrawn entries leave the public page");

    // Unpublishing the record hides its updates too.
    await s.as(user(U.adm)); await s.q("update official_updates set is_withdrawn=false where content_id=$1", [jobId]);
    await s.q("select transition_job($1,'draft',null,null)", [jobId]);
    await s.as(ANON);
    assert.equal((await s.q("select id from official_updates where content_id=$1", [jobId])).length, 0);
  });

  test("an editor who corrected a value before applying: evidence is recorded only for values the record really shows", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const jobId = await publishedJob(s, "Partial Evidence Job 2026", addDays(22));
    const d = await discovery({ change_target_kind: "job", change_target_id: jobId, amendment_type: "corrigendum",
      extracted: { last_date: addDays(40), total_vacancies: 130 }, changes: { last_date: { from: addDays(22), to: addDays(40), important: true }, total_vacancies: { from: 100, to: 130, important: true } },
      field_evidence: { last_date: "last date … extended", total_vacancies: "130 posts" } });
    await s.q("select apply_discovery_changes($1, array['last_date'], 'Corrigendum: date only; vacancy figure not confirmed')", [d]);
    const ev = await s.q("select field from field_evidence where content_id=$1", [jobId]);
    assert.deepEqual(ev.map((e) => e.field), ["last_date"]);
    const up = await s.q("select changes from official_updates where content_id=$1", [jobId]);
    assert.deepEqual(Object.keys(up[0].changes), ["last_date"], "the public update lists only what the record now says");
  });

  test("approving a new discovery carries its field decisions and evidence onto the draft", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const c = await admin(); const org = (await c.query("select id from organizations limit 1")).rows[0]?.id
      ?? (await c.query("insert into organizations (name, slug, level) values ('Verify Org','verify-org','central') returning id")).rows[0].id; await c.end();
    const d = await discovery({ extracted: { title: "Recruitment of Verifier 2026", advertisement_no: "VER/1", last_date: addDays(30) }, field_evidence: { advertisement_no: "Advt. No. VER/1", last_date: "Last date: …" } });
    await s.q("insert into field_verifications (subject_kind, subject_id, field, status, verified_by) values ('discovery',$1,'advertisement_no','verified',$2)", [d, U.ed]);
    const id = (await s.q("select approve_discovery($1,'job',$2::jsonb,'checked',false,false) as id", [d, JSON.stringify({ ...jobPayload({ title: "Recruitment of Verifier 2026", organization_name: "Verify Org" }), advertisement_no: "VER/1", last_date: addDays(30), organization_id: org })]))[0].id;
    const ev = await s.q("select field from field_evidence where content_id=$1 order by field", [id]);
    assert.deepEqual(ev.map((e) => e.field), ["advertisement_no", "last_date"]);
    const fv = await s.q("select field, status from field_verification_latest where subject_kind='job' and subject_id=$1", [id]);
    assert.deepEqual(fv.map((x) => `${x.field}:${x.status}`), ["advertisement_no:verified"]);
  });
});
