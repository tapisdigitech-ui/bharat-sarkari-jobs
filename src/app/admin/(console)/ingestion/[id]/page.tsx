import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIST } from "@/lib/admin/format";
import { CONFIDENCE_CLASS, REVIEW_STATUS_LABEL, RUN_STATUS_CLASS } from "@/lib/sources/config";

export const metadata: Metadata = { title: "Ingestion run" };
export const dynamic = "force-dynamic";
type Row = Record<string, any>;

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const db = await createSupabaseServerClient();
  const { data } = await db.from("ingestion_runs").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const r = data as Row;
  const [src, docs, items] = await Promise.all([
    r.source_id ? db.from("government_sources").select("id,name").eq("id", r.source_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("source_documents").select("id,source_url,document_type,http_status,byte_size,extraction_status,extraction_error,retrieved_at").eq("run_id", id).order("retrieved_at"),
    db.from("discovered_items").select("id,title,suggested_kind,confidence,review_status").eq("run_id", id).order("discovered_at"),
  ]);
  const stats: [string, unknown][] = [["Trigger", r.trigger], ["Started", formatDateTimeIST(r.started_at)], ["Completed", formatDateTimeIST(r.completed_at)],
    ["Duration", r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : "—"], ["HTTP status", r.http_status ?? "—"], ["Listing pages", r.pages_fetched],
    ["Discovered", r.records_discovered], ["New", r.records_new], ["Updated", r.records_updated], ["Unchanged", r.records_unchanged], ["Rejected / skipped", r.records_rejected],
    ["Duplicates", r.duplicates], ["Errors", r.errors]];
  return (
    <div className="space-y-5">
      <div><Link href="/admin/ingestion" className="text-sm text-brand-700 underline">← Ingestion log</Link>
        <h1 className="mt-1 text-2xl font-extrabold">Run {formatDateTimeIST(r.started_at)}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted"><span className={`badge ${RUN_STATUS_CLASS[r.status] ?? ""}`}>{r.status}</span>
          {src.data ? <Link href={`/admin/sources/${(src.data as Row).id}`} className="underline">{(src.data as Row).name}</Link> : r.trigger === "import" ? "CSV import" : null}</p></div>
      <section className="card p-4" aria-label="Run statistics"><dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{stats.map(([k, v]) => <div key={k}><dt className="text-ink-muted">{k}</dt><dd className="font-semibold">{String(v)}</dd></div>)}</dl>
        {r.error_summary && <p role="note" className="mt-3 rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">{r.error_summary}</p>}</section>
      <section aria-labelledby="log-h" className="card p-4"><h2 id="log-h" className="font-bold">Log</h2>
        <ol className="mt-2 space-y-1 font-mono text-xs">{((r.log ?? []) as Row[]).map((l, i) => <li key={i} className={l.level === "error" ? "text-danger-700" : l.level === "warn" ? "text-warning-700" : "text-ink-soft"}>{l.at?.slice(11, 19)} [{l.level}] {l.msg}</li>)}</ol></section>
      <section aria-labelledby="docs-h" className="card p-4"><h2 id="docs-h" className="font-bold">Documents fetched</h2>
        <p className="text-xs text-ink-muted">We keep each document&rsquo;s URL, hash and metadata; extracted text is kept for 30 days for review, then deleted. Official documents are never re-hosted.</p>
        <ul className="mt-2 divide-y divide-line text-sm">{((docs.data ?? []) as Row[]).map((d) => <li key={d.id} className="py-1.5"><a href={d.source_url} target="_blank" rel="noopener noreferrer" className="break-all text-brand-700 underline">{d.source_url}</a>
          <span className="text-ink-muted"> · {d.document_type} · HTTP {d.http_status ?? "—"} · {d.byte_size ? `${Math.round(d.byte_size / 1024)} KB` : "—"} · {d.extraction_status}{d.extraction_error ? ` (${d.extraction_error})` : ""}</span></li>)}</ul></section>
      <section aria-labelledby="items-h" className="card p-4"><h2 id="items-h" className="font-bold">Discoveries from this run</h2>
        <ul className="mt-2 divide-y divide-line text-sm">{((items.data ?? []) as Row[]).map((d) => <li key={d.id} className="py-1.5"><Link href={`/admin/review/${d.id}`} className="text-brand-700 underline">{d.title}</Link>
          <span className="text-ink-muted"> · {d.suggested_kind} · </span><span className={`badge ${CONFIDENCE_CLASS[d.confidence]}`}>{d.confidence}</span><span className="text-ink-muted"> · {REVIEW_STATUS_LABEL[d.review_status]}</span></li>)}</ul></section>
    </div>
  );
}
