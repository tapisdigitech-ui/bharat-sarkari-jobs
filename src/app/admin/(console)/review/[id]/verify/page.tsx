import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/admin/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIST } from "@/lib/admin/format";
import { getRef } from "@/lib/data/ref";
import { isKind, KIND_LABEL } from "@/lib/admin/kinds";
import { CONFIDENCE_CLASS } from "@/lib/sources/config";
import { VERIFY_STATUSES, verifyGroups, type VerifyGroup } from "@/lib/ingestion/verify-fields";
import { UnsavedChangesGuard } from "@/components/admin/UnsavedChangesGuard";
import { verifyFieldsAction } from "../../actions";

/**
 * Side-by-side verification (Phase 3.6 item 14): extracted values on the left, the official document on the right, one
 * decision per field. The right-hand side is the text read from the official URL at discovery time (with each value's
 * evidence highlighted) plus a link to the official document itself — the reviewer compares against the original.
 */
export const metadata: Metadata = { title: "Verify against the official source", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
type Row = Record<string, any>;
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

const STATUS_CLASS: Record<string, string> = { verified: "bg-success-50 text-success-700", incorrect: "bg-danger-50 text-danger-700", not_in_source: "bg-warning-50 text-warning-700" };
const STATUS_LABEL = Object.fromEntries(VERIFY_STATUSES) as Record<string, string>;
const MAX_TEXT = 20_000;

/** Split the source text into plain and highlighted runs, one highlight per field group (first occurrence of its evidence). */
function highlight(text: string, marks: { key: string; phrase: string }[]) {
  const ranges: { start: number; end: number; key: string }[] = [];
  const lower = text.toLowerCase();
  for (const m of marks) {
    const p = m.phrase.trim().replace(/\s+/g, " ");
    if (p.length < 3) continue;
    let at = text.indexOf(p);
    if (at < 0) at = lower.indexOf(p.toLowerCase());
    if (at < 0) { const head = p.slice(0, 40).toLowerCase(); at = head.length >= 8 ? lower.indexOf(head) : -1; if (at >= 0) { ranges.push({ start: at, end: at + head.length, key: m.key }); continue; } }
    if (at >= 0 && !ranges.some((r) => at < r.end && at + p.length > r.start)) ranges.push({ start: at, end: at + p.length, key: m.key });
  }
  ranges.sort((a, b) => a.start - b.start);
  const out: { text: string; key?: string }[] = []; let pos = 0;
  for (const r of ranges) { if (r.start < pos) continue; out.push({ text: text.slice(pos, r.start) }, { text: text.slice(r.start, r.end), key: r.key }); pos = r.end; }
  out.push({ text: text.slice(pos) });
  return { runs: out, found: new Set(ranges.map((r) => r.key)) };
}

export default async function VerifyDiscovery({ params, searchParams }: Props) {
  const staff = await requireStaff();
  const { id } = await params; const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const db = await createSupabaseServerClient();
  const { data } = await db.from("discovered_items").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const it = data as Row;
  // Human-effort measurement: the first time a reviewer opens this item (no-op afterwards and for viewers without review rights).
  if (!it.review_started_at && ["pending", "needs_review"].includes(it.review_status)) await db.rpc("mark_review_started", { p_id: id });
  const kind = isKind(it.suggested_kind) ? it.suggested_kind : "job";
  const ex = (it.extracted ?? {}) as Row;
  const fe = (it.field_evidence ?? {}) as Record<string, string>;
  const fc = (it.field_confidence ?? {}) as Record<string, number>;
  const canReview = can(staff.role, "ingestion:review") && ["pending", "needs_review"].includes(it.review_status);
  const [doc, latest, org, ref] = await Promise.all([
    it.document_id ? db.from("source_documents").select("raw_text,document_type,retrieved_at,raw_text_purge_at,document_hash,final_url").eq("id", it.document_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("field_verification_latest").select("field,status,note,verified_at").eq("subject_kind", "discovery").eq("subject_id", id),
    ex.organization_id ? db.from("organizations").select("name").eq("id", ex.organization_id).maybeSingle() : Promise.resolve({ data: null }),
    getRef(),
  ]);
  const d = doc.data as Row | null;
  const decided = new Map(((latest.data ?? []) as Row[]).map((r) => [r.field as string, r]));
  const groups = verifyGroups(kind);
  const display = (g: VerifyGroup): string => {
    const vals = g.fields.map((f) => {
      const v = ex[f];
      if (v === undefined || v === null || v === "") return null;
      if (f === "organization_id") return ((org.data as Row | null)?.name as string) ?? String(v);
      if (f === "qualification_slugs" && Array.isArray(v)) return v.map((s) => ref.qualifications.find((q) => q.slug === s)?.name ?? s).join(", ");
      if (f === "age_min") return `min ${v}`; if (f === "age_max") return `max ${v}`;
      if (f === "fee_general") return `general ${v}`; if (f === "fee_reserved") return `reserved ${v}`;
      return Array.isArray(v) ? v.join(", ") : String(v);
    }).filter(Boolean);
    return vals.length ? vals.join(" · ") : "";
  };
  const text = d?.raw_text ? String(d.raw_text).slice(0, MAX_TEXT) : "";
  const { runs, found } = highlight(text, groups.flatMap((g) => g.fields.filter((f) => fe[f]).map((f) => ({ key: g.key, phrase: fe[f] }))));
  const done = groups.filter((g) => decided.has(g.key)).length;
  const officialUrl = (it.item_url as string) || (ex.notification_url as string) || null;

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/admin/review/${id}`} className="text-sm text-brand-700 underline">← Back to the review item</Link>
        <h1 className="mt-1 break-words text-2xl font-extrabold">Verify: {it.title}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span className="badge badge-neutral">{KIND_LABEL[kind]}</span>
          <span className={`badge ${CONFIDENCE_CLASS[it.confidence]}`}>Extraction confidence: {it.confidence} · internal</span>
          {it.amendment_type && <span className="badge badge-urgent">Official update: {String(it.amendment_type).replace(/_/g, " ")}</span>}
          <span data-testid="verify-progress">{done} of {groups.length} fields decided</span>
        </p>
      </div>
      {sp.notice === "verified" && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">Your decisions were saved (the history of every decision is kept).</p>}
      {sp.notice === "unchanged" && <p role="status" className="rounded-md border border-line bg-white px-3 py-2 text-sm">Nothing changed — no new decisions to save.</p>}
      {sp.error && <p role="alert" data-testid="verify-error" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">{sp.error.slice(0, 400)}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="ex-h" className="card min-w-0 p-4">
          <h2 id="ex-h" className="font-bold">Extracted values</h2>
          <p className="mt-1 text-sm text-ink-muted">Decide each field against the official document. To correct a value, go back and use “Save corrections”, then verify it here.</p>
          <form id="verify-form" action={verifyFieldsAction} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={id} />
            {groups.map((g) => {
              const v = display(g); const prev = decided.get(g.key);
              const conf = Math.min(...g.fields.map((f) => fc[f] ?? 1));
              return (
                <fieldset key={g.key} className="rounded-md border border-line p-3" data-testid={`verify-${g.key}`}>
                  <legend className="px-1 text-sm font-bold">{g.label}</legend>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className={`min-w-0 break-words text-sm ${v ? "font-semibold" : "italic text-ink-muted"}`}>{v || "Nothing extracted"}{v && conf < 1 && <span className="ml-1 text-xs font-normal text-warning-700">(uncertain)</span>}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {found.has(g.key) && <a href={`#ev-${g.key}`} className="text-brand-700 underline">Show in source</a>}
                      {prev && <span className={`badge whitespace-normal ${STATUS_CLASS[prev.status]}`}>{STATUS_LABEL[prev.status]} · {formatDateTimeIST(prev.verified_at)}</span>}
                    </div>
                  </div>
                  {canReview && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                      {VERIFY_STATUSES.map(([s, label]) => (
                        <label key={s} className="inline-flex items-center gap-1.5 text-sm"><input type="radio" name={`v_${g.key}`} value={s} defaultChecked={prev?.status === s} className="size-4" />{label}</label>
                      ))}
                      <label className="sr-only" htmlFor={`vn-${g.key}`}>{g.label}: note</label>
                      <input id={`vn-${g.key}`} name={`vn_${g.key}`} defaultValue={prev?.note ?? ""} maxLength={500} placeholder="Note (required if wrong)" className="input h-9 min-w-0 flex-1 text-sm" />
                    </div>
                  )}
                </fieldset>
              );
            })}
            {canReview ? <button className="btn btn-primary">Save decisions</button>
              : <p className="text-sm text-ink-muted">{can(staff.role, "ingestion:review") ? "This item has been decided; its verification history is shown above." : "Your role can view but not verify discoveries."}</p>}
          </form>
          {canReview && <UnsavedChangesGuard formId="verify-form" confirmLinks />}
        </section>

        <section aria-labelledby="src-h" className="card min-w-0 p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
          <h2 id="src-h" className="font-bold">Official source</h2>
          {officialUrl ? (
            <p className="mt-1 text-sm"><a href={officialUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 underline">Open the official document ↗</a>
              <span className="block break-all text-xs text-ink-muted">{officialUrl}</span></p>
          ) : <p className="mt-1 text-sm text-ink-muted">No official URL recorded (CSV import).</p>}
          {d ? (
            <p className="mt-2 text-xs text-ink-muted">{String(d.document_type).toUpperCase()} read {formatDateTimeIST(d.retrieved_at)} · fingerprint {String(d.document_hash).slice(0, 12)} · text kept until {formatDateTimeIST(d.raw_text_purge_at)}</p>
          ) : null}
          {text ? (
            <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-canvas p-3 text-xs leading-relaxed" data-testid="source-text">
              {runs.map((r, i) => r.key ? <mark key={i} id={`ev-${r.key}`} className="rounded bg-accent-100 px-0.5" title={groups.find((g) => g.key === r.key)?.label}>{r.text}</mark> : <span key={i}>{r.text}</span>)}
            </pre>
          ) : (
            <p role="note" className="mt-3 rounded-md border border-warning-700/30 bg-warning-50 px-3 py-2 text-sm text-warning-700">
              {d ? "No text could be read from this document (scanned image or unreadable font) — compare with the official document directly." : "The text read from this document is no longer stored (kept for 30 days) — compare with the official document directly."}
            </p>
          )}
          {text.length === MAX_TEXT && <p className="mt-2 text-xs text-ink-muted">Showing the first {MAX_TEXT.toLocaleString("en-IN")} characters.</p>}
        </section>
      </div>
    </div>
  );
}
