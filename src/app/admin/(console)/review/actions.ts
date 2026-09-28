"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/staff";
import { can, type Action, type ContentKind } from "@/lib/admin/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbMessage } from "@/lib/admin/db-errors";
import { getRef } from "@/lib/data/ref";
import { adminHref, isKind } from "@/lib/admin/kinds";
import { REVIEW_FIELDS, buildPayload } from "@/lib/ingestion/review-fields";
import { VERIFY_STATUSES, verifyGroups } from "@/lib/ingestion/verify-fields";

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.replace(CONTROL, "").trim() : "");
const uuid = z.string().uuid();
const back = (id: string, q: string) => redirect(`/admin/review/${id}?${q}`);
const err = (id: string, m: string) => back(id, `error=${encodeURIComponent(m.slice(0, 300))}`);

async function guard(id: string) {
  if (!uuid.safeParse(id).success) redirect("/admin/review");
  try { return await assertPermission("ingestion:review"); } catch { redirect("/admin?notice=forbidden"); }
}
const done = (id: string) => { revalidatePath("/admin/review"); revalidatePath(`/admin/review/${id}`); revalidatePath("/admin/health"); };

/** Reject (reason required), ignore, request senior review, reopen. The database enforces the allowed transitions. */
export async function decideAction(fd: FormData): Promise<void> {
  const id = clean(fd.get("id")); await guard(id);
  const to = clean(fd.get("to")); const note = clean(fd.get("note")).slice(0, 2000);
  if (!["rejected", "ignored", "needs_review", "pending"].includes(to)) err(id, "Unknown action.");
  if (to === "rejected" && !note) err(id, "Give a reason when rejecting an item.");
  if (to === "needs_review" && !note) err(id, "Say what the senior reviewer should look at.");
  const db = await createSupabaseServerClient();
  const patch: Record<string, unknown> = { review_status: to, review_note: note || null };
  if (to === "ignored" && clean(fd.get("duplicate")) === "1") patch.duplicate_resolution = "ignore";
  const { data, error } = await db.from("discovered_items").update(patch).eq("id", id).select("id");
  done(id);
  if (error) err(id, dbMessage(error));
  if (!data?.length) err(id, "You cannot change this item.");
  back(id, `notice=${to}`);
}

/** The duplicate warning is wrong: keep this as a separate record (approval is allowed afterwards). */
export async function keepSeparateAction(fd: FormData): Promise<void> {
  const id = clean(fd.get("id")); await guard(id);
  const db = await createSupabaseServerClient();
  const { error } = await db.from("discovered_items").update({ duplicate_resolution: "keep_separate" }).eq("id", id);
  done(id);
  if (error) err(id, dbMessage(error));
  back(id, "notice=keep_separate");
}

export async function mergeAction(fd: FormData): Promise<void> {
  const id = clean(fd.get("id")); await guard(id);
  const kind = clean(fd.get("kind")); const target = clean(fd.get("target")); const note = clean(fd.get("note")).slice(0, 2000);
  if (!isKind(kind) || !uuid.safeParse(target).success) err(id, "Choose the record to merge into.");
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("merge_discovery", { p_id: id, p_kind: kind, p_target: target, p_note: note || "Same notice as an existing record" });
  done(id);
  if (error) err(id, dbMessage(error));
  back(id, "notice=merged");
}

