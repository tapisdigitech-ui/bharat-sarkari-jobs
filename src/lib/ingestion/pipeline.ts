/**
 * The ingestion pipeline for ONE source check:
 *   FETCH listing → RAW DOCUMENT (hash) → discover candidates → FETCH notice → RAW DOCUMENT → EXTRACT → NORMALIZE → VALIDATE
 *   → DUPLICATE CHECK → CHANGE DETECTION → REVIEW QUEUE
 * It never creates or edits public content. Runs with the service role (cron) or on a staff member's "Check now" (after the
 * server action has checked their permission); every run, document and discovery is recorded for audit and debugging.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentKind } from "@/lib/admin/permissions";
import { getAdapter, hostAllowed, type AdapterConfig, type Candidate } from "./adapters";
import { scannedPdf, type AdapterContext, type AdapterIO } from "./source-adapter";
import { pickTitle } from "./fields";
import { PoliteFetcher, type Fetcher } from "./http";
import { classify, normalize, type SourceCtx } from "./normalize";
import { PARSER_VERSION, sha256 } from "./text";
import { log as oplog } from "@/lib/log";

type Row = Record<string, unknown>;
export interface RunOptions {
  trigger: "manual" | "schedule" | "test"; triggeredBy?: string | null; fetcher?: Fetcher;
  /** Re-read every notice even when the listing page has not changed (manual checks do this). */
  force?: boolean;
  /** Check a single notice URL (must be on the source's official domain) instead of the listing pages. */
  onlyUrl?: string;
  budgetMs?: number;
}
export interface RunSummary {
  runId: string | null; status: string; discovered: number; created: number; updated: number; unchanged: number; rejected: number;
  duplicates: number; errors: number; log: { at: string; level: "info" | "warn" | "error"; msg: string }[];
}

const TABLE: Record<ContentKind, string> = { job: "jobs", recruitment: "recruitments", exam: "exams", admit_card: "admit_cards", result: "results", answer_key: "answer_keys", exam_calendar: "exam_calendar" };
const RAW_TEXT_MAX = 200_000;
const RAW_TEXT_DAYS = 30;

