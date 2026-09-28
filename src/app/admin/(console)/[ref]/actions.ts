"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, assertPermission } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbMessage } from "@/lib/admin/db-errors";
import { refKinds, refOptionSets, slugify, type RefField, type RefKind } from "@/lib/admin/reference-config";
import { getRef, invalidateDistricts, invalidateRef, listAllDistricts } from "@/lib/data/ref";
import { redirect } from "next/navigation";

export interface RefFormState { error?: string; ok?: string; fieldErrors?: Record<string, string>; values?: Record<string, string>; nonce?: number }

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.replace(CONTROL, "").trim() : "");
const uuid = z.string().uuid();

async function guard() {
  try { return { staff: await assertPermission("reference:manage"), error: null as string | null }; }
  catch (e) { return { staff: null, error: e instanceof ForbiddenError ? e.message : "Not allowed." }; }
}

const after = () => { invalidateRef(); invalidateDistricts(); revalidatePath("/", "layout"); };

function validate(cfg: RefKind, fd: FormData, creating: boolean, opts: Record<string, string[]>) {
  const errors: Record<string, string> = {}; const out: Record<string, unknown> = {};
  for (const f of cfg.fields) {
    if (f.name === "slug") continue;
    const raw = f.type === "checkbox" ? (fd.get(f.name) === "on" ? "on" : "") : clean(fd.get(f.name));
    if (f.type === "checkbox") { out[f.name] = raw === "on"; continue; }
    if (!raw) { if (f.required) errors[f.name] = `${f.label} is required`; else if (f.type !== "number") out[f.name] = null; continue; }   // blank numbers keep the column default (e.g. sort_order)
    if (f.max && raw.length > f.max) { errors[f.name] = `At most ${f.max} characters`; continue; }
    if (f.type === "number") { const n = Number(raw); if (!Number.isInteger(n) || n < -100000 || n > 100000) errors[f.name] = "Enter a whole number"; else out[f.name] = n; continue; }
    if (f.type === "url") { try { const u = new URL(raw); if (!["http:", "https:"].includes(u.protocol)) throw 0; } catch { errors[f.name] = "Enter a full URL starting with http:// or https://"; continue; } }
    if (f.type === "select" && !(opts[f.options ?? ""] ?? []).includes(raw)) { errors[f.name] = "Choose one of the listed options"; continue; }
    out[f.name] = raw;
  }
  const slugRaw = clean(fd.get("slug"));
  if (creating) {
    const s = slugRaw || slugify(String(out.name ?? ""));
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) || s.length > 80) errors.slug = "Slug must be lower-case letters, numbers and single hyphens";
    out.slug = s;
  }
  return { errors, out };
}

async function optionSets(): Promise<Record<string, string[]>> {
  const [ref, districts] = await Promise.all([getRef(), listAllDistricts()]);
  return {
    levels: refOptionSets.levels.map((x) => x[0]), statekind: refOptionSets.statekind.map((x) => x[0]),
    states: ref.allStates.map((s) => s.slug), departments: ref.allDepartments.map((d) => d.slug), districts: districts.map((d) => String(d.id)),
  };
}

/** Translate slug-valued relation fields to ids. */
async function resolveRelations(cfg: RefKind, out: Record<string, unknown>) {
  const ref = await getRef();
  for (const f of cfg.fields as RefField[]) {
    if (!f.rel) continue;
    const slug = out[f.name] as string | null; delete out[f.name];
    const row = slug ? (f.rel.table === "states" ? ref.allStates : ref.allDepartments).find((x) => x.slug === slug) : null;
    out[f.rel.column] = row?.id ?? null;
  }
}

export async function saveReferenceAction(_p: RefFormState, fd: FormData): Promise<RefFormState> {
  const kind = String(fd.get("_ref") ?? "");
  const cfg = refKinds[kind];
  const values: Record<string, string> = {}; for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) values[k] = v;
  const nonce = Date.now();
  if (!cfg) return { error: "Unknown reference type.", values, nonce };
  const g = await guard(); if (g.error) return { error: g.error, values, nonce };
  const rawId = clean(fd.get("id"));
  const editing = rawId !== "";
  const { errors, out } = validate(cfg, fd, !editing, await optionSets());
  if (Object.keys(errors).length) return { error: "Please fix the highlighted fields.", fieldErrors: errors, values, nonce };
  await resolveRelations(cfg, out);

  const db = await createSupabaseServerClient();
  if (editing) {
    const idOk = cfg.table === "organizations" ? uuid.safeParse(rawId).success : /^\d+$/.test(rawId);
    if (!idOk) return { error: "Invalid reference.", values, nonce };
    delete out.slug;
    const { data, error } = await db.from(cfg.table).update(out).eq("id", rawId).select("id");
    if (error) return { error: dbMessage(error), values, nonce };
    if (!data?.length) return { error: "That record no longer exists or you cannot change it.", values, nonce };
  } else {
    const { data, error } = await db.from(cfg.table).insert(out).select("id").single();
    if (error) return { error: error.code === "23505" ? `A ${cfg.singular} with that ${/name|lower/i.test(error.message) ? "name" : "slug"} already exists.` : dbMessage(error), values, nonce };
    if (cfg.kind === "organizations") { after(); redirect(`/admin/organizations/${data.id}?notice=created`); }
  }
  after();
  return { ok: editing ? "Saved." : `Added “${String(out.name)}”.`, nonce };
}

