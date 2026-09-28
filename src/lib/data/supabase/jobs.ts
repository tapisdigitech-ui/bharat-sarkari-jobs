import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DiscoveryItem, Exam, Job, JobFilters, SiteUpdate, VacancyRow } from "@/lib/types";
import { addDays, todayIST } from "@/lib/dates";
import { createPublicClient } from "@/lib/supabase/public";
import { getRef, labelJob } from "../ref";
import { LIST_COLUMNS, mapJob, type JobRow } from "./mapper";
import type { FacetKind, JobPage, ListOptions, Repository } from "../repository";

const LIVE = ["published", "updated"];
const VISIBLE = ["published", "updated", "expired"];

function fail(what: string, error: { message: string }): never {
  throw new Error(`Database error while ${what}: ${error.message}`);
}

/* State/department ids come from the (cached) reference tables — the database is the single source of truth. */
async function refIds(_db?: SupabaseClient) {
  const ref = await getRef();
  return { ref, states: new Map(ref.allStates.map((r) => [r.slug, r.id as number])), departments: new Map(ref.allDepartments.map((r) => [r.slug, r.id as number])) };
}

/** Only letters, digits and a few safe punctuation marks reach the query; LIKE wildcards can never be injected. */
const searchTerms = (q?: string) => (q ?? "").toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}\-/.]/gu, "")).filter(Boolean).slice(0, 8);

 
const refsFor = (db: SupabaseClient, f: JobFilters) => ((f.state && f.state !== "all-india") || f.department ? refIds(db) : Promise.resolve(null));

// NOTE: must stay synchronous. PostgREST query builders are thenables, so returning one from an async function would EXECUTE it.
function applyFilters(refs: Awaited<ReturnType<typeof refIds>> | null, q: any, f: JobFilters, includeClosed: boolean) {
  const today = todayIST();
  q = q.in("status", includeClosed ? VISIBLE : LIVE);
  if (!includeClosed) q = q.or(`last_date.is.null,last_date.gte.${today}`);
  if (f.state) {
    if (f.state === "all-india") q = q.eq("is_all_india", true);
    else { const id = refs?.states.get(f.state); q = id ? q.eq("state_id", id) : q.eq("id", "00000000-0000-0000-0000-000000000000"); }
  }
  if (f.department) { const id = refs?.departments.get(f.department); q = id ? q.eq("department_id", id) : q.eq("id", "00000000-0000-0000-0000-000000000000"); }
  if (f.organization) q = q.eq("organization_slug", f.organization);
  if (f.category) q = q.contains("category_slugs", [f.category]);
  if (f.district) q = q.eq("district_slug", f.district);
  if (f.qualification) q = q.contains("qualification_slugs", [f.qualification]);
  if (f.level) q = q.eq("level", f.level);
  if (f.jobType) q = q.eq("job_type", f.jobType);
  if (f.exam) q = q.eq("exam_slug", f.exam);
  if (f.fresher) q = q.eq("fresher_friendly", true);
  if (f.women) q = q.eq("women_only", true);
  if (f.postedWithin) q = q.gte("posted_at", addDays(today, -f.postedWithin));
  if (f.closingWithin) q = q.not("last_date", "is", null).lte("last_date", addDays(today, f.closingWithin));
  for (const t of searchTerms(f.q)) q = q.ilike("search_text", `%${t}%`);
  return q;
}

/** Compact rows for the homepage "latest updates" feed (the full Phase 2B listings live in gov-items.ts). */

