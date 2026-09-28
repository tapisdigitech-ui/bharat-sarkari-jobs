/**
 * Polite, safe HTTP for official-source checks.
 *  - identifies itself honestly (User-Agent with a contact URL) — no browser impersonation, no anti-bot evasion;
 *  - honours robots.txt (Disallow + Crawl-delay) per host;
 *  - one request at a time per host with a minimum spacing, hard timeouts, bounded retries with exponential backoff,
 *    Retry-After respected, 401/403/429 treated as "access restricted" (we back off, a person looks) — never retried around;
 *  - SSRF guard: only http(s), only public addresses (private/loopback/link-local are refused unless explicitly allowed
 *    for local synthetic tests), every redirect hop re-checked, response size capped.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseRobots, robotsAllows, robotsCrawlDelay, type Robots } from "./robots";

export const BOT_TOKEN = "BharatSarkariJobsBot";
export const userAgent = () => `${BOT_TOKEN}/0.3 (+${(process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.invalid").replace(/\/$/, "")}/about; official-source monitoring)`;

export type FetchOutcome = "ok" | "redirect" | "not_found" | "gone" | "client_error" | "server_error" | "timeout" | "invalid" | "blocked" | "unreachable" | "skipped";
export interface FetchResult {
  ok: boolean;
  outcome: FetchOutcome;
  url: string;
  finalUrl: string;
  status: number | null;
  contentType: string | null;
  body: Uint8Array | null;
  error?: string;
  redirected: boolean;
  ms: number;
}
export interface FetchOptions { method?: "GET" | "HEAD"; maxBytes?: number; timeoutMs?: number; retries?: number; accept?: string; checkRobots?: boolean }

export interface Fetcher { fetch(url: string, opts?: FetchOptions): Promise<FetchResult> }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────── address safety ───────── */
function ipv4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function ipv6Private(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("::ffff:")) return ipv4Private(s.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
}
export function isPrivateAddress(ip: string): boolean { return isIP(ip) === 4 ? ipv4Private(ip) : isIP(ip) === 6 ? ipv6Private(ip) : true; }

