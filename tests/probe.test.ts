/**
 * Server-side source probe (Phase 3.7 items 8–10). Synthetic pages served by an in-memory fetcher; database = local
 * PostgreSQL through the local Supabase API stand-in (NOT real Supabase, NOT a deployment, NOT a government site).
 * Verifies every verdict path — especially that protection (robots refusal, 403, CAPTCHA) ends in BLOCKED after a single
 * request and is never retried or worked around. Run with: npm run test:contract
 */
import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SERVICE_KEY } from "./harness/keys";
import { ANON, Session, U, admin, seedUsers, user } from "./db";
import { makePdf } from "./fixtures/pdf";
import type { FetchResult, Fetcher } from "../src/lib/ingestion/http";
import { markdownTable, tableRow } from "../src/lib/ingestion/probe-report";

const B = "https://probe.example.gov.in";
let db: SupabaseClient;
const res = (url: string, body: Uint8Array | string, contentType: string, status = 200): FetchResult => ({
  ok: status < 400, outcome: status < 400 ? "ok" : status === 403 ? "client_error" : status >= 500 ? "server_error" : "not_found", url, finalUrl: url, status, contentType, redirected: false, ms: 3,
  body: typeof body === "string" ? new TextEncoder().encode(body) : body, error: status < 400 ? undefined : `HTTP ${status}`,
});
class MapFetcher implements Fetcher {
  calls: string[] = [];
  constructor(private pages: Record<string, FetchResult>) {}
  async fetch(url: string) { this.calls.push(url); return this.pages[url] ?? res(url, "", "text/html", 404); }
}
const listingOf = (slug: string) => `${B}/${slug}/notices`;
const ROBOTS_OK = { [`${B}/robots.txt`]: res(`${B}/robots.txt`, "User-agent: *\nDisallow: /private/\n", "text/plain") };

async function source(slug: string, adapter = "pdf-index", config: Record<string, unknown> = {}) {
  const c = await admin();
  const org = (await c.query("insert into organizations (name, slug, level) values ('Probe Test Board','probe-test-board','central') on conflict (slug) do update set name=excluded.name returning id")).rows[0].id;
  await c.query("delete from government_sources where slug=$1", [slug]);
  const id = (await c.query(`insert into government_sources (slug, name, organization_id, source_type, official_domain, base_url, recruitment_url, adapter, adapter_config, status)
    values ($1, $1, $2, 'RECRUITMENT_BOARD', 'probe.example.gov.in', $3, $4, $5, $6, 'ACTIVE') returning id`, [slug, org, `${B}/`, listingOf(slug), adapter, JSON.stringify(config)])).rows[0].id;
  await c.end();
  return id as string;
}
const probe = async (id: string, f: Fetcher) => (await import("../src/lib/ingestion/probe")).probeSource(db, id, { fetcher: f, runtime: "local test" });

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  db = createClient("http://127.0.0.1:54321", SERVICE_KEY, { auth: { persistSession: false } });
  await seedUsers();
});

