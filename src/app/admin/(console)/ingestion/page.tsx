import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIST } from "@/lib/admin/format";
import { Pagination } from "@/components/ui/Pagination";
import { RUN_STATUS_CLASS } from "@/lib/sources/config";

export const metadata: Metadata = { title: "Ingestion log" };
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
type Row = Record<string, any>;
const STATUSES = ["running", "succeeded", "partial", "failed", "blocked", "skipped"];
const PAGE = 50;

export default async function IngestionLog({ searchParams }: Props) {
  await requireStaff();
  const sp = await searchParams;
  const status = STATUSES.includes(one(sp.status)) ? one(sp.status) : "";
  const source = /^[0-9a-f-]{36}$/.test(one(sp.source)) ? one(sp.source) : "";
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const db = await createSupabaseServerClient();
  let q = db.from("ingestion_runs").select("*", { count: "exact" }).order("started_at", { ascending: false });
  if (status) q = q.eq("status", status);
  if (source) q = q.eq("source_id", source);
  const [res, sources] = await Promise.all([q.range((page - 1) * PAGE, page * PAGE - 1), db.from("government_sources").select("id,name").order("name")]);
  const names = new Map(((sources.data ?? []) as Row[]).map((s) => [s.id, s.name]));
  const rows = (res.data ?? []) as Row[];
  const pageCount = Math.max(1, Math.ceil((res.count ?? 0) / PAGE));
  const href = (p: number) => { const u = new URLSearchParams(); if (status) u.set("status", status); if (source) u.set("source", source); if (p > 1) u.set("page", String(p)); const s = u.toString(); return `/admin/ingestion${s ? `?${s}` : ""}`; };
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-extrabold">Ingestion log</h1><p className="mt-1 max-w-3xl text-sm text-ink-muted">Every source check and CSV import, with what it found. Use it to debug a source: open a run to see its step-by-step log.</p></div>
      <form method="get" className="card grid grid-cols-1 gap-3 p-3 md:grid-cols-[1fr_12rem_auto]">
        <div><label htmlFor="source" className="mb-1 block text-xs font-semibold text-ink-muted">Source</label><select id="source" name="source" defaultValue={source} className="input"><option value="">All sources</option>{((sources.data ?? []) as Row[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label htmlFor="status" className="mb-1 block text-xs font-semibold text-ink-muted">Status</label><select id="status" name="status" defaultValue={status} className="input"><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
        <div className="flex items-end"><button className="btn btn-outline w-full">Apply</button></div>
      </form>
      <div className="table-wrap card" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="w-full text-left text-sm"><caption className="sr-only">Ingestion runs</caption>
        <thead className="border-b border-line bg-brand-50 text-xs uppercase tracking-wide text-ink-muted"><tr>{["Started", "Completed", "Source", "Status", "Discovered", "Updated", "Rejected", "Duplicates", "Errors", "Duration"].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {!rows.length && <tr><td colSpan={10} className="px-3 py-6 text-center text-ink-muted">No runs yet.</td></tr>}
          {rows.map((r) => <tr key={r.id} data-testid="run-row">
            <td className="whitespace-nowrap px-3 py-2"><Link href={`/admin/ingestion/${r.id}`} className="text-brand-700 underline">{formatDateTimeIST(r.started_at)}</Link></td>
            <td className="whitespace-nowrap px-3 py-2">{formatDateTimeIST(r.completed_at)}</td>
            <td className="px-3 py-2">{r.source_id ? <Link href={`/admin/sources/${r.source_id}`} className="underline">{names.get(r.source_id) ?? "source"}</Link> : <em>{r.trigger === "import" ? "CSV import" : "—"}</em>}</td>
            <td className="px-3 py-2"><span className={`badge ${RUN_STATUS_CLASS[r.status] ?? ""}`}>{r.status}</span></td>
            <td className="px-3 py-2">{r.records_discovered}</td><td className="px-3 py-2">{r.records_updated}</td><td className="px-3 py-2">{r.records_rejected}</td>
            <td className="px-3 py-2">{r.duplicates}</td><td className="px-3 py-2">{r.errors}</td><td className="px-3 py-2">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : "—"}</td></tr>)}
        </tbody></table></div>
      {pageCount > 1 && <Pagination page={page} pageCount={pageCount} hrefFor={href} />}
    </div>
  );
}
