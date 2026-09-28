import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { runCron } from "@/lib/cron-auth";
import { runDueSources } from "@/lib/ingestion/pipeline";
import { CRON_JOBS, batchSize } from "@/config/cron";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled source checks. Each call checks at most a few DUE sources (their own interval), one after another — never all
 * sources, never in parallel. Findings go to the review queue only.
 */
export async function GET(req: NextRequest) {
  return runCron(req, "sources", async () => {
    const runs = await runDueSources(createServiceClient(), batchSize(CRON_JOBS.find((j) => j.name === "sources")!));
    for (const r of runs) if (["failed", "blocked"].includes(r.status)) log("warn", r.status === "blocked" ? "source.blocked" : "source.check_failed", { run: r.runId, errors: r.errors, last: r.log.filter((l) => l.level === "error").slice(-1)[0]?.msg });
    return { checked: runs.length, runs: runs.map((r) => ({ id: r.runId, status: r.status, new: r.created, changed: r.updated, errors: r.errors })) };
  });
}
