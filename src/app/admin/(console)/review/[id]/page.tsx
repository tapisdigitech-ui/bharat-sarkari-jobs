import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { can, type Action } from "@/lib/admin/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIST } from "@/lib/admin/format";
import { getRef } from "@/lib/data/ref";
import { KIND_LABEL, KIND_TABLE, KIND_TITLE_FIELD, adminHref, isKind } from "@/lib/admin/kinds";
import { CONFIDENCE_CLASS, REVIEW_STATUS_LABEL } from "@/lib/sources/config";
import { REVIEW_FIELDS, fieldLabel } from "@/lib/ingestion/review-fields";
import { diffFields } from "@/lib/ingestion/normalize";
import { approveAction, applyChangesAction, decideAction, keepSeparateAction, mergeAction, saveExtractedAction } from "../actions";

export const metadata: Metadata = { title: "Review discovery" };
export const dynamic = "force-dynamic";
type Row = Record<string, any>;
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

const NOTICE: Record<string, string> = { rejected: "Rejected.", ignored: "Ignored.", needs_review: "Sent for senior review.", pending: "Reopened.", keep_separate: "Marked as a separate record — you can approve it now.",
  merged: "Merged into the existing record; this source is now linked to it.", edited: "Your corrections were saved.", applied: "Changes applied to the record and recorded in its version history." };
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function ReviewItem({ params, searchParams }: Props) {
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
  const open = ["pending", "needs_review"].includes(it.review_status);
  const canReview = can(staff.role, "ingestion:review");
  const ref = await getRef();
  const [src, orgs, doc, cats, rtypes, ktypes] = await Promise.all([
    it.source_id ? db.from("government_sources").select("id,name,official_domain,state_id,department_id,is_synthetic").eq("id", it.source_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("organizations").select("id,name").eq("is_active", true).order("name").limit(3000),
    it.document_id ? db.from("source_documents").select("raw_text,document_type,retrieved_at,raw_text_purge_at,byte_size").eq("id", it.document_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("categories").select("slug,name").eq("is_active", true).order("sort_order"),
    db.from("result_types").select("id,name").eq("is_active", true).order("sort_order"),
    db.from("answer_key_types").select("id,name").eq("is_active", true).order("sort_order"),
  ]);
  const source = src.data as Row | null;
  // The existing record this discovery would update (change detection) or may duplicate.
  const tKind = (it.change_target_kind ?? it.duplicate_kind) as string | null; const tId = (it.change_target_id ?? it.duplicate_id) as string | null;
  let target: Row | null = null;
  if (tKind && tId && isKind(tKind)) target = ((await db.from(KIND_TABLE[tKind]).select("*").eq("id", tId).maybeSingle()).data as Row) ?? null;
  const prev = it.previous_item_id ? ((await db.from("discovered_items").select("id,discovered_at,review_status").eq("id", it.previous_item_id).maybeSingle()).data as Row | null) : null;
  const dupOpen = it.duplicate_id && !it.duplicate_resolution;
  const dupDiff = dupOpen && target ? diffFields(target, ex) : null;
  const changes = (it.changes ?? {}) as Record<string, { from: unknown; to: unknown; important: boolean }>;
  const applicable = it.change_target_id && target ? Object.keys(changes).filter((k) => k in target!) : [];
  const low = it.confidence === "LOW";
  const canPublishKind = (k: string) => can(staff.role, `${k}:publish` as Action);
  const stateDefault = ex.state_slug ?? (ex.is_all_india === false && ex.state_id ? ref.allStates.find((s) => s.id === ex.state_id)?.slug : null) ?? (source?.state_id ? ref.allStates.find((s) => s.id === source.state_id)?.slug : "all-india") ?? "all-india";
  const deptDefault = ex.department_slug ?? ref.allDepartments.find((d) => d.id === source?.department_id)?.slug ?? "";
  const qualsDefault: string[] = Array.isArray(ex.qualification_slugs) ? ex.qualification_slugs : [];
  const fe = (it.field_evidence ?? {}) as Record<string, string>; const fc = (it.field_confidence ?? {}) as Record<string, number>;
  const fields = REVIEW_FIELDS[kind] ?? REVIEW_FIELDS.job;

  return (
    <div className="space-y-5">
      <div><Link href="/admin/review" className="text-sm text-brand-700 underline">← Review queue</Link>
        <h1 className="mt-1 break-words text-2xl font-extrabold">{it.title}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span className="badge badge-neutral">{KIND_LABEL[kind]}</span>
          <span className={`badge ${CONFIDENCE_CLASS[it.confidence]}`} data-testid="confidence">Confidence: {it.confidence} ({Math.round(Number(it.confidence_score) * 100)}%) · internal</span>
          <span data-testid="review-status">{REVIEW_STATUS_LABEL[it.review_status]}</span>
          {it.amendment_type && <span className="badge badge-urgent" data-testid="amendment-type">Official update: {String(it.amendment_type).replace(/_/g, " ")}</span>}
          {it.is_synthetic && <span className="badge badge-demo">Synthetic test data — not a real notice</span>}</p>
        <p className="mt-2"><Link href={`/admin/review/${id}/verify`} className="btn btn-outline btn-sm" data-testid="verify-link">Verify field by field against the official source →</Link></p></div>
      {sp.notice && NOTICE[sp.notice] && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">{NOTICE[sp.notice]}</p>}
      {sp.error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">{sp.error.slice(0, 400)}</p>}

      <section aria-labelledby="where-h" className="card p-4">
        <h2 id="where-h" className="font-bold">Where it came from</h2>
        <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-muted">Source</dt><dd className="font-medium">{source ? <Link href={`/admin/sources/${source.id}`} className="text-brand-700 underline">{source.name}</Link> : it.origin === "import" ? "CSV import" : "—"}</dd></div>
          <div><dt className="text-ink-muted">Official URL</dt><dd className="break-all font-medium">{it.item_url ? <a href={it.item_url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">{it.item_url}</a> : "—"}</dd></div>
          <div><dt className="text-ink-muted">Discovered</dt><dd className="font-medium">{formatDateTimeIST(it.discovered_at)} · seen {it.seen_count}×, last {formatDateTimeIST(it.last_seen_at)}</dd></div>
          <div><dt className="text-ink-muted">Reviewed</dt><dd className="font-medium">{it.reviewed_at ? `${formatDateTimeIST(it.reviewed_at)}${it.review_note ? ` — ${it.review_note}` : ""}` : "Not yet"}</dd></div>
          {it.resulting_id && isKind(it.resulting_kind) && <div className="sm:col-span-2"><dt className="text-ink-muted">Resulting record</dt><dd><Link href={adminHref(it.resulting_kind, it.resulting_id)} className="font-semibold text-brand-700 underline">Open the {KIND_LABEL[it.resulting_kind].toLowerCase()}</Link></dd></div>}
          {(it.external_id || it.group_key) && <div className="sm:col-span-2"><dt className="text-ink-muted">Source’s own reference</dt><dd className="font-medium">{it.external_id ? `notice id ${it.external_id}` : ""}{it.external_id && it.group_key ? " · " : ""}{it.group_key ? `group ${it.group_key} (links related notices and their corrigenda)` : ""}</dd></div>}
          {prev && <div className="sm:col-span-2"><dt className="text-ink-muted">Earlier version of this notice</dt><dd><Link href={`/admin/review/${prev.id}`} className="text-brand-700 underline">Discovered {formatDateTimeIST(prev.discovered_at)}</Link> ({REVIEW_STATUS_LABEL[prev.review_status]})</dd></div>}
        </dl>
      </section>

      {it.validation_issues?.length > 0 && (
        <section aria-labelledby="iss-h" className="rounded-lg border border-warning-700/30 bg-warning-50 p-4 text-sm text-warning-700">
          <h2 id="iss-h" className="font-bold">Check these before approving</h2>
          <ul className="mt-1 list-disc pl-5">{(it.validation_issues as string[]).map((i) => <li key={i}>{i}</li>)}</ul>
        </section>
      )}

      {Object.keys(changes).length > 0 && (
        <section aria-labelledby="chg-h" className="card space-y-3 p-4" data-testid="changes">
          <h2 id="chg-h" className="font-bold">{it.change_target_id ? `Changes from the published ${KIND_LABEL[(tKind ?? "job") as keyof typeof KIND_LABEL]?.toLowerCase() ?? "record"}` : "Changes from the previous version of this notice"}</h2>
          {target && it.change_target_id && <p className="text-sm">Record: <Link href={adminHref(tKind as never, tId!)} className="font-semibold text-brand-700 underline">{target[KIND_TITLE_FIELD[tKind as keyof typeof KIND_TITLE_FIELD]]}</Link> <span className="text-ink-muted">({target.status})</span></p>}
          <form action={applyChangesAction} className="space-y-3">
            <input type="hidden" name="id" value={id} />
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="w-full text-left text-sm"><caption className="sr-only">Detected changes</caption>
              <thead className="border-b border-line text-xs uppercase text-ink-muted"><tr>{applicable.length > 0 && open && <th scope="col" className="px-2 py-1">Apply</th>}<th scope="col" className="px-2 py-1">Field</th><th scope="col" className="px-2 py-1">Previous</th><th scope="col" className="px-2 py-1">New (source)</th><th scope="col" className="px-2 py-1"><span className="sr-only">Importance</span></th></tr></thead>
              <tbody className="divide-y divide-line">{Object.entries(changes).map(([k, c]) => (
                <tr key={k}>{applicable.length > 0 && open && <td className="px-2 py-1">{applicable.includes(k) ? <input type="checkbox" name="fields" value={k} defaultChecked={c.important} aria-label={`Apply ${fieldLabel(k)}`} className="size-4" /> : null}</td>}
                  <th scope="row" className="px-2 py-1 font-semibold">{fieldLabel(k)}</th><td className="px-2 py-1 text-danger-700">{show(c.from)}</td><td className="px-2 py-1 font-semibold text-success-700">{show(c.to)}</td>
                  <td className="px-2 py-1">{c.important && <span className="badge badge-urgent">Important</span>}</td></tr>))}</tbody></table></div>
            {applicable.length > 0 && open && canReview && (<>
              <div><label htmlFor="reason" className="mb-1 block text-sm font-semibold">Reason (kept in the version history) *</label><input id="reason" name="reason" className="input" placeholder="e.g. Official corrigendum dated … extends the last date" maxLength={500} /></div>
              <button className="btn btn-primary">Apply selected changes</button>
              {target && ["published", "updated"].includes(target.status) && !canPublishKind(tKind!) && <p className="text-xs text-ink-muted">This record is live: only someone who can publish it may apply changes.</p>}
            </>)}
          </form>
        </section>
      )}

      {dupOpen && target && (
        <section aria-labelledby="dup-h" className="card space-y-3 border-danger-600/30 p-4" data-testid="duplicate">
          <h2 id="dup-h" className="font-bold text-danger-700">Possible duplicate</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-ink-muted">Existing record</dt><dd><Link href={adminHref(it.duplicate_kind, it.duplicate_id)} className="font-semibold text-brand-700 underline">{target[KIND_TITLE_FIELD[it.duplicate_kind as keyof typeof KIND_TITLE_FIELD]]}</Link> <span className="text-ink-muted">({KIND_LABEL[it.duplicate_kind as keyof typeof KIND_LABEL]}, {target.status})</span></dd></div>
            <div><dt className="text-ink-muted">New source</dt><dd className="font-medium">{source?.name ?? "CSV import"}</dd></div>
            <div><dt className="text-ink-muted">Why it matched</dt><dd className="font-medium">{(it.duplicate_reasons ?? []).join(", ")} · score {Math.round(Number(it.duplicate_score) * 100)}%</dd></div>
          </dl>
          {dupDiff && Object.keys(dupDiff).length > 0 && (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="w-full text-left text-sm"><caption className="text-left text-sm font-semibold">Difference</caption>
              <thead className="border-b border-line text-xs uppercase text-ink-muted"><tr><th scope="col" className="px-2 py-1">Field</th><th scope="col" className="px-2 py-1">Existing record</th><th scope="col" className="px-2 py-1">This discovery</th></tr></thead>
              <tbody className="divide-y divide-line">{Object.entries(dupDiff).map(([k, c]) => <tr key={k}><th scope="row" className="px-2 py-1">{fieldLabel(k)}</th><td className="px-2 py-1">{show(c.from)}</td><td className="px-2 py-1">{show(c.to)}</td></tr>)}</tbody></table></div>)}
          {open && canReview && (
            <div className="flex flex-wrap gap-2">
              <form action={mergeAction} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={id} /><input type="hidden" name="kind" value={it.duplicate_kind} /><input type="hidden" name="target" value={it.duplicate_id} />
                <label htmlFor="merge-note" className="sr-only">Merge note</label><input id="merge-note" name="note" className="input w-64" placeholder="Note (optional)" />
                <button className="btn btn-primary">Merge</button></form>
              <form action={keepSeparateAction}><input type="hidden" name="id" value={id} /><button className="btn btn-outline">Keep separate</button></form>
              <form action={decideAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="ignored" /><input type="hidden" name="duplicate" value="1" /><button className="btn btn-outline">Ignore</button></form>
            </div>)}
        </section>
      )}

      <section aria-labelledby="ex-h" className="card space-y-3 p-4">
        <h2 id="ex-h" className="font-bold">Extracted information</h2>
        <p className="text-sm text-ink-muted">Compare every value with the official document before approving. “Evidence” is the exact phrase each value was read from.</p>
        <form action={saveExtractedAction} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="w-full text-left text-sm"><caption className="sr-only">Extracted fields</caption>
            <thead className="border-b border-line text-xs uppercase text-ink-muted"><tr><th scope="col" className="px-2 py-1">Field</th><th scope="col" className="px-2 py-1">Value</th><th scope="col" className="px-2 py-1">Evidence (from the source)</th></tr></thead>
            <tbody className="divide-y divide-line">{fields.map((f) => { const v = ex[f.key]; const val = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v); return (
              <tr key={f.key}><th scope="row" className="px-2 py-1 align-top"><label htmlFor={`x-${f.key}`}>{f.label}</label>{fc[f.key] !== undefined && fc[f.key] < 1 && <span className="ml-1 text-xs text-warning-700">(uncertain)</span>}</th>
                <td className="px-2 py-1 align-top">{open && canReview ? (
                  <div className="flex flex-wrap gap-1">
                    <input id={`x-${f.key}`} name={`x_${f.key}`} type={f.type === "date" ? "date" : f.type === "number" ? "number" : f.type === "url" ? "url" : "text"} defaultValue={f.type === "date" ? val.slice(0, 10) : val} className="input min-w-0 flex-1" />
                    {f.statusKey && <select name={`x_${f.statusKey}`} defaultValue={ex[f.statusKey] === "expected" ? "expected" : "official"} className="input w-32" aria-label={`${f.label}: official or expected`}><option value="official">Official</option><option value="expected">Expected</option></select>}
                  </div>) : <span>{show(v)}{f.statusKey && ex[f.statusKey] ? ` (${ex[f.statusKey]})` : ""}</span>}</td>
                <td className="max-w-md px-2 py-1 align-top text-xs text-ink-muted">{fe[f.key] ?? ""}</td></tr>); })}</tbody></table></div>
          {open && canReview && <button className="btn btn-outline">Save corrections</button>}
        </form>
        {doc.data && (doc.data as Row).raw_text && (
          <details><summary className="cursor-pointer text-sm font-semibold">Text read from the {(doc.data as Row).document_type.toUpperCase()} (kept until {formatDateTimeIST((doc.data as Row).raw_text_purge_at)})</summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-3 text-xs">{String((doc.data as Row).raw_text).slice(0, 6000)}</pre></details>)}
      </section>

      {open && canReview && !it.change_target_id && (
        <section aria-labelledby="ap-h" className="card space-y-3 p-4" data-testid="approve">
          <h2 id="ap-h" className="font-bold">Approve → create a draft</h2>
          <p className="text-sm text-ink-muted">Creates a <strong>draft</strong> filled from the values above and links it to its official source. Nothing becomes public until the draft is published through the normal workflow.</p>
          {dupOpen && <p role="note" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">Resolve the duplicate warning above first (merge, keep separate or ignore).</p>}
          <form action={approveAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input type="hidden" name="id" value={id} />
            <div><label htmlFor="ap-kind" className="mb-1 block text-sm font-semibold">Create as</label><select id="ap-kind" name="kind" defaultValue={kind} className="input">{Object.entries(KIND_LABEL).filter(([k]) => can(staff.role, `${k}:create` as Action)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label htmlFor="ap-org" className="mb-1 block text-sm font-semibold">Organization</label><select id="ap-org" name="organization_id" defaultValue={it.organization_id ?? ""} className="input"><option value="">Select…</option>{((orgs.data ?? []) as Row[]).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
            <div><label htmlFor="ap-state" className="mb-1 block text-sm font-semibold">State / UT</label><select id="ap-state" name="state_slug" defaultValue={stateDefault} className="input"><option value="all-india">All India</option>{ref.allStates.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></div>
            <div><label htmlFor="ap-dept" className="mb-1 block text-sm font-semibold">Department (jobs)</label><select id="ap-dept" name="department_slug" defaultValue={deptDefault} className="input"><option value="">—</option>{ref.allDepartments.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}</select></div>
            <fieldset className="md:col-span-2"><legend className="mb-1 text-sm font-semibold">Qualifications (jobs)</legend><div className="flex flex-wrap gap-3">{ref.qualifications.map((q) => <label key={q.slug} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" name="qualification_slugs" value={q.slug} defaultChecked={qualsDefault.includes(q.slug)} className="size-4" />{q.name}</label>)}</div></fieldset>
            <fieldset className="md:col-span-2"><legend className="mb-1 text-sm font-semibold">Job categories (jobs)</legend><div className="flex flex-wrap gap-3">{((cats.data ?? []) as Row[]).map((c) => <label key={c.slug} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" name="category_slugs" value={c.slug} defaultChecked={Array.isArray(ex.category_slugs) && ex.category_slugs.includes(c.slug)} className="size-4" />{c.name}</label>)}</div></fieldset>
            <div><label htmlFor="ap-avail" className="mb-1 block text-sm font-semibold">Admit card availability</label><select id="ap-avail" name="availability" defaultValue="" className="input"><option value="">(not an admit card)</option><option value="upcoming">Upcoming</option><option value="released">Released (official link below)</option></select></div>
            <div><label htmlFor="ap-acurl" className="mb-1 block text-sm font-semibold">Official admit card URL</label><input id="ap-acurl" name="official_admit_card_url" type="url" className="input" defaultValue={ex.official_admit_card_url ?? ""} /></div>
            <div><label htmlFor="ap-rt" className="mb-1 block text-sm font-semibold">Result type</label><select id="ap-rt" name="result_type_id" className="input" defaultValue=""><option value="">—</option>{((rtypes.data ?? []) as Row[]).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <div><label htmlFor="ap-kt" className="mb-1 block text-sm font-semibold">Answer key type</label><select id="ap-kt" name="answer_key_type_id" className="input" defaultValue=""><option value="">—</option>{((ktypes.data ?? []) as Row[]).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <div className="space-y-2 md:col-span-2">
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="source_checked" className="mt-0.5 size-4" /><span>I checked the official source just now (records the check time; required before publishing)</span></label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="submit" className="mt-0.5 size-4" /><span>Submit the draft for review straight away</span></label>
              {low && <label className="flex items-start gap-2 text-sm font-semibold text-danger-700"><input type="checkbox" name="confirm_compared" className="mt-0.5 size-4" /><span>Low-confidence extraction: I compared every field with the official document (required){!canPublishKind(kind) ? " — needs someone who can publish" : ""}</span></label>}
              <div><label htmlFor="ap-note" className="mb-1 block text-sm font-semibold">Note{low ? " (required)" : ""}</label><input id="ap-note" name="note" className="input" maxLength={2000} /></div>
            </div>
            <div className="md:col-span-2"><button className="btn btn-accent" disabled={!!dupOpen}>Approve and create draft</button></div>
          </form>
        </section>
      )}

      {canReview && (
        <section aria-labelledby="other-h" className="card space-y-3 p-4">
          <h2 id="other-h" className="font-bold">Other decisions</h2>
          {open ? (
            <div className="grid gap-3 md:grid-cols-3">
              <form action={decideAction} className="space-y-2"><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="rejected" />
                <label htmlFor="rej-note" className="block text-sm font-semibold">Reject — reason *</label><input id="rej-note" name="note" className="input" placeholder="Not an official notice / wrong source / …" />
                <button className="btn btn-outline btn-sm">Reject</button></form>
              <form action={decideAction} className="space-y-2"><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="needs_review" />
                <label htmlFor="rr-note" className="block text-sm font-semibold">Request senior review — what to check *</label><input id="rr-note" name="note" className="input" />
                <button className="btn btn-outline btn-sm">Request review</button></form>
              <form action={decideAction} className="space-y-2"><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="ignored" />
                <label htmlFor="ig-note" className="block text-sm font-semibold">Ignore (not relevant) — note</label><input id="ig-note" name="note" className="input" />
                <button className="btn btn-outline btn-sm">Ignore</button></form>
            </div>
          ) : ["rejected", "ignored"].includes(it.review_status) ? (
            <form action={decideAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="to" value="pending" /><button className="btn btn-outline btn-sm">Reopen</button></form>
          ) : <p className="text-sm text-ink-muted">This item is {REVIEW_STATUS_LABEL[it.review_status].toLowerCase()}; its decision is final.</p>}
        </section>
      )}
    </div>
  );
}
