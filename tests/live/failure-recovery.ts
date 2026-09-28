/**
 * PHASE 3.5 — failure recovery (local PostgreSQL + Supabase stand-in). A live record built from the real SSC CHSL 2026
 * notice text (verbatim excerpt, see replay-pilot.ts) is published first; then every failure the spec lists is thrown at the
 * pipeline. After each one the live record must be byte-for-byte unchanged: nothing published, deleted, expired or nulled.
 *
 * The failures are SIMULATED (a scripted fetcher), because they cannot be ordered from a real government site on demand.
 * Run: NODE_OPTIONS=--conditions=react-server npx tsx tests/live/failure-recovery.ts   (DB reset + stub running)
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { runSourceCheck } from "@/lib/ingestion/pipeline";
import type { Fetcher, FetchResult } from "@/lib/ingestion/http";
import { makePdf } from "../fixtures/pdf";
import { Session, U, admin, seedUsers, user } from "../db";
import { CHSL, CHSL_URL, pdf } from "./real-text";

type Spec = { status: number; outcome: FetchResult["outcome"]; body?: Uint8Array; ct?: string; error?: string };
class ScriptedFetcher implements Fetcher {
  constructor(public map: Map<string, Spec>) {}
  async fetch(url: string): Promise<FetchResult> {
    const s = this.map.get(url) ?? { status: 404, outcome: "not_found" };
    const ok = s.outcome === "ok";
    return { ok, status: s.status, outcome: s.outcome, url, finalUrl: url, contentType: s.ct ?? (ok ? "application/pdf" : null), body: ok ? s.body ?? null : null, error: s.error } as FetchResult;
  }
}
const LISTING = "https://ssc.gov.in/notices";
const listingHtml = (links: [string, string][]) => new TextEncoder().encode(`<html><body><ul>${links.map(([h, t]) => `<li><a href="${h}">${t}</a></li>`).join("")}</ul></body></html>`);
const results: { case: string; outcome: string; safe: boolean }[] = [];

async function main() {
  await seedUsers();
  const keys = await (await fetch("http://127.0.0.1:54321/__stub/keys")).json() as { service_role: string };
  const db = createClient("http://127.0.0.1:54321", keys.service_role, { auth: { persistSession: false } });
  const c = await admin();
  const org = (await c.query("insert into organizations (name, slug, level, official_website) values ('Staff Selection Commission','staff-selection-commission','central','https://ssc.gov.in') returning id")).rows[0].id;
  const src = (await c.query(`insert into government_sources (name, organization_id, source_type, authority_rank, official_domain, base_url, recruitment_url, adapter, status, is_synthetic)
    values ('SSC (failure drill)', $1, 'RECRUITMENT_BOARD', 2, 'ssc.gov.in', 'https://ssc.gov.in', $2, 'generic-listing', 'ACTIVE', false) returning id`, [org, LISTING])).rows[0].id;
  await c.end();
  const map = new Map<string, Spec>();
  const f = new ScriptedFetcher(map);
  const run = (onlyUrl?: string) => runSourceCheck(db as never, src, { trigger: "manual", fetcher: f, force: true, onlyUrl });

  // Baseline: real notice discovered, approved, published.
  map.set(LISTING, { status: 200, outcome: "ok", ct: "text/html", body: listingHtml([[CHSL_URL, "Notice of Combined Higher Secondary (10+2) Level Examination, 2026"]]) });
  map.set(CHSL_URL, { status: 200, outcome: "ok", body: pdf(CHSL) });
  await run();
  const s = await Session.open(); const commit = async () => { await s.c.query("commit"); await s.c.query("begin"); await s.as(s.actor); };
  await s.as(user(U.ed));
  const d = (await s.q("select * from discovered_items where item_url=$1", [CHSL_URL]))[0];
  const jobId = (await s.q("select approve_discovery($1,'job',$2::jsonb,'checked',false,true) as id", [d.id, JSON.stringify({ ...d.extracted, organization_id: org, job_type: "permanent", state_slug: "all-india", source_type: "official_notification", mark_source_checked: true })]))[0].id;
  await s.as(user(U.adm)); await s.q("select transition_job($1,'review',null,null)", [jobId]); await s.q("select transition_job($1,'published',null,null)", [jobId]);
  await commit();
  const snap = async () => JSON.stringify((await s.peek("select status, title, last_date, total_vacancies, fee_general, fee_reserved, age_min, age_max, advertisement_no, notification_url, qualification_slugs from jobs where id=$1", [jobId]))[0]);
  const jobsCount = async () => (await s.peek("select count(*)::int n from jobs"))[0].n;
  const before = await snap(); const n0 = await jobsCount();
  const check = async (name: string, act: () => Promise<string>) => {
    const outcome = await act(); await commit();
    const same = (await snap()) === before && (await jobsCount()) === n0;
    const pendingGarbage = (await s.peek("select count(*)::int n from discovered_items where review_status in ('approved') and item_url not in ($1)", [CHSL_URL]))[0].n;
    results.push({ case: name, outcome, safe: same && pendingGarbage === 0 });
    console.log(`${same ? "SAFE" : "UNSAFE"}  ${name}: ${outcome}`);
    assert.ok(same, `${name}: the live record changed`);
  };

  await check("site unavailable (503 on the listing)", async () => { map.set(LISTING, { status: 503, outcome: "server_error", error: "HTTP 503" }); const r = await run(); return `run ${r.status}, errors ${r.errors}`; });
  await check("timeout", async () => { map.set(LISTING, { status: 0, outcome: "timeout", error: "timed out after 20 s" }); const r = await run(); return `run ${r.status}`; });
  await check("403 (access restricted)", async () => {
    map.set(LISTING, { status: 403, outcome: "blocked", error: "HTTP 403 — access restricted" }); const r = await run();
    const st = (await s.peek("select status from government_sources where id=$1", [src]))[0].status; return `run ${r.status}; source → ${st} (not retried automatically)`;
  });
  await (await admin()).query("update government_sources set status='ACTIVE' where id=$1", [src]).catch(() => {});
  const restore = async () => { const a = await admin(); await a.query("update government_sources set status='ACTIVE', failure_count=0 where id=$1", [src]); await a.end(); };
  await restore();
  const OTHER = "https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/other.pdf";
  const listTwo = () => map.set(LISTING, { status: 200, outcome: "ok", ct: "text/html", body: listingHtml([[CHSL_URL, "Notice of Combined Higher Secondary (10+2) Level Examination, 2026"], [OTHER, "Notice of Examination 2026"]]) });
  await check("robots.txt denies a notice", async () => { listTwo(); map.set(OTHER, { status: 0, outcome: "blocked", error: "robots.txt disallows this URL for our crawler" }); const r = await run(); return `run ${r.status}, rejected ${r.rejected}`; });
  await check("PDF unavailable (404)", async () => { listTwo(); map.set(OTHER, { status: 404, outcome: "not_found", error: "HTTP 404" }); const r = await run(); return `run ${r.status}, errors ${r.errors}`; });
  await check("malformed PDF", async () => { listTwo(); map.set(OTHER, { status: 200, outcome: "ok", body: new TextEncoder().encode("%PDF-1.4\n%%garbage-not-a-pdf") }); const r = await run(); return `run ${r.status}: ${r.log.find((l) => /could not read/.test(l.msg))?.msg.slice(0, 90) ?? "?"}`; });
  await check("duplicate notice (same notice at a second URL)", async () => {
    listTwo(); map.set(OTHER, { status: 200, outcome: "ok", body: pdf(CHSL) }); const r = await run();
    const q = (await s.peek("select change_target_id, review_status from discovered_items where item_url=$1", [OTHER]));
    return `run ${r.status}, created ${r.created}, unchanged ${r.unchanged}; second URL queued as new job: ${q.some((x) => !x.change_target_id && x.review_status === "pending") ? "YES" : "no"}`;
  });
  await check("changed URL (notice moved, same content)", async () => {
    const MOVED = "https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_chsle_2026_v2.pdf";
    map.set(LISTING, { status: 200, outcome: "ok", ct: "text/html", body: listingHtml([[MOVED, "Notice of Combined Higher Secondary (10+2) Level Examination, 2026"]]) }); map.set(MOVED, { status: 200, outcome: "ok", body: pdf(CHSL) });
    const r = await run(); const q = await s.peek("select review_status, change_target_id is not null linked from discovered_items where item_url like '%_v2.pdf'"); return `run ${r.status}, created ${r.created}, unchanged ${r.unchanged}; queued: ${JSON.stringify(q)}; log: ${r.log.slice(-1)[0]?.msg.slice(0, 80)}`;
  });
  await check("source redesign (listing now has no notice links)", async () => {
    map.set(LISTING, { status: 200, outcome: "ok", ct: "text/html", body: new TextEncoder().encode("<html><body><div id=app></div><script src=/main.js></script></body></html>") });
    const r = await run(); return `run ${r.status}: ${r.log.find((l) => /redesigned/.test(l.msg)) ? "flagged 'may have been redesigned'" : "NOT flagged"}`;
  });
  await check("notice re-issued with fields missing (must not null anything)", async () => {
    const thin = CHSL.filter((l) => !/Fee|fee|Age limit|Vacancies|vacancies|Pay Level/.test(l));
    map.set(LISTING, { status: 200, outcome: "ok", ct: "text/html", body: listingHtml([[CHSL_URL, "Notice of Combined Higher Secondary (10+2) Level Examination, 2026"]]) }); map.set(CHSL_URL, { status: 200, outcome: "ok", body: pdf(thin) });
    const r = await run(); const d2 = (await s.peek("select changes from discovered_items where item_url=$1 order by discovered_at desc limit 1", [CHSL_URL]))[0];
    const nulling = Object.entries(d2?.changes ?? {}).filter(([, v]) => (v as { to: unknown }).to == null);
    assert.equal(nulling.length, 0); return `run ${r.status}; proposed changes ${JSON.stringify(Object.keys(d2?.changes ?? {}))}; none set a field to empty`;
  });
  await check("empty page (HTTP 200, no content)", async () => {
    map.set(LISTING, { status: 200, outcome: "ok", ct: "text/html", body: new Uint8Array() });
    const r = await run(); return `run ${r.status}; ${r.log.slice(-1)[0]?.msg.slice(0, 90)}`;
  });
  await check("server error on the notice only (HTTP 500)", async () => {
    listTwo(); map.set(OTHER, { status: 500, outcome: "server_error", error: "HTTP 500" });
    const r = await run(); return `run ${r.status}, errors ${r.errors}`;
  });
  await check("temporary outage (3 × 503) then recovery", async () => {
    map.set(LISTING, { status: 503, outcome: "server_error", error: "HTTP 503" });
    for (let i = 0; i < 3; i++) await run();
    const down = (await s.peek("select status, failure_count from government_sources where id=$1", [src]))[0];
    map.set(LISTING, { status: 200, outcome: "ok", ct: "text/html", body: listingHtml([[CHSL_URL, "Notice of Combined Higher Secondary (10+2) Level Examination, 2026"]]) }); map.set(CHSL_URL, { status: 200, outcome: "ok", body: pdf(CHSL) });
    const r = await run();
    const up = (await s.peek("select status, failure_count from government_sources where id=$1", [src]))[0];
    assert.equal(up.failure_count, 0, "a successful check resets the failure counter");
    return `after outage: ${down.status} (${down.failure_count} failures) → after recovery: ${up.status} (${up.failure_count}); run ${r.status}`;
  });
  await check("expiry cron after all of the above", async () => { const a = await admin(); const n = (await a.query("select expire_overdue_jobs('2026-09-25'::date) n")).rows[0].n; await a.end(); return `expired ${n} (last date 2026-10-07 is still open)`; });
  await Session.closeAll();
  console.log(`\nFAILURE DRILL: ${results.filter((r) => r.safe).length}/${results.length} safe`);
  process.exit(results.some((r) => !r.safe) ? 1 : 0);
}
void makePdf;
main().catch((e) => { console.error("DRILL FAILED:", e); process.exit(1); });
