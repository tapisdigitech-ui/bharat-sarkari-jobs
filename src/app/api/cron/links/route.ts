import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { runCron } from "@/lib/cron-auth";
import { checkLinks, dueLinkTargets } from "@/lib/ingestion/links";
import { CRON_JOBS, batchSize } from "@/config/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Check the least-recently-checked official links (flag, never delete) and mark stale content for re-verification. */
export async function GET(req: NextRequest) {
  return runCron(req, "links", async () => {
    const db = createServiceClient();
    const links = await checkLinks(db, await dueLinkTargets(db, batchSize(CRON_JOBS.find((j) => j.name === "links")!)));
    const stale = await db.rpc("mark_stale_content", { p_days: 30 });
    if (stale.error) throw new Error(stale.error.message);
    return { links, staleFlagged: Number(stale.data) || 0 };
  });
}
