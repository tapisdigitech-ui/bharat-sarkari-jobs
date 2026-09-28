/**
 * The generic pipeline driving each adapter end to end (Phase 3.6 item 9): listing → discover → identifyNotification (two
 * hops) → extract → amendment type → review queue. Synthetic pages served by an in-memory fetcher; database = local
 * PostgreSQL through the local Supabase API stand-in (NOT real Supabase). Run with: npm run test:contract
 */
import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SERVICE_KEY } from "./harness/keys";
import { admin } from "./db";
import { makePdf } from "./fixtures/pdf";
import type { FetchResult, Fetcher } from "../src/lib/ingestion/http";

const B = "https://pipe.example.gov.in";
let db: SupabaseClient;
const res = (url: string, body: Uint8Array | string, contentType: string, status = 200): FetchResult => ({
  ok: status < 400, outcome: status < 400 ? "ok" : "not_found", url, finalUrl: url, status, contentType, redirected: false, ms: 1,
  body: typeof body === "string" ? new TextEncoder().encode(body) : body, error: status < 400 ? undefined : `HTTP ${status}`,
});
class MapFetcher implements Fetcher {
  calls: string[] = [];
  constructor(private pages: Record<string, FetchResult>) {}
  async fetch(url: string) { this.calls.push(url); return this.pages[url] ?? res(url, "", "text/html", 404); }
}
const notice = (lines: string[]) => makePdf(["SYNTHETIC TEST DOCUMENT - NOT A REAL GOVERNMENT NOTICE", ...lines]);

async function source(slug: string, adapter: string, config: Record<string, unknown>, listing = `${B}/${slug}/notices`) {
  const c = await admin();
  const org = (await c.query("insert into organizations (name, slug, level) values ('Pipeline Test Board','pipeline-test-board','central') on conflict (slug) do update set name=excluded.name returning id")).rows[0].id;
  await c.query("delete from discovered_items where source_id in (select id from government_sources where slug=$1)", [slug]);
  await c.query("delete from source_documents where source_id in (select id from government_sources where slug=$1)", [slug]);
  await c.query("delete from ingestion_runs where source_id in (select id from government_sources where slug=$1)", [slug]);
  await c.query("delete from government_sources where slug=$1", [slug]);
  const id = (await c.query(`insert into government_sources (slug, name, organization_id, source_type, official_domain, base_url, recruitment_url, adapter, adapter_config, status)
    values ($1, $1, $2, 'RECRUITMENT_BOARD', 'pipe.example.gov.in', $3, $4, $5, $6, 'ACTIVE') returning id`, [slug, org, `${B}/`, listing, adapter, JSON.stringify(config)])).rows[0].id;
  await c.end();
  return id as string;
}
const items = async (sourceId: string) => (await db.from("discovered_items").select("title,item_url,suggested_kind,amendment_type,external_id,group_key,validation_issues").eq("source_id", sourceId).order("discovered_at")).data ?? [];

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  db = createClient("http://127.0.0.1:54321", SERVICE_KEY, { auth: { persistSession: false } });
});

