import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/admin/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIST } from "@/lib/admin/format";
import { addDays, todayIST } from "@/lib/dates";
import { KIND_LABEL, KIND_TABLE, KIND_TITLE_FIELD, adminHref, isKind } from "@/lib/admin/kinds";
import { fieldLabel } from "@/lib/ingestion/review-fields";
import { sourceStatusClass, sourceStatusLabel } from "@/lib/sources/config";
import { markStaleAction, runDueSourcesAction, runLinkCheckAction } from "./actions";

export const metadata: Metadata = { title: "Content health" };
export const dynamic = "force-dynamic";
type Row = Record<string, any>;
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : String(v));

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ ran?: string }> }) {
  const staff = await requireStaff();
  const { ran } = await searchParams;
  const db = await createSupabaseServerClient();
  const [stats, failing, broken, changed, dups] = await Promise.all([
    db.rpc("content_health_stats", { p_today: todayIST() }),
    db.from("government_sources").select("id,name,status,failure_count,last_error,last_checked_at").or("status.in.(ERROR,BLOCKED),failure_count.gt.0").neq("status", "ARCHIVED").order("failure_count", { ascending: false }).limit(10),
    db.from("link_status_latest").select("kind,content_id,field,url,outcome,http_status,checked_at,consecutive_failures").eq("broken", true).order("checked_at", { ascending: false }).limit(15),
    db.from("content_versions").select("kind,content_id,version,changed_at,reason,important_changes").neq("important_changes", "{}").order("changed_at", { ascending: false }).limit(10),
    db.from("discovered_items").select("id,title,duplicate_reasons,discovered_at").in("review_status", ["pending", "needs_review"]).not("duplicate_id", "is", null).is("duplicate_resolution", null).order("discovered_at", { ascending: false }).limit(10),
  ]);
  const s = (stats.data ?? {}) as Record<string, number | null>;
  // Stale live records (source not checked for 30+ days), oldest first, across all content types.
  const staleCut = `${addDays(todayIST(), -30)}T00:00:00+05:30`;
  const stale: { kind: string; id: string; title: string; checked: string | null }[] = [];
  for (const k of Object.keys(KIND_TABLE)) {
    if (!isKind(k)) continue;
    const r = await db.from(KIND_TABLE[k]).select(`id,${KIND_TITLE_FIELD[k]},source_checked_at`).in("status", ["published", "updated"]).or(`source_checked_at.is.null,source_checked_at.lt.${staleCut}`).order("source_checked_at", { ascending: true, nullsFirst: true }).limit(5);
    for (const x of (r.data ?? []) as Row[]) stale.push({ kind: k, id: x.id, title: x[KIND_TITLE_FIELD[k]], checked: x.source_checked_at });
  }
  // Titles for broken-link and changed rows
  const titleOf = new Map<string, string>();
  for (const k of Object.keys(KIND_TABLE)) {
    if (!isKind(k)) continue;
    const ids = [...new Set([...((broken.data ?? []) as Row[]), ...((changed.data ?? []) as Row[])].filter((x) => x.kind === k).map((x) => x.content_id))];
    if (!ids.length) continue;
    const r = await db.from(KIND_TABLE[k]).select(`id,${KIND_TITLE_FIELD[k]}`).in("id", ids);
    for (const x of (r.data ?? []) as Row[]) titleOf.set(`${k}|${x.id}`, x[KIND_TITLE_FIELD[k]]);
  }
  const tile = (label: string, v: number | null | undefined, href?: string, warn = false) => {
    const body = <><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p><p className={`mt-1 text-3xl font-extrabold ${warn && Number(v) > 0 ? "text-danger-700" : "text-brand-900"}`}>{v ?? "—"}</p></>;
    return href ? <Link key={label} href={href} className="card card-hover p-4">{body}</Link> : <div key={label} className="card p-4">{body}</div>;
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Content health</h1><p className="mt-1 max-w-3xl text-sm text-ink-muted">Freshness and accuracy of everything we publish, and how the content operation is running today (IST). Nothing here removes content automatically — it tells a person where to look.</p></div>
        <div className="flex flex-wrap gap-2">
          {can(staff.role, "ingestion:run") && <form action={runDueSourcesAction}><button className="btn btn-outline btn-sm">Check due sources now</button></form>}
          {can(staff.role, "source:manage") && <form action={runLinkCheckAction}><button className="btn btn-outline btn-sm">Run link check</button></form>}
          {can(staff.role, "source:manage") && <form action={markStaleAction}><button className="btn btn-outline btn-sm">Flag stale content</button></form>}
        </div>
      </div>
      {ran && <p role="status" className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{ran.slice(0, 300)}</p>}
      {stats.error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">Could not load statistics: {stats.error.message}</p>}

      <section aria-labelledby="h-h"><h2 id="h-h" className="section-title mb-2">Health</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="health-tiles">
          {tile("Sources checked today", s.sources_checked_today, "/admin/sources")}
          {tile("Sources failing", s.sources_failing, "/admin/sources?status=ERROR", true)}
          {tile("Awaiting review", s.awaiting_review, "/admin/review")}
          {tile("Needs source verification", s.needs_verification, undefined, true)}
          {tile("Jobs expiring in 7 days", s.jobs_expiring_soon, "/admin/jobs?status=live&sort=last_date")}
          {tile("Recently changed (7 days)", s.recently_changed)}
          {tile("Stale content (30+ days)", s.stale_content, undefined, true)}
          {tile("Duplicate warnings", s.duplicate_warnings, "/admin/review?flag=duplicate", true)}
          {tile("Broken official links", s.broken_links, undefined, true)}
          {tile("Senior review needed", s.needs_senior_review, "/admin/review?view=needs_review")}
        </div></section>

      <section aria-labelledby="ops-h"><h2 id="ops-h" className="section-title mb-2">Content operations today</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="ops-tiles">
          {tile("Jobs published today", s.jobs_published_today)}
          {tile("Jobs discovered today", s.jobs_discovered_today, "/admin/review")}
          {tile("Updates today", s.updates_today)}
          {tile("Reviews pending", s.reviews_pending, "/admin/review")}
          {tile("Average review time (h, 30 days)", s.avg_review_hours)}
          {tile("Source checks today", s.runs_today, "/admin/ingestion")}
          {tile("Source failures today", s.source_failures_today, "/admin/ingestion?status=failed", true)}
          {tile("Records updated today", s.records_updated_today)}
          {tile("Records expired today", s.records_expired_today)}
          {tile("Duplicate warnings", s.duplicate_warnings, "/admin/review?flag=duplicate")}
        </div></section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="fs-h" className="card p-4"><h2 id="fs-h" className="font-bold">Sources needing attention</h2>
          {!(failing.data ?? []).length ? <p className="mt-1 text-sm text-ink-muted">All sources are working.</p> : <ul className="mt-2 space-y-2 text-sm">{((failing.data ?? []) as Row[]).map((x) => <li key={x.id}><Link href={`/admin/sources/${x.id}`} className="font-semibold text-brand-700 underline">{x.name}</Link> <span className={`badge ${sourceStatusClass(x.status)}`}>{sourceStatusLabel(x.status)}</span><p className="text-xs text-ink-muted">{x.failure_count} failure(s) in a row · last check {formatDateTimeIST(x.last_checked_at)}{x.last_error ? ` · ${x.last_error.slice(0, 140)}` : ""}</p></li>)}</ul>}</section>
        <section aria-labelledby="bl-h" className="card p-4" data-testid="broken-links"><h2 id="bl-h" className="font-bold">Broken official links</h2>
          {!(broken.data ?? []).length ? <p className="mt-1 text-sm text-ink-muted">No broken links found in the latest checks.</p> : <ul className="mt-2 space-y-2 text-sm">{((broken.data ?? []) as Row[]).filter((b) => isKind(b.kind)).map((b) => <li key={`${b.kind}${b.content_id}${b.field}`}><Link href={adminHref(b.kind, b.content_id)} className="font-semibold text-brand-700 underline">{titleOf.get(`${b.kind}|${b.content_id}`) ?? b.content_id}</Link><p className="break-all text-xs text-ink-muted">{fieldLabel(b.field)}: {b.url} — {b.outcome}{b.http_status ? ` (HTTP ${b.http_status})` : ""}, {b.consecutive_failures} failed check(s) in a row</p></li>)}</ul>}</section>
        <section aria-labelledby="st-h" className="card p-4"><h2 id="st-h" className="font-bold">Stale content (source not checked for 30+ days)</h2>
          {!stale.length ? <p className="mt-1 text-sm text-ink-muted">Everything live was source-checked in the last 30 days.</p> : <ul className="mt-2 space-y-1 text-sm">{stale.slice(0, 12).map((x) => <li key={x.kind + x.id}><Link href={adminHref(x.kind as never, x.id)} className="text-brand-700 underline">{x.title}</Link> <span className="text-xs text-ink-muted">{KIND_LABEL[x.kind as keyof typeof KIND_LABEL]} · last checked {formatDateTimeIST(x.checked)}</span></li>)}</ul>}</section>
        <section aria-labelledby="rc-h" className="card p-4"><h2 id="rc-h" className="font-bold">Recently changed</h2>
          {!(changed.data ?? []).length ? <p className="mt-1 text-sm text-ink-muted">No important changes recorded yet.</p> : <ul className="mt-2 space-y-2 text-sm">{((changed.data ?? []) as Row[]).filter((c) => isKind(c.kind)).map((c) => <li key={`${c.kind}${c.content_id}${c.version}`}><Link href={adminHref(c.kind, c.content_id)} className="font-semibold text-brand-700 underline">{titleOf.get(`${c.kind}|${c.content_id}`) ?? c.content_id}</Link> <span className="text-xs text-ink-muted">v{c.version} · {formatDateTimeIST(c.changed_at)}{c.reason ? ` · ${c.reason}` : ""}</span>
            <p className="text-xs">{Object.entries(c.important_changes as Record<string, { from: unknown; to: unknown }>).slice(0, 4).map(([k, v]) => `${fieldLabel(k)}: ${show(v.from)} → ${show(v.to)}`).join(" · ")}</p></li>)}</ul>}</section>
        <section aria-labelledby="dw-h" className="card p-4"><h2 id="dw-h" className="font-bold">Duplicate warnings</h2>
          {!(dups.data ?? []).length ? <p className="mt-1 text-sm text-ink-muted">None open.</p> : <ul className="mt-2 space-y-1 text-sm">{((dups.data ?? []) as Row[]).map((d) => <li key={d.id}><Link href={`/admin/review/${d.id}`} className="text-brand-700 underline">{d.title}</Link> <span className="text-xs text-ink-muted">{(d.duplicate_reasons ?? []).join(", ")}</span></li>)}</ul>}</section>
      </div>
    </div>
  );
}
