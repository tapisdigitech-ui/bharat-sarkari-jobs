/** Supabase implementation: recruitments (public client by default; staff previews pass their RLS session client). */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public";
import { getRef } from "../ref";
import { LIST_COLUMNS, mapJob, type JobRow } from "./mapper";
import { labelJob } from "../ref";
import type { ContentStatus, Job, JobLevel } from "@/lib/types";

import { LIVE_STATUSES, VISIBLE_STATUSES, type Recruitment } from "../statuses";


type Row = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const fail = (what: string, e: { message: string }): never => { throw new Error(`Database error while ${what}: ${e.message}`); };
const dbOrPublic = (db?: SupabaseClient) => db ?? createPublicClient();

async function mapRecruitments(db: SupabaseClient, rows: Row[]): Promise<Recruitment[]> {
  if (rows.length === 0) return [];
  const ref = await getRef();
  const orgIds = [...new Set(rows.map((r) => r.organization_id as string))];
  const examIds = [...new Set(rows.map((r) => r.exam_id as string | null).filter((x): x is string => !!x))];
  const [orgs, exams] = await Promise.all([
    db.from("organizations").select("id,name,slug").in("id", orgIds),
    examIds.length ? db.from("exams").select("id,name,slug,status").in("id", examIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (orgs.error) fail("loading organizations", orgs.error);
  const on = new Map((orgs.data ?? []).map((o) => [o.id as string, o]));
  const en = new Map((exams.data ?? []).map((e) => [e.id as string, e]));
  return rows.map((r) => {
    const st = ref.allStates.find((x) => x.id === r.state_id);
    const org = on.get(r.organization_id as string);
    const ex = r.exam_id ? en.get(r.exam_id as string) : undefined;
    const dep = ref.allDepartments.find((d) => d.id === r.department_id);
    const examLive = ex && (ex.status === "published" || ex.status === "updated" || ex.status === "expired");
    return {
      id: r.id as string, slug: r.slug as string, title: r.title as string, shortTitle: s(r.short_title),
      organizationId: r.organization_id as string, organization: org?.name ?? "", organizationSlug: org?.slug ?? undefined,
      departmentName: dep?.name, examId: s(r.exam_id), examSlug: examLive ? ex.slug : undefined, examName: examLive ? ex.name : undefined,
      level: r.level as JobLevel, stateSlug: r.is_all_india ? "all-india" : st?.slug ?? "all-india", stateName: st?.name, isAllIndia: !!r.is_all_india,
      cycleYear: (r.cycle_year as number | null) ?? undefined, notificationNumber: s(r.notification_number), notificationDate: s(r.notification_date),
      summary: s(r.summary), officialNotificationUrl: s(r.official_notification_url), officialWebsiteUrl: s(r.official_website_url),
      sourceName: s(r.source_name), sourceCheckedAt: s(r.source_checked_at),
      status: r.status as ContentStatus, publishedAt: s(r.published_at), updatedAt: r.updated_at as string, verificationStatus: s(r.verification_status),
    };
  });
}

/** Public lookup: published / updated / expired recruitments only (RLS also enforces this). */
export async function getRecruitment(slug: string, db?: SupabaseClient): Promise<Recruitment | null> {
  const c = dbOrPublic(db);
  const { data, error } = await c.from("recruitments").select("*").eq("slug", slug).in("status", [...VISIBLE_STATUSES]).maybeSingle();
  if (error) fail("loading recruitment", error);
  return data ? (await mapRecruitments(c, [data as Row]))[0] : null;
}

/** Staff lookup by id (used by the signed preview; the caller passes the RLS session client). */
export async function getRecruitmentById(id: string, db: SupabaseClient): Promise<Recruitment | null> {
  const { data, error } = await db.from("recruitments").select("*").eq("id", id).maybeSingle();
  if (error) fail("loading recruitment", error);
  return data ? (await mapRecruitments(db, [data as Row]))[0] : null;
}

/** Jobs that belong to a recruitment cycle (live and expired jobs; drafts stay hidden by RLS / the status filter). */
export async function jobsOfRecruitment(recruitmentId: string, opts: { db?: SupabaseClient; includeDrafts?: boolean } = {}): Promise<Job[]> {
  const c = dbOrPublic(opts.db);
  let q = c.from("jobs_v").select(LIST_COLUMNS).eq("recruitment_id", recruitmentId);
  if (!opts.includeDrafts) q = q.in("status", [...VISIBLE_STATUSES]);
  const { data, error } = await q.order("posted_at", { ascending: false, nullsFirst: false }).limit(100);
  if (error) fail("loading recruitment jobs", error);
  const ref = await getRef();
  return (data as unknown as JobRow[]).map((r) => labelJob(mapJob(r), ref));
}

const searchTerms = (q?: string) => (q ?? "").toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}\-/.]/gu, "")).filter(Boolean).slice(0, 6);

export async function listRecruitments(opts: { limit?: number; organizationId?: string; examId?: string; q?: string } = {}): Promise<Recruitment[]> {
  const c = createPublicClient();
  let q = c.from("recruitments").select("*").in("status", [...LIVE_STATUSES]);
  if (opts.organizationId) q = q.eq("organization_id", opts.organizationId);
  if (opts.examId) q = q.eq("exam_id", opts.examId);
  for (const t of searchTerms(opts.q)) q = q.ilike("title", `%${t}%`);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(opts.limit ?? 50);
  if (error) fail("listing recruitments", error);
  return mapRecruitments(c, data as Row[]);
}

export async function sitemapRecruitments(): Promise<{ slug: string; updatedAt: string }[]> {
  const { data, error } = await createPublicClient().from("recruitments").select("slug,updated_at").in("status", [...LIVE_STATUSES]).order("updated_at", { ascending: false }).limit(45000);
  if (error) fail("building sitemap", error);
  return (data ?? []).map((r) => ({ slug: r.slug as string, updatedAt: r.updated_at as string }));
}