/** Edit the extracted values before approval (the reviewer's corrections are what gets approved). */
export async function saveExtractedAction(fd: FormData): Promise<void> {
  const id = clean(fd.get("id")); await guard(id);
  const db = await createSupabaseServerClient();
  const { data: it } = await db.from("discovered_items").select("extracted,suggested_kind,review_status").eq("id", id).maybeSingle();
  if (!it) err(id, "Item not found.");
  const kind = it!.suggested_kind as ContentKind;
  const ex = { ...(it!.extracted as Record<string, unknown>) };
  const issues: string[] = [];
  for (const fld of REVIEW_FIELDS[kind] ?? []) {
    const raw = clean(fd.get(`x_${fld.key}`));
    if (!raw) { delete ex[fld.key]; if (fld.statusKey) { delete ex[fld.statusKey]; delete ex[fld.key + "_text"]; } continue; }
    if (fld.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) { issues.push(`${fld.label}: use a full date`); continue; }
    if (fld.type === "number") { const n = Number(raw); if (!Number.isInteger(n) || n < 0 || n > 1_000_000) { issues.push(`${fld.label}: whole number`); continue; } ex[fld.key] = n; continue; }
    if (fld.type === "url") { try { const u = new URL(raw); if (!["http:", "https:"].includes(u.protocol)) throw 0; } catch { issues.push(`${fld.label}: full http(s) URL`); continue; } }
    ex[fld.key] = fld.type === "list" ? raw.split(/\s*[,\n]\s*/).filter(Boolean).slice(0, 30) : raw.slice(0, 2000);
    if (fld.statusKey) {
      const st = clean(fd.get(`x_${fld.statusKey}`)) === "expected" ? "expected" : "official";
      ex[fld.statusKey] = st;
      if (st === "expected") ex[fld.key + "_text"] = new Date(`${raw}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
      else delete ex[fld.key + "_text"];
    }
  }
  if (issues.length) err(id, issues.join(" · "));
  const title = String(ex.title ?? ex.name ?? "").slice(0, 400);
  if (title.length < 2) err(id, "Title is required.");
  const { error } = await db.from("discovered_items").update({ extracted: ex, title }).eq("id", id);
  done(id);
  if (error) err(id, dbMessage(error));
  back(id, "notice=edited");
}

/**
 * Approve → a DRAFT (optionally submitted for review) in the chosen content type, linked to its official source.
 * Publishing still happens through the normal workflow and the database's official-source gate.
 */
export async function approveAction(fd: FormData): Promise<void> {
  const id = clean(fd.get("id")); const staff = await guard(id);
  const kind = clean(fd.get("kind"));
  if (!isKind(kind)) err(id, "Choose what to create.");
  if (!can(staff!.role, `${kind}:create` as Action)) err(id, "Your role cannot create this kind of content.");
  const db = await createSupabaseServerClient();
  const { data: it } = await db.from("discovered_items").select("*").eq("id", id).maybeSingle();
  if (!it) err(id, "Item not found.");
  const ref = await getRef();
  const orgId = clean(fd.get("organization_id")) || (it!.organization_id as string | null);
  if (!orgId || !uuid.safeParse(orgId).success) err(id, "Choose the organization.");
  const org = await db.from("organizations").select("id,name,level").eq("id", orgId!).maybeSingle();
  if (!org.data) err(id, "Organization not found.");
  const stateSlug = clean(fd.get("state_slug")) || "all-india";
  const st = stateSlug === "all-india" ? null : ref.allStates.find((s) => s.slug === stateSlug);
  if (stateSlug !== "all-india" && !st) err(id, "Choose a state or All India.");
  const quals = fd.getAll("qualification_slugs").map(String).filter((q) => ref.qualifications.some((x) => x.slug === q));
  const cats = fd.getAll("category_slugs").map(String).filter((c) => /^[a-z0-9-]{1,60}$/.test(c));
  const low = it!.confidence === "LOW";
  const confirm = fd.get("confirm_compared") === "on";
  const note = clean(fd.get("note")).slice(0, 2000);
  if (low && (!confirm || !note)) err(id, "Low-confidence item: tick “I compared every field with the official document” and add a note.");
  const payload = buildPayload(kind as ContentKind, it!.extracted as Record<string, unknown>, {
    organizationId: orgId!, organizationName: org.data!.name as string, organizationLevel: org.data!.level as string, stateSlug, stateId: st?.id ?? null,
    departmentSlug: clean(fd.get("department_slug")) || undefined, qualificationSlugs: quals, categorySlugs: cats, sourceChecked: fd.get("source_checked") === "on",
    availability: ["upcoming", "released"].includes(clean(fd.get("availability"))) ? clean(fd.get("availability")) : undefined,
    resultTypeId: Number(clean(fd.get("result_type_id"))) || undefined, answerKeyTypeId: Number(clean(fd.get("answer_key_type_id"))) || undefined,
    officialAdmitCardUrl: clean(fd.get("official_admit_card_url")) || undefined,
  });
  const { data, error } = await db.rpc("approve_discovery", { p_id: id, p_kind: kind, p_payload: payload, p_note: note || null, p_confirm_compared: confirm, p_submit: fd.get("submit") === "on" });
  done(id);
  if (error) err(id, dbMessage(error));
  revalidatePath("/admin/jobs"); revalidatePath(`/admin/${kind}`);
  redirect(`${adminHref(kind as ContentKind, String(data))}?notice=${kind === "job" ? "saved" : "saved"}&from_review=1`);
}

/**
 * Record the reviewer's per-field decisions from the side-by-side verification screen. Append-only: each decision is a new
 * row (history kept); only groups whose decision changed are written. The value that was checked is stored with it.
 */
export async function verifyFieldsAction(fd: FormData): Promise<void> {
  const id = clean(fd.get("id")); const staff = await guard(id);
  const err = (_: string, m: string) => redirect(`/admin/review/${id}/verify?error=${encodeURIComponent(m.slice(0, 300))}`);
  const db = await createSupabaseServerClient();
  const { data: it } = await db.from("discovered_items").select("extracted,suggested_kind").eq("id", id).maybeSingle();
  if (!it) err(id, "Item not found.");
  const kind = (isKind(it!.suggested_kind as string) ? it!.suggested_kind : "job") as ContentKind;
  const ex = (it!.extracted ?? {}) as Record<string, unknown>;
  const { data: latest } = await db.from("field_verification_latest").select("field,status,note").eq("subject_kind", "discovery").eq("subject_id", id);
  const prev = new Map(((latest ?? []) as { field: string; status: string; note: string | null }[]).map((r) => [r.field, r]));
  const rows: Record<string, unknown>[] = [];
  const missingNote: string[] = [];
  for (const g of verifyGroups(kind)) {
    const status = clean(fd.get(`v_${g.key}`));
    if (!VERIFY_STATUSES.some(([s]) => s === status)) continue;
    const note = clean(fd.get(`vn_${g.key}`)).slice(0, 500) || null;
    if (status === "incorrect" && !note) { missingNote.push(g.label); continue; }
    const p = prev.get(g.key);
    if (p && p.status === status && (p.note ?? null) === note) continue;
    rows.push({ subject_kind: "discovery", subject_id: id, field: g.key, status, note, verified_by: staff!.user.id,
      value_checked: Object.fromEntries(g.fields.map((f) => [f, ex[f] ?? null])) });
  }
  if (missingNote.length) err(id, `Say what is wrong for: ${missingNote.join(", ")} (then correct the value).`);
  if (rows.length) {
    const { error } = await db.from("field_verifications").insert(rows);
    if (error) err(id, dbMessage(error));
  }
  done(id); revalidatePath(`/admin/review/${id}/verify`);
  redirect(`/admin/review/${id}/verify?notice=${rows.length ? "verified" : "unchanged"}`);
}

/** Apply the selected detected changes to the existing record (needs publish permission when the record is live). */
export async function applyChangesAction(fd: FormData): Promise<void> {
  const id = clean(fd.get("id")); await guard(id);
  const fields = fd.getAll("fields").map(String).filter((k) => /^[a-z_]{2,60}$/.test(k));
  const reason = clean(fd.get("reason")).slice(0, 500);
  if (!fields.length) err(id, "Select at least one change to apply.");
  if (!reason) err(id, "Give a reason (it is kept in the record's version history).");
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("apply_discovery_changes", { p_id: id, p_fields: fields, p_reason: reason });
  done(id); revalidatePath("/", "layout");
  if (error) err(id, dbMessage(error));
  back(id, "notice=applied");
}
