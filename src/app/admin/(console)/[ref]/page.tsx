import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { refKinds, refOptionSets } from "@/lib/admin/reference-config";
import { getRef, listAllDistricts } from "@/lib/data/ref";
import { DistrictImport, ReferenceForm, type RefOptions } from "@/components/admin/ReferenceForm";
import { Pagination } from "@/components/ui/Pagination";
import { mergeReferenceAction, setActiveAction } from "./actions";
import { contentCfgByRoute } from "@/lib/admin/content-config";
import { ContentListPage } from "@/components/admin/ContentList";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
type Props = { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
type Row = Record<string, unknown> & { id: string | number; slug: string; name: string; is_active: boolean };

export async function generateMetadata({ params }: Props): Promise<Metadata> { const r = (await params).ref; const c = refKinds[r]; return { title: c?.title ?? contentCfgByRoute(r)?.plural ?? "Not found" }; }

export default async function ReferenceAdmin({ params, searchParams }: Props) {
  const { ref: kind } = await params;
  const content = contentCfgByRoute(kind);
  if (content) return <ContentListPage cfg={content} sp={await searchParams} />;
  const cfg = refKinds[kind];
  if (!cfg) notFound();
  await requireStaff("reference:manage");
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 80).replace(/[^\p{L}\p{N}\s\-.&]/gu, " ").trim();
  const show = ["active", "archived", "all"].includes(one(sp.show)) ? one(sp.show) : "active";
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const editId = one(sp.edit);

  const [ref, allDistricts] = await Promise.all([getRef(), cfg.kind === "organizations" ? listAllDistricts() : Promise.resolve([])]);
  const stateSlug = cfg.kind === "districts" ? ref.allStates.find((s) => s.slug === one(sp.state))?.slug ?? "" : "";
  const options: RefOptions = {
    ...refOptionSets,
    states: ref.allStates.map((s) => [s.slug, s.name]), departments: ref.allDepartments.map((d) => [d.slug, d.name]),
    districts: allDistricts.map((d) => [String(d.id), `${ref.allStates.find((x) => x.slug === d.stateSlug)?.name ?? d.stateSlug} — ${d.name}`]),
  } as RefOptions;
  const mergeable = cfg.kind === "qualifications" || cfg.kind === "categories";
  const mergeRows = mergeable ? (((await (await createSupabaseServerClient()).from(cfg.table).select("id,name,is_active,merged_into_id").order("name")).data ?? []) as { id: number; name: string; is_active: boolean; merged_into_id: number | null }[]) : [];

  const db = await createSupabaseServerClient();
  let rows: Row[] = []; let total = 0; let listError: string | null = null;
  if (cfg.kind !== "districts" || stateSlug) {
    let query = db.from(cfg.table).select("*", { count: "exact" });
    if (show === "active") query = query.eq("is_active", true); else if (show === "archived") query = query.eq("is_active", false);
    if (q) query = query.or(`name.ilike.*${q}*,slug.ilike.*${q}*`);
    if (stateSlug) query = query.eq("state_id", ref.allStates.find((s) => s.slug === stateSlug)!.id!);
    const res = await query.order(cfg.order, { ascending: true }).order("name").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (res.error) listError = res.error.message; else { rows = res.data as unknown as Row[]; total = res.count ?? 0; }
  }
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => { const u = new URLSearchParams(); if (q) u.set("q", q); if (show !== "active") u.set("show", show); if (stateSlug) u.set("state", stateSlug); if (p > 1) u.set("page", String(p)); const s = u.toString(); return `/admin/${cfg.kind}${s ? `?${s}` : ""}`; };

  // Values for the edit form (relations turned back into slugs).
  let editing: Row | undefined; let initial: Record<string, string> = { is_active: "on" };
  if (editId) {
    const res = await db.from(cfg.table).select("*").eq("id", editId).maybeSingle();
    editing = (res.data ?? undefined) as Row | undefined;
    if (editing) {
      initial = {};
      for (const f of cfg.fields) {
        if (f.rel) { const id = editing[f.rel.column] as number | null; const list = f.rel.table === "states" ? ref.allStates : ref.allDepartments; initial[f.name] = list.find((x) => x.id === id)?.slug ?? ""; }
        else if (f.type === "checkbox") initial[f.name] = editing[f.name] ? "on" : "";
        else initial[f.name] = editing[f.name] == null ? "" : String(editing[f.name]);
      }
    }
  }
  const stateName = (id: unknown) => ref.allStates.find((s) => s.id === id)?.name ?? "";
  const deptName = (id: unknown) => ref.allDepartments.find((d) => d.id === id)?.name ?? "";

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-extrabold">{cfg.title}</h1><p className="mt-1 max-w-3xl text-sm text-ink-muted">{cfg.description}</p></div>

      <ReferenceForm key={editing ? String(editing.id) : "new"} cfg={cfg} options={options} initial={initial} id={editing ? String(editing.id) : undefined} />
      {cfg.kind === "districts" && <DistrictImport states={options.states} />}
      {mergeable && (
        <form action={mergeReferenceAction} className="card grid grid-cols-1 gap-3 p-4 md:grid-cols-[1fr_1fr_auto]" aria-label={`Merge ${cfg.title.toLowerCase()}`}>
          <input type="hidden" name="_ref" value={cfg.kind} />
          <p className="text-sm text-ink-muted md:col-span-3"><strong className="text-ink">Merge duplicates.</strong> Every job using the first entry moves to the second; the first is archived and remembers where it went. Nothing is deleted.</p>
          {one(sp.merged) && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700 md:col-span-3">Merged. {one(sp.merged)} job(s) moved.</p>}
          {one(sp.merge_error) && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700 md:col-span-3">{one(sp.merge_error).slice(0, 200)}</p>}
          <div><label htmlFor="m-from" className="mb-1 block text-xs font-semibold text-ink-muted">Merge this…</label><select id="m-from" name="from" className="input">{mergeRows.filter((r) => !r.merged_into_id).map((r) => <option key={r.id} value={r.id}>{r.name}{r.is_active ? "" : " (archived)"}</option>)}</select></div>
          <div><label htmlFor="m-into" className="mb-1 block text-xs font-semibold text-ink-muted">…into this (kept)</label><select id="m-into" name="into" className="input">{mergeRows.filter((r) => r.is_active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
          <div className="flex items-end"><button className="btn btn-outline w-full">Merge</button></div>
        </form>
      )}

      <form method="get" action={`/admin/${cfg.kind}`} role="search" className="card grid grid-cols-1 gap-3 p-3 md:grid-cols-[1fr_12rem_12rem_auto]">
        <div><label htmlFor="q" className="mb-1 block text-xs font-semibold text-ink-muted">Search name or slug</label><input id="q" name="q" defaultValue={q} className="input" /></div>
        {cfg.kind === "districts"
          ? <div><label htmlFor="st" className="mb-1 block text-xs font-semibold text-ink-muted">State / UT</label><select id="st" name="state" defaultValue={stateSlug} className="input"><option value="">Select…</option>{options.states.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          : <div />}
        <div><label htmlFor="show" className="mb-1 block text-xs font-semibold text-ink-muted">Show</label>
          <select id="show" name="show" defaultValue={show} className="input"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></div>
        <div className="flex items-end"><button className="btn btn-outline w-full">Apply</button></div>
      </form>

      {listError && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">Could not load the list: {listError.slice(0, 200)}</p>}
      {cfg.kind === "districts" && !stateSlug ? <p className="card p-4 text-sm text-ink-muted">Choose a state / UT to list its districts. Districts appear only after an official list is imported.</p> : (
        <div className="table-wrap card" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{cfg.title}</caption>
            <thead className="border-b border-line bg-brand-50 text-xs uppercase tracking-wide text-ink-muted"><tr>
              <th scope="col" className="px-3 py-2">Name</th><th scope="col" className="px-3 py-2">Slug</th>
              {cfg.kind === "organizations" && <><th scope="col" className="px-3 py-2">Department</th><th scope="col" className="px-3 py-2">State</th></>}
              {cfg.columns.map((c) => <th key={c.key} scope="col" className="px-3 py-2">{c.label}</th>)}
              <th scope="col" className="px-3 py-2">Status</th><th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-ink-muted">Nothing here{q ? " matches your search" : " yet"}.</td></tr>}
              {rows.map((r) => (
                <tr key={String(r.id)} className={r.is_active ? undefined : "bg-canvas text-ink-muted"}>
                  <th scope="row" className="px-3 py-2 font-semibold">{r.name}</th>
                  <td className="px-3 py-2 font-mono text-xs">{r.slug}</td>
                  {cfg.kind === "organizations" && <><td className="px-3 py-2">{deptName(r.department_id)}</td><td className="px-3 py-2">{stateName(r.state_id) || "Central / all-India"}</td></>}
                  {cfg.columns.map((c) => <td key={c.key} className="px-3 py-2">{r[c.key] == null ? "—" : String(r[c.key])}</td>)}
                  <td className="px-3 py-2">{r.is_active ? "Active" : r.merged_into_id ? `Merged into ${mergeRows.find((m) => m.id === r.merged_into_id)?.name ?? "another entry"}` : "Archived"}</td>
                  <td className="px-3 py-2"><div className="flex gap-2">
                    <Link href={`/admin/${cfg.kind}?${new URLSearchParams({ ...(stateSlug ? { state: stateSlug } : {}), edit: String(r.id) })}`} className="btn btn-outline btn-sm">Edit<span className="sr-only"> {r.name}</span></Link>
                    <form action={setActiveAction}><input type="hidden" name="_ref" value={cfg.kind} /><input type="hidden" name="id" value={String(r.id)} /><input type="hidden" name="active" value={r.is_active ? "0" : "1"} />
                      <button className="btn btn-outline btn-sm">{r.is_active ? "Archive" : "Restore"}<span className="sr-only"> {r.name}</span></button></form>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pageCount > 1 && <Pagination page={page} pageCount={pageCount} hrefFor={href} />}
    </div>
  );
}
