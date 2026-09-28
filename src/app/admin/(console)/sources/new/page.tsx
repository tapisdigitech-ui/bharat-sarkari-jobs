import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SourceForm } from "@/components/admin/SourceForm";
import { sourceFormOptions } from "@/lib/sources/options";

export const metadata: Metadata = { title: "Register source" };
export const dynamic = "force-dynamic";

export default async function NewSource() {
  await requireStaff("source:manage");
  const db = await createSupabaseServerClient();
  return (
    <div className="space-y-5">
      <div><Link href="/admin/sources" className="text-sm text-brand-700 underline">← Source registry</Link>
        <h1 className="mt-1 text-2xl font-extrabold">Register an official source</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">Confirm the domain belongs to the government body (its own website, or an official NIC-hosted address). New sources start as “Review required”: run one manual check, compare what it found with the official page, then set it Active.</p></div>
      <SourceForm options={await sourceFormOptions(db)} initial={{ status: "REVIEW_REQUIRED", source_priority: "normal", check_interval_hours: "24", adapter: "generic-listing", authority_rank: "1" }} />
    </div>
  );
}
