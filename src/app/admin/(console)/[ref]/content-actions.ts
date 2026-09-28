"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/log";
import { z } from "zod";
import { ForbiddenError, assertPermission } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, workflow, type Action } from "@/lib/admin/permissions";
import { dbMessage } from "@/lib/admin/db-errors";
import { contentCfgByKind } from "@/lib/admin/content-config";
import { parseContentForm } from "@/lib/validation/content";
import type { ContentStatus } from "@/lib/types";

export interface ContentFormState { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string | string[]>; nonce?: number }
export interface ContentWorkflowState { ok?: boolean; error?: string; message?: string }

const uuid = z.string().uuid();
const STATUSES = ["draft", "review", "published", "updated", "expired", "archived"] as const;
const LIVE: ContentStatus[] = ["published", "updated"];
/** Public pages are cached: any content change drops those caches so unpublished/edited records update at once. */
const refreshPublic = () => revalidatePath("/", "layout");

const echo = (fd: FormData) => {
  const v: Record<string, string | string[]> = {};
  for (const k of new Set(fd.keys())) {
    if (k.startsWith("$")) continue;
    const all = fd.getAll(k).filter((x): x is string => typeof x === "string");
    v[k] = all.length > 1 ? all : (all[0] ?? "");
  }
  return v;
};

async function guard(action: Action) {
  try { return { staff: await assertPermission(action), error: null as string | null }; }
  catch (e) { return { staff: null, error: e instanceof ForbiddenError ? e.message : "Not allowed." }; }
}

const FK_MSG = "One of the linked records (organization, exam, recruitment, …) does not exist any more. Reload the page and choose again.";
const friendly = (e: { code?: string; message?: string }) => (e.code === "23503" ? FK_MSG : e.code === "23505" ? "That URL slug is already used. Choose a different one." : dbMessage(e));

export async function saveContentAction(_prev: ContentFormState, fd: FormData): Promise<ContentFormState> {
  const values = echo(fd); const nonce = Date.now();
  const cfg = contentCfgByKind(String(fd.get("_kind") ?? ""));
  if (!cfg) return { error: "Unknown content type.", values, nonce };
  const rawId = String(fd.get("id") ?? "");
  const id = rawId ? (uuid.safeParse(rawId).success ? rawId : null) : undefined;
  if (id === null) return { error: "Invalid reference.", values, nonce };
  const intent = ["save", "submit", "publish"].includes(String(fd.get("intent"))) ? String(fd.get("intent")) : "save";

  const g = await guard(`${cfg.kind}:${id ? "edit" : "create"}` as Action);
  if (g.error) return { error: g.error, values, nonce };
  const staff = g.staff!;
  const { errors, row, slug, editorialNotes, markSourceChecked } = parseContentForm(cfg, fd);
  if (Object.keys(errors).length) return { error: "Please fix the highlighted fields.", fieldErrors: errors, values, nonce };

  const db = await createSupabaseServerClient();
  let status: ContentStatus | null = null;
  if (id) {
    const cur = await db.from(cfg.table).select("status,slug").eq("id", id).maybeSingle();
    status = (cur.data?.status as ContentStatus | undefined) ?? null;
    if (!status) return { error: "This record no longer exists or you cannot access it.", values, nonce };
    if (LIVE.includes(status) && !can(staff.role, `${cfg.kind}:publish` as Action)) return { error: "This record is live. Only users who can publish may change it. Ask an editor or admin, or unpublish it first.", values, nonce };
    if (status === "expired" || status === "archived") return { error: `${status === "expired" ? "Expired" : "Archived"} records cannot be edited. Use the workflow buttons to extend or restore it first.`, values, nonce };
    if (slug && slug !== cur.data?.slug && (status === "draft" || status === "review")) row.slug = slug;
  } else if (slug) row.slug = slug;
  if (intent === "submit" && !can(staff.role, `${cfg.kind}:edit` as Action)) return { error: "You cannot submit for review.", values, nonce };
  if (intent === "publish" && !can(staff.role, `${cfg.kind}:publish` as Action)) return { error: "You do not have permission to publish.", values, nonce };
  if (markSourceChecked) row.source_checked_at = new Date().toISOString();

  let recordId = id ?? "";
  if (id) {
    const u = await db.from(cfg.table).update(row).eq("id", id).select("id");
    if (u.error) return { error: friendly(u.error), values, nonce };
    if (!u.data?.length) return { error: "Nothing was saved (record not found, or you lack permission).", values, nonce };
  } else {
    const ins = await db.from(cfg.table).insert(row).select("id").single();
    if (ins.error) return { error: friendly(ins.error), values, nonce };
    recordId = ins.data.id;
  }
  const n = await db.from("content_internal").upsert({ kind: cfg.kind, content_id: recordId, editorial_notes: editorialNotes, updated_at: new Date().toISOString() }, { onConflict: "kind,content_id" });
  if (n.error) return { error: friendly(n.error), values, nonce };

  const reason = String(fd.get("change_reason") ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 500);
  if (reason && id && status && LIVE.includes(status)) await db.rpc("annotate_latest_version", { p_kind: cfg.kind, p_id: recordId, p_reason: reason });
  let notice = id ? (status && LIVE.includes(status) ? "updated" : "saved") : "saved";
  const to: ContentStatus | null = intent === "submit" && (!status || status === "draft") ? "review" : intent === "publish" && status === "review" ? "published" : null;
  if (to) {
    const t = await db.rpc("transition_content", { p_kind: cfg.kind, p_id: recordId, p_to: to, p_comment: null });
    if (t.error) { refreshPublic(); redirect(`/admin/${cfg.route}/${recordId}?error=${encodeURIComponent(`Saved, but it could not be ${to === "review" ? "submitted" : "published"}: ${friendly(t.error)}`)}`); }
    notice = to === "review" ? "submitted" : "published";
    if (to === "published") log("info", "content.published", { kind: cfg.kind, id: recordId });
  }
  refreshPublic();
  redirect(`/admin/${cfg.route}/${recordId}?notice=${notice}`);
}

