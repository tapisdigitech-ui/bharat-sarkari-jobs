import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/admin/permissions";
import { todayIST } from "@/lib/dates";
import { jobFormOptions } from "@/lib/admin/options";
import { JobForm, type Values } from "@/components/admin/JobForm";

export const metadata: Metadata = { title: "New job" };
export const dynamic = "force-dynamic";

const DEFAULTS: Values = { level: "central", job_type: "permanent", employment_type: "", state_slug: "", qualification_slugs: [], category_slugs: [], vacancy_post: [], vacancy_category: [], vacancy_count: [] };

export default async function NewJob() {
  const staff = await requireStaff("job:create");
  return (
    <div className="space-y-5">
      <div><Link href="/admin/jobs" className="text-sm text-brand-700 underline">← All jobs</Link><h1 className="mt-1 text-2xl font-extrabold">New job</h1>
        <p className="text-sm text-ink-muted">Saved as a draft. Drafts are never public. Publishing needs an official source.</p></div>
      <JobForm options={await jobFormOptions()} initial={DEFAULTS} sourceCheckedAt={null} lastVerifiedAt={null} today={todayIST()} canSave canSubmit={can(staff.role, "job:edit")} canPublish={false} />
    </div>
  );
}
