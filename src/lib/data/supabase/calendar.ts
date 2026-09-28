/** Supabase implementation: exam calendar rows. */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public";
import { todayIST } from "@/lib/dates";
import type { StatusDate } from "@/lib/date-display";
import type { CalendarFilters, CalendarItem, ExamType } from "@/lib/gov-types";
import type { ContentStatus } from "@/lib/types";
import { getRef } from "../ref";
import { LIVE_STATUSES, VISIBLE_STATUSES } from "../statuses";
import { sortKey } from "../calendar-rules";

type Row = Record<string, unknown>;
const CAP = 1000;
const NIL = "00000000-0000-0000-0000-000000000000";
const fail = (what: string, e: { message: string }): never => { throw new Error(`Database error while ${what}: ${e.message}`); };
const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const sd = (r: Row, col: string): StatusDate => ({ date: s(r[col]) ?? null, status: (s(r[`${col}_status`]) as StatusDate["status"]) ?? null, expectedText: s(r[`${col}_text`]) ?? null });
const isVisible = (o?: Row) => !!o && (VISIBLE_STATUSES as readonly string[]).includes(o.status as string);

async function mapRows(db: SupabaseClient, rows: Row[]): Promise<CalendarItem[]> {
  if (rows.length === 0) return [];
  const ids = (k: string) => [...new Set(rows.map((r) => r[k] as string | null).filter((x): x is string => !!x))];
  const q = (table: string, cols: string, list: string[]) => (list.length ? db.from(table).select(cols).in("id", list) : Promise.resolve({ data: [] as Row[], error: null }));
  const [orgs, exams, recs] = await Promise.all([q("organizations", "id,name,slug", ids("organization_id")), q("exams", "id,name,slug,status", ids("exam_id")), q("recruitments", "id,title,slug,status", ids("recruitment_id"))]);
  for (const r of [orgs, exams, recs]) if (r.error) fail("loading calendar links", r.error);
  const by = (x: { data: unknown }) => new Map(((x.data ?? []) as Row[]).map((o) => [o.id as string, o]));
  const [on, en, rn, ref] = [by(orgs), by(exams), by(recs), await getRef()];
  const dIds = [...new Set(rows.map((r) => r.district_id as number | null).filter((x): x is number => !!x))];
  const dn = new Map<number, string>();
  if (dIds.length) { const d = await db.from("districts").select("id,name").in("id", dIds); (d.data ?? []).forEach((x) => dn.set(x.id as number, x.name as string)); }
  return rows.map((r): CalendarItem => {
    const org = on.get(r.organization_id as string), ex = r.exam_id ? en.get(r.exam_id as string) : undefined, rc = r.recruitment_id ? rn.get(r.recruitment_id as string) : undefined;
    const st = ref.allStates.find((x) => x.id === r.state_id), dep = ref.allDepartments.find((d) => d.id === r.department_id);
    return {
      id: r.id as string, title: r.title as string, shortTitle: s(r.short_title),
      organizationId: r.organization_id as string, organization: (org?.name as string) ?? "", organizationSlug: s(org?.slug), departmentName: dep?.name,
      examId: s(r.exam_id), examSlug: isVisible(ex) ? (ex!.slug as string) : undefined, examName: isVisible(ex) ? (ex!.name as string) : undefined,
      recruitmentId: s(r.recruitment_id), recruitmentSlug: isVisible(rc) ? (rc!.slug as string) : undefined, recruitmentTitle: isVisible(rc) ? (rc!.title as string) : undefined,
      examType: ((s(r.exam_type) as ExamType) ?? "recruitment"),
      stateSlug: r.is_all_india ? "all-india" : st?.slug ?? "all-india", stateName: st?.name, isAllIndia: !!r.is_all_india,
      districtName: r.district_id ? dn.get(r.district_id as number) : undefined,
      coverage: r.district_id ? "district" : r.is_all_india ? "national" : "state",
      notificationDate: sd(r, "notification_date"), applicationStart: sd(r, "application_start_date"), applicationLast: sd(r, "application_last_date"), correctionDate: sd(r, "correction_date"),
      admitCardDate: sd(r, "admit_card_date"), examDate: sd(r, "exam_date"), resultDate: sd(r, "result_date"),
      description: s(r.description), officialNotificationUrl: s(r.official_notification_url), officialWebsiteUrl: s(r.official_website_url),
      sourceName: s(r.source_name), sourceCheckedAt: s(r.source_checked_at),
      status: r.status as ContentStatus, updatedAt: r.updated_at as string, isDemo: false,
    };
  });
}