/** Latest live admit cards / results / answer keys for the home page "Latest updates" feed. */
async function listDiscovery(table: "admit_cards" | "results" | "answer_keys"): Promise<DiscoveryItem[]> {
  const db = createPublicClient();
  const dateCol = table === "results" ? "result_date" : "release_date";
  const urlCol = table === "admit_cards" ? "official_admit_card_url" : table === "results" ? "official_result_url" : "official_answer_key_url";
  const { data, error } = await db.from(table).select(`id,slug,title,organization_id,exam_id,${dateCol},${dateCol}_status,${urlCol},notes,updated_at`).in("status", LIVE).order("updated_at", { ascending: false }).limit(100);
  if (error) fail(`loading ${table}`, error);
  const rows = data as unknown as Record<string, any>[];
  const orgIds = [...new Set(rows.map((r) => r.organization_id).filter(Boolean))], examIds = [...new Set(rows.map((r) => r.exam_id).filter(Boolean))];
  const [orgs, exams] = await Promise.all([
    orgIds.length ? db.from("organizations").select("id,name").in("id", orgIds) : { data: [], error: null },
    examIds.length ? db.from("exams").select("id,slug").in("id", examIds) : { data: [], error: null },
  ]);
  const on = new Map((orgs.data ?? []).map((o) => [o.id, o.name])), es = new Map((exams.data ?? []).map((e) => [e.id, e.slug]));
  return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, organization: on.get(r.organization_id) ?? "", examSlug: es.get(r.exam_id),
    date: (r[`${dateCol}_status`] === "official" && r[dateCol]) ? r[dateCol] : todayIST(new Date(r.updated_at)), officialUrl: r[urlCol], note: r.notes ?? undefined, isDemo: false }));
}

