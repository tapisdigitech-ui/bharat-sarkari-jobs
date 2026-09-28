import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIST } from "@/lib/admin/format";
import { Pagination } from "@/components/ui/Pagination";

export const metadata: Metadata = { title: "Audit logs" };
export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
const ENTITIES = ["jobs", "job_internal", "job_vacancies", "job_qualifications", "organizations", "admin_users", "recruitments", "exams", "admit_cards", "results", "answer_keys", "exam_calendar"];
/** table name -> admin route, so a log row can link straight to that record's editor (jobs already had its own case). */
const ROUTE_BY_TABLE: Record<string, string> = { recruitments: "recruitments", exams: "exams", admit_cards: "admit-cards", results: "results", answer_keys: "answer-keys", exam_calendar: "exam-calendar" };
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
interface Log { id: number; actor_id: string | null; actor_label: string | null; action: string; entity: string; entity_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: string }

const show = (v: unknown) => { const t = typeof v === "string" ? v : JSON.stringify(v); return t.length > 160 ? t.slice(0, 160) + "…" : t; };

export default async function AuditPage({ searchParams }: Props) {
  await requireStaff("audit:view");
  const sp = await searchParams;
  const entity = ENTITIES.includes(one(sp.entity)) ? one(sp.entity) : "";
  const entityId = /^[0-9a-f-]{8,36}$/i.test(one(sp.entity_id)) ? one(sp.entity_id) : "";
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);

  const db = await createSupabaseServerClient();
  let q = db.from("audit_logs").select("id,actor_id,actor_label,action,entity,entity_id,before,after,at", { count: "exact" }).order("at", { ascending: false }).order("id", { ascending: false });
  if (entity) q = q.eq("entity", entity);
  if (entityId) q = q.eq("entity_id", entityId);
  const { data, count, error } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const logs = (data ?? []) as Log[];

  const actorIds = [...new Set(logs.map((l) => l.actor_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const p = await db.from("profiles").select("id,display_name").in("id", actorIds);   // only readable with users:manage
    (p.data ?? []).forEach((r) => names.set(r.id, r.display_name ?? ""));
  }
  const pageCount = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const href = (p: number) => { const u = new URLSearchParams(); if (entity) u.set("entity", entity); if (entityId) u.set("entity_id", entityId); if (p > 1) u.set("page", String(p)); const s = u.toString(); return s ? `/admin/audit?${s}` : "/admin/audit"; };

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-extrabold">Audit logs</h1><p className="text-sm text-ink-muted">Every change to jobs, staff and organizations, recorded by the database itself. Entries cannot be edited or deleted from this application.</p></div>
      <form method="get" className="card grid grid-cols-1 gap-3 p-3 md:grid-cols-[12rem_1fr_auto]">
        <div><label htmlFor="entity" className="mb-1 block text-xs font-semibold text-ink-muted">Entity</label>
          <select id="entity" name="entity" defaultValue={entity} className="input"><option value="">All</option>{ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}</select></div>
        <div><label htmlFor="entity_id" className="mb-1 block text-xs font-semibold text-ink-muted">Record ID</label><input id="entity_id" name="entity_id" defaultValue={entityId} className="input" placeholder="job UUID" /></div>
        <div className="flex items-end"><button type="submit" className="btn btn-primary w-full">Filter</button></div>
      </form>
      {error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">Could not load the log: {error.message}</p>}
      {logs.length === 0 && !error ? <p className="card p-6 text-center text-ink-muted">No matching entries.</p> : (
        <div className="table-wrap bg-white" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="data-table">
          <caption className="sr-only">Audit log</caption>
          <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">Changes</th></tr></thead>
          <tbody>{logs.map((l) => {
            const keys = Object.keys(l.after ?? l.before ?? {});
            return (
              <tr key={l.id}>
                <td className="whitespace-nowrap text-sm">{formatDateTimeIST(l.at)}</td>
                <td className="text-sm">{l.actor_id ? (names.get(l.actor_id) || <code title={l.actor_id}>{l.actor_id.slice(0, 8)}</code>) : <em>{l.actor_label ?? "system"}</em>}</td>
                <td className="whitespace-nowrap"><code>{l.action}</code></td>
                <td className="text-sm">{l.entity}{l.entity_id && (l.entity === "jobs" || ROUTE_BY_TABLE[l.entity]
                  ? <> · <Link className="underline" href={`/admin/${l.entity === "jobs" ? "jobs" : ROUTE_BY_TABLE[l.entity]}/${l.entity_id}`}>{l.entity_id.slice(0, 8)}</Link></>
                  : <> · <code>{l.entity_id.slice(0, 8)}</code></>)}</td>
                <td className="min-w-56 text-sm">
                  {keys.length === 0 ? "—" : (
                    <details><summary className="cursor-pointer">{keys.length} field{keys.length === 1 ? "" : "s"}: {keys.slice(0, 4).join(", ")}{keys.length > 4 ? "…" : ""}</summary>
                      <dl className="mt-1 space-y-1">{keys.map((k) => (
                        <div key={k}><dt className="font-semibold">{k}</dt>{l.before && k in l.before && <dd className="text-danger-700">− {show(l.before[k])}</dd>}{l.after && k in l.after && <dd className="text-success-700">+ {show(l.after[k])}</dd>}</div>
                      ))}</dl></details>)}
                </td>
              </tr>);
          })}</tbody></table></div>
      )}
      <Pagination page={page} pageCount={pageCount} hrefFor={href} />
    </div>
  );
}
