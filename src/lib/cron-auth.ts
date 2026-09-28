import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { CRON_JOBS } from "@/config/cron";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { createServiceClient, serviceRoleConfigured } from "@/lib/supabase/admin";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; refuse to run if the secret is unset or trivially short. */
export function cronAuthorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? ""), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Shared wrapper for every scheduled job: secret check (401), a per-job rate limit (429 — a leaked secret cannot hammer
 * official websites), a single-run lock (409 while a run of the same job is unfinished), a `cron_runs` row with outcome and summary, and one structured log line. Errors return 500 with a
 * generic message; details go to the log (redacted), never to the caller.
 */
export async function runCron(req: NextRequest, name: string, work: () => Promise<Record<string, unknown>>): Promise<NextResponse> {
  if (!CRON_JOBS.some((j) => j.name === name)) return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  if (!cronAuthorised(req)) { log("warn", "auth.failed", { reason: "cron secret", job: name }); return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  if (!(await rateLimit("cron", name)).ok) return NextResponse.json({ error: "Too many runs" }, { status: 429 });
  const db = serviceRoleConfigured() ? createServiceClient() : null;
  // One run at a time per job (a slow run and the next schedule, or two manual calls, never overlap). A run left unfinished
  // by a crash is closed as abandoned after 15 minutes so it cannot block the job forever.
  let runId: number | undefined;
  if (db) {
    const begun = await db.rpc("cron_begin", { p_job: name, p_stale_minutes: 15 });
    if (begun.error) { log("error", "cron.failed", { job: name, error: `could not record the run: ${begun.error.message}` }); return NextResponse.json({ ok: false, error: `${name} failed` }, { status: 500 }); }
    if (begun.data === null) { log("warn", "cron.failed", { job: name, reason: "already running" }); return NextResponse.json({ ok: false, skipped: "already running" }, { status: 409 }); }
    runId = Number(begun.data);
  }
  const t0 = Date.now();
  try {
    const summary = await work();
    if (runId) await db!.from("cron_runs").update({ finished_at: new Date().toISOString(), ok: true, summary }).eq("id", runId);
    log("info", "cron.ok", { job: name, ms: Date.now() - t0, ...summary });
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const message = (e as Error).message;
    if (runId) await db!.from("cron_runs").update({ finished_at: new Date().toISOString(), ok: false, error: message.slice(0, 1000) }).eq("id", runId);
    log("error", "cron.failed", { job: name, ms: Date.now() - t0, error: message });
    return NextResponse.json({ ok: false, error: `${name} failed` }, { status: 500 });
  }
}
