import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAnyStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, transitionsFor, isLiveStatus, VERBS, type Action } from "@/lib/admin/permissions";
import { contentCfgByRoute } from "@/lib/admin/content-config";
import { contentOptions } from "@/lib/admin/content-options";
import { clientCfg } from "@/lib/admin/client-cfg";
import { formatDateTimeIST } from "@/lib/admin/format";
import { makePreviewToken } from "@/lib/auth/preview-token";
import { ContentForm } from "@/components/admin/ContentForm";
import { ContentWorkflowPanel } from "@/components/admin/ContentWorkflowPanel";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { RecordOps } from "@/components/admin/RecordOps";
import type { ContentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ ref: string; id: string }>; searchParams: Promise<{ notice?: string; error?: string; links?: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { const c = contentCfgByRoute((await params).ref); return { title: c ? `Edit ${c.label.toLowerCase()}` : "Not found" }; }

const NOTICES: Record<string, string> = {
  t_review: "Submitted for review.", t_draft: "Moved back to draft (not public).", t_published: "Published. It is now live on the public site.", t_updated: "Re-published. It is live again.",
  t_expired: "Marked expired.", t_archived: "Archived.",
  saved: "Saved.", submitted: "Saved and submitted for review.", published: "Published. It is now live on the public site.", updated: "Saved. The live page has been updated.",
};
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export default async function EditContent({ params, searchParams }: Props) {
  const { ref, id } = await params;
  const cfg = contentCfgByRoute(ref);
  if (!cfg || !z.string().uuid().safeParse(id).success) notFound();
  const staff = await requireAnyStaff(VERBS.map((v) => `${cfg.kind}:${v}` as Action));
  const { notice, error, links } = await searchParams;
  const act = (v: string) => can(staff.role, `${cfg.kind}:${v}` as Action);

  const db = await createSupabaseServerClient();
  const [rec, internal] = await Promise.all([
    db.from(cfg.table).select("*").eq("id", id).maybeSingle(),
    db.from("content_internal").select("editorial_notes,review_comment").eq("kind", cfg.kind).eq("content_id", id).maybeSingle(),
  ]);
  if (rec.error) throw new Error(rec.error.message);
  if (!rec.data) notFound();
  const r = rec.data as Row;
  const status = r.status as ContentStatus;

  const initial: Record<string, string | string[]> = {};
  for (const sec of cfg.sections) for (const f of sec.fields) {
    if (f.type === "scope") initial.state_id = r.is_all_india ? "all-india" : s(r.state_id);
    else if (f.type === "datestatus") { initial[f.name] = s(r[f.name]); initial[`${f.name}_status`] = s(r[`${f.name}_status`]); initial[`${f.name}_text`] = s(r[`${f.name}_text`]); }
    else if (f.type === "datelist") {
      const list = Array.isArray(r[f.name]) ? (r[f.name] as { label: string; status: string; date: string | null; text: string | null }[]) : [];
      initial[`${f.name}_label`] = list.map((x) => x.label); initial[`${f.name}_status`] = list.map((x) => x.status);
      initial[`${f.name}_date`] = list.map((x) => x.date ?? ""); initial[`${f.name}_text`] = list.map((x) => x.text ?? "");
    }
    else if (f.type === "lines") initial[f.name] = Array.isArray(r[f.name]) ? (r[f.name] as string[]) : [];
    else if (f.type === "checkbox") { if (f.name !== "source_checked_at") initial[f.name] = r[f.name] ? "on" : ""; }
    else initial[f.name] = s(r[f.name]);
  }
  initial.editorial_notes = s(internal.data?.editorial_notes);

  const live = isLiveStatus(status);
  const frozen = status === "expired" || status === "archived";
  const canEdit = act("edit") && !frozen && (!live || act("publish"));
  const readOnlyReason = !act("edit") ? `Your role can review this ${cfg.label.toLowerCase()} but not edit it.`
    : frozen ? `${status === "expired" ? "Expired" : "Archived"} records are read-only. Use the workflow below to extend or restore it.`
    : live && !act("publish") ? "This record is live. Only users who can publish may change live content." : undefined;
  const transitions = transitionsFor(staff.role, status, cfg.kind).map((t) => ({ to: t.to, label: t.label }));
  const title = s(r[cfg.titleField]);
  const publicHref = cfg.publicPath && r.slug ? cfg.publicPath(String(r.slug)) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/admin/${cfg.route}`} className="text-sm text-brand-700 underline">← All {cfg.plural.toLowerCase()}</Link>
          <h1 className="mt-1 break-words text-2xl font-extrabold">{title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted"><StatusBadge status={status} /> updated {formatDateTimeIST(s(r.updated_at))}
            {live && publicHref && <Link href={publicHref} target="_blank" rel="noopener" className="underline">View public page</Link>}</p>
        </div>
        {cfg.previewable && <Link href={`/admin/${cfg.route}/${id}/preview?t=${makePreviewToken(cfg.kind, id, staff.user.id)}`} target="_blank" rel="noopener" className="btn btn-outline btn-sm">Preview (staff only)</Link>}
      </div>
      {notice && NOTICES[notice] && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">{NOTICES[notice]}</p>}
      {error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">{error.slice(0, 400)}</p>}

      <ContentWorkflowPanel kind={cfg.kind} label={cfg.label} id={id} status={status} transitions={transitions} canDelete={act("delete")} reviewComment={s(internal.data?.review_comment) || undefined} />
      <ContentForm cfg={clientCfg(cfg)} options={await contentOptions()} id={id} status={status} initial={initial} sourceCheckedAt={s(r.source_checked_at) || null}
        canSave={canEdit} canSubmit={act("edit")} canPublish={act("publish")} readOnlyReason={readOnlyReason} liveEditNote={live} />
      <RecordOps kind={cfg.kind} id={id} row={r} linksNotice={links} />
    </div>
  );
}
