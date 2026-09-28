"use server";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getStaff } from "@/lib/auth/staff";
import { can, VERBS, type Action, type ContentKind } from "@/lib/admin/permissions";
import { createServiceClient } from "@/lib/supabase/admin";
import { adminHref, isKind } from "@/lib/admin/kinds";
import { checkLinks, recordTargets } from "@/lib/ingestion/links";
import { PoliteFetcher, operatorFetcher } from "@/lib/ingestion/http";

/** "Check official links now" for one record. Any staff member who can work on that content type may run it. */
export async function checkRecordLinksAction(fd: FormData): Promise<void> {
  const kind = String(fd.get("kind") ?? ""); const id = String(fd.get("id") ?? "");
  if (!isKind(kind) || !z.string().uuid().safeParse(id).success) redirect("/admin");
  const staff = await getStaff();
  if (!staff || !VERBS.some((v) => can(staff.role, `${kind}:${v}` as Action))) redirect("/admin?notice=forbidden");
  if (!(await rateLimit("sourceCheck", staff.user.id)).ok) redirect(`${adminHref(kind as ContentKind, id)}?links=${encodeURIComponent("Too many link checks in the last hour — please try again later.")}`);
  const db = createServiceClient();   // link_checks are written by the monitor only (never from a browser session)
  const fetcher = operatorFetcher() ?? new PoliteFetcher({ minDelayMs: 1500 });
  const sum = await checkLinks(db, await recordTargets(db, kind as ContentKind, id), fetcher);
  revalidatePath(adminHref(kind as ContentKind, id));
  redirect(`${adminHref(kind as ContentKind, id)}?links=${encodeURIComponent(`${sum.checked} link(s) checked, ${sum.broken} not working${sum.flagged ? ` — record flagged “official source unavailable”` : ""}.`)}`);
}
