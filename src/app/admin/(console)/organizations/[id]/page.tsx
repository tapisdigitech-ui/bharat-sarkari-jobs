import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { refKinds } from "@/lib/admin/reference-config";
import { orgOptions } from "@/lib/admin/org-options";
import { getRef } from "@/lib/data/ref";
import { ReferenceForm } from "@/components/admin/ReferenceForm";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { KIND_LABEL, KIND_TABLE, KIND_TITLE_FIELD, adminHref } from "@/lib/admin/kinds";
import { sourceStatusClass, sourceStatusLabel } from "@/lib/sources/config";
import { setActiveAction } from "../../[ref]/actions";
import type { ContentKind } from "@/lib/admin/permissions";
import type { ContentStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Organization" };
export const dynamic = "force-dynamic";
type Row = Record<string, any>;
const NOTICE: Record<string, string> = { created: "Organization created.", archived: "Archived. Existing records keep pointing to it; it is no longer offered for new ones.", restored: "Restored." };
const RELATED: ContentKind[] = ["recruitment", "job", "exam", "result", "admit_card", "answer_key", "exam_calendar"];

export default async function OrganizationDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  await requireStaff("reference:manage");
  const { id } = await params; const { notice } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const db = await createSupabaseServerClient();
  const { data } = await db.from("organizations").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const o = data as Row;
  const ref = await getRef();
  const [usage, sources, ...lists] = await Promise.all([
    db.rpc("organization_usage", { p_org: id }),
    db.from("government_sources").select("id,name,status,official_domain").eq("organization_id", id).order("name"),
    ...RELATED.map((k) => db.from(KIND_TABLE[k]).select(`id,${KIND_TITLE_FIELD[k]},status,updated_at`).eq("organization_id", id).order("updated_at", { ascending: false }).limit(8)),
  ]);
  const u = (usage.data ?? {}) as Record<string, number>;
  const countKey: Record<ContentKind, string> = { job: "jobs", recruitment: "recruitments", exam: "exams", admit_card: "admit_cards", result: "results", answer_key: "answer_keys", exam_calendar: "exam_calendar" };
  const initial: Record<string, string> = {
    name: o.name, slug: o.slug, short_name: o.short_name ?? "", level: o.level, department_slug: ref.allDepartments.find((d) => d.id === o.department_id)?.slug ?? "",
    state_slug: ref.allStates.find((s) => s.id === o.state_id)?.slug ?? "", district_id: o.district_id ? String(o.district_id) : "", official_website: o.official_website ?? "",
    description: o.description ?? "", is_active: o.is_active ? "on" : "",
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><Link href="/admin/organizations" className="text-sm text-brand-700 underline">← Organizations</Link>
          <h1 className="mt-1 break-words text-2xl font-extrabold">{o.name}</h1>
          <p className="mt-1 text-sm text-ink-muted"><span className="font-mono">{o.slug}</span> · {o.level} · {ref.allStates.find((s) => s.id === o.state_id)?.name ?? "Central / all-India"} · {o.is_active ? "Active" : "Archived"}</p></div>
        <form action={setActiveAction}><input type="hidden" name="_ref" value="organizations" /><input type="hidden" name="id" value={id} /><input type="hidden" name="active" value={o.is_active ? "0" : "1"} /><input type="hidden" name="_return" value={`/admin/organizations/${id}`} />
          <button className="btn btn-outline">{o.is_active ? "Archive" : "Restore"}</button></form>
      </div>
      {notice && NOTICE[notice] && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">{NOTICE[notice]}</p>}

      <section aria-labelledby="use-h" className="card p-4"><h2 id="use-h" className="font-bold">Used by</h2>
        <ul className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{[...RELATED.map((k) => [KIND_LABEL[k], u[countKey[k]] ?? 0] as const), ["Official sources", u.sources ?? 0] as const].map(([l, n]) => <li key={l} className="rounded-md border border-line p-2"><span className="text-ink-muted">{l}</span><p className="text-xl font-bold">{n}</p></li>)}</ul></section>

      <section aria-labelledby="src-h" className="card p-4"><h2 id="src-h" className="font-bold">Official sources</h2>
        {!(sources.data ?? []).length ? <p className="mt-1 text-sm text-ink-muted">No source registered. <Link href="/admin/sources/new" className="underline">Register one</Link>.</p>
          : <ul className="mt-2 space-y-1 text-sm">{((sources.data ?? []) as Row[]).map((s) => <li key={s.id}><Link href={`/admin/sources/${s.id}`} className="text-brand-700 underline">{s.name}</Link> <span className="font-mono text-xs text-ink-muted">{s.official_domain}</span> <span className={`badge ${sourceStatusClass(s.status)}`}>{sourceStatusLabel(s.status)}</span></li>)}</ul>}</section>

      <div className="grid gap-5 lg:grid-cols-2">{RELATED.map((k, i) => { const rows = ((lists[i] as { data: Row[] | null }).data ?? []) as Row[]; return (
        <section key={k} aria-labelledby={`rel-${k}`} className="card p-4"><h2 id={`rel-${k}`} className="font-bold">{KIND_LABEL[k]}s <span className="font-normal text-ink-muted">({u[countKey[k]] ?? rows.length})</span></h2>
          {!rows.length ? <p className="mt-1 text-sm text-ink-muted">None.</p> : <ul className="mt-2 space-y-1 text-sm">{rows.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><Link href={adminHref(k, r.id)} className="text-brand-700 underline">{r[KIND_TITLE_FIELD[k]]}</Link><StatusBadge status={r.status as ContentStatus} /></li>)}</ul>}
        </section>); })}</div>

      <ReferenceForm cfg={refKinds.organizations} options={await orgOptions()} initial={initial} id={id} />
    </div>
  );
}
