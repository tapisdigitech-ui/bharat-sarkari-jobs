/**
 * Rate limits (Phase 3.6 item 28). Deliberately generous: they stop floods and credential stuffing, not normal use.
 *
 * Store: the database (rate_limit_hit, migration 0025) when the service role is configured — shared by every server
 * instance; otherwise an in-process counter (development / tests; per instance only). If the store itself fails, the request
 * is ALLOWED and a warning logged: an outage of the limiter must not lock editors out (Supabase Auth keeps its own limits
 * on sign-in regardless).
 *
 * Keys are salted SHA-256 hashes — raw IPs, emails and user ids never reach the table.
 */
import "server-only";
import { createHash } from "node:crypto";
import { log } from "./log";
import { createServiceClient, serviceRoleConfigured } from "./supabase/admin";

export const LIMITS = {
  loginIp: { limit: 30, windowSec: 15 * 60 },         // FAILED sign-ins per client IP
  loginAccount: { limit: 8, windowSec: 15 * 60 },     // FAILED sign-ins per email address (successful ones never count)
  search: { limit: 90, windowSec: 60 },               // per client IP
  adminWrite: { limit: 240, windowSec: 60 },          // per staff member, all admin server actions
  sourceCheck: { limit: 60, windowSec: 60 * 60 },     // per staff member ("Check now", single-URL checks)
  import: { limit: 30, windowSec: 60 * 60 },          // per staff member (CSV imports)
  cron: { limit: 30, windowSec: 60 * 60 },            // per cron job (a leaked secret cannot hammer government sites)
} as const;
export type LimitName = keyof typeof LIMITS;

const memory = new Map<string, { start: number; hits: number }>();
const salt = () => process.env.RATE_LIMIT_SALT ?? process.env.CRON_SECRET ?? "local-development-salt";
export const bucketKey = (name: LimitName, key: string) => `${name}:${createHash("sha256").update(`${salt()}|${name}|${key}`).digest("hex").slice(0, 40)}`;

function memoryHit(bucket: string, limit: number, windowSec: number, now = Date.now()): boolean {
  const start = Math.floor(now / 1000 / windowSec) * windowSec * 1000;
  const cur = memory.get(bucket);
  const hits = cur && cur.start === start ? cur.hits + 1 : 1;
  memory.set(bucket, { start, hits });
  if (memory.size > 50_000) for (const [k, v] of memory) if (v.start < start) memory.delete(k);
  return hits <= limit;
}

export interface RateResult { ok: boolean; retryAfterSec: number }

export async function rateLimit(name: LimitName, key: string): Promise<RateResult> {
  const { limit, windowSec } = LIMITS[name];
  const bucket = bucketKey(name, key || "unknown");
  const retryAfterSec = windowSec - (Math.floor(Date.now() / 1000) % windowSec);
  let ok = true;
  try {
    if (serviceRoleConfigured() && process.env.RATE_LIMIT_STORE !== "memory") {
      const { data, error } = await createServiceClient().rpc("rate_limit_hit", { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSec });
      if (error) throw new Error(error.message);
      ok = data !== false;
    } else ok = memoryHit(bucket, limit, windowSec);
  } catch (e) {
    log("warn", "rate_limited", { limit: name, store_error: (e as Error).message, allowed: true });
    return { ok: true, retryAfterSec: 0 };
  }
  if (!ok) log("warn", "rate_limited", { limit: name });
  return { ok, retryAfterSec };
}

/** Is the bucket still under its limit? Does NOT count a hit (pair with rateLimit() on failure, e.g. failed sign-ins). */
export async function underLimit(name: LimitName, key: string): Promise<RateResult> {
  const { limit, windowSec } = LIMITS[name];
  const bucket = bucketKey(name, key || "unknown");
  const retryAfterSec = windowSec - (Math.floor(Date.now() / 1000) % windowSec);
  try {
    if (serviceRoleConfigured() && process.env.RATE_LIMIT_STORE !== "memory") {
      const { data, error } = await createServiceClient().rpc("rate_limit_ok", { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSec });
      if (error) throw new Error(error.message);
      return { ok: data !== false, retryAfterSec };
    }
    const start = Math.floor(Date.now() / 1000 / windowSec) * windowSec * 1000;
    const cur = memory.get(bucket);
    return { ok: !cur || cur.start !== start || cur.hits < limit, retryAfterSec };
  } catch (e) {
    log("warn", "rate_limited", { limit: name, store_error: (e as Error).message, allowed: true });
    return { ok: true, retryAfterSec: 0 };
  }
}

/** Client IP as seen by the platform proxy (Vercel sets x-forwarded-for / x-real-ip). */
export function clientIp(h: Headers): string {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || "unknown";
}

/** Test hook: the in-process store only. */
export const __memoryHitForTests = memoryHit;