async function slugFilters(db: SupabaseClient, f: CalendarFilters) {
  const out: { organization?: string; exam?: string; state?: number | "all" } = {};
  if (f.organization) { const r = await db.from("organizations").select("id").eq("slug", f.organization).maybeSingle(); out.organization = r.data?.id ?? NIL; }
  if (f.exam) { const r = await db.from("exams").select("id").eq("slug", f.exam).in("status", [...VISIBLE_STATUSES]).maybeSingle(); out.exam = r.data?.id ?? NIL; }
  if (f.state) out.state = f.state === "all-india" ? "all" : (await getRef()).allStates.find((x) => x.slug === f.state)?.id ?? -1;
  return out;
}

/** Live calendar rows matching the filters (unsorted; the view/order/paging rules are shared in gov-calendar.ts). */
export async function listCalendarItems(f: CalendarFilters = {}): Promise<CalendarItem[]> {
  const db = createPublicClient();
  const ids = await slugFilters(db, f);
  let q = db.from("exam_calendar").select("*").in("status", [...LIVE_STATUSES]);
  if (ids.organization) q = q.eq("organization_id", ids.organization);
  if (ids.exam) q = q.eq("exam_id", ids.exam);
  if (f.examType) q = q.eq("exam_type", f.examType);
  if (ids.state === "all") q = q.eq("is_all_india", true); else if (ids.state !== undefined) q = q.eq("state_id", ids.state);
  for (const t of (f.q ?? "").toLowerCase().split(/\s+/).map((x) => x.replace(/[^\p{L}\p{N}\-/.]/gu, "")).filter(Boolean).slice(0, 6)) q = q.ilike("title", `%${t}%`);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(CAP);
  if (error) fail("listing the exam calendar", error);
  return mapRows(db, (data ?? []) as Row[]);
}

/** Schedule entries tied to an exam and/or recruitment (exam hub, recruitment page, job page). */
export async function calendarFor(link: { examId?: string; recruitmentId?: string }, opts: { limit?: number; db?: SupabaseClient } = {}): Promise<CalendarItem[]> {
  if (!link.examId && !link.recruitmentId) return [];
  const db = opts.db ?? createPublicClient();
  const parts = [link.examId && `exam_id.eq.${link.examId}`, link.recruitmentId && `recruitment_id.eq.${link.recruitmentId}`].filter(Boolean);
  const { data, error } = await db.from("exam_calendar").select("*").in("status", [...LIVE_STATUSES]).or(parts.join(",")).order("updated_at", { ascending: false }).limit(opts.limit ?? 10);
  if (error) fail("loading calendar entries", error);
  const today = todayIST();
  return (await mapRows(db, (data ?? []) as Row[])).sort((a, b) => sortKey(a, today).localeCompare(sortKey(b, today)));
}

export async function calendarFacets(): Promise<{ organizations: { slug: string; name: string }[] }> {
  const db = createPublicClient();
  const { data, error } = await db.from("exam_calendar").select("organization_id").in("status", [...LIVE_STATUSES]).limit(CAP);
  if (error) fail("loading calendar filters", error);
  const ids = [...new Set((data ?? []).map((r) => r.organization_id as string))];
  const o = ids.length ? await db.from("organizations").select("slug,name").in("id", ids).order("name") : { data: [] as { slug: string; name: string }[] };
  return { organizations: (o.data ?? []) as { slug: string; name: string }[] };
}
