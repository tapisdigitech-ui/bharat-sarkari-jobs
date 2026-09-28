import Link from "next/link";
import type { ContentKind } from "@/lib/admin/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIST } from "@/lib/admin/format";
import { LINK_FIELDS } from "@/lib/ingestion/links";
import { officialUrlWarnings, hostOf } from "@/lib/ingestion/url-checks";
import { fieldLabel } from "@/lib/ingestion/review-fields";
import { VERIFICATION_CLASS, VERIFICATION_LABEL } from "@/lib/sources/config";
import { checkRecordLinksAction } from "@/app/admin/(console)/record-actions";

type Row = Record<string, any>;
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

/**
 * Operations panel shown under every content editor: source verification status, official-link health with domain
 * warnings, the official sources the record came from, and its numbered version history.
 */
export async function RecordOps({ kind, id, row, linksNotice }: { kind: ContentKind; id: string; row: Row; linksNotice?: string }) {
  const db = await createSupabaseServerClient();
  const orgId = row.organization_id as string | undefined;
  const [org, sources, links, versions, srcLinks] = await Promise.all([
    orgId ? db.from("organizations").select("official_website").eq("id", orgId).maybeSingle() : Promise.resolve({ data: null }),
    orgId ? db.from("government_sources").select("official_domain").eq("organization_id", orgId) : Promise.resolve({ data: [] }),
    db.from("link_status_latest").select("field,url,outcome,http_status,checked_at,broken,consecutive_failures,error").eq("kind", kind).eq("content_id", id),
    db.from("content_versions").select("version,status,changed_at,changed_by,source,reason,important_changes,changes").eq("kind", kind).eq("content_id", id).order("version", { ascending: false }).limit(30),
    db.from("source_content_links").select("source_id,relation,created_at").eq("kind", kind).eq("content_id", id),
  ]);
  const domains = [hostOf(((org.data as Row | null)?.official_website as string) ?? "") ?? "", ...((sources.data ?? []) as Row[]).map((s) => s.official_domain as string)].filter(Boolean);
  const latest = new Map(((links.data ?? []) as Row[]).map((l) => [l.field, l]));
  const srcRows = (srcLinks.data ?? []) as Row[];
  const srcNames = srcRows.length ? new Map((((await db.from("government_sources").select("id,name").in("id", srcRows.map((s) => s.source_id))).data ?? []) as Row[]).map((s) => [s.id, s.name])) : new Map();
  const urls = LINK_FIELDS[kind].filter((f) => row[f]);
  const vs = (row.verification_status as string) ?? "NEEDS_REVIEW";
  const changedBy = new Map<string, string>();
  const ids = [...new Set(((versions.data ?? []) as Row[]).map((v) => v.changed_by).filter(Boolean))];
  if (ids.length) for (const p of (((await db.from("profiles").select("id,display_name").in("id", ids)).data ?? []) as Row[])) changedBy.set(p.id, p.display_name);

  return (
    <div className="space-y-5">
      <section aria-labelledby="ver-h" className="card space-y-3 p-4" data-testid="verification">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ver-h" className="font-bold">Source verification & official links</h2>
          <form action={checkRecordLinksAction}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><button className="btn btn-outline btn-sm" disabled={!urls.length}>Check links now</button></form>
        </div>
        {linksNotice && <p role="status" className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{linksNotice}</p>}
        <p className="flex flex-wrap items-center gap-2 text-sm"><span className={`badge ${VERIFICATION_CLASS[vs] ?? ""}`}>{VERIFICATION_LABEL[vs] ?? vs}</span>
          <span className="text-ink-muted">Source last checked {formatDateTimeIST(row.source_checked_at)} · last verified {formatDateTimeIST(row.last_verified_at)}</span></p>
        {vs === "SOURCE_UNAVAILABLE" && <p role="note" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">The official links failed on several checks. The record stays published — government sites are often down temporarily. Open the links; if the notice was withdrawn, unpublish or expire it; if it moved, update the URL and tick “I checked the official source”.</p>}
        {!urls.length ? <p className="text-sm text-ink-muted">No official links recorded yet.</p> : (
          <ul className="divide-y divide-line text-sm">{urls.map((f) => { const l = latest.get(f); const w = officialUrlWarnings(String(row[f]), domains); return (
            <li key={f} className="py-2"><p><span className="font-semibold">{fieldLabel(f)}</span>: <a href={row[f]} target="_blank" rel="noopener noreferrer" className="break-all text-brand-700 underline">{row[f]}</a></p>
              <p className="text-xs text-ink-muted">{l ? <>Last check {formatDateTimeIST(l.checked_at)}: <span className={l.broken ? "font-semibold text-danger-700" : "text-success-700"}>{l.outcome}{l.http_status ? ` (HTTP ${l.http_status})` : ""}</span>{l.broken && l.consecutive_failures > 1 ? ` · failed ${l.consecutive_failures} checks in a row` : ""}</> : "Not checked yet"}</p>
              {w.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-warning-700" data-testid="url-warning">{w.map((x) => <li key={x}>{x}</li>)}</ul>}</li>); })}</ul>)}
        {srcRows.length > 0 && <p className="text-sm"><span className="text-ink-muted">Official source(s): </span>{srcRows.map((s, i) => <span key={s.source_id}>{i > 0 && ", "}<Link href={`/admin/sources/${s.source_id}`} className="text-brand-700 underline">{srcNames.get(s.source_id) ?? "source"}</Link> <span className="text-ink-muted">({s.relation})</span></span>)}</p>}
      </section>

      <section aria-labelledby="vh-h" className="card p-4" data-testid="versions">
        <h2 id="vh-h" className="font-bold">Version history</h2>
        <p className="text-xs text-ink-muted">A new version is recorded when the record is published and every time published information changes. Drafts are tracked in the audit log.</p>
        {!(versions.data ?? []).length ? <p className="mt-2 text-sm text-ink-muted">Not published yet — no versions.</p> : (
          <ol className="mt-2 space-y-2 text-sm">{((versions.data ?? []) as Row[]).map((v) => { const imp = Object.entries((v.important_changes ?? {}) as Record<string, { from: unknown; to: unknown }>); return (
            <li key={v.version} className="rounded-md border border-line p-2">
              <p><strong>Version {v.version}</strong> · {v.status} · {formatDateTimeIST(v.changed_at)} · {v.changed_by ? changedBy.get(v.changed_by) ?? "staff" : "system"}{v.source === "ingestion" ? " · from a source update" : ""}</p>
              {v.reason && <p className="text-ink-soft">Reason: {v.reason}</p>}
              {imp.length > 0 && <ul className="mt-1 text-xs">{imp.map(([k, c]) => <li key={k}><span className="font-semibold">{fieldLabel(k)}</span>: <span className="text-danger-700">{show(c.from)}</span> → <span className="text-success-700">{show(c.to)}</span></li>)}</ul>}
              {!imp.length && Object.keys(v.changes ?? {}).length > 0 && <p className="text-xs text-ink-muted">Changed: {Object.keys(v.changes).map(fieldLabel).join(", ")}</p>}
            </li>); })}</ol>)}
      </section>
    </div>
  );
}
