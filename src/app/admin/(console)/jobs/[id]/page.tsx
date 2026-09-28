import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { makePreviewToken } from "@/lib/auth/preview-token";
import { JOB_ACTIONS, requireAnyStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, transitionsFor, isLiveStatus } from "@/lib/admin/permissions";
import { todayIST } from "@/lib/dates";
import { formatDateTimeIST } from "@/lib/admin/format";
import { jobFormOptions } from "@/lib/admin/options";
import { RecordOps } from "@/components/admin/RecordOps";
import { JobForm, type Values } from "@/components/admin/JobForm";
import { WorkflowPanel } from "@/components/admin/WorkflowPanel";
import { StatusBadge } from "@/components/admin/StatusBadge";
import type { ContentStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Edit job" };
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string; links?: string }> };

const NOTICES: Record<string, string> = {
  saved: "Saved.", submitted: "Saved and submitted for review.", published: "Published. It is now live on the public site.", updated: "Saved. The live page has been updated.",
  duplicated: "Duplicated as a new draft. Review it, re-check the source, then continue.",
};

 
type Row = Record<string, any>;
const s = (v: unknown) => (v == null ? "" : String(v));
const lines = (v: unknown) => (Array.isArray(v) ? v.join("\n") : "");

export default async function EditJob({ params, searchParams }: Props) {
  const staff = await requireAnyStaff(JOB_ACTIONS);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { notice, error, links } = await searchParams;

  const db = await createSupabaseServerClient();
  const [job, vac, internal] = await Promise.all([
    db.from("jobs_v").select("*").eq("id", id).maybeSingle(),
    db.from("job_vacancies").select("post_name,category,count,sort_order").eq("job_id", id).order("sort_order"),
    db.from("job_internal").select("editorial_notes,review_comment").eq("job_id", id).maybeSingle(),
  ]);
  if (job.error) throw new Error(job.error.message);
  if (!job.data) notFound();
  const j = job.data as Row;
  const status = j.status as ContentStatus;
  const vrows = (vac.data ?? []) as Row[];

  const initial: Values = {
    title: s(j.title), short_title: s(j.short_title), slug: s(j.slug), organization_name: s(j.organization), department_slug: s(j.department_slug),
    advertisement_no: s(j.advertisement_no), level: s(j.level), job_type: s(j.job_type), employment_type: s(j.employment_type),
    state_slug: s(j.state_slug), district_slug: s(j.district_slug), district_text: s(j.district_text), work_location: s(j.work_location),
    total_vacancies: s(j.total_vacancies), vacancy_post: vrows.map((r) => s(r.post_name)), vacancy_category: vrows.map((r) => s(r.category)), vacancy_count: vrows.map((r) => s(r.count)),
    qualification_slugs: (j.qualification_slugs ?? []) as string[], category_slugs: (j.category_slugs ?? []) as string[], qualification_details: s(j.qualification_details), experience_text: s(j.experience_text),
    age_min: s(j.age_min), age_max: s(j.age_max), age_relaxation: s(j.age_relaxation), salary_text: s(j.salary_text), pay_level: s(j.pay_level),
    fee_general: s(j.fee_general), fee_reserved: s(j.fee_reserved), fee_note: s(j.fee_note),
    fresher_friendly: j.fresher_friendly ? "on" : "", women_only: j.women_only ? "on" : "",
    notification_date: s(j.notification_date), application_start_date: s(j.application_start_date), last_date: s(j.last_date), correction_date: s(j.correction_date),
    exam_date: s(j.exam_date), exam_date_status: s(j.exam_date_status), exam_date_text: s(j.exam_date_text),
    admit_card_date: s(j.admit_card_date), admit_card_date_status: s(j.admit_card_date_status), admit_card_date_text: s(j.admit_card_date_text),
    result_date: s(j.result_date), result_date_status: s(j.result_date_status), result_date_text: s(j.result_date_text),
    recruitment_id: s(j.recruitment_id), exam_id: s(j.exam_id),
    selection_process: lines(j.selection_process), exam_pattern: lines(j.exam_pattern), syllabus_summary: s(j.syllabus_summary),
    interview_details: s(j.interview_details), physical_test_details: s(j.physical_test_details), skill_test_details: s(j.skill_test_details),
    document_verification_details: s(j.document_verification_details), other_stages_details: s(j.other_stages_details),
    notification_url: s(j.notification_url), official_apply_url: s(j.official_apply_url), official_website_url: s(j.official_website_url),
    source_name: s(j.source_name), source_url: s(j.source_url), source_type: s(j.source_type),
    summary: s(j.summary), eligibility_explanation: s(j.eligibility_explanation), how_to_apply: lines(j.how_to_apply), documents_required: lines(j.documents_required),
    important_instructions: s(j.important_instructions), editorial_notes: s(internal.data?.editorial_notes),
  };

  const live = isLiveStatus(status);
  const frozen = status === "expired" || status === "archived";
  const canEdit = can(staff.role, "job:edit") && !frozen && (!live || can(staff.role, "job:publish"));
  const readOnlyReason = !can(staff.role, "job:edit") ? "Your role can review this job but not edit it."
    : frozen ? `${status === "expired" ? "Expired" : "Archived"} jobs are read-only. Use the workflow below to extend or restore it.`
    : live && !can(staff.role, "job:publish") ? "This job is live. Only users who can publish may change live content." : undefined;
  const transitions = transitionsFor(staff.role, status).map((t) => ({ to: t.to, label: t.label }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/jobs" className="text-sm text-brand-700 underline">← All jobs</Link>
          <h1 className="mt-1 break-words text-2xl font-extrabold">{s(j.title)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted"><StatusBadge status={status} /> {s(j.organization)} · updated {formatDateTimeIST(j.updated_at)}
            {live && <Link href={`/jobs/${j.slug}`} target="_blank" rel="noopener" className="underline">View public page</Link>}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/jobs/${id}/preview?t=${makePreviewToken("job", id, staff.user.id)}`} target="_blank" rel="noopener" className="btn btn-outline btn-sm">Preview (staff only)</Link>
        </div>
      </div>
      {notice && NOTICES[notice] && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">{NOTICES[notice]}</p>}
      {error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">{error.slice(0, 400)}</p>}

      <WorkflowPanel id={id} status={status} transitions={transitions} today={todayIST()} canDelete={can(staff.role, "job:delete")} reviewComment={s(internal.data?.review_comment) || undefined} />

      <JobForm options={await jobFormOptions()} id={id} status={status} initial={initial} sourceCheckedAt={j.source_checked_at ?? null} lastVerifiedAt={j.last_verified_at ?? null} today={todayIST()}
        canSave={canEdit} canSubmit={can(staff.role, "job:edit")} canPublish={can(staff.role, "job:publish")} readOnlyReason={readOnlyReason} liveEditNote={live} />
      <RecordOps kind="job" id={id} row={j} linksNotice={links} />
    </div>
  );
}