describe("probe verdicts", () => {
  test("robots.txt answering 403 → BLOCKED after one request; the listing is never requested", async () => {
    const id = await source("probe-robots-403");
    const f = new MapFetcher({ [`${B}/robots.txt`]: res(`${B}/robots.txt`, "Forbidden", "text/html", 403) });
    const p = await probe(id, f);
    assert.equal(p.verdict, "BLOCKED"); assert.equal(p.robots_outcome, "refused");
    assert.deepEqual(f.calls, [`${B}/robots.txt`], "no second request, no retry");
  });
  test("robots.txt disallowing the listing → BLOCKED", async () => {
    const id = await source("probe-robots-dis");
    const f = new MapFetcher({ [`${B}/robots.txt`]: res(`${B}/robots.txt`, "User-agent: *\nDisallow: /probe-robots-dis/\n", "text/plain") });
    const p = await probe(id, f);
    assert.equal(p.verdict, "BLOCKED"); assert.equal(p.robots_outcome, "disallowed"); assert.equal(f.calls.length, 1);
  });
  test("HTTP 403 on the listing → BLOCKED, not retried", async () => {
    const id = await source("probe-403");
    const f = new MapFetcher({ ...ROBOTS_OK, [listingOf("probe-403")]: res(listingOf("probe-403"), "Forbidden", "text/html", 403) });
    const p = await probe(id, f);
    assert.equal(p.verdict, "BLOCKED"); assert.equal(p.http_status, 403);
    assert.equal(f.calls.filter((u) => u === listingOf("probe-403")).length, 1);
  });
  test("a CAPTCHA / anti-bot page served with 200 → BLOCKED", async () => {
    const id = await source("probe-captcha");
    const f = new MapFetcher({ ...ROBOTS_OK, [listingOf("probe-captcha")]: res(listingOf("probe-captcha"), "<html><head><title>Attention Required! | Cloudflare</title></head><body>Please complete the captcha to continue.</body></html>", "text/html") });
    const p = await probe(id, f);
    assert.equal(p.verdict, "BLOCKED"); assert.match(p.notes!, /anti-bot|CAPTCHA/);
  });
  test("a JavaScript-rendered listing → MANUAL", async () => {
    const id = await source("probe-js");
    const f = new MapFetcher({ ...ROBOTS_OK, [listingOf("probe-js")]: res(listingOf("probe-js"), "<html><body><div id=root></div><script src=/app.js></script></body></html>", "text/html") });
    const p = await probe(id, f);
    assert.equal(p.verdict, "MANUAL"); assert.equal(p.discovered, 0); assert.match(p.notes!, /JavaScript/);
  });
  test("a site that is down → FAILED (robots unreachable), not BLOCKED", async () => {
    const id = await source("probe-down");
    const f = new MapFetcher({ [`${B}/robots.txt`]: res(`${B}/robots.txt`, "", "text/html", 503) });
    const p = await probe(id, f);
    assert.equal(p.verdict, "FAILED"); assert.equal(p.robots_outcome, "unreachable");
  });
  test("a scanned PDF notice → MANUAL", async () => {
    const id = await source("probe-scan");
    const pdf = `${B}/n/scan.pdf`;
    const f = new MapFetcher({ ...ROBOTS_OK,
      [listingOf("probe-scan")]: res(listingOf("probe-scan"), `<html><body><a href="${pdf}">Recruitment of Stenographer Grade C - Advt. No. 3/2026</a></body></html>`, "text/html"),
      [pdf]: res(pdf, makePdf(["Advt 3/2026"]), "application/pdf") });
    const p = await probe(id, f);
    assert.equal(p.verdict, "MANUAL"); assert.match(p.notes!, /scanned/); assert.equal(p.notice_url, pdf);
  });
  test("a readable notice → PASS, with the extraction summary recorded; no robots file (404) is allowed", async () => {
    const id = await source("probe-ok");
    const pdf = `${B}/n/ok.pdf`;
    const f = new MapFetcher({
      [listingOf("probe-ok")]: res(listingOf("probe-ok"), `<html><body><a href="${pdf}">Recruitment of Junior Assistant 2026 - Advt. No. 07/2026</a></body></html>`, "text/html"),
      [pdf]: res(pdf, makePdf(["SYNTHETIC TEST DOCUMENT - NOT A REAL GOVERNMENT NOTICE", "Probe Test Board", "Recruitment of Junior Assistant 2026", "Advertisement No. 07/2026",
        "Total vacancies: 45", "Online application starts: 01/11/2026", "Last date for online application: 30/11/2026", "Age limit: 18 to 27 years",
        "Educational qualification: Graduate from a recognised university", "Application fee: Rs. 500 for General candidates", ...Array(10).fill("Candidates must read the instructions carefully before applying online.")]), "application/pdf") });
    const p = await probe(id, f);
    assert.equal(p.robots_outcome, "no_file");
    assert.equal(p.verdict, "PASS", `${p.notes} ${JSON.stringify(p.extraction)}`);
    assert.equal(p.discovered, 1);
    const ex = p.extraction as { fieldsFound: string[]; kind: string };
    assert.equal(ex.kind, "job"); assert.ok(ex.fieldsFound.includes("last_date") && ex.fieldsFound.includes("advertisement_no"), ex.fieldsFound.join());
    const stored = (await db.from("source_probes").select("verdict,runtime,http_status,duration_ms").eq("source_id", id).single()).data!;
    assert.deepEqual([stored.verdict, stored.runtime, stored.http_status, stored.duration_ms], ["PASS", "local test", 200, 3]);
    const q = (await db.from("discovered_items").select("id").eq("source_id", id)).data!;
    assert.equal(q.length, 0, "the probe never queues anything for review");
  });
});