export async function transitionContentAction(_prev: ContentWorkflowState, fd: FormData): Promise<ContentWorkflowState> {
  const cfg = contentCfgByKind(String(fd.get("_kind") ?? ""));
  if (!cfg) return { error: "Unknown content type." };
  const parsed = z.object({ id: uuid, to: z.enum(STATUSES), comment: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string().max(1000).optional()) })
    .safeParse({ id: fd.get("id"), to: fd.get("to"), comment: fd.get("comment") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { id, to, comment } = parsed.data;
  const db = await createSupabaseServerClient();
  const cur = await db.from(cfg.table).select("status").eq("id", id).maybeSingle();
  const from = cur.data?.status as ContentStatus | undefined;
  if (!from) return { error: "This record no longer exists or you cannot access it." };
  const rule = workflow.find((w) => w.kind === cfg.kind && w.from === from && w.to === to);
  if (!rule) return { error: `A record cannot move from ${from} to ${to}.` };
  const g = await guard(rule.action);
  if (g.error) return { error: g.error };
  const r = await db.rpc("transition_content", { p_kind: cfg.kind, p_id: id, p_to: to, p_comment: comment ?? null });
  if (r.error) return { error: friendly(r.error) };
  log("info", to === "published" || to === "updated" ? "content.published" : to === "draft" ? "content.unpublished" : "admin.change", { kind: cfg.kind, id, to });
  refreshPublic();
  redirect(`/admin/${cfg.route}/${id}?notice=t_${to}`);
}

export async function deleteContentAction(_prev: ContentWorkflowState, fd: FormData): Promise<ContentWorkflowState> {
  const cfg = contentCfgByKind(String(fd.get("_kind") ?? ""));
  const id = uuid.safeParse(fd.get("id"));
  if (!cfg || !id.success) return { error: "Invalid reference." };
  if (fd.get("confirm") !== "on") return { error: "Tick the confirmation box to delete." };
  const g = await guard(`${cfg.kind}:delete` as Action);
  if (g.error) return { error: g.error };
  const db = await createSupabaseServerClient();
  const cur = await db.from(cfg.table).select("status").eq("id", id.data).maybeSingle();
  if (cur.data && cur.data.status !== "draft" && cur.data.status !== "archived") return { error: "Only drafts and archived records can be deleted. Unpublish or archive it first." };
  const r = await db.from(cfg.table).delete().eq("id", id.data).select("id");
  if (r.error) return { error: r.error.code === "23503" ? "Other records (jobs, admit cards, results…) still link to this. Archive it instead of deleting it." : dbMessage(r.error) };
  if (!r.data?.length) return { error: "Nothing was deleted (record not found, or you lack permission)." };
  await db.from("content_internal").delete().eq("kind", cfg.kind).eq("content_id", id.data);
  refreshPublic();
  redirect(`/admin/${cfg.route}?notice=deleted`);
}
