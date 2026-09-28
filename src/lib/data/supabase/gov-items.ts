/** Supabase implementation: admit cards, results, answer keys. */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public";
import { addDays, todayIST } from "@/lib/dates";
import type { StatusDate } from "@/lib/date-display";
import type { AdmitCard, AnswerKey, GovBase, GovFilters, GovItem, GovKind, GovPage, ImportantDateItem, ResultItem } from "@/lib/gov-types";
import type { ContentStatus } from "@/lib/types";
import { getRef } from "../ref";
import { LIVE_STATUSES, VISIBLE_STATUSES } from "../statuses";

type Row = Record<string, unknown>;
const TABLE: Record<GovKind, string> = { admit_card: "admit_cards", result: "results", answer_key: "answer_keys" };
/** The column that says "as of when" for each kind (used for ordering and the recency filter). */
const MAIN_DATE: Record<GovKind, string> = { admit_card: "release_date", result: "result_date", answer_key: "release_date" };
const NIL = "00000000-0000-0000-0000-000000000000";
const fail = (what: string, e: { message: string }): never => { throw new Error(`Database error while ${what}: ${e.message}`); };
const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const terms = (q?: string) => (q ?? "").toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}\-/.]/gu, "")).filter(Boolean).slice(0, 6);

const sd = (r: Row, col: string): StatusDate => ({ date: s(r[col]) ?? null, status: (s(r[`${col}_status`]) as StatusDate["status"]) ?? null, expectedText: s(r[`${col}_text`]) ?? null });

async function lookups(db: SupabaseClient, rows: Row[]) {
  const ids = (k: string) => [...new Set(rows.map((r) => r[k] as string | null).filter((x): x is string => !!x))];
  const q = <T,>(table: string, cols: string, list: string[]) => list.length ? db.from(table).select(cols).in("id", list) : Promise.resolve({ data: [] as T[], error: null });
  const [orgs, exams, recs, jobs] = await Promise.all([
    q<Row>("organizations", "id,name,slug", ids("organization_id")), q<Row>("exams", "id,name,slug,status", ids("exam_id")),
    q<Row>("recruitments", "id,title,slug,status", ids("recruitment_id")), q<Row>("jobs", "id,title,slug,status", ids("job_id")),
  ]);
  for (const r of [orgs, exams, recs, jobs]) if (r.error) fail("loading related records", r.error);
  const by = (x: { data: unknown }) => new Map(((x.data ?? []) as Row[]).map((o) => [o.id as string, o]));
  return { ref: await getRef(), orgs: by(orgs), exams: by(exams), recs: by(recs), jobs: by(jobs) };
}
const isVisible = (o?: Row) => !!o && (VISIBLE_STATUSES as readonly string[]).includes(o.status as string);