/** Merge one qualification / job category into another: every job moves over, the old entry is archived with a pointer. */
export async function mergeReferenceAction(fd: FormData): Promise<void> {
  const kind = String(fd.get("_ref") ?? ""); const g = await guard();
  if (g.error || !["qualifications", "categories"].includes(kind)) redirect("/admin?notice=forbidden");
  const from = Number(fd.get("from")), into = Number(fd.get("into"));
  const back = (q: string) => redirect(`/admin/${kind}?${q}`);
  if (!Number.isInteger(from) || !Number.isInteger(into) || from === into) back(`merge_error=${encodeURIComponent("Choose two different entries.")}`);
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc(kind === "qualifications" ? "merge_qualification" : "merge_category", { p_from: from, p_into: into });
  after();
  if (error) back(`merge_error=${encodeURIComponent(dbMessage(error))}`);
  back(`merged=${Number(data) || 0}`);
}

export async function setActiveAction(fd: FormData): Promise<void> {
  const kind = String(fd.get("_ref") ?? ""), id = clean(fd.get("id")), active = fd.get("active") === "1";
  const cfg = refKinds[kind]; const g = await guard();
  if (!cfg || g.error) return;
  const idOk = cfg.table === "organizations" ? uuid.safeParse(id).success : /^\d+$/.test(id);
  if (!idOk) return;
  const db = await createSupabaseServerClient();
  await db.from(cfg.table).update({ is_active: active }).eq("id", id);
  after();
  const ret = String(fd.get("_return") ?? "");
  if (/^\/admin\/organizations\/[0-9a-f-]{36}$/.test(ret)) redirect(`${ret}?notice=${active ? "restored" : "archived"}`);
}

/* ───────── Districts: bulk import of an OFFICIAL list (LGD code, name) ───────── */
export async function importDistrictsAction(_p: RefFormState, fd: FormData): Promise<RefFormState> {
  const nonce = Date.now();
  const g = await guard(); if (g.error) return { error: g.error, nonce };
  const ref = await getRef();
  const st = ref.allStates.find((s) => s.slug === clean(fd.get("state_slug")));
  if (!st?.id) return { error: "Choose the state / UT this list belongs to.", nonce };
  const text = String(fd.get("list") ?? "").slice(0, 200_000);
  const lines = text.split(/\r?\n/).map((l) => l.replace(CONTROL, "").trim()).filter(Boolean);
  if (!lines.length) return { error: "Paste one district per line: “LGD code, District name” (or just the name).", nonce };
  if (lines.length > 200) return { error: "At most 200 districts per import (no state has more).", nonce };
  const rows: { state_id: number; slug: string; name: string; lgd_code: string | null }[] = [];
  const problems: string[] = []; const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (/^(lgd|code|district)/i.test(l) && i === 0) return;   // header row
    const m = /^(\d{1,10})\s*[,;\t]\s*(.+)$/.exec(l);
    const lgd = m ? m[1] : null, name = (m ? m[2] : l).trim();
    const slug = slugify(name);
    if (!name || name.length > 120 || !slug) { problems.push(`Line ${i + 1}: invalid name`); return; }
    if (seen.has(slug)) { problems.push(`Line ${i + 1}: duplicate “${name}”`); return; }
    seen.add(slug); rows.push({ state_id: st.id!, slug, name, lgd_code: lgd });
  });
  if (problems.length) return { error: problems.slice(0, 5).join(" · "), nonce };
  const db = await createSupabaseServerClient();
  const existing = await db.from("districts").select("slug").eq("state_id", st.id);
  if (existing.error) return { error: dbMessage(existing.error), nonce };
  const have = new Set((existing.data ?? []).map((r) => r.slug));
  const fresh = rows.filter((r) => !have.has(r.slug));
  if (fresh.length) {
    const { error } = await db.from("districts").insert(fresh);
    if (error) return { error: error.code === "23505" ? "One of the LGD codes is already used by another district." : dbMessage(error), nonce };
  }
  after();
  return { ok: `${fresh.length} district(s) added to ${st.name}; ${rows.length - fresh.length} already existed (left unchanged).`, nonce };
}
