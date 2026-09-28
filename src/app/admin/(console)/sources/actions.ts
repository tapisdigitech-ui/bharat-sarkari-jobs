"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ForbiddenError, assertPermission } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { dbMessage } from "@/lib/admin/db-errors";
import { getRef } from "@/lib/data/ref";
import { SOURCE_STATUSES, SOURCE_TYPES } from "@/lib/sources/config";
import { ADAPTERS, validateAdapterConfig, type AdapterConfig } from "@/lib/ingestion/adapters";
import { runSourceCheck } from "@/lib/ingestion/pipeline";
import { operatorFetcher } from "@/lib/ingestion/http";
import { probeNextSources, probeSource } from "@/lib/ingestion/probe";

export interface SourceFormState { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string>; nonce?: number }

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.replace(CONTROL, "").trim() : "");
const uuid = z.string().uuid();
const URL_FIELDS = ["base_url", "recruitment_url", "results_url", "admit_card_url", "answer_key_url", "exam_url"] as const;

function hostOf(u: string) { try { const x = new URL(u); return ["http:", "https:"].includes(x.protocol) ? x.hostname.toLowerCase().replace(/^www\./, "") : null; } catch { return null; } }

/** Validate adapter_config for the chosen adapter (rules: validateAdapterConfig in ingestion/adapters.ts). Returns an error message or the object. */
export async function parseAdapterConfig(raw: string, adapter = "generic-listing"): Promise<Record<string, unknown> | string> {
  if (!raw) return {};
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return "Adapter settings must be valid JSON, e.g. {\"include\": \"recruit|vacanc\"}"; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return "Adapter settings must be a JSON object";
  if (raw.length > 4000) return "Adapter settings are too long";
  return validateAdapterConfig(adapter, o as AdapterConfig) ?? (o as Record<string, unknown>);
}

export async function saveSourceAction(_p: SourceFormState, fd: FormData): Promise<SourceFormState> {
  const values: Record<string, string> = {}; for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) values[k] = v;
  const nonce = Date.now();
  let staffId: string;
  try { staffId = (await assertPermission("source:manage")).user.id; } catch (e) { return { error: e instanceof ForbiddenError ? e.message : "Not allowed.", values, nonce }; }
  void staffId;
  const id = clean(fd.get("id"));
  if (id && !uuid.safeParse(id).success) return { error: "Invalid source.", values, nonce };
  const err: Record<string, string> = {};
  const name = clean(fd.get("name")); if (name.length < 2 || name.length > 200) err.name = "Name is required (2–200 characters)";
  const type = clean(fd.get("source_type")); if (!SOURCE_TYPES.some(([v]) => v === type)) err.source_type = "Choose a source type";
  const status = clean(fd.get("status")) || "REVIEW_REQUIRED"; if (!SOURCE_STATUSES.some(([v]) => v === status)) err.status = "Choose a status";
  const domain = clean(fd.get("official_domain")).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) err.official_domain = "Enter the official domain, e.g. ssc.gov.in";
  const urls: Record<string, string | null> = {};
  for (const f of URL_FIELDS) {
    const v = clean(fd.get(f)); urls[f] = v || null;
    if (!v) { if (f === "base_url") err[f] = "The official website address is required"; continue; }
    const h = hostOf(v);
    if (!h) { err[f] = "Enter a full http(s) URL"; continue; }
    if (domain && !(h === domain || h.endsWith("." + domain))) err[f] = `Must be on the official domain ${domain} (or a sub-domain of it)`;
  }
  const rank = Number(clean(fd.get("authority_rank")) || "1"); if (!Number.isInteger(rank) || rank < 1 || rank > 7) err.authority_rank = "Choose the source's place in the official-source hierarchy";
  const priority = clean(fd.get("source_priority")) || "normal"; if (!["high", "normal", "low"].includes(priority)) err.source_priority = "Choose a priority";
  const interval = Number(clean(fd.get("check_interval_hours")) || "24"); if (!Number.isInteger(interval) || interval < 1 || interval > 720) err.check_interval_hours = "Between 1 and 720 hours";
  const adapter = clean(fd.get("adapter")) || "generic-listing"; if (!ADAPTERS.some((a) => a.key === adapter)) err.adapter = "Choose an adapter";
  const cfg = await parseAdapterConfig(clean(fd.get("adapter_config")), adapter);
  if (typeof cfg === "string") err.adapter_config = cfg;
  const notes = clean(fd.get("notes")).slice(0, 4000) || null;
  const orgId = clean(fd.get("organization_id")) || null; if (orgId && !uuid.safeParse(orgId).success) err.organization_id = "Choose an organization";
  const ref = await getRef();
  const dept = clean(fd.get("department_slug")); const st = clean(fd.get("state_slug"));
  const deptId = dept ? ref.allDepartments.find((d) => d.slug === dept)?.id ?? null : null;
  const stateId = st ? ref.allStates.find((s) => s.slug === st)?.id ?? null : null;
  if (dept && !deptId) err.department_slug = "Unknown department"; if (st && !stateId) err.state_slug = "Unknown state";
  const districtRaw = clean(fd.get("district_id")); const districtId = districtRaw ? Number(districtRaw) : null;
  if (districtRaw && !Number.isInteger(districtId)) err.district_id = "Unknown district";
  if (Object.keys(err).length) return { error: "Please fix the highlighted fields.", fieldErrors: err, values, nonce };

  const row = { name, source_type: type, status, official_domain: domain, ...urls, authority_rank: rank, source_priority: priority, check_interval_hours: interval,
    adapter, adapter_config: cfg, notes, organization_id: orgId, department_id: deptId, state_id: stateId, district_id: districtId };
  const db = await createSupabaseServerClient();
  let newId = id;
  if (id) {
    const { data, error } = await db.from("government_sources").update(row).eq("id", id).select("id");
    if (error) return { error: friendly(error), values, nonce };
    if (!data?.length) return { error: "That source no longer exists or you cannot change it.", values, nonce };
  } else {
    const { data, error } = await db.from("government_sources").insert(row).select("id").single();
    if (error) return { error: friendly(error), values, nonce };
    newId = data.id as string;
  }
  revalidatePath("/admin/sources");
  redirect(`/admin/sources/${newId}?notice=${id ? "saved" : "created"}`);
}