async function mapRows(kind: GovKind, db: SupabaseClient, rows: Row[], staff = false): Promise<GovItem[]> {
  if (rows.length === 0) return [];
  const L = await lookups(db, rows);
  let typeNames = new Map<number, Row>();
  const typeTable = kind === "result" ? "result_types" : kind === "answer_key" ? "answer_key_types" : null;
  if (typeTable) {
    const t = await db.from(typeTable).select("id,name,slug");
    if (t.error) fail("loading types", t.error);
    typeNames = new Map((t.data ?? []).map((x) => [x.id as number, x as Row]));
  }
  const districts = new Map<number, string>();
  if (kind === "admit_card") {
    const ids = [...new Set(rows.map((r) => r.district_id as number | null).filter((x): x is number => !!x))];
    if (ids.length) { const d = await db.from("districts").select("id,name").in("id", ids); (d.data ?? []).forEach((x) => districts.set(x.id as number, x.name as string)); }
  }
  return rows.map((r): GovItem => {
    const org = L.orgs.get(r.organization_id as string), ex = r.exam_id ? L.exams.get(r.exam_id as string) : undefined;
    const rc = r.recruitment_id ? L.recs.get(r.recruitment_id as string) : undefined, jb = r.job_id ? L.jobs.get(r.job_id as string) : undefined;
    const st = L.ref.allStates.find((x) => x.id === r.state_id), dep = L.ref.allDepartments.find((d) => d.id === r.department_id);
    // Public pages link only to related records that are themselves public; staff previews see everything.
    const showEx = ex && (staff || isVisible(ex)), showRc = rc && (staff || isVisible(rc)), showJb = jb && (staff || isVisible(jb));
    const base: GovBase = {
      id: r.id as string, slug: r.slug as string, title: r.title as string, shortTitle: s(r.short_title),
      organizationId: r.organization_id as string, organization: (org?.name as string) ?? "", organizationSlug: s(org?.slug), departmentName: dep?.name,
      examId: s(r.exam_id), examSlug: showEx ? (ex.slug as string) : undefined, examName: showEx ? (ex.name as string) : undefined,
      recruitmentId: s(r.recruitment_id), recruitmentSlug: showRc ? (rc.slug as string) : undefined, recruitmentTitle: showRc ? (rc.title as string) : undefined,
      jobSlug: showJb ? (jb.slug as string) : undefined, jobTitle: showJb ? (jb.title as string) : undefined,
      stateSlug: r.is_all_india ? "all-india" : st?.slug ?? "all-india", stateName: st?.name, isAllIndia: !!r.is_all_india,
      description: s(r.description), notes: s(r.notes), officialWebsiteUrl: s(r.official_website_url), sourceName: s(r.source_name), sourceCheckedAt: s(r.source_checked_at),
      status: r.status as ContentStatus, publishedAt: s(r.published_at), updatedAt: r.updated_at as string, isDemo: false, verificationStatus: s(r.verification_status),
    };
    if (kind === "admit_card") {
      const list = Array.isArray(r.important_dates) ? (r.important_dates as { label: string; status: "official" | "expected"; date: string | null; text: string | null }[]) : [];
      const importantDates: ImportantDateItem[] = list.map((x) => ({ label: x.label, date: { date: x.date, status: x.status, expectedText: x.text } }));
      return { ...base, kind, availability: (r.availability as AdmitCard["availability"]) ?? "upcoming", districtName: r.district_id ? districts.get(r.district_id as number) : undefined,
        releaseDate: sd(r, "release_date"), examDate: sd(r, "exam_date"), applicationLastDate: sd(r, "application_last_date"), importantDates,
        officialAdmitCardUrl: s(r.official_admit_card_url), officialNotificationUrl: s(r.official_notification_url),
        summary: s(r.summary), importantInstructions: s(r.important_instructions), howToDownload: s(r.how_to_download), documentsRequired: s(r.documents_required) };
    }
    if (kind === "result") {
      const t = typeNames.get(r.result_type_id as number);
      return { ...base, kind, resultType: (t?.name as string) ?? "Result", resultTypeSlug: (t?.slug as string) ?? "", resultDate: sd(r, "result_date"), examDate: sd(r, "exam_date"),
        officialResultUrl: s(r.official_result_url), officialCutoffUrl: s(r.official_cutoff_url), importantInstructions: s(r.important_instructions) };
    }
    const t = typeNames.get(r.answer_key_type_id as number);
    return { ...base, kind: "answer_key", keyType: (t?.name as string) ?? "Answer Key", keyTypeSlug: (t?.slug as string) ?? "", releaseDate: sd(r, "release_date"), examDate: sd(r, "exam_date"),
      objectionStart: s(r.objection_start_date), objectionLast: s(r.objection_last_date),
      officialAnswerKeyUrl: s(r.official_answer_key_url), officialObjectionUrl: s(r.official_objection_url) };
  });
}

/** Resolve slug filters to ids (unknown slug ⇒ match nothing, never "everything"). */
async function idFilters(db: SupabaseClient, f: GovFilters) {
  const out: { organization?: string; exam?: string; state?: number | "all"; department?: number } = {};
  if (f.organization) { const r = await db.from("organizations").select("id").eq("slug", f.organization).maybeSingle(); out.organization = r.data?.id ?? NIL; }
  if (f.exam) { const r = await db.from("exams").select("id").eq("slug", f.exam).in("status", [...VISIBLE_STATUSES]).maybeSingle(); out.exam = r.data?.id ?? NIL; }
  const ref = await getRef();
  if (f.state) out.state = f.state === "all-india" ? "all" : ref.allStates.find((x) => x.slug === f.state)?.id ?? -1;
  if (f.department) out.department = ref.allDepartments.find((x) => x.slug === f.department)?.id ?? -1;
  return out;
}