export async function loadSourceCtx(db: SupabaseClient, sourceId: string): Promise<{ row: Row; ctx: SourceCtx } | null> {
  const { data: row } = await db.from("government_sources").select("*").eq("id", sourceId).maybeSingle();
  if (!row) return null;
  const [org, dept, st] = await Promise.all([
    row.organization_id ? db.from("organizations").select("id,name,level").eq("id", row.organization_id).maybeSingle() : Promise.resolve({ data: null }),
    row.department_id ? db.from("departments").select("slug").eq("id", row.department_id).maybeSingle() : Promise.resolve({ data: null }),
    row.state_id ? db.from("states").select("slug").eq("id", row.state_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const o = org.data as Row | null;
  return { row, ctx: {
    id: row.id as string, name: row.name as string, organizationId: (o?.id as string) ?? null, organizationName: (o?.name as string) ?? null,
    organizationLevel: (o?.level as string) ?? null, departmentSlug: ((dept.data as Row | null)?.slug as string) ?? null,
    stateId: (row.state_id as number) ?? null, stateSlug: ((st.data as Row | null)?.slug as string) ?? null, isAllIndia: !row.state_id,
    officialDomain: row.official_domain as string, baseUrl: row.base_url as string, isSynthetic: !!row.is_synthetic,
  } };
}

export async function runSourceCheck(db: SupabaseClient, sourceId: string, opts: RunOptions): Promise<RunSummary> {
  const t0 = Date.now(); const budget = opts.budgetMs ?? 45_000;
  const sum: RunSummary = { runId: null, status: "running", discovered: 0, created: 0, updated: 0, unchanged: 0, rejected: 0, duplicates: 0, errors: 0, log: [] };
  const log = (level: "info" | "warn" | "error", msg: string) => { if (sum.log.length < 200) sum.log.push({ at: new Date().toISOString(), level, msg: msg.slice(0, 500) }); };

  const loaded = await loadSourceCtx(db, sourceId);
  if (!loaded) return { ...sum, status: "failed", errors: 1, log: [{ at: new Date().toISOString(), level: "error", msg: "Source not found" }] };
  const { row, ctx } = loaded;
  const cfg = (row.adapter_config ?? {}) as AdapterConfig;
  const fetcher = opts.fetcher ?? new PoliteFetcher({ minDelayMs: Math.max(cfg.delayMs ?? 2000, 1000) });

  const run = await db.from("ingestion_runs").insert({ source_id: sourceId, trigger: opts.trigger, triggered_by: opts.triggeredBy ?? null }).select("id").single();
  if (run.error) throw new Error(`Could not start the run: ${run.error.message}`);
  sum.runId = run.data.id as string;

  let firstHttp: number | null = null; let blocked = false; let listingsOk = 0; let listingsTried = 0; let emptyListings = 0;
  if (["PAUSED", "ARCHIVED"].includes(row.status as string) && opts.trigger === "schedule") {
    log("info", `Source is ${row.status}; skipped`);
    return finish("skipped", null);
  }

  const adapter = getAdapter(row.adapter as string);
  const refused = adapter.refuse(cfg);
  if (refused) { log("warn", refused); return finish("skipped", null); }
  const io: AdapterIO = { fetch: (url, purpose) => adapter.fetch(fetcher, url, purpose), parse: (res) => adapter.parse(res) };
  const actx = (listingUrl: string, listingKind?: ContentKind): AdapterContext => ({ officialDomain: ctx.officialDomain!, listingUrl, listingKind, config: cfg, organizationName: ctx.organizationName });

  try {
    if (opts.onlyUrl) {
      if (!hostAllowed(opts.onlyUrl, ctx.officialDomain!, cfg.allowDomains)) { log("error", `${opts.onlyUrl} is not on the official domain ${ctx.officialDomain}`); sum.errors++; return finish("failed", null); }
      listingsTried = 1; listingsOk = 1;
      await processCandidate({ url: opts.onlyUrl, anchorText: "", context: "" });
    } else {
      const uniq = adapter.listings(row as never, cfg);
      for (const l of uniq) {
        if (Date.now() - t0 > budget) { log("warn", "Time budget reached; remaining listing pages will be read on the next check"); break; }
        listingsTried++;
        const res = await adapter.fetch(fetcher, l.url, "listing");
        firstHttp ??= res.status;
        if (!res.ok || !res.body) {
          if (res.outcome === "blocked") blocked = true;
          sum.errors++; log("error", `Listing ${l.url}: ${res.error ?? res.outcome}`);
          continue;
        }
        listingsOk++;
        const hash = sha256(res.body);
        const prevListing = await db.from("source_documents").select("id,document_hash").eq("source_url", l.url).order("retrieved_at", { ascending: false }).limit(1);
        const listingChanged = !prevListing.data?.length || (prevListing.data[0] as Row).document_hash !== hash;
        const parsed = await adapter.parse(res);
        const doc = parsed.doc;
        await db.from("source_documents").upsert({
          source_id: sourceId, run_id: sum.runId, source_url: l.url, final_url: res.finalUrl, document_type: doc.type, content_type: res.contentType,
          http_status: res.status, document_hash: hash, byte_size: res.body.byteLength, raw_text: null, parser_version: PARSER_VERSION,
          extraction_status: listingChanged ? "extracted" : "unchanged",
        }, { onConflict: "source_url,document_hash", ignoreDuplicates: true });
        if (!listingChanged && !opts.force) { log("info", `Listing ${l.url} unchanged since the last check — notices not re-read`); continue; }
        const cands = adapter.discover(doc, parsed.raw, actx(res.finalUrl, l.kind), parsed);
        log("info", `Listing ${l.url}: ${cands.length} candidate notice(s) via ${adapter.key}`);
        if (!cands.length) {
          // A listing that stops yielding notices is the usual sign of a redesign (or of a JavaScript-only page). Nothing is
          // archived or expired because of it — existing records stay as they are — but the run is flagged for a person.
          emptyListings++;
          log("warn", `Listing ${l.url} produced no candidate notices — if it used to, the page may have been redesigned; check the adapter settings`);
        }
        for (const c of cands) {
          if (Date.now() - t0 > budget) { log("warn", "Time budget reached; remaining notices will be read on the next check"); break; }
          await processCandidate(c, l.kind);
        }
      }
    }
  } catch (e) {
    sum.errors++; log("error", `Unexpected error: ${(e as Error).message}`);
  }

  const status = blocked && listingsOk === 0 ? "blocked" : listingsOk === 0 ? "failed" : sum.errors > 0 || (emptyListings > 0 && emptyListings === listingsOk) ? "partial" : "succeeded";
  return finish(status, firstHttp, blocked && listingsOk === 0);

  async function processCandidate(c0: Candidate, listingKind?: ContentKind) {
    const first = await adapter.fetch(fetcher, c0.url, "notice");
    if (first.outcome === "blocked" && /robots/i.test(first.error ?? "")) { sum.rejected++; log("info", `Skipped (robots.txt disallows): ${c0.url}`); return; }
    if (!first.ok || !first.body) { sum.errors++; log("warn", `Notice ${c0.url}: ${first.error ?? first.outcome}`); return; }
    let firstParsed;
    try { firstParsed = await adapter.parse(first); }
    catch (e) { sum.errors++; log("warn", `Notice ${c0.url}: could not read the document (${(e as Error).message.slice(0, 120)})`); return; }
    // Resolve the candidate to the notice document itself (e.g. a notice page → its PDF). Every hop uses the same polite fetcher.
    const resolved = await adapter.identifyNotification(c0, { res: first, parsed: firstParsed }, actx(c0.url, listingKind), io);
    if ("skip" in resolved) { sum.rejected++; log("info", `Skipped ${c0.url}: ${resolved.skip}`); return; }
    const c = resolved.candidate, res = resolved.res;
    if (resolved.hops.length > 1) log("info", `Followed ${resolved.hops.join(" → ")}`);
    if (!res.body) { sum.errors++; log("warn", `Notice ${c.url}: empty document`); return; }
    const hash = sha256(res.body);
    const seen = await db.from("source_documents").select("id").eq("source_url", c.url).eq("document_hash", hash).limit(1);
    if (seen.data?.length) {
      sum.unchanged++;
      const prev = await db.from("discovered_items").select("id,seen_count").eq("item_url", c.url).order("discovered_at", { ascending: false }).limit(1);
      if (prev.data?.length) await db.from("discovered_items").update({ last_seen_at: new Date().toISOString(), seen_count: ((prev.data[0] as Row).seen_count as number) + 1 }).eq("id", (prev.data[0] as Row).id as string);
      return;
    }
    const doc = resolved.parsed.doc;
    const docRow = await db.from("source_documents").insert({
      source_id: sourceId, run_id: sum.runId, source_url: c.url, final_url: res.finalUrl, document_type: doc.type, content_type: res.contentType,
      http_status: res.status, document_hash: hash, byte_size: res.body.byteLength, raw_text: doc.text.slice(0, RAW_TEXT_MAX) || null,
      raw_text_purge_at: new Date(Date.now() + RAW_TEXT_DAYS * 864e5).toISOString(), parser_version: PARSER_VERSION, extraction_status: "pending",
    }).select("id").single();
    const docId = docRow.data?.id as string | undefined;
    const setDoc = (extraction_status: string, extraction_error?: string) => docId ? db.from("source_documents").update({ extraction_status, extraction_error: extraction_error ?? null }).eq("id", docId) : null;

    const title = pickTitle(c.anchorText, doc);
    const kind = title ? classify(title.value, doc.text, c.kindHint) : null;
    if (!title || !kind) { sum.rejected++; await setDoc("no_match", title ? "Not a recruitment / exam / result notice" : "No usable title"); log("info", `Skipped (not a notice): ${c.url}`); return; }
    const x = adapter.extractFields(doc, c);
    const apply = adapter.identifyApplicationLink(doc, x, actx(c.url, listingKind));
    const n = normalize(kind, title, x, ctx, c.url);
    const amendmentType = adapter.identifyAmendment(title.value, doc.text);
    if (amendmentType) n.amendment = true;
    if (apply?.offDomain) n.issues.push(`The application link goes to ${new URL(apply.url).hostname}, outside the official domain — confirm the notice itself names this portal before approving`);
    n.issues.push(...adapter.checkNotice(doc, actx(c.url, listingKind)));
    if (scannedPdf(doc)) n.confidence = "LOW";     // the issue text itself comes from adapter.checkNotice
    if (c.dateHint && !n.extracted.notification_date && kind === "job") n.issues.push(`The listing shows the date ${c.dateHint} next to this notice`);

    // ── change detection: the same notice seen before (same URL or same organization + advertisement number) ──
    let prev: Row | null = null;
    const byUrl = await db.from("discovered_items").select("*").eq("item_url", c.url).order("discovered_at", { ascending: false }).limit(1);
    prev = (byUrl.data?.[0] as Row) ?? null;
    if (!prev && n.fingerprint) {
      const byFp = await db.from("discovered_items").select("*").eq("fingerprint", n.fingerprint).order("discovered_at", { ascending: false }).limit(1);
      prev = (byFp.data?.[0] as Row) ?? null;
    }
    if (prev && prev.content_hash === n.contentHash) {
      sum.unchanged++; await setDoc("unchanged");
      await db.from("discovered_items").update({ last_seen_at: new Date().toISOString(), seen_count: (prev.seen_count as number) + 1 }).eq("id", prev.id as string);
      return;
    }

    // ── duplicate detection (strong: advertisement number / official URL; fuzzy title similarity only warns) ──
    const dupRes = await db.rpc("find_duplicate_candidates", { p_kind: kind, p: { ...n.extracted, item_url: c.url }, p_exclude_item: null, p_limit: 5 });
    const dups = (dupRes.data ?? []) as { kind: string; id: string; title: string; status: string; score: number; reasons: string[] }[];
    let target: { kind: ContentKind; id: string } | null = prev?.resulting_id ? { kind: prev.resulting_kind as ContentKind, id: prev.resulting_id as string } : null;
    const strong = dups.find((d) => d.reasons.includes("advertisement number") || d.reasons.includes("official URL"));
    if (!target && strong) target = { kind: strong.kind as ContentKind, id: strong.id };

    let changes: Record<string, unknown> | null = null;
    if (target) {
      const rec = await db.from(TABLE[target.kind]).select("*").eq("id", target.id).maybeSingle();
      if (rec.data) {
        const d = adapter.identifyUpdate(rec.data as Row, n.extracted, n.amendment);
        if (!Object.keys(d).length && n.amendment) {
          // A corrigendum/addendum whose change we cannot read automatically (a qualification text, a new exam date in prose)
          // must still reach a person — never be dropped as "unchanged" (found with SSC's JE 2026 addendum in the pilot).
          n.issues.push("Linked to an existing record, but its change could not be read automatically — read the corrigendum and edit the record by hand");
          log("info", `Amendment for an existing record queued for manual review: ${c.url}`);
        } else if (!Object.keys(d).length) {       // the source says exactly what the published record says
          sum.unchanged++; await setDoc("unchanged");
          log("info", `No change vs the existing record for ${c.url}`);
          return;
        }
        changes = Object.keys(d).length ? d : null;
      } else target = null;
    }
    if (!changes && prev) { const d = adapter.identifyUpdate(prev.extracted as Row, n.extracted, n.amendment); changes = Object.keys(d).length ? d : null; }
    const fuzzy = !target ? dups.find((d) => d.score >= 0.2) : undefined;

    if (prev && ["pending", "needs_review"].includes(prev.review_status as string)) {
      await db.from("discovered_items").update({ review_status: "superseded", review_note: "A newer version of this notice was found" }).eq("id", prev.id as string);
    }
    const ins = await db.from("discovered_items").insert({
      source_id: sourceId, run_id: sum.runId, document_id: docId ?? null, origin: "source", item_url: c.url, suggested_kind: kind, title: n.title.slice(0, 400),
      organization_id: ctx.organizationId, extracted: n.extracted, field_confidence: n.fieldConfidence, field_evidence: n.evidence, confidence: n.confidence, confidence_score: n.score,
      validation_issues: n.issues, fingerprint: n.fingerprint, content_hash: n.contentHash, previous_item_id: (prev?.id as string) ?? null,
      change_target_kind: target?.kind ?? null, change_target_id: target?.id ?? null, changes,
      duplicate_kind: fuzzy?.kind ?? null, duplicate_id: fuzzy?.id ?? null, duplicate_score: fuzzy?.score ?? null, duplicate_reasons: fuzzy?.reasons ?? [],
      is_synthetic: ctx.isSynthetic, amendment_type: amendmentType, external_id: c.externalId ?? null, group_key: c.group ?? null,
    }).select("id").single();
    if (ins.error) { sum.errors++; await setDoc("failed", ins.error.message); log("error", `Could not queue ${c.url}: ${ins.error.message}`); return; }
    await setDoc("extracted");
    sum.discovered++;
    if (target || prev) sum.updated++; else sum.created++;
    if (fuzzy) sum.duplicates++;
    log("info", `${target || prev ? "Changed" : "New"} ${kind}: ${n.title.slice(0, 120)} (${n.confidence})`);
  }

  async function finish(status: string, http: number | null, isBlocked = false): Promise<RunSummary> {
    sum.status = status;
    if (status === "failed" || status === "blocked") oplog("warn", status === "blocked" ? "source.blocked" : "ingestion.failed", { source: sourceId, run: sum.runId, http, errors: sum.log.filter((l) => l.level === "error").map((l) => l.msg).slice(-3) });
    else if (sum.errors > 0) oplog("info", "extraction.failed", { source: sourceId, run: sum.runId, errors: sum.errors });
    await db.from("ingestion_runs").update({
      completed_at: new Date().toISOString(), status, http_status: http, pages_fetched: listingsTried, records_discovered: sum.discovered,
      records_new: sum.created, records_updated: sum.updated, records_unchanged: sum.unchanged, records_rejected: sum.rejected, duplicates: sum.duplicates,
      errors: sum.errors, error_summary: sum.log.filter((l) => l.level === "error").map((l) => l.msg).join(" · ").slice(0, 1000) || null, log: sum.log,
    }).eq("id", sum.runId!);
    if (status !== "skipped") {
      await db.rpc("record_source_check", { p_source: sourceId, p_ok: status === "succeeded" || status === "partial", p_http: http,
        p_error: status === "succeeded" ? null : sum.log.filter((l) => l.level === "error").map((l) => l.msg).join(" · ").slice(0, 1000) || status,
        p_new: sum.created, p_changed: sum.updated, p_blocked: isBlocked });
    }
    return sum;
  }
}

/** Scheduler entry point: check up to `limit` due sources, one after another (never in parallel against government sites). */
export async function runDueSources(db: SupabaseClient, limit = 3, fetcher?: Fetcher): Promise<RunSummary[]> {
  const due = await db.rpc("due_sources", { p_limit: limit });
  if (due.error) throw new Error(due.error.message);
  const out: RunSummary[] = [];
  const shared = fetcher ?? new PoliteFetcher();
  for (const s of (due.data ?? []) as Row[]) out.push(await runSourceCheck(db, s.id as string, { trigger: "schedule", fetcher: shared }));
  return out;
}