function friendly(e: { code?: string; message: string }) {
  if (e.code === "23505") return /name/.test(e.message) ? "A source with that name already exists." : "A source with that slug already exists.";
  if (/domain_chk/.test(e.message)) return "Every listing URL must be on the official domain.";
  return dbMessage(e);
}

export async function setSourceStatusAction(fd: FormData): Promise<void> {
  try { await assertPermission("source:manage"); } catch { redirect("/admin?notice=forbidden"); }
  const id = clean(fd.get("id")); const to = clean(fd.get("to"));
  if (!uuid.safeParse(id).success || !SOURCE_STATUSES.some(([v]) => v === to)) return;
  const db = await createSupabaseServerClient();
  const { error } = await db.from("government_sources").update({ status: to }).eq("id", id);
  revalidatePath(`/admin/sources/${id}`); revalidatePath("/admin/sources");
  redirect(`/admin/sources/${id}?${error ? `error=${encodeURIComponent(dbMessage(error))}` : `notice=status_${to}`}`);
}

/**
 * "Check now" — runs the pipeline for this source immediately. The permission is checked here with the caller's session;
 * the pipeline itself writes with the service role because runs/documents/discoveries are never writable from a browser.
 * Discoveries go to the review queue; nothing is published.
 */
export async function checkNowAction(fd: FormData): Promise<void> {
  let staffId: string;
  try { staffId = (await assertPermission("ingestion:run", "sourceCheck")).user.id; } catch { redirect("/admin?notice=forbidden"); }
  const id = clean(fd.get("id")); const only = clean(fd.get("only_url")) || undefined;
  if (!uuid.safeParse(id).success) return;
  if (only && !hostOf(only)) redirect(`/admin/sources/${id}?error=${encodeURIComponent("Enter a full http(s) URL of the notice")}`);
  const db = createServiceClient();
  const fetcher = operatorFetcher();
  let runId: string | null = null; let msg = "";
  try {
    const sum = await runSourceCheck(db, id, { trigger: "manual", triggeredBy: staffId!, force: true, onlyUrl: only, fetcher });
    runId = sum.runId;
    msg = `Check ${sum.status}: ${sum.created} new, ${sum.updated} changed, ${sum.unchanged} unchanged, ${sum.rejected} skipped, ${sum.errors} error(s).`;
  } catch (e) { msg = `Check failed: ${(e as Error).message}`.slice(0, 300); }
  revalidatePath(`/admin/sources/${id}`); revalidatePath("/admin/review"); revalidatePath("/admin/ingestion");
  redirect(`/admin/sources/${id}?checked=${encodeURIComponent(msg)}${runId ? `&run=${runId}` : ""}`);
}

/**
 * Server-side source probe (Phase 3.7): asks "can THIS server reach the source?" for one source, or for the next few
 * least-recently-probed ones. Read-only towards the review queue. Protection (robots refusal, 401/403/429, CAPTCHA) is
 * recorded as BLOCKED and never worked around.
 */
export async function probeSourcesAction(fd: FormData): Promise<void> {
  let staffId: string;
  try { staffId = (await assertPermission("source:manage", "sourceCheck")).user.id; } catch { redirect("/admin?notice=forbidden"); }
  const id = clean(fd.get("id"));
  const limit = Math.min(Math.max(Number(clean(fd.get("limit")) || "4") || 4, 1), 10);
  const db = createServiceClient();
  const fetcher = operatorFetcher();
  let msg: string;
  try {
    if (id) {
      if (!uuid.safeParse(id).success) return;
      const p = await probeSource(db, id, { staffId: staffId!, fetcher });
      msg = `Probe: ${p.verdict}${p.notes ? ` — ${p.notes}` : ""}`;
    } else {
      const rows = await probeNextSources(db, { limit, staffId: staffId!, fetcher, budgetMs: 240_000 });
      const by = rows.reduce<Record<string, number>>((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {});
      msg = rows.length ? `Probed ${rows.length} source(s): ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ")}.` : "No sources to probe.";
    }
  } catch (e) { msg = `Probe failed: ${(e as Error).message}`.slice(0, 300); }
  revalidatePath("/admin/sources/probe");
  redirect(`/admin/sources/probe?done=${encodeURIComponent(msg.slice(0, 500))}`);
}