// NOTE: synchronous on purpose — PostgREST builders are thenables.
function applyFilters(kind: GovKind, q: any, f: GovFilters, ids: Awaited<ReturnType<typeof idFilters>>, typeIds: Record<string, number>) {
  const today = todayIST(), main = MAIN_DATE[kind];
  if (ids.organization) q = q.eq("organization_id", ids.organization);
  if (ids.exam) q = q.eq("exam_id", ids.exam);
  if (ids.department !== undefined) q = q.eq("department_id", ids.department);
  if (ids.state === "all") q = q.eq("is_all_india", true); else if (ids.state !== undefined) q = q.eq("state_id", ids.state);
  for (const t of terms(f.q)) q = q.ilike("title", `%${t}%`);
  if (f.within) q = q.eq(`${main}_status`, "official").gte(main, addDays(today, -f.within));
  if (f.examWhen === "upcoming") q = q.eq("exam_date_status", "official").gte("exam_date", today);
  else if (f.examWhen === "next30") q = q.eq("exam_date_status", "official").gte("exam_date", today).lte("exam_date", addDays(today, 30));
  else if (f.examWhen === "past") q = q.eq("exam_date_status", "official").lt("exam_date", today);
  if (kind === "admit_card" && f.availability) q = q.eq("availability", f.availability);
  if (kind === "result") {
    if (f.view === "today") q = q.eq("result_date_status", "official").eq("result_date", today);
    if (f.view === "recent") q = q.gte("updated_at", `${addDays(today, -14)}T00:00:00+05:30`);
  }
  if (kind !== "admit_card" && f.type && typeIds[f.type] !== undefined) q = q.eq(kind === "result" ? "result_type_id" : "answer_key_type_id", typeIds[f.type]);
  if (kind === "answer_key") {
    if (f.view === "recent") q = q.gte("updated_at", `${addDays(today, -14)}T00:00:00+05:30`);
    if (f.view === "objection") q = q.not("objection_last_date", "is", null).gte("objection_last_date", today);
    if ((f.view === "final" || f.view === "provisional") && typeIds[f.view] !== undefined) q = q.eq("answer_key_type_id", typeIds[f.view]);
  }
  return q;
}

export async function listGov<K extends GovKind>(kind: K, f: GovFilters = {}, opts: { page?: number; pageSize?: number } = {}): Promise<GovPage<Extract<GovItem, { kind: K }>>> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 12, 1), 50);
  const db = createPublicClient();
  const ids = await idFilters(db, f);
  const typeIds: Record<string, number> = {};
  if (kind !== "admit_card") {
    const t = await db.from(kind === "result" ? "result_types" : "answer_key_types").select("id,slug");
    for (const x of t.data ?? []) typeIds[x.slug as string] = x.id as number;
    if (f.type && typeIds[f.type] === undefined) return { items: [], total: 0, page: 1, pageSize, pageCount: 1 } as GovPage<Extract<GovItem, { kind: K }>>;
  }
  const main = MAIN_DATE[kind];
  const run = async (page: number) => {
    let q = db.from(TABLE[kind]).select("*", { count: "exact" }).in("status", [...LIVE_STATUSES]);
    q = applyFilters(kind, q, f, ids, typeIds);
    if (kind === "answer_key" && f.view === "objection") q = q.order("objection_last_date", { ascending: true });
    else if ((kind !== "admit_card" && f.view === "recent")) q = q.order("updated_at", { ascending: false });
    else q = q.order(main, { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false });
    return q.range((page - 1) * pageSize, page * pageSize - 1);
  };
  let page = Math.max(1, opts.page ?? 1);
  let res = await run(page);
  if (res.error && !/range|416|Requested range/i.test(res.error.message)) fail(`listing ${TABLE[kind]}`, res.error);
  let total = res.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (page > pageCount) { page = pageCount; res = await run(page); if (res.error) fail(`listing ${TABLE[kind]}`, res.error); total = res.count ?? total; }
  return { items: (await mapRows(kind, db, (res.data ?? []) as Row[])) as Extract<GovItem, { kind: K }>[], total, page, pageSize, pageCount };
}

