/** Supabase implementation: exam hubs (public client by default; staff previews pass their RLS session client). */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public";
import type { ExamHub, ExamType, GovPage } from "@/lib/gov-types";
import type { ContentStatus } from "@/lib/types";
import { getRef } from "../ref";
import { LIVE_STATUSES, VISIBLE_STATUSES } from "../statuses";

type Row = Record<string, unknown>;
const fail = (what: string, e: { message: string }): never => { throw new Error(`Database error while ${what}: ${e.message}`); };
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const n = (v: unknown) => (typeof v === "number" ? v : undefined);
const httpUrl = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : undefined);

function mapSections(v: unknown): ExamHub["patterns"][number]["sections"] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => (x && typeof x === "object" && typeof (x as Row).name === "string" ? [{ name: (x as Row).name as string, questions: n((x as Row).questions), marks: n((x as Row).marks) }] : []));
}

async function mapHubs(db: SupabaseClient, rows: Row[], withChildren: boolean): Promise<ExamHub[]> {
  if (rows.length === 0) return [];
  const ref = await getRef();
  const orgIds = [...new Set(rows.map((r) => r.organization_id as string))];
  const org = await db.from("organizations").select("id,name,slug").in("id", orgIds);
  if (org.error) fail("loading organizations", org.error);
  const on = new Map((org.data ?? []).map((o) => [o.id as string, o]));
  const ids = rows.map((r) => r.id as string);
  let syl: Row[] = [], pat: Row[] = [], pap: Row[] = [];
  if (withChildren) {
    const [a, b, c] = await Promise.all([
      db.from("exam_syllabi").select("exam_id,stage,subject,topics,official_url,sort_order").in("exam_id", ids).order("sort_order"),
      db.from("exam_patterns").select("exam_id,stage,sections,total_marks,duration_minutes,negative_marking,official_url").in("exam_id", ids),
      db.from("previous_papers").select("exam_id,year,title,official_url").in("exam_id", ids).order("year", { ascending: false }),
    ]);
    for (const r of [a, b, c]) if (r.error) fail("loading exam details", r.error);
    syl = (a.data ?? []) as Row[]; pat = (b.data ?? []) as Row[]; pap = (c.data ?? []) as Row[];
  }
  return rows.map((r): ExamHub => {
    const o = on.get(r.organization_id as string), st = ref.allStates.find((x) => x.id === r.state_id), dep = ref.allDepartments.find((d) => d.id === r.department_id);
    const mine = (list: Row[]) => list.filter((x) => x.exam_id === r.id);
    return {
      id: r.id as string, slug: r.slug as string, name: r.name as string, shortName: s(r.short_name),
      organizationId: r.organization_id as string, organization: (o?.name as string) ?? "", organizationSlug: s(o?.slug), departmentName: dep?.name,
      examType: ((s(r.exam_type) as ExamType) ?? "recruitment"), level: (r.level as string) ?? "central",
      stateSlug: r.is_all_india ? "all-india" : st?.slug ?? "all-india", stateName: st?.name, isAllIndia: !!r.is_all_india,
      overview: s(r.overview), eligibilitySummary: s(r.eligibility_summary), applicationSummary: s(r.application_summary), syllabusSummary: s(r.syllabus_summary),
      patternSummary: s(r.pattern_summary), cutoffSummary: s(r.cutoff_summary), preparationSummary: s(r.preparation_summary),
      officialWebsiteUrl: s(r.official_website_url), sourceName: s(r.source_name), sourceCheckedAt: s(r.source_checked_at),
      syllabus: mine(syl).map((x) => ({ stage: s(x.stage), subject: x.subject as string, topics: s(x.topics), officialUrl: httpUrl(x.official_url) })),
      patterns: mine(pat).map((x) => ({ stage: s(x.stage), sections: mapSections(x.sections), totalMarks: n(x.total_marks), durationMinutes: n(x.duration_minutes), negativeMarking: s(x.negative_marking), officialUrl: httpUrl(x.official_url) })),
      previousPapers: mine(pap).flatMap((x) => (httpUrl(x.official_url) ? [{ year: x.year as number, title: x.title as string, officialUrl: httpUrl(x.official_url)! }] : [])),
      status: r.status as ContentStatus, publishedAt: s(r.published_at), updatedAt: r.updated_at as string, isDemo: false, verificationStatus: s(r.verification_status),
    };
  });
}

