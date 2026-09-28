import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { JOB_ACTIONS, requireAnyStaff } from "@/lib/auth/staff";
import { verifyPreviewToken } from "@/lib/auth/preview-token";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { JobDetailView } from "@/components/jobs/JobDetailView";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { mapJob, type JobRow } from "@/lib/data/supabase/mapper";
import { relatedJobs } from "@/lib/data";
import { calendarForStaff, relatedGovForStaff } from "@/lib/data/staff-preview";
import { listCategories } from "@/lib/data/ref";
import type { ContentStatus } from "@/lib/types";

/**
 * Staff-only draft preview. Never public, never indexed, never listed:
 *  - lives under /admin (proxy + console layout + this page all require a verified active staff session),
 *  - needs a signed, expiring token bound to this job and this staff member (non-guessable),
 *  - reads through the signed-in user's RLS session (not the service role),
 *  - robots noindex,nofollow (metadata) and the /admin tree is disallowed in robots.txt,
 *  - renders the same JobDetailView as the public page, minus JSON-LD and the sticky apply bar.
 */
export const metadata: Metadata = { title: "Job preview", robots: { index: false, follow: false, nocache: true } };
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> };

export default async function JobPreview({ params, searchParams }: Props) {
  const staff = await requireAnyStaff(JOB_ACTIONS);
  const { id } = await params;
  const { t } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  if (!verifyPreviewToken(t, "job", id, staff.user.id)) notFound();   // 404, not 403: don't confirm the record exists

  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("jobs_v").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) notFound();
  const v = await db.from("job_vacancies").select("post_name,category,count").eq("job_id", id).order("sort_order");
  const job = mapJob(data as unknown as JobRow, (v.data ?? []).map((x) => ({ post: x.post_name, category: x.category ?? undefined, count: x.count })));
  const related = job.status === "published" || job.status === "updated" ? await relatedJobs(job) : [];
  const link = { examId: job.examId, recruitmentId: job.recruitmentId };
  const crossLinks = link.examId || link.recruitmentId
    ? { admitCards: await relatedGovForStaff("admit_card", link, 3, db), answerKeys: await relatedGovForStaff("answer_key", link, 3, db), results: await relatedGovForStaff("result", link, 3, db), calendar: await calendarForStaff(link, 2, db) }
    : { admitCards: [], answerKeys: [], results: [], calendar: [] };

  return (
    <div>
      <div role="note" className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-warning-700/30 bg-warning-50 px-4 py-2 text-sm text-warning-700">
        <span><strong>Preview</strong> — staff only, not public, not indexed. This is how the page will look to readers. <StatusBadge status={job.status as ContentStatus} /></span>
        <Link href={`/admin/jobs/${id}`} className="underline">← Back to editor</Link>
      </div>
      <JobDetailView job={job} related={related} crossLinks={crossLinks} preview categoryNames={Object.fromEntries((await listCategories()).map((c) => [c.slug, c.name]))} />
    </div>
  );
}
