import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAnyStaff } from "@/lib/auth/staff";
import { verifyPreviewToken } from "@/lib/auth/preview-token";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VERBS, type Action } from "@/lib/admin/permissions";
import { contentCfgByRoute } from "@/lib/admin/content-config";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { RecruitmentView } from "@/components/gov/RecruitmentView";
import { GovDetailView } from "@/components/gov/GovDetailView";
import { ExamHubView } from "@/components/gov/ExamHubView";
import { calendarForStaff, getExamHubById, getGovById, getRecruitmentById, jobsOfRecruitmentForStaff, loadExamHubDataForStaff, relatedGovForStaff } from "@/lib/data/staff-preview";

/**
 * Staff-only preview for content types (same rules as the job preview): inside /admin, signed expiring token bound to the record
 * and the staff member, read through the staff member's RLS session, noindex, and the same public view component (minus JSON-LD).
 */
export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ ref: string; id: string }>; searchParams: Promise<{ t?: string }> };

export default async function ContentPreview({ params, searchParams }: Props) {
  const { ref, id } = await params;
  const cfg = contentCfgByRoute(ref);
  if (!cfg || !cfg.previewable || !z.string().uuid().safeParse(id).success) notFound();
  const staff = await requireAnyStaff(VERBS.map((v) => `${cfg.kind}:${v}` as Action));
  const { t } = await searchParams;
  if (!verifyPreviewToken(t, cfg.kind, id, staff.user.id)) notFound();
  const db = await createSupabaseServerClient();

  let view: React.ReactNode = null; let status = "draft";
  if (cfg.kind === "recruitment") {
    const rec = await getRecruitmentById(id, db);
    if (!rec) notFound();
    status = rec.status;
    const link = { examId: rec.examId, recruitmentId: rec.id };
    const [jobs, admitCards, answerKeys, results, calendar] = await Promise.all([
      jobsOfRecruitmentForStaff(rec.id, db),
      relatedGovForStaff("admit_card", link, 3, db), relatedGovForStaff("answer_key", link, 3, db), relatedGovForStaff("result", link, 3, db), calendarForStaff(link, 2, db),
    ]);
    view = <RecruitmentView rec={rec} jobs={jobs} crossLinks={{ admitCards, answerKeys, results, calendar }} preview />;
  }
  if (cfg.kind === "admit_card" || cfg.kind === "result" || cfg.kind === "answer_key") {
    const item = await getGovById(cfg.kind, id, db);
    if (!item) notFound();
    status = item.status;
    view = <GovDetailView item={item} preview />;
  }
  if (cfg.kind === "exam") {
    const exam = await getExamHubById(id, db);
    if (!exam) notFound();
    status = exam.status;
    view = <ExamHubView data={await loadExamHubDataForStaff(exam, db)} preview />;
  }
  if (!view) notFound();
  return (
    <div>
      <div role="note" className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-warning-700/30 bg-warning-50 px-4 py-2 text-sm text-warning-700">
        <span><strong>Preview</strong> — staff only, not public, not indexed. This is how the page will look to readers. <StatusBadge status={status as never} /></span>
        <Link href={`/admin/${cfg.route}/${id}`} className="underline">← Back to editor</Link>
      </div>
      {view}
    </div>
  );
}