describe("pipeline × adapters (local stand-in)", () => {
  test("detail-page: listing → notice page → official PDF; the PDF is what gets read and queued", async () => {
    const { runSourceCheck } = await import("../src/lib/ingestion/pipeline");
    const id = await source("pipe-detail", "detail-page", { detailPdfInclude: "notice" });
    const f = new MapFetcher({
      [`${B}/pipe-detail/notices`]: res(`${B}/pipe-detail/notices`, `<html><body><ul><li><a href="${B}/exam/ese-2027">Engineering Services Examination 2027 - Notification</a></li></ul></body></html>`, "text/html"),
      [`${B}/exam/ese-2027`]: res(`${B}/exam/ese-2027`, `<html><body><h1>Engineering Services Examination 2027</h1><a href="${B}/files/ese-2027-notice.pdf">Notice (1.54 MB)</a></body></html>`, "text/html"),
      [`${B}/files/ese-2027-notice.pdf`]: res(`${B}/files/ese-2027-notice.pdf`, notice(["Engineering Services Examination 2027", "Advt. No. 05/2027-ESE", "Last date of online application: 20/10/2026"]), "application/pdf"),
    });
    const sum = await runSourceCheck(db, id, { trigger: "test", fetcher: f, force: true });
    assert.equal(sum.discovered, 1, JSON.stringify(sum.log));
    const [it] = await items(id);
    assert.equal(it.item_url, `${B}/files/ese-2027-notice.pdf`);
    assert.ok(sum.log.some((l) => /Followed .* → /.test(l.msg)));
  });

  test("an amendment is queued with its type (corrigendum chain input)", async () => {
    const { runSourceCheck } = await import("../src/lib/ingestion/pipeline");
    const id = await source("pipe-amend", "pdf-index", {});
    const f = new MapFetcher({
      [`${B}/pipe-amend/notices`]: res(`${B}/pipe-amend/notices`, `<html><body><a href="${B}/n/ext.pdf">Extension of last date - Advt. No. 09/2026 Stenographer recruitment</a></body></html>`, "text/html"),
      [`${B}/n/ext.pdf`]: res(`${B}/n/ext.pdf`, notice(["Extension of last date for Advt. No. 09/2026", "The last date for submission of online applications has been extended up to 18/11/2026."]), "application/pdf"),
    });
    await runSourceCheck(db, id, { trigger: "test", fetcher: f, force: true });
    const [it] = await items(id);
    assert.equal(it?.amendment_type, "extension");
  });

  test("json-feed is refused (no fetch at all) until the terms are reviewed", async () => {
    const { runSourceCheck } = await import("../src/lib/ingestion/pipeline");
    const feed = { url: `${B}/api/notices`, title: "headline", link: "attachments[].path", id: "id", group: "examId", linkPrefix: `${B}/api/attachment/` };
    const id = await source("pipe-feed", "json-feed", { feed });
    const f = new MapFetcher({});
    const sum = await runSourceCheck(db, id, { trigger: "test", fetcher: f });
    assert.equal(sum.status, "skipped");
    assert.deepEqual(f.calls, []);
    assert.ok(sum.log.some((l) => /terms/.test(l.msg)));
  });

  test("json-feed after review: items keep the source's id and grouping key", async () => {
    const { runSourceCheck } = await import("../src/lib/ingestion/pipeline");
    const feed = { url: `${B}/api/notices`, title: "headline", link: "attachments[].path", id: "id", group: "examId", linkPrefix: `${B}/api/attachment/` };
    const id = await source("pipe-feed2", "json-feed", { feed, termsReviewed: true });
    const f = new MapFetcher({
      [`${B}/api/notices`]: res(`${B}/api/notices`, JSON.stringify({ data: [{ id: 9, headline: "Notice of Selection Post Recruitment 2027", examId: 77, attachments: [{ path: "sp.pdf" }] }] }), "application/json"),
      [`${B}/api/attachment/sp.pdf`]: res(`${B}/api/attachment/sp.pdf`, notice(["Selection Post Recruitment 2027", "Advt. No. SP/2027/01", "Last date of online application: 30/10/2026"]), "application/pdf"),
    });
    const sum = await runSourceCheck(db, id, { trigger: "test", fetcher: f, force: true });
    assert.equal(sum.discovered, 1, JSON.stringify(sum.log));
    const [it] = await items(id);
    assert.equal(it.external_id, "9"); assert.equal(it.group_key, "77");
  });

  test("organization check: another body's circular is flagged in the review queue", async () => {
    const { runSourceCheck } = await import("../src/lib/ingestion/pipeline");
    const id = await source("pipe-org", "pdf-index", { expectOrganization: "Pipeline Test Board" });
    const f = new MapFetcher({
      [`${B}/pipe-org/notices`]: res(`${B}/pipe-org/notices`, `<html><body><a href="${B}/n/other.pdf">Recruitment notice of another court - Court Assistant</a></body></html>`, "text/html"),
      [`${B}/n/other.pdf`]: res(`${B}/n/other.pdf`, notice(["SOME OTHER HIGH COURT", "Recruitment of Court Assistant 2026", "Last date of application: 30/11/2026"]), "application/pdf"),
    });
    await runSourceCheck(db, id, { trigger: "test", fetcher: f, force: true });
    const [it] = await items(id);
    assert.ok((it?.validation_issues as string[]).some((i) => /expected organization/.test(i)), JSON.stringify(it));
  });
});
