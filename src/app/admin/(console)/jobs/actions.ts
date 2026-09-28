"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/log";
import { z } from "zod";
import { ForbiddenError, assertPermission, getStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, workflow, type Action } from "@/lib/admin/permissions";
import { dbMessage } from "@/lib/admin/db-errors";
import { formToJobInput, buildJobInputSchema, zodFieldErrors } from "@/lib/validation/job";
import { getRef } from "@/lib/data/ref";
import { todayIST } from "@/lib/dates";
import type { ContentStatus } from "@/lib/types";

export interface JobFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of what was submitted so a failed save never loses the editor's work. */
  values?: Record<string, string | string[]>;
  nonce?: number;
}
export interface WorkflowState { ok?: boolean; error?: string; message?: string }

const uuid = z.string().uuid();
const STATUSES = ["draft", "review", "published", "updated", "expired", "archived"] as const;
const LIVE: ContentStatus[] = ["published", "updated"];

/** Public pages are cached/ISR: any content change must drop those caches so drafts/unpublished jobs disappear at once. */
const refreshPublic = () => revalidatePath("/", "layout");

const echo = (fd: FormData) => {
  const v: Record<string, string | string[]> = {};
  for (const k of new Set(fd.keys())) {
    if (k.startsWith("$")) continue;
    const all = fd.getAll(k).filter((x): x is string => typeof x === "string");
    v[k] = all.length > 1 || ["qualification_slugs", "category_slugs", "vacancy_post", "vacancy_category", "vacancy_count"].includes(k) ? all : (all[0] ?? "");
  }
  return v;
};

async function guard(action: Action) {
  try { return { staff: await assertPermission(action), error: null as string | null }; }
  catch (e) { return { staff: null, error: e instanceof ForbiddenError ? e.message : "Not allowed." }; }
}

async function currentStatus(id: string): Promise<ContentStatus | null> {
  const db = await createSupabaseServerClient();
  const { data } = await db.from("jobs").select("status").eq("id", id).maybeSingle();
  return (data?.status as ContentStatus | undefined) ?? null;
}

/* ───────────── Save / submit for review / publish (one form, three buttons) ───────────── */
export async function saveJobAction(_prev: JobFormState, fd: FormData): Promise<JobFormState> {
  const values = echo(fd);
  const nonce = Date.now();
  const rawId = String(fd.get("id") ?? "");
  const id = rawId ? (uuid.safeParse(rawId).success ? rawId : null) : undefined;
  if (id === null) return { error: "Invalid job reference.", values, nonce };
  const intent = ["save", "submit", "publish"].includes(String(fd.get("intent"))) ? String(fd.get("intent")) : "save";

  const g = await guard(id ? "job:edit" : "job:create");
  if (g.error) return { error: g.error, values, nonce };
  const staff = g.staff!;

  const parsed = buildJobInputSchema(await getRef()).safeParse(formToJobInput(fd));
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error), values, nonce };

  let status: ContentStatus | null = null;
  if (id) {
    status = await currentStatus(id);
    if (!status) return { error: "This job no longer exists or you cannot access it.", values, nonce };
    if (LIVE.includes(status) && !can(staff.role, "job:publish")) return { error: "This job is live. Only users who can publish may change it. Ask an editor or admin to update it, or unpublish it first.", values, nonce };
    if (status === "expired" || status === "archived") return { error: `${status === "expired" ? "Expired" : "Archived"} jobs cannot be edited. Use the workflow buttons to extend or restore it first.`, values, nonce };
  }
  if (intent === "submit" && !can(staff.role, "job:edit")) return { error: "You cannot submit jobs for review.", values, nonce };
  if (intent === "publish" && !can(staff.role, "job:publish")) return { error: "You do not have permission to publish.", values, nonce };

  const db = await createSupabaseServerClient();
  const saved = await db.rpc("save_job", { p_id: id ?? null, p: parsed.data });
  if (saved.error) return { error: dbMessage(saved.error), values, nonce };
  const jobId = saved.data as string;
  const reason = String(fd.get("change_reason") ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 500);
  if (reason && status && LIVE.includes(status)) await db.rpc("annotate_latest_version", { p_kind: "job", p_id: jobId, p_reason: reason });

  let notice = status && LIVE.includes(status) ? "updated" : "saved";
  if (intent === "submit") {
    if (!status || status === "draft") {
      const t = await db.rpc("transition_job", { p_id: jobId, p_to: "review" });
      if (t.error) redirect(`/admin/jobs/${jobId}?error=${encodeURIComponent("Saved as draft, but could not submit for review: " + dbMessage(t.error))}`);
      notice = "submitted";
    } else if (status === "review") notice = "saved";
  } else if (intent === "publish") {
    if (status === "review") {
      const t = await db.rpc("transition_job", { p_id: jobId, p_to: "published" });
      if (t.error) redirect(`/admin/jobs/${jobId}?error=${encodeURIComponent("Saved, but not published: " + dbMessage(t.error))}`);
      notice = "published"; log("info", "content.published", { kind: "job", id: jobId });
    } else if (status && LIVE.includes(status)) notice = "updated";
    else redirect(`/admin/jobs/${jobId}?error=${encodeURIComponent("Saved. A job must be submitted for review before it can be published.")}`);
  }
  refreshPublic();
  redirect(`/admin/jobs/${jobId}?notice=${notice}`);
}

