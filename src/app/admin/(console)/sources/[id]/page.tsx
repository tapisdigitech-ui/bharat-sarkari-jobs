import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/admin/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIST } from "@/lib/admin/format";
import { getRef } from "@/lib/data/ref";
import { KIND_LABEL, KIND_TABLE, KIND_TITLE_FIELD, adminHref, isKind } from "@/lib/admin/kinds";
import { AUTHORITY_RANKS, CONFIDENCE_CLASS, REVIEW_STATUS_LABEL, RUN_STATUS_CLASS, sourceStatusClass, sourceStatusLabel, sourceTypeLabel } from "@/lib/sources/config";
import { sourceFormOptions, sourceInitial } from "@/lib/sources/options";
import { SourceForm } from "@/components/admin/SourceForm";
import { checkNowAction, setSourceStatusAction } from "../actions";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };
type Row = Record<string, any>;
export async function generateMetadata(): Promise<Metadata> { return { title: "Source" }; }

const NOTICE: Record<string, string> = { created: "Source registered.", saved: "Source saved." };

export default async function SourceDetail({ params, searchParams }: Props) {
  const staff = await requireStaff();
  const { id } = await params; const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const db = await createSupabaseServerClient();
  const { data: s } = await db.from("government_sources").select("*").eq("id", id).maybeSingle();
  if (!s) notFound();
  const src = s as Row;
  const [ref, org, runs, items, links, history, counts] = await Promise.all([
    getRef(),
    src.organization_id ? db.from("organizations").select("id,name,official_website").eq("id", src.organization_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("ingestion_runs").select("id,started_at,completed_at,status,trigger,records_new,records_updated,records_unchanged,records_rejected,duplicates,errors,error_summary,duration_ms").eq("source_id", id).order("started_at", { ascending: false }).limit(15),
    db.from("discovered_items").select("id,title,suggested_kind,confidence,review_status,discovered_at,change_target_id,previous_item_id,duplicate_id").eq("source_id", id).order("discovered_at", { ascending: false }).limit(12),
    db.from("source_content_links").select("kind,content_id,relation,created_at").eq("source_id", id).order("created_at", { ascending: false }).limit(30),
    db.from("audit_logs").select("id,at,action,actor_label,actor_id,before,after").eq("entity", "government_sources").eq("entity_id", id).order("at", { ascending: false }).limit(15),
    db.rpc("source_record_counts"),
  ]);
  const cnt = ((counts.data ?? []) as Row[]).find((r) => r.source_id === id);
  // Titles of linked records, one query per kind.
  const linkRows = (links.data ?? []) as Row[];
  const titles = new Map<string, { title: string; status: string }>();
  for (const kind of [...new Set(linkRows.map((l) => l.kind))].filter(isKind)) {
    const idsK = linkRows.filter((l) => l.kind === kind).map((l) => l.content_id);
    const r = await db.from(KIND_TABLE[kind]).select(`id,${KIND_TITLE_FIELD[kind]},status`).in("id", idsK);
    for (const x of (r.data ?? []) as Row[]) titles.set(`${kind}|${x.id}`, { title: x[KIND_TITLE_FIELD[kind]], status: x.status });
  }
  const canManage = can(staff.role, "source:manage"); const canRun = can(staff.role, "ingestion:run");
  const failed = ((runs.data ?? []) as Row[]).filter((r) => ["failed", "blocked", "partial"].includes(r.status));
  const urlRows: [string, string | null][] = [["Official website", src.base_url], ["Recruitment / notices", src.recruitment_url], ["Admit cards", src.admit_card_url], ["Results", src.results_url], ["Answer keys", src.answer_key_url], ["Exams / calendar", src.exam_url]];
  const dl = (rows: [string, React.ReactNode][]) => (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">{rows.map(([k, v]) => <div key={k}><dt className="text-ink-muted">{k}</dt><dd className="font-medium break-words">{v ?? "—"}</dd></div>)}</dl>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><Link href="/admin/sources" className="text-sm text-brand-700 underline">← Source registry</Link>
          <h1 className="mt-1 break-words text-2xl font-extrabold">{src.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted"><span className={`badge ${sourceStatusClass(src.status)}`} data-testid="source-status">{sourceStatusLabel(src.status)}</span>
            <span className="font-mono">{src.official_domain}</span>{src.is_synthetic && <span className="badge badge-demo">Synthetic test source — not a real government body</span>}</p></div>
        {canRun && (
          <form action={checkNowAction}><input type="hidden" name="id" value={id} />
            <button className="btn btn-accent" disabled={["ARCHIVED"].includes(src.status)}>Check now</button></form>
        )}
      </div>
      {sp.notice && NOTICE[sp.notice] && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">{NOTICE[sp.notice]}</p>}
      {sp.notice?.startsWith("status_") && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">Status changed to {sourceStatusLabel(sp.notice.slice(7))}.</p>}
      {sp.checked && <p role="status" data-testid="check-result" className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{sp.checked.slice(0, 300)} {sp.run && <Link href={`/admin/ingestion/${sp.run}`} className="underline">Open the run log</Link>} · <Link href={`/admin/review?source=${id}`} className="underline">Review what was found</Link></p>}
      {sp.error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">{sp.error.slice(0, 300)}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="info-h" className="card space-y-3 p-4">
          <h2 id="info-h" className="font-bold">Source information</h2>
          {dl([
            ["Type", sourceTypeLabel(src.source_type)], ["Hierarchy", AUTHORITY_RANKS.find(([r]) => r === src.authority_rank)?.[1]],
            ["Organization", org.data ? <Link href={`/admin/organizations/${(org.data as Row).id}`} className="text-brand-700 underline">{(org.data as Row).name}</Link> : "—"],
            ["Department", ref.allDepartments.find((d) => d.id === src.department_id)?.name], ["State / UT", ref.allStates.find((x) => x.id === src.state_id)?.name ?? "Central / all-India"],
            ["Priority", `${src.source_priority} · every ${src.check_interval_hours} h`], ["Adapter", src.adapter], ["Registered", formatDateTimeIST(src.created_at)],
          ])}
          {src.notes && <p className="whitespace-pre-line text-sm text-ink-soft">{src.notes}</p>}
        </section>
        <section aria-labelledby="urls-h" className="card space-y-3 p-4">
          <h2 id="urls-h" className="font-bold">Official domain & pages</h2>
          <p className="font-mono text-sm">{src.official_domain}</p>
          <ul className="space-y-1 text-sm">{urlRows.filter(([, u]) => u).map(([k, u]) => <li key={k}><span className="text-ink-muted">{k}: </span><a href={u!} target="_blank" rel="noopener noreferrer" className="break-all text-brand-700 underline">{u}</a></li>)}</ul>
        </section>
      </div>

      <section aria-labelledby="health-h" className="card space-y-3 p-4">
        <h2 id="health-h" className="font-bold">Health</h2>
        {dl([
          ["Last checked", formatDateTimeIST(src.last_checked_at)], ["Next scheduled check", src.next_check_at ? formatDateTimeIST(src.next_check_at) : "Not scheduled"],
          ["Last successful check", formatDateTimeIST(src.last_success_at)], ["Last failed check", formatDateTimeIST(src.last_failure_at)],
          ["Last HTTP status", src.last_http_status ?? "—"], ["Consecutive failures", `${src.failure_count} (${src.total_failures} in total)`],
          ["Last extraction", formatDateTimeIST(src.last_extraction_at)], ["Last check found", `${src.last_new_count} new · ${src.last_changed_count} changed`],
          ["Records discovered", `${cnt?.discovered ?? 0} (${cnt?.pending ?? 0} waiting for review)`], ["Records published", cnt?.published ?? 0],
        ])}
        {src.last_error && <p role="note" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">Last error: {src.last_error}</p>}
        {canManage && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {(src.status === "ACTIVE" ? [["PAUSED", "Pause checks"]] : src.status === "ARCHIVED" ? [["REVIEW_REQUIRED", "Restore"]] : [["ACTIVE", "Set active"], ["PAUSED", "Pause checks"]])
              .concat(src.status !== "ARCHIVED" ? [["ARCHIVED", "Archive"]] : []).filter(([to]) => to !== src.status).map(([to, label]) => (
              <form key={to} action={setSourceStatusAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value={to} /><button className="btn btn-outline btn-sm">{label}</button></form>
            ))}
          </div>
        )}
      </section>

      {canRun && src.status !== "ARCHIVED" && (
        <section aria-labelledby="one-h" className="card space-y-2 p-4">
          <h2 id="one-h" className="font-bold">Check a single notice</h2>
          <p className="text-sm text-ink-muted">Paste the URL of one notice (HTML page or PDF) on {src.official_domain}. It is fetched politely, extracted and sent to the review queue — never published directly.</p>
          <form action={checkNowAction} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={id} />
            <label htmlFor="only-url" className="sr-only">Notice URL</label>
            <input id="only-url" name="only_url" type="url" required placeholder={`https://${src.official_domain}/…`} className="input min-w-0 flex-1" />
            <button className="btn btn-outline">Check this notice</button></form>
        </section>
      )}

      <section aria-labelledby="runs-h">
        <h2 id="runs-h" className="section-title mb-2">Last checks</h2>
        <div className="table-wrap card" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="w-full text-left text-sm"><caption className="sr-only">Recent checks of this source</caption>
          <thead className="border-b border-line bg-brand-50 text-xs uppercase tracking-wide text-ink-muted"><tr>{["Started", "Trigger", "Status", "New", "Changed", "Unchanged", "Skipped", "Errors", "Duration"].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {!(runs.data ?? []).length && <tr><td colSpan={9} className="px-3 py-4 text-center text-ink-muted">Never checked.</td></tr>}
            {((runs.data ?? []) as Row[]).map((r) => <tr key={r.id}>
              <td className="whitespace-nowrap px-3 py-2"><Link href={`/admin/ingestion/${r.id}`} className="text-brand-700 underline">{formatDateTimeIST(r.started_at)}</Link></td>
              <td className="px-3 py-2">{r.trigger}</td><td className="px-3 py-2"><span className={`badge ${RUN_STATUS_CLASS[r.status] ?? ""}`}>{r.status}</span></td>
              <td className="px-3 py-2">{r.records_new}</td><td className="px-3 py-2">{r.records_updated}</td><td className="px-3 py-2">{r.records_unchanged}</td><td className="px-3 py-2">{r.records_rejected}</td>
              <td className="px-3 py-2">{r.errors}</td><td className="px-3 py-2">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : "—"}</td></tr>)}
          </tbody></table></div>
      </section>

      {failed.length > 0 && (
        <section aria-labelledby="fail-h" className="card p-4">
          <h2 id="fail-h" className="font-bold">Failed / partial checks</h2>
          <ul className="mt-2 space-y-1 text-sm">{failed.map((r) => <li key={r.id}><Link href={`/admin/ingestion/${r.id}`} className="text-brand-700 underline">{formatDateTimeIST(r.started_at)}</Link> — {r.status}: {r.error_summary ?? "see log"}</li>)}</ul>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="disc-h" className="card p-4">
          <h2 id="disc-h" className="font-bold">Recent discoveries</h2>
          {!(items.data ?? []).length ? <p className="mt-2 text-sm text-ink-muted">Nothing discovered yet.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">{((items.data ?? []) as Row[]).map((d) => (
              <li key={d.id} className="py-2"><Link href={`/admin/review/${d.id}`} className="font-semibold text-brand-700 underline">{d.title}</Link>
                <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-ink-muted"><span>{KIND_LABEL[d.suggested_kind as keyof typeof KIND_LABEL] ?? d.suggested_kind}</span>
                  <span className={`badge ${CONFIDENCE_CLASS[d.confidence]}`}>{d.confidence}</span><span>{REVIEW_STATUS_LABEL[d.review_status]}</span>
                  {(d.change_target_id || d.previous_item_id) && <span className="badge badge-updated">Change</span>}{d.duplicate_id && <span className="badge badge-urgent">Possible duplicate</span>}
                  <span>{formatDateTimeIST(d.discovered_at)}</span></p></li>))}</ul>)}
        </section>
        <section aria-labelledby="pub-h" className="card p-4">
          <h2 id="pub-h" className="font-bold">Records from this source</h2>
          {!linkRows.length ? <p className="mt-2 text-sm text-ink-muted">No content linked to this source yet.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">{linkRows.filter((l) => isKind(l.kind)).map((l) => { const t = titles.get(`${l.kind}|${l.content_id}`); return (
              <li key={`${l.kind}${l.content_id}`} className="py-2"><Link href={adminHref(l.kind, l.content_id)} className="font-semibold text-brand-700 underline">{t?.title ?? l.content_id}</Link>
                <p className="text-xs text-ink-muted">{KIND_LABEL[l.kind as keyof typeof KIND_LABEL]} · {t?.status ?? "?"} · {l.relation}</p></li>); })}</ul>)}
        </section>
      </div>

      <section aria-labelledby="hist-h" className="card p-4">
        <h2 id="hist-h" className="font-bold">Change history</h2>
        <ul className="mt-2 space-y-1 text-sm">{((history.data ?? []) as Row[]).map((h) => (
          <li key={h.id}><span className="text-ink-muted">{formatDateTimeIST(h.at)}</span> · <code>{h.action}</code>{h.after ? ` · ${Object.keys(h.after).slice(0, 6).join(", ")}` : ""}{h.actor_label ? ` · ${h.actor_label}` : ""}</li>))}</ul>
      </section>

      {canManage && (
        <details className="card p-4"><summary className="cursor-pointer font-bold">Edit source</summary>
          <div className="mt-3"><SourceForm options={await sourceFormOptions(db)} initial={await sourceInitial(src)} id={id} /></div></details>
      )}
    </div>
  );
}
