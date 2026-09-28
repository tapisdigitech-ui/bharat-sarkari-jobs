/**
 * SERVER-SIDE SOURCE PROBE (Phase 3.7). Answers one question per official source: can THIS server (the deployed staging
 * function) reach it, and what happens when it tries? Read-only: nothing is queued for review and nothing is published.
 *
 * Per source it records: robots.txt (URL, status, outcome), the listing request (URL, final URL, redirect, HTTP status,
 * content type, size, duration, outcome), how many notices the adapter discovered, and — for the first one only — the notice
 * request and a summary of what extraction produced. At most three requests per source (robots, listing, one notice, plus a
 * second hop for notice-page adapters), all through the polite fetcher.
 *
 * Protection is never bypassed: a refused robots.txt, 401/403/429, a CAPTCHA or an anti-bot challenge page ends the probe
 * with verdict BLOCKED; the source is then operated manually.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdapter, type AdapterConfig } from "./adapters";
import { pickTitle } from "./fields";
import { BOT_TOKEN, PoliteFetcher, type FetchResult, type Fetcher } from "./http";
import { classify, normalize } from "./normalize";
import { loadSourceCtx } from "./pipeline";
import { parseRobots, robotsAllows } from "./robots";
import { scannedPdf, type AdapterIO } from "./source-adapter";
import { tableRow, type Counts, type ProbeLike } from "./probe-report";

export type Verdict = "PASS" | "PASS WITH ADAPTER" | "MANUAL" | "BLOCKED" | "FAILED" | "UNKNOWN";
export interface ProbeRow {
  source_id: string; runtime: string; probed_by: string | null;
  robots_url: string | null; robots_status: number | null; robots_outcome: "allowed" | "disallowed" | "no_file" | "refused" | "unreachable" | "not_checked";
  request_url: string; final_url: string | null; redirected: boolean | null; http_status: number | null; content_type: string | null; bytes: number | null; duration_ms: number | null;
  fetch_outcome: string | null; discovered: number | null;
  notice_url: string | null; notice_status: number | null; notice_type: string | null; notice_duration_ms: number | null;
  extraction: Record<string, unknown>; error: string | null; verdict: Verdict; notes: string | null;
}

/** Pages that are an anti-bot / CAPTCHA wall rather than content. Seeing one means: stop, mark BLOCKED, do not retry. */
const CHALLENGE = /captcha|cf-chl-|challenge-platform|attention required! \| cloudflare|request unsuccessful\. incapsula|access denied|bot detection|are you a robot|please enable javascript and cookies/i;

export const probeRuntime = () => (process.env.VERCEL ? `vercel ${process.env.VERCEL_ENV ?? "?"} ${process.env.VERCEL_REGION ?? ""}`.trim() : "local (not a deployment)");

async function robotsCheck(f: Fetcher, url: string): Promise<{ url: string; status: number | null; outcome: ProbeRow["robots_outcome"]; allows: (u: string) => boolean }> {
  const robotsUrl = new URL("/robots.txt", url).toString();
  const r = await f.fetch(robotsUrl, { checkRobots: false, retries: 0, timeoutMs: 10_000, maxBytes: 512_000, accept: "text/plain" });
  const st = r.status;
  // Same policy as the crawler (http.ts): 2xx → its rules; 401/403/429 → refused (stay out); 5xx/unreachable → stay out
  // for now; anything else (404, 410 …) → no rules. An HTML page served as robots.txt parses to no rules.
  if (r.ok && r.body) {
    const rules = parseRobots(new TextDecoder().decode(r.body));
    const allows = (u: string) => { const x = new URL(u); return robotsAllows(rules, BOT_TOKEN, x.pathname + x.search); };
    return { url: robotsUrl, status: st, outcome: allows(url) ? "allowed" : "disallowed", allows };
  }
  if (st && [401, 403, 429].includes(st)) return { url: robotsUrl, status: st, outcome: "refused", allows: () => false };
  if (!st || st >= 500 || r.outcome === "timeout" || r.outcome === "unreachable") return { url: robotsUrl, status: st, outcome: "unreachable", allows: () => false };
  return { url: robotsUrl, status: st, outcome: "no_file", allows: () => true };
}

const textOf = (r: FetchResult) => (r.body && /html|text/i.test(r.contentType ?? "") ? new TextDecoder().decode(r.body.slice(0, 200_000)) : "");

