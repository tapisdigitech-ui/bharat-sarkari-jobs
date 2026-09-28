import type { Metadata } from "next";
import Link from "next/link";
import { JOB_ACTIONS, requireAnyStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can } from "@/lib/admin/permissions";
import { formatDateTimeIST } from "@/lib/admin/format";
import { formatDate } from "@/lib/dates";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import { duplicateJobAction } from "./actions";
import type { ContentStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const STATUS_FILTERS = [["", "All"], ["draft", "Drafts"], ["review", "In review"], ["live", "Published"], ["expired", "Expired"], ["archived", "Archived"]] as const;
const SORTS = [["updated", "Recently updated"], ["last_date", "Last date (soonest)"], ["title", "Title A–Z"], ["created", "Newest created"]] as const;
const ALL_STATUS: ContentStatus[] = ["draft", "review", "published", "updated", "expired", "archived"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

interface Row { id: string; slug: string; title: string; organization: string; state_name: string | null; status: ContentStatus; last_date: string | null; updated_at: string; source_name: string | null; source_checked_at: string | null }

export default async function JobsAdmin({ searchParams }: Props) {
  const staff = await requireAnyStaff(JOB_ACTIONS);
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 100);
  const status = STATUS_FILTERS.some(([v]) => v === one(sp.status)) ? one(sp.status) : "";
  const sort = SORTS.some(([v]) => v === one(sp.sort)) ? one(sp.sort) : "updated";
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const notice = one(sp.notice);

  const db = await createSupabaseServerClient();
  let query = db.from("jobs_v").select("id,slug,title,organization,state_name,status,last_date,updated_at,source_name,source_checked_at", { count: "exact" });
  if (status === "live") query = query.in("status", ["published", "updated"]);
  else if (status) query = query.eq("status", status);

  if (q) {
    // Only safe characters reach the PostgREST filter grammar (no commas/parentheses/wildcards from the user).
    const term = q.toLowerCase().replace(/[^\p{L}\p{N}\s\-/._]/gu, " ").replace(/\s+/g, " ").trim();
    if (UUID.test(q)) query = query.eq("id", q);
    else if (term) {
      const parts = ["title", "organization", "advertisement_no", "source_name", "state_name", "slug"].map((c) => `${c}.ilike.*${term}*`);
      const st = ALL_STATUS.find((s) => s === term);
      if (st) parts.push(`status.eq.${st}`);
      if (term === "published") parts.push("status.eq.updated");
      query = query.or(parts.join(","));
    }
  }
  if (sort === "last_date") query = query.order("last_date", { ascending: true, nullsFirst: false });
  else if (sort === "title") query = query.order("title", { ascending: true });
  else if (sort === "created") query = query.order("created_at", { ascending: false });
  else query = query.order("updated_at", { ascending: false });
  const { data, count, error } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as Row[];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q); if (status) u.set("status", status); if (sort !== "updated") u.set("sort", sort); if (p > 1) u.set("page", String(p));
    const s = u.toString(); return s ? `/admin/jobs?${s}` : "/admin/jobs";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Jobs</h1>
        {can(staff.role, "job:create") && <Link href="/admin/jobs/new" className="btn btn-accent">New job</Link>}
      </div>
      {notice && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">{notice === "deleted" ? "Job deleted." : notice === "duplicated" ? "Job duplicated as a new draft." : notice === "expiry" ? `Expiry run complete: ${one(sp.n) || "0"} job(s) expired.` : notice}</p>}
      {one(sp.error) && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">{one(sp.error).slice(0, 300)}</p>}

      <form method="get" action="/admin/jobs" role="search" className="card grid grid-cols-1 gap-3 p-3 md:grid-cols-[1fr_11rem_13rem_auto]">
        <div><label htmlFor="q" className="mb-1 block text-xs font-semibold text-ink-muted">Search title, organization, advertisement no., state, source, status or ID</label>
          <input id="q" name="q" defaultValue={q} className="input" placeholder="e.g. railway, ADVT/2026, uttar pradesh" /></div>
        <div><label htmlFor="status" className="mb-1 block text-xs font-semibold text-ink-muted">Status</label>
          <select id="status" name="status" defaultValue={status} className="input">{STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label htmlFor="sort" className="mb-1 block text-xs font-semibold text-ink-muted">Sort</label>
          <select id="sort" name="sort" defaultValue={sort} className="input">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="flex items-end"><button type="submit" className="btn btn-primary w-full">Apply</button></div>
      </form>

      {error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">Could not load jobs: {error.message}</p>}
      <p className="text-sm text-ink-muted" aria-live="polite">{total} job{total === 1 ? "" : "s"}</p>

      {rows.length === 0 && !error ? (
        <div className="card p-8 text-center"><p className="font-semibold">{q || status ? "No jobs match these filters." : "No jobs yet."}</p>
          {(q || status) ? <Link href="/admin/jobs" className="btn btn-outline mt-3">Clear filters</Link> : can(staff.role, "job:create") ? <Link href="/admin/jobs/new" className="btn btn-accent mt-3">Create the first job</Link> : null}</div>
      ) : (
        <div className="table-wrap bg-white" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="data-table">
            <caption className="sr-only">Jobs</caption>
            <thead><tr><th scope="col">Title</th><th scope="col">Organization</th><th scope="col">State</th><th scope="col">Status</th><th scope="col">Last date</th><th scope="col">Source checked</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td className="min-w-64"><Link href={`/admin/jobs/${j.id}`} className="font-semibold text-brand-700 underline">{j.title}</Link></td>
                  <td>{j.organization}</td>
                  <td>{j.state_name ?? "—"}</td>
                  <td><StatusBadge status={j.status} /></td>
                  <td className="whitespace-nowrap">{j.last_date ? formatDate(j.last_date, { short: true }) : "Not set"}</td>
                  <td className="whitespace-nowrap text-sm">{j.source_checked_at ? formatDateTimeIST(j.source_checked_at) : <span className="text-danger-700">Never</span>}</td>
                  <td className="whitespace-nowrap text-sm">{formatDateTimeIST(j.updated_at)}</td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-2">
                      {(j.status === "published" || j.status === "updated") && <Link href={`/jobs/${j.slug}`} className="btn btn-ghost btn-sm" target="_blank" rel="noopener">View</Link>}
                      {can(staff.role, "job:create") && <form action={duplicateJobAction}><input type="hidden" name="id" value={j.id} /><button type="submit" className="btn btn-ghost btn-sm">Duplicate</button></form>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageCount={pageCount} hrefFor={href} />
    </div>
  );
}
