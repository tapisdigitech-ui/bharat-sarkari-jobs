import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { runCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

/** Housekeeping: notice text past its retention date, old rate-limit windows, old cron-run records. Content is never touched. */
export async function GET(req: NextRequest) {
  return runCron(req, "cleanup", async () => {
    const db = createServiceClient();
    const purged = await db.rpc("purge_old_document_text");
    if (purged.error) throw new Error(purged.error.message);
    const ops = await db.rpc("cleanup_operational_data", { p_keep_cron_days: 90 });
    if (ops.error) throw new Error(ops.error.message);
    return { rawTextPurged: Number(purged.data) || 0, ...(ops.data as Record<string, number>) };
  });
}