export async function probeSource(db: SupabaseClient, sourceId: string, o: { fetcher?: Fetcher; staffId?: string | null; runtime?: string } = {}): Promise<ProbeRow> {
  const loaded = await loadSourceCtx(db, sourceId);
  if (!loaded) throw new Error("Source not found");
  const { row, ctx } = loaded;
  const cfg = (row.adapter_config ?? {}) as AdapterConfig;
  const adapter = getAdapter(row.adapter as string);
  const f = o.fetcher ?? new PoliteFetcher({ minDelayMs: Math.max(cfg.delayMs ?? 2000, 1000) });
  const listing = adapter.listings(row as never, cfg)[0]?.url ?? (row.base_url as string);
  const p: ProbeRow = {
    source_id: sourceId, runtime: o.runtime ?? probeRuntime(), probed_by: o.staffId ?? null,
    robots_url: null, robots_status: null, robots_outcome: "not_checked", request_url: listing, final_url: null, redirected: null, http_status: null,
    content_type: null, bytes: null, duration_ms: null, fetch_outcome: null, discovered: null, notice_url: null, notice_status: null, notice_type: null,
    notice_duration_ms: null, extraction: {}, error: null, verdict: "UNKNOWN", notes: null,
  };
  const done = async (verdict: Verdict, notes?: string, error?: string) => {
    p.verdict = verdict; p.notes = notes?.slice(0, 1000) ?? null; p.error = error?.slice(0, 1000) ?? null;
    const ins = await db.from("source_probes").insert(p);
    if (ins.error) throw new Error(`Could not record the probe: ${ins.error.message}`);
    return p;
  };

  try {
    const robots = await robotsCheck(f, listing);
    p.robots_url = robots.url; p.robots_status = robots.status; p.robots_outcome = robots.outcome;
    if (robots.outcome === "refused") return await done("BLOCKED", `robots.txt answered HTTP ${robots.status}: our crawler stays out — operate this source manually`);
    if (robots.outcome === "disallowed") return await done("BLOCKED", "robots.txt disallows the listing page for our crawler — operate this source manually");
    if (robots.outcome === "unreachable") return await done("FAILED", "robots.txt could not be fetched (timeout / 5xx / network) — the site may be down or unreachable from this server; try again later");

    const refused = adapter.refuse(cfg);
    if (refused) return await done("MANUAL", refused);

    const res = await adapter.fetch(f, listing, "listing").then((r) => r).catch((e) => ({ ok: false, outcome: "unreachable", url: listing, finalUrl: listing, status: null, contentType: null, body: null, error: String(e), redirected: false, ms: 0 }) as FetchResult);
    p.final_url = res.finalUrl; p.redirected = res.redirected; p.http_status = res.status; p.content_type = res.contentType;
    p.bytes = res.body?.byteLength ?? null; p.duration_ms = res.ms; p.fetch_outcome = res.outcome;
    if (res.status && [401, 403, 429].includes(res.status)) return await done("BLOCKED", `HTTP ${res.status} from this server — not retried, not worked around`);
    if (!res.ok || !res.body) return await done("FAILED", `Listing page: ${res.error ?? res.outcome}`, res.error ?? res.outcome);
    const html = textOf(res);
    if (CHALLENGE.test(html.slice(0, 20_000)) && html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").length < 5000)
      return await done("BLOCKED", "The server received an anti-bot / CAPTCHA page instead of content — not worked around");

    const parsed = await adapter.parse(res);
    const actx = { officialDomain: ctx.officialDomain!, listingUrl: res.finalUrl, config: cfg, organizationName: ctx.organizationName };
    const cands = adapter.discover(parsed.doc, parsed.raw, actx, parsed);
    p.discovered = cands.length;
    if (!cands.length) {
      const jsOnly = /<script/i.test(html) && parsed.doc.text.replace(/\s/g, "").length < 400;
      return await done("MANUAL", jsOnly ? "The listing page is rendered by JavaScript: no notice links in the served HTML — needs an adapter or manual entry"
        : "Reached, but no notice links were recognised — check the adapter settings (selector / include pattern) or operate manually");
    }

    const c = cands[0];
    if (!robots.allows(c.url)) return await done("MANUAL", `Discovery works (${cands.length} notices) but robots.txt disallows the notice URLs`);
    const io: AdapterIO = { fetch: (u, purpose) => adapter.fetch(f, u, purpose), parse: (r) => adapter.parse(r) };
    const t0 = Date.now();
    const first = await adapter.fetch(f, c.url, "notice");
    p.notice_url = c.url; p.notice_status = first.status; p.notice_type = first.contentType;
    if (!first.ok || !first.body) { p.notice_duration_ms = Date.now() - t0; return await done("FAILED", `Discovery works (${cands.length} notices) but the first notice failed: ${first.error ?? first.outcome}`, first.error ?? first.outcome); }
    const resolved = await adapter.identifyNotification(c, { res: first, parsed: await adapter.parse(first) }, actx, io);
    p.notice_duration_ms = Date.now() - t0;
    if ("skip" in resolved) return await done("MANUAL", `Discovery works (${cands.length} notices); notice not resolved: ${resolved.skip}`);
    const doc = resolved.parsed.doc;
    const title = pickTitle(resolved.candidate.anchorText, doc);
    const kind = title ? classify(title.value, doc.text, resolved.candidate.kindHint) : null;
    const x = adapter.extractFields(doc, resolved.candidate);
    const n = kind && title ? normalize(kind, title, x, ctx, resolved.candidate.url) : null;
    const fields = n ? Object.keys(n.extracted).filter((k) => !["title", "organization_id", "source_name", "source_url", "official_website_url", "is_all_india", "state_id"].includes(k)) : [];
    const scanned = scannedPdf(doc);
    p.extraction = { url: resolved.candidate.url, hops: resolved.hops, docType: doc.type, textChars: doc.text.length, title: title?.value ?? null, kind, confidence: n?.confidence ?? null,
      fieldsFound: fields, issues: [...(n?.issues ?? []), ...adapter.checkNotice(doc, actx)].slice(0, 10), amendment: title ? adapter.identifyAmendment(title.value, doc.text) : null };
    const configured = !["generic-listing", "pdf-index"].includes(adapter.key) || Object.keys(cfg).length > 0;
    if (scanned) return await done("MANUAL", `Discovery works (${cands.length} notices); the first notice is a scanned/image PDF — fields must be entered by hand`);
    if (!kind || fields.length < 2) return await done("MANUAL", `Discovery works (${cands.length} notices); extraction found ${fields.length} field(s) — mostly manual entry`);
    return await done(configured ? "PASS WITH ADAPTER" : "PASS", `${cands.length} notices discovered; first notice: ${kind}, ${fields.length} fields, confidence ${n!.confidence}`);
  } catch (e) {
    return await done("FAILED", "Probe error", (e as Error).message);
  }
}

/** Probe up to `limit` sources, least-recently probed first, one after another, within a time budget. */
export async function probeNextSources(db: SupabaseClient, o: { limit?: number; budgetMs?: number; staffId?: string | null; fetcher?: Fetcher } = {}): Promise<ProbeRow[]> {
  const t0 = Date.now(); const budget = o.budgetMs ?? 240_000;
  const { data: sources, error } = await db.from("government_sources").select("id,status,is_synthetic").neq("status", "ARCHIVED");
  if (error) throw new Error(error.message);
  const ids = (sources ?? []).filter((s) => !s.is_synthetic || process.env.ALLOW_PRIVATE_SOURCE_HOSTS === "1").map((s) => s.id as string);
  const { data: last } = await db.from("source_probes").select("source_id,probed_at").in("source_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).order("probed_at", { ascending: false });
  const lastAt = new Map<string, string>(); for (const r of last ?? []) if (!lastAt.has(r.source_id as string)) lastAt.set(r.source_id as string, r.probed_at as string);
  const order = ids.sort((a, b) => (lastAt.get(a) ?? "").localeCompare(lastAt.get(b) ?? ""));
  const out: ProbeRow[] = [];
  const shared = o.fetcher ?? new PoliteFetcher();
  for (const id of order.slice(0, Math.min(Math.max(o.limit ?? 4, 1), 10))) {
    if (Date.now() - t0 > budget) break;
    out.push(await probeSource(db, id, { fetcher: shared, staffId: o.staffId }));
  }
  return out;
}

/** Latest probe per source + editorial counts → the source-by-source table. Works with the caller's client (staff) or the service client. */
export async function loadSourceTable(db: SupabaseClient, o: { includeSynthetic?: boolean } = {}) {
  const [src, probes, counts] = await Promise.all([
    db.from("government_sources").select("id,name,official_domain,is_synthetic,status").neq("status", "ARCHIVED").order("name").limit(500),
    db.from("source_probes").select("*").order("probed_at", { ascending: false }).limit(2000),
    db.rpc("source_record_counts"),
  ]);
  if (src.error) throw new Error(src.error.message);
  if (probes.error) throw new Error(probes.error.message);
  const latest = new Map<string, ProbeLike & { id: string }>();
  for (const p of (probes.data ?? []) as (ProbeLike & { id: string })[]) if (!latest.has(p.source_id)) latest.set(p.source_id, p);
  const c = new Map(((counts.data ?? []) as (Counts & { source_id: string })[]).map((r) => [r.source_id, r]));
  const sources = (src.data ?? []).filter((s) => o.includeSynthetic || !s.is_synthetic);
  return sources.map((s) => ({ id: s.id as string, domain: s.official_domain as string, synthetic: !!s.is_synthetic, probe: latest.get(s.id as string) ?? null,
    row: tableRow(`${s.name}${s.is_synthetic ? " (SYNTHETIC)" : ""}`, latest.get(s.id as string) ?? null, c.get(s.id as string)) }));
}