/** Public detail: published / updated / expired only. */
export async function getGovBySlug<K extends GovKind>(kind: K, slug: string): Promise<Extract<GovItem, { kind: K }> | null> {
  const db = createPublicClient();
  const { data, error } = await db.from(TABLE[kind]).select("*").eq("slug", slug).in("status", [...VISIBLE_STATUSES]).maybeSingle();
  if (error) fail(`loading ${kind}`, error);
  return data ? ((await mapRows(kind, db, [data as Row]))[0] as Extract<GovItem, { kind: K }>) : null;
}

/** Staff preview (drafts allowed by RLS for staff). */
export async function getGovById<K extends GovKind>(kind: K, id: string, db: SupabaseClient): Promise<Extract<GovItem, { kind: K }> | null> {
  const { data, error } = await db.from(TABLE[kind]).select("*").eq("id", id).maybeSingle();
  if (error) fail(`loading ${kind}`, error);
  return data ? ((await mapRows(kind, db, [data as Row], true))[0] as Extract<GovItem, { kind: K }>) : null;
}

export async function sitemapGov(kind: GovKind): Promise<{ slug: string; updatedAt: string }[]> {
  const { data, error } = await createPublicClient().from(TABLE[kind]).select("slug,updated_at").in("status", [...LIVE_STATUSES]).order("updated_at", { ascending: false }).limit(45000);
  if (error) fail("building sitemap", error);
  return (data ?? []).map((r) => ({ slug: r.slug as string, updatedAt: r.updated_at as string }));
}

/** Records tied to an exam or recruitment (used for cross-linking); `exclude` is the current record's id. */
export async function relatedGov(kind: GovKind, link: { examId?: string; recruitmentId?: string }, opts: { limit?: number; exclude?: string; db?: SupabaseClient } = {}): Promise<GovItem[]> {
  if (!link.examId && !link.recruitmentId) return [];
  const db = opts.db ?? createPublicClient();
  let q = db.from(TABLE[kind]).select("*").in("status", [...LIVE_STATUSES]);
  const parts = [link.examId && `exam_id.eq.${link.examId}`, link.recruitmentId && `recruitment_id.eq.${link.recruitmentId}`].filter(Boolean);
  q = q.or(parts.join(","));
  if (opts.exclude) q = q.neq("id", opts.exclude);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(opts.limit ?? 6);
  if (error) fail(`loading related ${kind}`, error);
  return mapRows(kind, db, (data ?? []) as Row[]);
}

export async function govTypes(kind: GovKind): Promise<{ slug: string; name: string }[]> {
  if (kind === "admit_card") return [];
  const { data, error } = await createPublicClient().from(kind === "result" ? "result_types" : "answer_key_types").select("slug,name").eq("is_active", true).order("sort_order");
  if (error) fail("loading types", error);
  return (data ?? []) as { slug: string; name: string }[];
}

/** Facets for filter dropdowns: only organizations / exams that actually have live records of this kind. */
export async function govFacets(kind: GovKind): Promise<{ organizations: { slug: string; name: string }[]; exams: { slug: string; name: string }[] }> {
  const db = createPublicClient();
  const { data, error } = await db.from(TABLE[kind]).select("organization_id,exam_id").in("status", [...LIVE_STATUSES]).limit(2000);
  if (error) fail("loading filters", error);
  const oIds = [...new Set((data ?? []).map((r) => r.organization_id as string))], eIds = [...new Set((data ?? []).map((r) => r.exam_id as string | null).filter((x): x is string => !!x))];
  const [o, e] = await Promise.all([
    oIds.length ? db.from("organizations").select("slug,name").in("id", oIds).order("name") : { data: [] as { slug: string; name: string }[] },
    eIds.length ? db.from("exams").select("slug,name").in("id", eIds).in("status", [...VISIBLE_STATUSES]).order("name") : { data: [] as { slug: string; name: string }[] },
  ]);
  return { organizations: (o.data ?? []) as { slug: string; name: string }[], exams: (e.data ?? []) as { slug: string; name: string }[] };
}
