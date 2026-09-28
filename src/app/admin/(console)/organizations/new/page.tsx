import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { refKinds } from "@/lib/admin/reference-config";
import { orgOptions } from "@/lib/admin/org-options";
import { ReferenceForm } from "@/components/admin/ReferenceForm";

export const metadata: Metadata = { title: "New organization" };
export const dynamic = "force-dynamic";

export default async function NewOrganization() {
  await requireStaff("reference:manage");
  return (
    <div className="space-y-5">
      <div><Link href="/admin/organizations" className="text-sm text-brand-700 underline">← Organizations</Link><h1 className="mt-1 text-2xl font-extrabold">New organization</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">Use the organization&rsquo;s official name as it appears on its own website or notifications. Record the official website: its domain is used to check that “official” links really point to this organization.</p></div>
      <ReferenceForm cfg={refKinds.organizations} options={await orgOptions()} initial={{ is_active: "on", level: "central" }} />
    </div>
  );
}