/** Throws a readable error if the URL may not be fetched. */
export async function assertFetchable(raw: string, allowPrivate: boolean): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new FetchRefused("invalid", "Not a valid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FetchRefused("invalid", "Only http(s) URLs are checked");
  if (u.username || u.password) throw new FetchRefused("invalid", "URLs with credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => { throw new FetchRefused("unreachable", `Could not resolve ${host}`); })).map((a) => a.address);
  if (!allowPrivate && addrs.some(isPrivateAddress)) throw new FetchRefused("blocked", "Refusing to fetch a private or local network address");
  if (!allowPrivate && u.port && !["80", "443"].includes(u.port)) throw new FetchRefused("invalid", "Non-standard ports are not allowed");
  return u;
}
export class FetchRefused extends Error { constructor(public outcome: FetchOutcome, message: string) { super(message); } }

/* ───────── the fetcher ───────── */
export interface PoliteFetcherOptions { minDelayMs?: number; allowPrivate?: boolean; fetchImpl?: typeof fetch; userAgent?: string }

export class PoliteFetcher implements Fetcher {
  private lastHit = new Map<string, number>();
  private robots = new Map<string, Robots | null>();
  private minDelayMs: number;
  private allowPrivate: boolean;
  private f: typeof fetch;
  private ua: string;
  constructor(o: PoliteFetcherOptions = {}) {
    this.minDelayMs = Math.max(o.minDelayMs ?? 2000, 0);
    // Test-only switch; never honoured on the production deployment (Vercel), so a synthetic source can never be read there.
    this.allowPrivate = process.env.VERCEL_ENV === "production" ? false : o.allowPrivate ?? process.env.ALLOW_PRIVATE_SOURCE_HOSTS === "1";
    this.f = o.fetchImpl ?? fetch;
    this.ua = o.userAgent ?? userAgent();
  }

  private async pace(host: string, extraDelaySec = 0) {
    const gap = Math.max(this.minDelayMs, Math.min(extraDelaySec, 30) * 1000);
    const last = this.lastHit.get(host);
    if (last !== undefined) { const wait = last + gap - Date.now(); if (wait > 0) await sleep(wait); }
    this.lastHit.set(host, Date.now());
  }

  async robotsFor(u: URL): Promise<Robots | null> {
    const key = u.origin;
    if (this.robots.has(key)) return this.robots.get(key)!;
    const r = await this.raw(new URL("/robots.txt", u).toString(), { method: "GET", maxBytes: 512_000, timeoutMs: 10_000, retries: 0, accept: "text/plain" }, 0);
    // robots.txt outcomes (RFC 9309 §2.3.1): 2xx → its rules; 404/410 etc. → no rules; 5xx / unreachable → treat as
    // "disallow everything" for now (RFC: the site is unreachable, assume complete disallow) and do not cache, so the next
    // check asks again. STRICTER than RFC 9309 on purpose: 401/403/429 → "stay out" (a refused robots.txt is read as a refusal —
    // e.g. dsssb.delhi.gov.in answered 403 in the Phase 3.5 pilot, so that source is MANUAL, not crawled).
    const allOut = () => parseRobots("User-agent: *\nDisallow: /");
    if (r.ok && r.body) { const p = parseRobots(new TextDecoder().decode(r.body)); this.robots.set(key, p); return p; }
    const st = r.status ?? 0;
    if ([401, 403, 429].includes(st)) { const p = allOut(); this.robots.set(key, p); return p; }
    if (st >= 500 || st === 0 || r.outcome === "timeout" || r.outcome === "unreachable") return allOut();   // not cached
    const parsed = null;
    this.robots.set(key, parsed);
    return parsed;
  }

  async allowedByRobots(url: string): Promise<{ allowed: boolean; crawlDelay?: number }> {
    const u = new URL(url);
    const r = await this.robotsFor(u);
    if (!r) return { allowed: true };
    return { allowed: robotsAllows(r, BOT_TOKEN, u.pathname + u.search), crawlDelay: robotsCrawlDelay(r, BOT_TOKEN) };
  }

  async fetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    const started = Date.now();
    const fail = (outcome: FetchOutcome, error: string, status: number | null = null): FetchResult =>
      ({ ok: false, outcome, url, finalUrl: url, status, contentType: null, body: null, error, redirected: false, ms: Date.now() - started });
    let u: URL;
    try { u = await assertFetchable(url, this.allowPrivate); } catch (e) { return fail(e instanceof FetchRefused ? e.outcome : "invalid", (e as Error).message); }
    let crawlDelay = 0;
    if (opts.checkRobots !== false) {
      const r = await this.allowedByRobots(u.toString()).catch(() => ({ allowed: true, crawlDelay: undefined }));
      if (!r.allowed) return fail("blocked", "robots.txt disallows this URL for our crawler");
      crawlDelay = r.crawlDelay ?? 0;
    }
    return this.raw(u.toString(), opts, crawlDelay);
  }

  private async raw(url: string, opts: FetchOptions, crawlDelay: number): Promise<FetchResult> {
    const started = Date.now();
    const retries = Math.min(opts.retries ?? 2, 3);
    const maxBytes = opts.maxBytes ?? 5_000_000;
    const timeoutMs = Math.min(opts.timeoutMs ?? 20_000, 60_000);
    let attempt = 0; let last: FetchResult | null = null;
    while (attempt <= retries) {
      if (attempt > 0) await sleep(Math.min(2000 * 2 ** (attempt - 1), 15_000) + Math.floor(Math.random() * 500));
      last = await this.once(url, opts.method ?? "GET", maxBytes, timeoutMs, opts.accept, crawlDelay, started);
      const retryable = last.outcome === "timeout" || last.outcome === "unreachable" || (last.outcome === "server_error" && last.status !== 501);
      if (!retryable) return last;
      attempt++;
    }
    return last!;
  }

  private async once(start: string, method: "GET" | "HEAD", maxBytes: number, timeoutMs: number, accept: string | undefined, crawlDelay: number, t0: number): Promise<FetchResult> {
    let current = start; let redirected = false;
    for (let hop = 0; hop <= 5; hop++) {
      let u: URL;
      try { u = await assertFetchable(current, this.allowPrivate); }
      catch (e) { return { ok: false, outcome: e instanceof FetchRefused ? e.outcome : "invalid", url: start, finalUrl: current, status: null, contentType: null, body: null, error: (e as Error).message, redirected, ms: Date.now() - t0 }; }
      await this.pace(u.host, crawlDelay);
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await this.f(u.toString(), { method, redirect: "manual", signal: ac.signal,
          headers: { "user-agent": this.ua, accept: accept ?? "text/html,application/pdf;q=0.9,*/*;q=0.5", "accept-language": "en-IN,en;q=0.8,hi;q=0.5" } });
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          clearTimeout(timer);
          await res.body?.cancel().catch(() => {});
          current = new URL(res.headers.get("location")!, u).toString(); redirected = true;
          continue;
        }
        const contentType = res.headers.get("content-type");
        let body: Uint8Array | null = null;
        if (method === "GET" && res.body) {
          const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) { await reader.cancel().catch(() => {}); clearTimeout(timer);
              return { ok: false, outcome: "invalid", url: start, finalUrl: u.toString(), status: res.status, contentType, body: null, error: `Response larger than ${Math.round(maxBytes / 1e6)} MB`, redirected, ms: Date.now() - t0 }; }
            chunks.push(value);
          }
          body = new Uint8Array(size); let off = 0; for (const c of chunks) { body.set(c, off); off += c.byteLength; }
        }
        clearTimeout(timer);
        const s = res.status;
        const outcome: FetchOutcome = s >= 200 && s < 300 ? (redirected ? "redirect" : "ok")
          : s === 404 ? "not_found" : s === 410 ? "gone" : s === 401 || s === 403 || s === 429 ? "blocked" : s >= 500 ? "server_error" : "client_error";
        if (s === 429 || s === 503) {
          const ra = Number(res.headers.get("retry-after"));
          if (Number.isFinite(ra) && ra > 0 && ra <= 30) await sleep(ra * 1000);
        }
        return { ok: s >= 200 && s < 300, outcome, url: start, finalUrl: u.toString(), status: s, contentType, body, redirected, ms: Date.now() - t0,
          error: s >= 400 ? `HTTP ${s}` : undefined };
      } catch (e) {
        clearTimeout(timer);
        const aborted = (e as Error).name === "AbortError";
        return { ok: false, outcome: aborted ? "timeout" : "unreachable", url: start, finalUrl: u.toString(), status: null, contentType: null, body: null,
          error: aborted ? `No response within ${Math.round(timeoutMs / 1000)} s` : `Network error: ${(e as Error).message}`.slice(0, 300), redirected, ms: Date.now() - t0 };
      }
    }
    return { ok: false, outcome: "invalid", url: start, finalUrl: current, status: null, contentType: null, body: null, error: "Too many redirects", redirected, ms: Date.now() - t0 };
  }
}

/**
 * The fetcher for staff-triggered checks ("Check now", link checks). In the local test harness only
 * (ALLOW_PRIVATE_SOURCE_HOSTS=1 with SOURCE_MIN_DELAY_MS, never honoured on the live site) it shortens the politeness delay
 * for the synthetic source; otherwise it returns undefined and callers use their normal, polite default.
 */
export function operatorFetcher(): Fetcher | undefined {
  if (process.env.VERCEL_ENV === "production") return undefined;
  if (process.env.ALLOW_PRIVATE_SOURCE_HOSTS !== "1" || !process.env.SOURCE_MIN_DELAY_MS) return undefined;
  return new PoliteFetcher({ minDelayMs: Number(process.env.SOURCE_MIN_DELAY_MS) });
}
