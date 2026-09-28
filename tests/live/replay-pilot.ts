/**
 * PHASE 3.5 — REAL-TEXT REPLAY through the whole chain (local PostgreSQL + Supabase stand-in; NOT real Supabase).
 *
 *   Source → Discovery ("check a single notice URL") → Extraction → Review queue → Approval (editor) → Publish (admin)
 *   → Public read (anon) → Change detection → Apply change (admin, with reason) → Version + audit → Expiry → Amendment safety
 *
 * The TEXT of every document below is copied verbatim from the official PDF read in the Phase 3.5 live pilot
 * (ssc.gov.in, 25 Sep 2026; see docs/pilot/notices.jsonl). The build sandbox cannot reach government hosts, so the bytes are
 * re-typeset into a PDF with the test PDF writer; the pipeline then reads them exactly as it would read the original.
 * Excerpts are marked as excerpts. The ONE simulated input is labelled SIMULATED: a deadline extension used to exercise the
 * change mechanics, because no real corrigendum for an open notice was captured.
 *
 * Run: npm run db:start && npm run db:reset && (npx tsx tests/harness/supabase-stub.ts &) && \
 *      NODE_OPTIONS=--conditions=react-server npx tsx tests/live/replay-pilot.ts
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { runSourceCheck } from "@/lib/ingestion/pipeline";
import type { Fetcher, FetchResult } from "@/lib/ingestion/http";
import { ANON, Session, U, admin, seedUsers, user } from "../db";

import { CHSL, CHSL_SIMULATED_EXTENSION, CHSL_URL, JE_ADD, JE_ADD_URL, JE_HEAD, JE_URL, STENO_CORR, STENO_CORR_URL, pdf } from "./real-text";

class ReplayFetcher implements Fetcher {
  constructor(public docs: Map<string, Uint8Array>) {}
  async fetch(url: string): Promise<FetchResult> {
    const body = this.docs.get(url);
    if (!body) return { ok: false, status: 404, outcome: "not_found", url, finalUrl: url, contentType: null, body: null, error: "not captured" } as unknown as FetchResult;
    return { ok: true, status: 200, outcome: "ok", url, finalUrl: url, contentType: "application/pdf", body } as unknown as FetchResult;
  }
}

const log: string[] = [];
const step = (m: string) => { log.push(m); console.log("•", m); };
const T: Record<string, number> = {}; const mark = (k: string) => { T[k] = Date.now(); };

async function main() {
  await seedUsers();
  const keys = await (await fetch("http://127.0.0.1:54321/__stub/keys")).json() as { service_role: string };
  const db = createClient("http://127.0.0.1:54321", keys.service_role, { auth: { persistSession: false } });
  const c = await admin();
  const org = (await c.query("insert into organizations (name, slug, level, official_website) values ('Staff Selection Commission','staff-selection-commission','central','https://ssc.gov.in') returning id")).rows[0].id as string;
  const srcId = (await c.query(`insert into government_sources (name, organization_id, source_type, authority_rank, official_domain, base_url, recruitment_url, adapter, status, is_synthetic, notes)
    values ('Staff Selection Commission — notice board (replay)', $1, 'RECRUITMENT_BOARD', 2, 'ssc.gov.in', 'https://ssc.gov.in', 'https://ssc.gov.in/home/notice-board', 'generic-listing', 'REVIEW_REQUIRED', false,
            'Phase 3.5 replay of verbatim official text; listing is JavaScript-driven so notices are checked one URL at a time') returning id`, [org])).rows[0].id as string;
  await c.end();
  const docs = new Map<string, Uint8Array>([[CHSL_URL, pdf(CHSL)], [STENO_CORR_URL, pdf(STENO_CORR)], [JE_URL, pdf(JE_HEAD)], [JE_ADD_URL, pdf(JE_ADD)]]);
  const fetcher = new ReplayFetcher(docs);
  const check = (url: string) => runSourceCheck(db as never, srcId, { trigger: "test", fetcher, onlyUrl: url, force: true });
  const s = await Session.open();
  // The pipeline writes through the Supabase stand-in on other connections: commit between steps so it sees (and is not
  // blocked by) what the reviewer just did.
  const commit = async () => { await s.c.query("commit"); await s.c.query("begin"); await s.as(s.actor); };

  // 1. Discovery + extraction
  mark("t0"); const r1 = await check(CHSL_URL); mark("discovered");
  assert.equal(r1.created, 1, JSON.stringify(r1.log));
  await s.as(user(U.ed));
  const d1 = (await s.q("select * from discovered_items where item_url=$1", [CHSL_URL]))[0];
  const x = d1.extracted as Record<string, unknown>;
  step(`CHSL discovered: confidence ${d1.confidence} (${d1.confidence_score}); fields ${JSON.stringify(x)}`);
  const truth: Record<string, unknown> = { advertisement_no: "HQ-C1102/5/2026-C-1", application_start_date: "2026-09-07", last_date: "2026-10-07", total_vacancies: 2536,
    age_min: 18, age_max: 27, pay_level: "Level 2", fee_general: "Rs. 100", fee_reserved: "Nil (exempted)" };
  const fieldResults = Object.entries(truth).map(([k, v]) => ({ k, ok: JSON.stringify(x[k]) === JSON.stringify(v), got: x[k], want: v }));
  for (const f of fieldResults) step(`  ${f.ok ? "OK  " : "MISS"} ${f.k}: got ${JSON.stringify(f.got)} · official ${JSON.stringify(f.want)}`);
  assert.equal(s.constructor.name, "Session");

  // 2. Approval (editor) → draft; publish (admin)
  const payload = { ...x, organization_id: org, job_type: "permanent", department_slug: null, state_slug: "all-india", source_name: "Staff Selection Commission",
    source_type: "official_notification", qualification_slugs: ["12th-pass"], mark_source_checked: true };
  const jobId = (await s.q("select approve_discovery($1,'job',$2::jsonb,'Compared with the official PDF (ssc.gov.in) on 25 Sep 2026',false,true) as id", [d1.id, JSON.stringify(payload)]))[0].id as string;
  mark("approved");
  step(`approved by editor → job ${jobId} (draft)`);
  await s.as(ANON);
  assert.equal((await s.q("select id from jobs where id=$1", [jobId])).length, 0, "draft is not public");
  await s.as(user(U.adm));
  await s.q("select transition_job($1,'review',null,null)", [jobId]); await s.q("select transition_job($1,'published',null,null)", [jobId]);
  mark("published");
  await s.as(ANON);
  const pub = (await s.q("select title, to_char(last_date,'YYYY-MM-DD') last_date, source_url, notification_url, source_checked_at from jobs where id=$1", [jobId]))[0];
  assert.ok(pub, "published job is public"); assert.equal(String(pub.last_date).slice(0, 10), "2026-10-07");
  step(`published by admin; anon reads it: last_date ${String(pub.last_date).slice(0, 10)}, official source ${pub.notification_url}, source checked ${pub.source_checked_at ? "yes" : "no"}`);

  // 3. SIMULATED deadline extension → change detection → public unchanged until applied
  await commit();
  docs.set(CHSL_URL, pdf(CHSL_SIMULATED_EXTENSION));
  mark("changed_at_source"); const r2 = await check(CHSL_URL); mark("change_detected");
  await s.as(user(U.ed));
  const d2 = (await s.q("select * from discovered_items where item_url=$1 order by discovered_at desc limit 1", [CHSL_URL]))[0];
  assert.ok(d2.changes && d2.changes.last_date, `change detected: ${JSON.stringify(d2.changes)} / run ${JSON.stringify(r2.log.slice(-3))}`);
  step(`SIMULATED extension detected as a change on the live record: ${JSON.stringify(d2.changes)}`);
  await s.as(ANON);
  assert.equal((await s.q("select to_char(last_date,'YYYY-MM-DD') d from jobs where id=$1", [jobId]))[0].d, "2026-10-07", "public page unchanged before approval");
  step("public record still shows 07.10.2026 before anyone approves");
  await s.as(user(U.adm));
  await s.q("select apply_discovery_changes($1, array['last_date'], 'SSC corrigendum extends the last date (SIMULATED for the replay)')", [d2.id]);
  mark("change_applied");
  await s.as(ANON);
  assert.equal((await s.q("select to_char(last_date,'YYYY-MM-DD') d from jobs where id=$1", [jobId]))[0].d, "2026-10-14"); mark("public_updated");
  const v = await s.peek("select version, changes, important_changes, reason, source from content_versions where content_id=$1 order by version", [jobId]);
  assert.ok(v.length >= 2 && JSON.stringify(v[v.length - 1].changes).includes("last_date"), JSON.stringify(v));
  const audit = await s.peek("select count(*)::int n from audit_logs where entity='jobs' and entity_id=$1", [jobId]);
  step(`applied by admin with a reason → public shows 14.10.2026; versions ${v.map((r) => r.version).join(",")} (latest: ${JSON.stringify(v[v.length - 1].changes)}, reason "${v[v.length - 1].reason}", source ${v[v.length - 1].source}); audit rows ${audit[0].n}`);

  await commit();
  // 4. Expiry uses the updated date: on 10 Oct 2026 the job stays live (old date would have expired it); on 15 Oct it expires.
  const c2 = await admin();
  assert.equal((await c2.query("select expire_overdue_jobs('2026-10-10'::date) n")).rows[0].n, 0);
  assert.equal((await c2.query("select status from jobs where id=$1", [jobId])).rows[0].status, "updated");
  const n15 = (await c2.query("select expire_overdue_jobs('2026-10-15'::date) n")).rows[0].n;
  assert.equal((await c2.query("select status from jobs where id=$1", [jobId])).rows[0].status, "expired"); await c2.end();
  step(`expiry follows the updated date: 10 Oct → still live; 15 Oct → expired (${n15} job)`);

  // 5. Amendments: date-change corrigendum reaches review; JE addendum never proposes overwriting unrelated fields
  const r3 = await check(STENO_CORR_URL);
  await s.as(user(U.ed));
  const d3 = (await s.q("select suggested_kind, confidence, validation_issues from discovered_items where item_url=$1", [STENO_CORR_URL]))[0];
  assert.ok(d3, `corrigendum kept for review (run: ${JSON.stringify(r3.log.slice(-2))})`);
  step(`Steno date corrigendum → review queue as ${d3.suggested_kind} / ${d3.confidence}; issues: ${JSON.stringify(d3.validation_issues).slice(0, 160)}`);
  await commit();
  await check(JE_URL);
  const dj = (await s.q("select * from discovered_items where item_url=$1", [JE_URL]))[0];
  const jeId = (await s.q("select approve_discovery($1,'job',$2::jsonb,'Compared with the official PDF',false,true) as id",
    [dj.id, JSON.stringify({ ...dj.extracted, organization_id: org, job_type: "permanent", state_slug: "all-india", source_name: "Staff Selection Commission", source_type: "official_notification", qualification_slugs: ["diploma", "engineering"], mark_source_checked: true })]))[0].id;
  await s.as(user(U.adm)); await s.q("select transition_job($1,'review',null,null)", [jeId]);
  const gate = await s.fails("select transition_job($1,'published',null,null)", [jeId]);
  assert.match(gate ?? "", /last date .* is in the past/);
  step(`JE 2026 (closed 22.09.2026) → publish refused by the database gate: "${(gate ?? "").trim().slice(0, 90)}" — kept in review`);
  await commit();
  await check(JE_ADD_URL);
  await s.as(user(U.ed));
  const da = (await s.q("select * from discovered_items where item_url=$1", [JE_ADD_URL]))[0];
  assert.equal(da.change_target_id, jeId, "the addendum is linked to the JE record, not queued as a new job");
  const proposed = Object.keys(da.changes ?? {});
  for (const k of ["title", "notification_url", "source_url", "qualification_slugs"]) assert.ok(!proposed.includes(k), `addendum must not propose ${k}: ${proposed}`);
  step(`JE addendum linked to JE 2026 via F. No. (${dj.extracted.advertisement_no}); proposed changes: ${JSON.stringify(proposed)} — title, PDF link and qualification list untouched`);
  const je = (await s.peek("select title, notification_url, qualification_slugs from jobs where id=$1", [jeId]))[0];
  assert.equal(je.notification_url, JE_URL);
  await Session.closeAll();
  step(`fields: ${fieldResults.filter((f) => f.ok).length}/${fieldResults.length} of the checked CHSL fields match the official notice`);
  const d = (a: string, b: string) => `${T[b] - T[a]} ms`;
  step(`system latency (no human wait): fetch+extract+queue ${d("t0", "discovered")} · approve ${d("discovered", "approved")} · publish ${d("approved", "published")} · change detection ${d("changed_at_source", "change_detected")} · apply ${d("change_detected", "change_applied")} · public read ${d("change_applied", "public_updated")}`);
  console.log("\nREPLAY OK");
  process.exit(0);
}
main().catch((e) => { console.error("REPLAY FAILED:", e); process.exit(1); });
