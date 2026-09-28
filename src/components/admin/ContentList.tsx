import Link from "next/link";
import { requireAnyStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, VERBS, type Action } from "@/lib/admin/permissions";
import type { ContentCfg } from "@/lib/admin/content-config";
import { formatDateTimeIST } from "@/lib/admin/format";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";
import type { ContentStatus } from "@/lib/types";

const PAGE_SIZE = 20;
const STATUS_FILTERS = [["", "All"], ["draft", "Drafts"], ["review", "In review"], ["live", "Published"], ["expired", "Expired"], ["archived", "Archived"]] as const;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown> & { id: string; slug: string | null; status: ContentStatus; organization_id: string | null; updated_at: string; source_name: string | null };

/** Generic staff list for any content type: search, status + organization filter, pagination. RLS decides what the staff member may see. */
export async function ContentListPage({ cfg, sp }: { cfg: ContentCfg; sp: Record<string, string | string[] | undefined> }) {
  const staff = await requireAnyStaff(VERBS.map((v) => `${cfg.kind}:${v}` as Action));
  const q = one(sp.q).trim().slice(0, 100);
  const status = STATUS_FILTERS.some(([v]) => v === one(sp.status)) ? one(sp.status) : "";
  const org = UUID.test(one(sp.org)) ? one(sp.org) : "";
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const notice = one(sp.notice);
  const db = await createSupabaseServerClient();

  let query = db.from(cfg.table).select("*", { count: "exact" });
  if (status === "live") query = query.in("status", ["published", "updated"]); else if (status) query = query.eq("status", status);
  if (org) query = query.eq("organization_id", org);
  if (q) {
    const term = q.toLowerCase().replace(/[^\p{L}\p{N}\s\-._]/gu, " ").replace(/\s+/g, " ").trim();
    if (UUID.test(q)) query = query.eq("id", q);
    else if (term) query = query.or([cfg.titleField, "slug", "source_name"].map((c) => `${c}.ilike.*${term}*`).join(","));
  }
  const { data, count, error } = await query.order("updated_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as Row[];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const orgs = await db.from("organizations").select("id,name").order("name").limit(2000);
  const orgName = new Map((orgs.data ?? []).map((o) => [o.id as string, o.name as string]));

  const href = (p: number) => { const u = new URLSearchParams(); if (q) u.set("q", q); if (status) u.set("status", status); if (org) u.set("org", org); if (p > 1) u.set("page", String(p)); const s = u.toString(); return `/admin/${cfg.route}${s ? `?${s}` : ""}`; };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">{cfg.plural}</h1><p className="mt-1 max-w-3xl text-sm text-ink-muted">{cfg.intro}</p></div>
        {can(staff.role, `${cfg.kind}:create` as Action) && <Link href={`/admin/${cfg.route}/new`} className="btn btn-accent">New {cfg.label.toLowerCase()}</Link>}
      </div>
      {notice && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">{notice === "deleted" ? `${cfg.label} deleted.` : notice.slice(0, 200)}</p>}

      <form method="get" action={`/admin/${cfg.route}`} role="search" className="card grid grid-cols-1 gap-3 p-3 md:grid-cols-[1fr_12rem_14rem_auto]">
        <div><label htmlFor="q" className="mb-1 block text-xs font-semibold text-ink-muted">Search title, slug, source or ID</label><input id="q" name="q" defaultValue={q} className="input" /></div>
        <div><label htmlFor="status" className="mb-1 block text-xs font-semibold text-ink-muted">Status</label>
          <select id="status" name="status" defaultValue={status} className="input">{STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label htmlFor="org" className="mb-1 block text-xs font-semibold text-ink-muted">Organization</label>
          <select id="org" name="org" defaultValue={org} className="input"><option value="">All</option>{[...orgName].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
        <div className="flex items-end"><button type="submit" className="btn btn-primary w-full">Apply</button></div>
      </form>

      {error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">Could not load the list: {error.message.slice(0, 200)}</p>}
      <p className="text-sm text-ink-muted" aria-live="polite">{total} {total === 1 ? cfg.label.toLowerCase() : cfg.plural.toLowerCase()}</p>
      <div className="table-wrap card" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{cfg.plural}</caption>
          <thead className="border-b border-line bg-brand-50 text-xs uppercase tracking-wide text-ink-muted"><tr>
            <th scope="col" className="px-3 py-2">Title</th><th scope="col" className="px-3 py-2">Organization</th><th scope="col" className="px-3 py-2">Status</th>
            <th scope="col" className="px-3 py-2">Source checked</th><th scope="col" className="px-3 py-2">Updated</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-muted">No {cfg.plural.toLowerCase()} {q || status || org ? "match your filters" : "yet"}.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="px-3 py-2 font-semibold"><Link href={`/admin/${cfg.route}/${r.id}`} className="text-brand-700 underline">{String(r[cfg.titleField] ?? "(untitled)")}</Link></th>
                <td className="px-3 py-2">{r.organization_id ? orgName.get(r.organization_id) ?? "—" : "—"}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2">{r.source_checked_at ? formatDateTimeIST(String(r.source_checked_at)) : "Never"}</td>
                <td className="px-3 py-2">{formatDateTimeIST(r.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount} hrefFor={href} />
    </div>
  );
}
