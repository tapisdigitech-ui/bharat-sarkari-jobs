/**
 * LIVE-PILOT PROBE (Phase 3.5) — the production discovery/extraction modules, bundled for a normal web browser.
 *
 * Why this exists: the build/test sandbox is not allowed to connect to government hosts (egress policy, HTTP 403 at the
 * proxy), so the crawler could not be pointed at real sites from there. For the pilot, a person's ordinary browser opens
 * the official page and this bundle runs the SAME code the crawler runs (text.ts, adapters.ts, fields.ts, normalize.ts,
 * robots.ts) on the SAME bytes the server returns (fetch of the served document — JavaScript-rendered content is NOT
 * seen, exactly as the crawler would not see it). PDF text is read with pdf.js 6.1.200 — the version bundled inside
 * `unpdf` — using unpdf's own join/normalise logic (see tests/live/shims/unpdf.ts).
 *
 * What it does NOT reproduce: our User-Agent (browsers cannot set it), per-host pacing across tabs, and the database
 * stages (duplicates, change detection, review) — those are replayed separately from captured text (tests/live/replay.ts).
 * It never submits forms, logs in, solves captchas or touches anything but public GET URLs on the page's own origin.
 */
import { getAdapter, type AdapterConfig, type Candidate } from "@/lib/ingestion/adapters";
import { extractFields, pickTitle } from "@/lib/ingestion/fields";
import { classify, normalize, type SourceCtx } from "@/lib/ingestion/normalize";
import { parseRobots, robotsAllows } from "@/lib/ingestion/robots";
import { toDoc, sha256, type DocText } from "@/lib/ingestion/text";
import type { ContentKind } from "@/lib/admin/permissions";

const BOT = "BharatSarkariJobsBot";
const docs = new Map<string, { doc: DocText; bytes: number; ct: string | null; hash: string }>();

async function get(url: string) {
  const r = await fetch(url, { credentials: "omit", redirect: "follow", cache: "no-store" });
  const body = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, ok: r.ok, ct: r.headers.get("content-type"), finalUrl: r.url, body };
}

async function robots(u: string) {
  const origin = new URL(u).origin;
  try {
    const r = await get(origin + "/robots.txt");
    const text = new TextDecoder().decode(r.body);
    const looksHtml = /<html|<!doctype/i.test(text.slice(0, 500));
    // Same decision as PoliteFetcher.robotsFor: 2xx → parse; 401/403 → disallow all; anything else → no rules.
    const parsed = r.ok ? parseRobots(text) : r.status === 401 || r.status === 403 ? parseRobots("User-agent: *\nDisallow: /") : null;
    const path = new URL(u).pathname + new URL(u).search;
    return { status: r.status, ct: r.ct, looksHtml, rules: parsed ? parsed.groups.size : 0, allowed: parsed ? robotsAllows(parsed, BOT, path) : true,
      excerpt: looksHtml ? "(HTML page, not a robots file)" : text.slice(0, 400) };
  } catch (e) { return { status: 0, error: String(e), allowed: true, rules: 0 }; }
}

async function load(url: string) {
  const r = await get(url);
  const doc = await toDoc(r.body, r.ct, r.finalUrl);
  const entry = { doc, bytes: r.body.byteLength, ct: r.ct, hash: sha256(r.body) };
  docs.set(url, entry);
  return { r, ...entry };
}

export async function listing(url: string, o: { adapter?: string; config?: AdapterConfig; officialDomain: string; kind?: ContentKind }) {
  const rob = await robots(url);
  const { r, doc, bytes, hash } = await load(url);
  const raw = doc.type === "html" ? new TextDecoder().decode(r.body) : null;
  const cands: Candidate[] = r.ok ? getAdapter(o.adapter ?? "generic-listing").discover(doc, raw, { officialDomain: o.officialDomain, listingUrl: r.finalUrl, listingKind: o.kind, config: o.config ?? {} }) : [];
  return { url, final: r.finalUrl, status: r.status, ct: r.ct, bytes, hash: hash.slice(0, 16), docType: doc.type, textLen: doc.text.length, links: doc.links.length,
    robots: rob, candidates: cands.map((c) => ({ url: c.url, title: c.anchorText.slice(0, 140), date: c.dateHint, kind: c.kindHint })) };
}

export async function notice(url: string, o: { anchorText?: string; context?: string; kindHint?: ContentKind; ctx: Partial<SourceCtx> }) {
  const rob = await robots(url);
  const { r, doc, bytes, hash } = await load(url);
  const ctx: SourceCtx = { id: null, name: "", organizationId: null, organizationName: null, organizationLevel: null, departmentSlug: null, stateId: null,
    stateSlug: null, isAllIndia: true, officialDomain: null, baseUrl: null, isSynthetic: false, ...o.ctx };
  const title = pickTitle(o.anchorText ?? "", doc);
  const kind = title ? classify(title.value, doc.text, o.kindHint) : null;
  const base = { url, status: r.status, ct: r.ct, bytes, hash: hash.slice(0, 16), docType: doc.type, pages: doc.pages, textLen: doc.text.length,
    textChars: doc.text.replace(/\s/g, "").length, robotsAllowed: rob.allowed, title: title?.value };
  if (!title || !kind) return { ...base, kind: null, skipped: title ? "not a notice" : "no title" };
  const x = extractFields(`${doc.text}\n${o.context ?? ""}`, doc.links);
  const n = normalize(kind, title, x, ctx, url);
  if (doc.type === "pdf" && doc.text.replace(/\s/g, "").length < 200) { n.issues.push("scanned / no text layer"); n.confidence = "LOW"; }
  return { ...base, kind, confidence: n.confidence, score: n.score, fingerprint: n.fingerprint, extracted: n.extracted, fieldConfidence: n.fieldConfidence, issues: n.issues };
}

/** Evidence for the human comparison: short windows of the document around a pattern. */
export function snip(url: string, pattern: string, width = 160, max = 4) {
  const d = docs.get(url); if (!d) return [];
  const re = new RegExp(pattern, "gi"); const t = d.doc.text; const out: string[] = [];
  for (const m of t.matchAll(re)) { out.push(t.slice(Math.max(0, m.index! - width / 2), m.index! + width).replace(/\s+/g, " ")); if (out.length >= max) break; }
  return out;
}
export function text(url: string) { return docs.get(url)?.doc.text ?? null; }
export function docInfo(url: string) { const d = docs.get(url); return d ? { type: d.doc.type, pages: d.doc.pages, bytes: d.bytes, hash: d.hash, links: d.doc.links.slice(0, 40) } : null; }
export { robots };
export { selftest } from "./selftest-core";
