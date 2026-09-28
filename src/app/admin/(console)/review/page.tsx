import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIST } from "@/lib/admin/format";
import { Pagination } from "@/components/ui/Pagination";
import { KIND_LABEL, isKind } from "@/lib/admin/kinds";
import { CONFIDENCE_CLASS, REVIEW_STATUS_LABEL } from "@/lib/sources/config";

export const metadata: Metadata = { title: "Review queue" };
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
type Row = Record<string, any>;
const VIEWS: [string, string][] = [["open", "Open (waiting + senior review)"], ["needs_review", "Needs senior review"], ["approved", "Approved"], ["merged", "Merged"], ["rejected", "Rejected"], ["ignored", "Ignored"], ["superseded", "Superseded"], ["all", "All"]];
const PAGE = 40;
const shortUrl = (u: string | null) => { if (!u) return "—"; try { const x = new URL(u); const p = x.pathname.length > 28 ? "…" + x.pathname.slice(-26) : x.pathname; return x.hostname.replace(/^www\./, "") + p; } catch { return u.slice(0, 40); } };
const fmtDate = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

export default async function ReviewQueue({ searchParams }: Props) {
  await requireStaff();
  const sp = await searchParams;
  const view = VIEWS.some(([v]) => v === one(sp.view)) ? one(sp.view) : "open";
  const conf = ["HIGH", "MEDIUM", "LOW"].includes(one(sp.confidence)) ? one(sp.confidence) : "";
  const kind = isKind(one(sp.kind)) ? one(sp.kind) : "";
  const source = /^[0-9a-f-]{36}$/.test(one(sp.source)) ? one(sp.source) : "";
  const flag = ["duplicate", "change", "amendment"].includes(one(sp.flag)) ? one(sp.flag) : "";
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const db = await createSupabaseServerClient();
  let q = db.from("discovered_items").select("id,source_id,item_url,discovered_at,title,organization_id,extracted,confidence,confidence_score,duplicate_id,duplicate_resolution,changes,change_target_id,previous_item_id,suggested_kind,review_status,is_synthetic,validation_issues,amendment_type", { count: "exact" });
  if (view === "open") q = q.in("review_status", ["pending", "needs_review"]); else if (view !== "all") q = q.eq("review_status", view);
  if (conf) q = q.eq("confidence", conf);
  if (kind) q = q.eq("suggested_kind", kind);
  if (source) q = q.eq("source_id", source);
  if (flag === "duplicate") q = q.not("duplicate_id", "is", null).is("duplicate_resolution", null);
  if (flag === "change") q = q.not("changes", "is", null);
  if (flag === "amendment") q = q.not("amendment_type", "is", null);
  const [res, sources, orgs] = await Promise.all([
    q.order("discovered_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    db.from("government_sources").select("id,name").order("name"),
    db.from("organizations").select("id,name").limit(3000),
  ]);
  const rows = (res.data ?? []) as Row[];
  const sName = new Map(((sources.data ?? []) as Row[]).map((s) => [s.id, s.name]));
  const oName = new Map(((orgs.data ?? []) as Row[]).map((o) => [o.id, o.name]));
  const pageCount = Math.max(1, Math.ceil((res.count ?? 0) / PAGE));
  const href = (p: number) => { const u = new URLSearchParams(); if (view !== "open") u.set("view", view); if (conf) u.set("confidence", conf); if (kind) u.set("kind", kind); if (source) u.set("source", source); if (flag) u.set("flag", flag); if (p > 1) u.set("page", String(p)); const s = u.toString(); return `/admin/review${s ? `?${s}` : ""}`; };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Review queue</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">Everything discovered from official sources (and every CSV import) lands here. Nothing is public until a person compares it with the official notice, approves it into a draft, and publishes that draft. Confidence is an internal hint about the extraction — never shown to readers.</p></div>
        <Link href="/admin/import" className="btn btn-outline">Import CSV</Link>
      </div>
      <form method="get" className="card grid grid-cols-2 gap-3 p-3 md:grid-cols-[1fr_9rem_10rem_1fr_10rem_auto]">
        <div><label htmlFor="view" className="mb-1 block text-xs font-semibold text-ink-muted">Show</label><select id="view" name="view" defaultValue={view} className="input">{VIEWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label htmlFor="confidence" className="mb-1 block text-xs font-semibold text-ink-muted">Confidence</label><select id="confidence" name="confidence" defaultValue={conf} className="input"><option value="">Any</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></div>
        <div><label htmlFor="kind" className="mb-1 block text-xs font-semibold text-ink-muted">Suggested type</label><select id="kind" name="kind" defaultValue={kind} className="input"><option value="">Any</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label htmlFor="source" className="mb-1 block text-xs font-semibold text-ink-muted">Source</label><select id="source" name="source" defaultValue={source} className="input"><option value="">All sources</option>{((sources.data ?? []) as Row[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label htmlFor="flag" className="mb-1 block text-xs font-semibold text-ink-muted">Flag</label><select id="flag" name="flag" defaultValue={flag} className="input"><option value="">Any</option><option value="duplicate">Possible duplicate</option><option value="change">Changes detected</option><option value="amendment">Official update (corrigendum, extension…)</option></select></div>
        <div className="flex items-end"><button className="btn btn-outline w-full">Apply</button></div>
      </form>
      <p className="text-sm text-ink-muted" role="status">{res.count ?? 0} item{res.count === 1 ? "" : "s"}</p>
      <div className="table-wrap card" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Discovered items</caption>
          <thead className="border-b border-line bg-brand-50 text-xs uppercase tracking-wide text-ink-muted"><tr>
            {["Extracted title", "Source", "URL", "Discovered", "Organization", "Last date", "Vacancy", "Confidence", "Duplicate", "Changes", "Suggested type", "Status"].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {!rows.length && <tr><td colSpan={12} className="px-3 py-6 text-center text-ink-muted">Nothing here. Run “Check now” on a source, or import a CSV.</td></tr>}
            {rows.map((r) => { const ex = r.extracted ?? {}; const nChanges = r.changes ? Object.keys(r.changes).length : 0; return (
              <tr key={r.id} data-testid="review-row">
                <th scope="row" className="min-w-56 px-3 py-2"><Link href={`/admin/review/${r.id}`} className="font-semibold text-brand-700 underline">{r.title}</Link>
                  {r.is_synthetic && <span className="badge badge-demo ml-1">Synthetic</span>}{r.validation_issues?.length ? <p className="text-xs text-warning-700">{r.validation_issues.length} issue{r.validation_issues.length > 1 ? "s" : ""}</p> : null}</th>
                <td className="px-3 py-2">{r.source_id ? sName.get(r.source_id) ?? "—" : <em>Import</em>}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.item_url ? <a href={r.item_url} target="_blank" rel="noopener noreferrer" className="underline">{shortUrl(r.item_url)}</a> : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTimeIST(r.discovered_at)}</td>
                <td className="px-3 py-2">{oName.get(r.organization_id) ?? ex.organization_name ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">{fmtDate(ex.last_date ?? ex.application_last_date ?? ex.objection_last_date)}</td>
                <td className="px-3 py-2">{ex.total_vacancies ?? "—"}</td>
                <td className="px-3 py-2"><span className={`badge ${CONFIDENCE_CLASS[r.confidence]}`}>{r.confidence}</span></td>
                <td className="px-3 py-2">{r.duplicate_id && !r.duplicate_resolution ? <span className="badge badge-urgent">Possible duplicate</span> : r.duplicate_resolution ? <span className="text-xs text-ink-muted">{r.duplicate_resolution.replace("_", " ")}</span> : "—"}</td>
                <td className="px-3 py-2">{r.amendment_type && <span className="badge badge-urgent mb-1 block w-fit">{String(r.amendment_type).replace(/_/g, " ")}</span>}{nChanges ? <span className="badge badge-updated">{nChanges} change{nChanges > 1 ? "s" : ""}</span> : r.previous_item_id || r.change_target_id ? "update" : r.amendment_type ? "" : "—"}</td>
                <td className="px-3 py-2">{KIND_LABEL[r.suggested_kind as keyof typeof KIND_LABEL] ?? r.suggested_kind}</td>
                <td className="px-3 py-2 text-xs">{REVIEW_STATUS_LABEL[r.review_status]}</td>
              </tr>); })}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && <Pagination page={page} pageCount={pageCount} hrefFor={href} />}
    </div>
  );
}