/* ───────────── Status changes from the workflow panel ───────────── */
export async function transitionJobAction(_prev: WorkflowState, fd: FormData): Promise<WorkflowState> {
  const parsed = z.object({
    id: uuid, to: z.enum(STATUSES),
    comment: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string().max(1000).optional()),
    new_last_date: z.preprocess((v) => (typeof v === "string" && v ? v : undefined), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date").optional()),
  }).safeParse({ id: fd.get("id"), to: fd.get("to"), comment: fd.get("comment"), new_last_date: fd.get("new_last_date") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { id, to, comment, new_last_date } = parsed.data;

  const from = await currentStatus(id);
  if (!from) return { error: "This job no longer exists or you cannot access it." };
  const rule = workflow.find((w) => w.kind === "job" && w.from === from && w.to === to);
  if (!rule) return { error: `A job cannot move from ${from} to ${to}.` };
  const g = await guard(rule.action);
  if (g.error) return { error: g.error };
  if (from === "expired" && to === "updated" && (!new_last_date || new_last_date < todayIST())) return { error: "Extending an expired job needs a new official last date that is today or later." };

  const db = await createSupabaseServerClient();
  const r = await db.rpc("transition_job", { p_id: id, p_to: to, p_comment: comment ?? null, p_new_last_date: new_last_date ?? null });
  if (r.error) return { error: dbMessage(r.error) };
  log("info", to === "published" || to === "updated" ? "content.published" : to === "draft" ? "content.unpublished" : "admin.change", { kind: "job", id, to });
  refreshPublic();
  return { ok: true, message: `${rule.label}: done.` };
}

export async function duplicateJobAction(fd: FormData) {
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) redirect("/admin/jobs?error=Invalid+job");
  const g = await guard("job:create");
  if (g.error) redirect(`/admin/jobs?error=${encodeURIComponent(g.error)}`);
  const db = await createSupabaseServerClient();
  const r = await db.rpc("duplicate_job", { p_id: id.data });
  if (r.error) redirect(`/admin/jobs?error=${encodeURIComponent(dbMessage(r.error))}`);
  redirect(`/admin/jobs/${r.data as string}?notice=duplicated`);
}

export async function deleteJobAction(_prev: WorkflowState, fd: FormData): Promise<WorkflowState> {
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "Invalid job reference." };
  if (fd.get("confirm") !== "on") return { error: "Tick the confirmation box to delete." };
  const g = await guard("job:delete");
  if (g.error) return { error: g.error };
  const status = await currentStatus(id.data);
  if (status && status !== "draft" && status !== "archived") return { error: "Only drafts and archived jobs can be deleted. Unpublish or archive it first." };
  const db = await createSupabaseServerClient();
  const r = await db.from("jobs").delete().eq("id", id.data).select("id");
  if (r.error) return { error: dbMessage(r.error) };
  if (!r.data?.length) return { error: "Nothing was deleted (job not found, or you lack permission)." };
  refreshPublic();
  redirect("/admin/jobs?notice=deleted");
}

export async function runExpiryAction() {
  const staff = await getStaff();
  if (!staff || !can(staff.role, "job:expire")) redirect("/admin?notice=forbidden");
  const db = await createSupabaseServerClient();
  const r = await db.rpc("expire_overdue_jobs");
  if (r.error) redirect(`/admin/jobs?error=${encodeURIComponent(dbMessage(r.error))}`);
  refreshPublic();
  redirect(`/admin/jobs?notice=expiry&n=${Number(r.data) || 0}`);
}
