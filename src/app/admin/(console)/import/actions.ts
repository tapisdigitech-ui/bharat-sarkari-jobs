"use server";
import { revalidatePath } from "next/cache";
import { assertPermission, ForbiddenError } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { getRef } from "@/lib/data/ref";
import { todayIST } from "@/lib/dates";
import { validateCsv, type CsvRefs, type CsvRowResult } from "@/lib/ingestion/csv";
import { fingerprint, hashOf } from "@/lib/ingestion/normalize";

export interface ImportState { error?: string; ok?: string; csv?: string; rows?: CsvRowResult[]; header?: string[]; nonce?: number }

async function refs(): Promise<CsvRefs> {
  const db = await createSupabaseServerClient();
  const [ref, orgs, cats] = await Promise.all([getRef(), db.from("organizations").select("id,name,slug,level").eq("is_active", true).limit(5000), db.from("categories").select("slug").eq("is_active", true)]);
  return {
    organizations: (orgs.data ?? []) as CsvRefs["organizations"], states: ref.allStates.map((s) => s.slug), qualifications: ref.allQualifications.map((q) => q.slug),
    categories: ((cats.data ?? []) as { slug: string }[]).map((c) => c.slug), departments: ref.allDepartments.map((d) => d.slug),
  };
}

async function readCsv(fd: FormData): Promise<string> {
  const file = fd.get("file");
  if (file && typeof file === "object" && "text" in file && (file as File).size > 0) {
    if ((file as File).size > 2_000_000) throw new Error("The file is larger than 2 MB.");
    return await (file as File).text();
  }
  return String(fd.get("csv") ?? "").slice(0, 2_000_000);
}

/** Step 1 and 2 in one action: `intent=preview` validates and shows every row; `intent=import` re-validates and queues. */
export async function importCsvAction(_p: ImportState, fd: FormData): Promise<ImportState> {
  const nonce = Date.now();
  let staffId: string;
  try { staffId = (await assertPermission("ingestion:run", "import")).user.id; } catch (e) { return { error: e instanceof ForbiddenError ? e.message : "Not allowed.", nonce }; }
  let csv: string;
  try { csv = await readCsv(fd); } catch (e) { return { error: (e as Error).message, nonce }; }
  if (!csv.trim()) return { error: "Choose a CSV file or paste its contents.", nonce };
  const res = validateCsv(csv, await refs(), todayIST());
  if (res.fatal) return { error: res.fatal, csv, nonce };
  if (fd.get("intent") !== "import") return { csv, rows: res.rows, header: res.header, nonce };

  // Import: only valid rows, into the review queue as discoveries (origin=import). Nothing is created as content here.
  const good = res.rows.filter((r) => r.ok);
  if (!good.length) return { error: "No valid rows to import.", csv, rows: res.rows, header: res.header, nonce };
  const db = createServiceClient();   // queue items are written by the ingestion service only (permission checked above)
  const run = await db.from("ingestion_runs").insert({ trigger: "import", triggered_by: staffId }).select("id").single();
  if (run.error) return { error: `Could not start the import: ${run.error.message}`, csv, nonce };
  let queued = 0, dups = 0; const errors: string[] = [];
  for (const r of good) {
    const ex = r.extracted;
    const dup = await db.rpc("find_duplicate_candidates", { p_kind: "job", p: ex, p_exclude_item: null, p_limit: 3 });
    const d = ((dup.data ?? []) as { kind: string; id: string; score: number; reasons: string[] }[])[0];
    const complete = ["title", "organization_id", "last_date", "notification_url", "source_name", "advertisement_no", "total_vacancies", "qualification_slugs"].filter((k) => ex[k] !== undefined).length;
    const ins = await db.from("discovered_items").insert({
      run_id: run.data.id, origin: "import", item_url: ex.notification_url, suggested_kind: "job", title: r.title, organization_id: r.organizationId,
      extracted: ex, confidence: complete >= 7 ? "HIGH" : complete >= 5 ? "MEDIUM" : "LOW", confidence_score: Math.round((complete / 8) * 1000) / 1000,
      validation_issues: [`Imported from CSV (line ${r.line}) — compare with the official notice before approving`, ...r.warnings],
      fingerprint: fingerprint("job", r.organizationId, ex, String(ex.notification_url)), content_hash: hashOf(ex),
      duplicate_kind: d?.kind ?? null, duplicate_id: d?.id ?? null, duplicate_score: d?.score ?? null, duplicate_reasons: d?.reasons ?? [],
    });
    if (ins.error) errors.push(`line ${r.line}: ${ins.error.message}`); else { queued++; if (d) dups++; }
  }
  await db.from("ingestion_runs").update({ completed_at: new Date().toISOString(), status: errors.length ? (queued ? "partial" : "failed") : "succeeded",
    records_discovered: queued, records_new: queued, duplicates: dups, records_rejected: res.rows.length - good.length, errors: errors.length,
    error_summary: errors.join(" · ").slice(0, 1000) || null, log: [{ at: new Date().toISOString(), level: "info", msg: `CSV import: ${queued} queued, ${res.rows.length - good.length} invalid row(s) skipped` }] }).eq("id", run.data.id);
  revalidatePath("/admin/review"); revalidatePath("/admin/ingestion");
  return { ok: `${queued} row(s) added to the review queue${dups ? ` (${dups} with a possible-duplicate warning)` : ""}. ${res.rows.length - good.length} invalid row(s) were skipped. Nothing was published.`, nonce };
}
