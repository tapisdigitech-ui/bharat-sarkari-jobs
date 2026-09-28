"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertPermission } from "@/lib/auth/staff";
import { createServiceClient } from "@/lib/supabase/admin";
import { checkLinks, dueLinkTargets } from "@/lib/ingestion/links";
import { runDueSources } from "@/lib/ingestion/pipeline";
import { operatorFetcher } from "@/lib/ingestion/http";


/** The same jobs the scheduler runs, on demand (permission checked first; the monitors write with the service role). */
export async function runLinkCheckAction(): Promise<void> {
  try { await assertPermission("source:manage"); } catch { redirect("/admin?notice=forbidden"); }
  const db = createServiceClient();
  const sum = await checkLinks(db, await dueLinkTargets(db, 40), operatorFetcher());
  revalidatePath("/admin/health");
  redirect(`/admin/health?ran=${encodeURIComponent(`Link check: ${sum.checked} checked, ${sum.broken} not working, ${sum.flagged} record(s) flagged, ${sum.recovered} recovered.`)}`);
}

export async function runDueSourcesAction(): Promise<void> {
  try { await assertPermission("ingestion:run", "sourceCheck"); } catch { redirect("/admin?notice=forbidden"); }
  const db = createServiceClient();
  const runs = await runDueSources(db, 3, operatorFetcher());
  revalidatePath("/admin/health"); revalidatePath("/admin/review");
  redirect(`/admin/health?ran=${encodeURIComponent(runs.length ? `Checked ${runs.length} due source(s): ${runs.map((r) => r.status).join(", ")}.` : "No source is due for a check.")}`);
}

export async function markStaleAction(): Promise<void> {
  try { await assertPermission("source:manage"); } catch { redirect("/admin?notice=forbidden"); }
  const db = createServiceClient();
  const { data } = await db.rpc("mark_stale_content", { p_days: 30 });
  revalidatePath("/admin/health");
  redirect(`/admin/health?ran=${encodeURIComponent(`${Number(data) || 0} live record(s) not source-checked for 30 days moved to “Needs source review”.`)}`);
}
