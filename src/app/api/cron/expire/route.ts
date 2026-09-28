import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/admin";
import { runCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

/** Daily expiry (service role): live jobs whose official last date has passed become EXPIRED. Schedule: src/config/cron.ts. */
export async function GET(req: NextRequest) {
  return runCron(req, "expire", async () => {
    const { data, error } = await createServiceClient().rpc("expire_overdue_jobs");
    if (error) throw new Error(error.message);
    const expired = Number(data) || 0;
    if (expired > 0) revalidatePath("/", "layout");
    return { expired };
  });
}
