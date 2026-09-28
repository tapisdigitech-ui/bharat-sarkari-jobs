import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/admin/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIST } from "@/lib/admin/format";
import { getRef } from "@/lib/data/ref";
import { SOURCE_STATUSES, SOURCE_TYPES, sourceStatusClass, sourceStatusLabel, sourceTypeLabel } from "@/lib/sources/config";

export const metadata: Metadata = { title: "Source registry" };
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
type Row = Record<string, any>;

export default async function SourcesPage({ searchParams }: Props) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 80).replace(/[^\p{L}\p{N}\s.\-&]/gu, " ").trim();
  const type = SOURCE_TYPES.some(([v]) => v === one(sp.type)) ? one(sp.type) : "";
  const status = SOURCE_STATUSES.some(([v]) => v === one(sp.status)) ? one(sp.status) : "";
  const ref = await getRef();
  const state = ref.allStates.find((s) => s.slug === one(sp.state))?.slug ?? (one(sp.state) === "central" ? "central" : "");
  const db = await createSupabaseServerClient();
  let query = db.from("government_sources").select("*").order("name");
  if (q) query = query.or(`name.ilike.*${q}*,official_domain.ilike.*${q}*`);
  if (type) query = query.eq("source_type", type);
  if (status) query = query.eq("status", status); else query = query.neq("status", "ARCHIVED");
  if (state === "central") query = query.is("state_id", null);
  else if (state) query = query.eq("state_id", ref.allStates.find((s) => s.slug === state)!.id!);
  const [res, counts] = await Promise.all([query.limit(500), db.rpc("source_record_counts")]);
  const rows = (res.data ?? []) as Row[];
  const c = new Map(((counts.data ?? []) as Row[]).map((r) => [r.source_id, r]));
  const stateName = (id: unknown) => ref.allStates.find((s) => s.id === id)?.name ?? "Central / all-India";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Source registry</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">Official government sources this platform monitors. Only official departments, boards, commissions, PSUs, universities, courts and district administrations belong here — never private job portals. Checks feed the review queue; nothing is published automatically.</p></div>
        <div className="flex gap-2"><Link href="/admin/sources/probe" className="btn btn-outline">Server-side probe</Link>{can(staff.role, "source:manage") && <Link href="/admin/sources/new" className="btn btn-accent">Register source</Link>}</div>
      </div>
      <form method="get" role="search" className="card grid grid-cols-1 gap-3 p-3 md:grid-cols-[1fr_12rem_12rem_12rem_auto]">
        <div><label htmlFor="q" className="mb-1 block text-xs font-semibold text-ink-muted">Search name or domain</label><input id="q" name="q" defaultValue={q} className="input" /></div>
        <div><label htmlFor="type" className="mb-1 block text-xs font-semibold text-ink-muted">Type</label><select id="type" name="type" defaultValue={type} className="input"><option value="">All types</option>{SOURCE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label htmlFor="state" className="mb-1 block text-xs font-semibold text-ink-muted">State</label><select id="state" name="state" defaultValue={state} className="input"><option value="">All</option><option value="central">Central / all-India</option>{ref.allStates.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></div>
        <div><label htmlFor="status" className="mb-1 block text-xs font-semibold text-ink-muted">Status</label><select id="status" name="status" defaultValue={status} className="input"><option value="">All except archived</option>{SOURCE_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="flex items-end"><button className="btn btn-outline w-full">Apply</button></div>
      </form>
      {res.error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">Could not load sources: {res.error.message.slice(0, 200)}</p>}
      <div className="table-wrap card" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Registered official sources</caption>
          <thead className="border-b border-line bg-brand-50 text-xs uppercase tracking-wide text-ink-muted"><tr>
            {["Source", "Type", "State", "Status", "Last checked", "Last successful", "Failures", "Discovered", "Published"].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}
            <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-ink-muted">No sources{q || type || status || state ? " match your filters" : " registered yet"}.</td></tr>}
            {rows.map((r) => { const k = c.get(r.id); return (
              <tr key={r.id} data-testid="source-row">
                <th scope="row" className="px-3 py-2"><Link href={`/admin/sources/${r.id}`} className="font-semibold text-brand-700 underline">{r.name}</Link>
                  <p className="font-mono text-xs text-ink-muted">{r.official_domain}{r.is_synthetic && <span className="badge badge-demo ml-1">Synthetic test source</span>}</p></th>
                <td className="px-3 py-2">{sourceTypeLabel(r.source_type)}</td>
                <td className="px-3 py-2">{stateName(r.state_id)}</td>
                <td className="px-3 py-2"><span className={`badge ${sourceStatusClass(r.status)}`}>{sourceStatusLabel(r.status)}</span></td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTimeIST(r.last_checked_at)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTimeIST(r.last_success_at)}</td>
                <td className="px-3 py-2">{r.failure_count}{r.total_failures > r.failure_count ? <span className="text-ink-muted"> ({r.total_failures} total)</span> : null}</td>
                <td className="px-3 py-2">{k?.discovered ?? 0}{Number(k?.pending) ? <span className="text-ink-muted"> ({k?.pending} waiting)</span> : null}</td>
                <td className="px-3 py-2">{k?.published ?? 0}</td>
                <td className="px-3 py-2"><Link href={`/admin/sources/${r.id}`} className="btn btn-outline btn-sm">Open<span className="sr-only"> {r.name}</span></Link></td>
              </tr>); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