/** Public lookup (published / updated / expired). */
export async function getExamHub(slug: string): Promise<ExamHub | null> {
  const db = createPublicClient();
  const { data, error } = await db.from("exams").select("*").eq("slug", slug).in("status", [...VISIBLE_STATUSES]).maybeSingle();
  if (error) fail("loading exam", error);
  return data ? (await mapHubs(db, [data as Row], true))[0] : null;
}

/** Staff preview lookup (drafts visible through the staff member's RLS session). */
export async function getExamHubById(id: string, db: SupabaseClient): Promise<ExamHub | null> {
  const { data, error } = await db.from("exams").select("*").eq("id", id).maybeSingle();
  if (error) fail("loading exam", error);
  return data ? (await mapHubs(db, [data as Row], true))[0] : null;
}

import type { ExamFilters } from "../statuses";
const terms = (q?: string) => (q ?? "").toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}\-/.]/gu, "")).filter(Boolean).slice(0, 6);

export async function listExamHubs(f: ExamFilters = {}, opts: { page?: number; pageSize?: number } = {}): Promise<GovPage<ExamHub>> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 24, 1), 60);
  const db = createPublicClient();
  let orgId: string | undefined;
  if (f.organization) { const r = await db.from("organizations").select("id").eq("slug", f.organization).maybeSingle(); orgId = r.data?.id ?? "00000000-0000-0000-0000-000000000000"; }
  const run = (page: number) => {
    // Listings show live exams only; an expired exam still opens by URL (VISIBLE_STATUSES in getExamHub) but is not listed.
    let q = db.from("exams").select("*", { count: "exact" }).in("status", [...LIVE_STATUSES]);
    if (orgId) q = q.eq("organization_id", orgId);
    if (f.type) q = q.eq("exam_type", f.type);
    for (const t of terms(f.q)) q = q.ilike("name", `%${t}%`);
    return q.order("name").range((page - 1) * pageSize, page * pageSize - 1);
  };
  let page = Math.max(1, opts.page ?? 1);
  let res = await run(page);
  if (res.error && !/range|416|Requested range/i.test(res.error.message)) fail("listing exams", res.error);
  let total = res.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (page > pageCount) { page = pageCount; res = await run(page); if (res.error) fail("listing exams", res.error); total = res.count ?? total; }
  return { items: await mapHubs(db, (res.data ?? []) as Row[], false), total, page, pageSize, pageCount };
}

export async function examFacets(): Promise<{ organizations: { slug: string; name: string }[] }> {
  const db = createPublicClient();
  const { data, error } = await db.from("exams").select("organization_id").in("status", [...LIVE_STATUSES]).limit(2000);
  if (error) fail("loading exam filters", error);
  const ids = [...new Set((data ?? []).map((r) => r.organization_id as string))];
  const o = ids.length ? await db.from("organizations").select("slug,name").in("id", ids).order("name") : { data: [] as { slug: string; name: string }[] };
  return { organizations: (o.data ?? []) as { slug: string; name: string }[] };
}

export async function sitemapExamHubs(): Promise<{ slug: string; updatedAt: string }[]> {
  const { data, error } = await createPublicClient().from("exams").select("slug,updated_at").in("status", [...LIVE_STATUSES]).order("updated_at", { ascending: false }).limit(45000);
  if (error) fail("building sitemap", error);
  return (data ?? []).map((r) => ({ slug: r.slug as string, updatedAt: r.updated_at as string }));
}
