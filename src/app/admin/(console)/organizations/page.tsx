import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRef } from "@/lib/data/ref";
import { refOptionSets } from "@/lib/admin/reference-config";
import { Pagination } from "@/components/ui/Pagination";

export const metadata: Metadata = { title: "Organizations" };
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
type Row = Record<string, any>;
const PAGE = 50;

export default async function OrganizationsPage({ searchParams }: Props) {
  await requireStaff("reference:manage");
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 80).replace(/[^\p{L}\p{N}\s.\-&]/gu, " ").trim();
  const show = ["active", "archived", "all"].includes(one(sp.show)) ? one(sp.show) : "active";
  const level = refOptionSets.levels.some(([v]) => v === one(sp.level)) ? one(sp.level) : "";
  const ref = await getRef();
  const state = one(sp.state) === "central" ? "central" : ref.allStates.find((s) => s.slug === one(sp.state))?.slug ?? "";
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const db = await createSupabaseServerClient();
  let query = db.from("organizations").select("*", { count: "exact" });
  if (show === "active") query = query.eq("is_active", true); else if (show === "archived") query = query.eq("is_active", false);
  if (q) query = query.or(`name.ilike.*${q}*,short_name.ilike.*${q}*,slug.ilike.*${q}*`);
  if (level) query = query.eq("level", level);
  if (state === "central") query = query.is("state_id", null); else if (state) query = query.eq("state_id", ref.allStates.find((s) => s.slug === state)!.id!);
  const res = await query.order("name").range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (res.data ?? []) as Row[];
  const pageCount = Math.max(1, Math.ceil((res.count ?? 0) / PAGE));
  const href = (p: number) => { const u = new URLSearchParams(); if (q) u.set("q", q); if (show !== "active") u.set("show", show); if (level) u.set("level", level); if (state) u.set("state", state); if (p > 1) u.set("page", String(p)); const s = u.toString(); return `/admin/organizations${s ? `?${s}` : ""}`; };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Organizations</h1><p className="mt-1 max-w-3xl text-sm text-ink-muted">Recruiting bodies — commissions, boards, ministries, PSUs, universities, district administrations. Reused by jobs, recruitments, exams, admit cards, results, answer keys and the source registry. Archive instead of deleting, so everything that refers to an organization keeps working.</p></div>
        <Link href="/admin/organizations/new" className="btn btn-accent">New organization</Link>
      </div>
      <form method="get" role="search" className="card grid grid-cols-1 gap-3 p-3 md:grid-cols-[1fr_10rem_12rem_10rem_auto]">
        <div><label htmlFor="q" className="mb-1 block text-xs font-semibold text-ink-muted">Search name / acronym</label><input id="q" name="q" defaultValue={q} className="input" /></div>
        <div><label htmlFor="level" className="mb-1 block text-xs font-semibold text-ink-muted">Level</label><select id="level" name="level" defaultValue={level} className="input"><option value="">All</option>{refOptionSets.levels.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label htmlFor="state" className="mb-1 block text-xs font-semibold text-ink-muted">State</label><select id="state" name="state" defaultValue={state} className="input"><option value="">All</option><option value="central">Central / all-India</option>{ref.allStates.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></div>
        <div><label htmlFor="show" className="mb-1 block text-xs font-semibold text-ink-muted">Show</label><select id="show" name="show" defaultValue={show} className="input"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></div>
        <div className="flex items-end"><button className="btn btn-outline w-full">Apply</button></div>
      </form>
      <div className="table-wrap card" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="w-full text-left text-sm"><caption className="sr-only">Organizations</caption>
        <thead className="border-b border-line bg-brand-50 text-xs uppercase tracking-wide text-ink-muted"><tr>{["Name", "Short", "Level", "State", "Official website", "Status"].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {!rows.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-muted">No organizations{q ? " match your search" : ""}.</td></tr>}
          {rows.map((r) => <tr key={r.id} data-testid="org-row" className={r.is_active ? undefined : "bg-canvas text-ink-muted"}>
            <th scope="row" className="px-3 py-2"><Link href={`/admin/organizations/${r.id}`} className="font-semibold text-brand-700 underline">{r.name}</Link></th>
            <td className="px-3 py-2">{r.short_name ?? "—"}</td><td className="px-3 py-2">{r.level}</td>
            <td className="px-3 py-2">{ref.allStates.find((s) => s.id === r.state_id)?.name ?? "Central / all-India"}</td>
            <td className="px-3 py-2 font-mono text-xs">{r.official_website ? new URL(r.official_website).hostname : "—"}</td>
            <td className="px-3 py-2">{r.is_active ? "Active" : "Archived"}</td></tr>)}
        </tbody></table></div>
      {pageCount > 1 && <Pagination page={page} pageCount={pageCount} hrefFor={href} />}
    </div>
  );
}