export const supabaseRepository: Repository = {
  async listJobs(filters: JobFilters = {}, opts: ListOptions = {}): Promise<JobPage> {
    const db = createPublicClient();
    const pageSize = Math.min(Math.max(opts.pageSize ?? 10, 1), 100);
    const sort = opts.sort ?? "latest";
    const refs = await refsFor(db, filters);
    const run = async (page: number) => {
      let q = db.from("jobs_v").select(LIST_COLUMNS, { count: "exact" });
      q = applyFilters(refs, q, filters, !!opts.includeClosed);
      if (sort === "closing") q = q.order("last_date", { ascending: true, nullsFirst: false }).order("posted_at", { ascending: false });
      else if (sort === "vacancies") q = q.order("total_vacancies", { ascending: false, nullsFirst: false }).order("posted_at", { ascending: false });
      else q = q.order("posted_at", { ascending: false, nullsFirst: false }).order("published_at", { ascending: false, nullsFirst: false });
      return q.range((page - 1) * pageSize, page * pageSize - 1);
    };
    let page = Math.max(1, opts.page ?? 1);
    let res = await run(page);
    let total = res.count ?? 0;
    if (res.error && !/range|416|Requested range/i.test(res.error.message)) fail("listing jobs", res.error);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (page > pageCount) { page = pageCount; res = await run(page); if (res.error) fail("listing jobs", res.error); total = res.count ?? total; }
    const rows = ((res.data ?? []) as unknown as JobRow[]);
    const ref = await getRef();
    return { jobs: rows.map((r) => labelJob(mapJob(r), ref)), total, page, pageSize, pageCount };
  },

  async getJob(slug) {
    const db = createPublicClient();
    const { data, error } = await db.from("jobs_v").select("*").eq("slug", slug).in("status", VISIBLE).maybeSingle();
    if (error) fail("loading job", error);
    if (!data) return null;
    const v = await db.from("job_vacancies").select("post_name,category,count").eq("job_id", data.id).order("sort_order");
    if (v.error) fail("loading vacancies", v.error);
    const rows: VacancyRow[] = (v.data ?? []).map((x) => ({ post: x.post_name, category: x.category ?? undefined, count: x.count }));
    return labelJob(mapJob(data as unknown as JobRow, rows), await getRef());
  },

  async sitemapJobs() {
    const today = todayIST();
    const { data, error } = await createPublicClient().from("jobs_v").select("slug,updated_at").in("status", LIVE)
      .or(`last_date.is.null,last_date.gte.${today}`).order("updated_at", { ascending: false }).limit(45000);
    if (error) fail("building sitemap", error);
    return data.map((r) => ({ slug: r.slug, updatedAt: r.updated_at }));
  },

  async latestJobs(limit = 6) { return (await this.listJobs({}, { sort: "latest", pageSize: limit })).jobs; },

  async closingSoon(limit = 6) {
    const today = todayIST();
    const { data, error } = await createPublicClient().from("jobs_v").select(LIST_COLUMNS).in("status", LIVE)
      .gte("last_date", today).lte("last_date", addDays(today, 7)).order("last_date", { ascending: true }).limit(limit);
    if (error) fail("loading closing-soon jobs", error);
    const ref = await getRef();
    return (data as unknown as JobRow[]).map((r) => labelJob(mapJob(r), ref));
  },

  async latestUpdates(limit = 8): Promise<SiteUpdate[]> {
    const db = createPublicClient();
    const { data, error } = await db.from("jobs_v").select("id,slug,title,status,updated_at,published_at").in("status", LIVE).order("updated_at", { ascending: false }).limit(limit);
    if (error) fail("loading updates", error);
    const jobs: SiteUpdate[] = data.map((r) => ({
      id: r.id, kind: "job" as const, href: `/jobs/${r.slug}`, isDemo: false, date: todayIST(new Date(r.updated_at)),
      title: r.status === "updated" ? `${r.title} — details updated` : `${r.title} — notification published`,
    }));
    const [ac, rs, ak] = await Promise.all([listDiscovery("admit_cards"), listDiscovery("results"), listDiscovery("answer_keys")]);
    const extra: SiteUpdate[] = [
      ...ac.slice(0, 3).map((x) => ({ id: x.id, kind: "admit-card" as const, title: x.title, href: `/admit-card/${x.slug}`, date: x.date, isDemo: false })),
      ...rs.slice(0, 3).map((x) => ({ id: x.id, kind: "result" as const, title: x.title, href: `/results/${x.slug}`, date: x.date, isDemo: false })),
      ...ak.slice(0, 3).map((x) => ({ id: x.id, kind: "answer-key" as const, title: x.title, href: `/answer-key/${x.slug}`, date: x.date, isDemo: false })),
    ].filter((x) => x.date);
    return [...jobs, ...extra].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
  },

  async countJobs(filters) {
    const db = createPublicClient();
    const refs = await refsFor(db, filters);
    let q = db.from("jobs_v").select("id", { count: "exact", head: true });
    q = applyFilters(refs, q, filters, false);
    const { count, error } = await q;
    if (error) fail("counting jobs", error);
    return count ?? 0;
  },

  async facetCounts(kind: FacetKind, within: JobFilters = {}) {
    const { data, error } = await createPublicClient().rpc("job_facet_counts", {
      p_kind: kind, p_state: within.state ?? null, p_department: within.department ?? null, p_qualification: within.qualification ?? null, p_today: todayIST(),
    });
    if (error) fail("loading facet counts", error);
    return Object.fromEntries((data as { key: string; n: number }[]).map((r) => [r.key, Number(r.n)]));
  },

  async relatedJobs(job: Job, limit = 3) {
    const db = createPublicClient(); const today = todayIST();
    const refs = await refIds(db);
    const parts = [refs.departments.get(job.departmentSlug) ? `department_id.eq.${refs.departments.get(job.departmentSlug)}` : "", refs.states.get(job.stateSlug) ? `state_id.eq.${refs.states.get(job.stateSlug)}` : ""].filter(Boolean);
    if (!parts.length) return [];
    const { data, error } = await db.from("jobs_v").select(LIST_COLUMNS).in("status", LIVE).neq("id", job.id)
      .or(`last_date.is.null,last_date.gte.${today}`).or(parts.join(",")).order("posted_at", { ascending: false }).limit(limit);
    if (error) fail("loading related jobs", error);
    return (data as unknown as JobRow[]).map((r) => labelJob(mapJob(r), refs.ref));
  },

  async districtContentCounts(stateSlug) {
    const { data, error } = await createPublicClient().rpc("district_content_counts", { p_state: stateSlug ?? null, p_today: todayIST() });
    if (error) fail("counting district content", error);
    return (data as { state_slug: string; district_slug: string; n: number }[]).map((r) => ({ state: r.state_slug, district: r.district_slug, n: Number(r.n) }));
  },

};