describe("probe table and access", () => {
  test("the table maps verdicts to column states and flags non-deployment runs", () => {
    const base = { source_id: "x", runtime: "local test", robots_status: 200, fetch_outcome: "ok", redirected: false, content_type: "text/html", duration_ms: 10, notice_url: null, error: null };
    const blocked = tableRow("A", { ...base, robots_outcome: "allowed", http_status: 403, discovered: null, verdict: "BLOCKED", notes: "HTTP 403" }, undefined);
    assert.deepEqual([blocked.server, blocked.robots, blocked.discovery, blocked.extraction], ["BLOCKED", "PASS", "UNKNOWN", "UNKNOWN"]);
    const pass = tableRow("B", { ...base, runtime: "vercel preview bom1", robots_outcome: "no_file", http_status: 200, discovered: 4, notice_url: "u", verdict: "PASS WITH ADAPTER", notes: "" }, { discovered: 3, pending: 1, published: 2 });
    assert.deepEqual([pass.server, pass.discovery, pass.extraction, pass.review, pass.publish, pass.deployed], ["PASS", "PASS WITH ADAPTER", "PASS WITH ADAPTER", "PASS", "PASS", true]);
    const none = tableRow("C", null, undefined);
    assert.equal(none.server, "UNKNOWN");
    const md = markdownTable([blocked, pass, none]);
    assert.match(md, /^\| Source \| Server Access \| Robots \| Discovery \| Extraction \| Review \| Publish \| Notes \|/);
    assert.match(md, /1 of 3 probe result\(s\) did not come from a deployment/);
  });
  test("probe results are readable by staff only and cannot be written from a browser session", async () => {
    const s = await Session.open();
    await s.as(ANON); assert.ok(await s.fails("select * from source_probes"));
    await s.as(user(U.plain)); assert.equal((await s.q("select count(*)::int n from source_probes"))[0].n, 0);
    await s.as(user(U.mod)); assert.ok((await s.q("select count(*)::int n from source_probes"))[0].n > 0);
    for (const who of [U.mod, U.sa]) {
      await s.as(user(who));
      assert.ok(await s.fails("insert into source_probes (source_id, runtime, request_url, verdict) select id, 'forged', 'https://x', 'PASS' from government_sources limit 1"), "insert refused");
      assert.ok(await s.fails("update source_probes set verdict='PASS'") || (await s.q("select count(*)::int n from source_probes where verdict='PASS' and runtime='forged'"))[0].n === 0);
      assert.ok(await s.fails("delete from source_probes"));
    }
    await Session.closeAll();
  });
  test("probeNextSources probes least-recently-probed first and skips synthetic sources", async () => {
    const { probeNextSources } = await import("../src/lib/ingestion/probe");
    const c = await admin();
    await c.query("update government_sources set status='ARCHIVED' where slug not like 'probe-%'");
    const syn = await source("probe-synth"); await c.query("update government_sources set is_synthetic=true where id=$1", [syn]);
    const fresh = await source("probe-fresh");
    await c.end();
    const f = new MapFetcher({ [`${B}/robots.txt`]: res(`${B}/robots.txt`, "", "text/html", 403) });
    delete process.env.ALLOW_PRIVATE_SOURCE_HOSTS;
    const rows = await probeNextSources(db, { limit: 1, fetcher: f });
    assert.equal(rows.length, 1); assert.equal(rows[0].source_id, fresh, "never-probed first");
    const all = await probeNextSources(db, { limit: 10, fetcher: f });
    assert.ok(!all.some((r) => r.source_id === syn), "synthetic sources are not probed");
  });
});
