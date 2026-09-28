import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, workflow } from "@/lib/admin/permissions";
import { formatDateTimeIST } from "@/lib/admin/format";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { todayIST } from "@/lib/dates";
import { runExpiryAction } from "./jobs/actions";
import type { ContentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ notice?: string }> };

interface Stats {
  published: number; draft: number; review: number; closing_soon: number; expired: number; needs_review: number;
  recruitments: number; exams: number;
  admit_cards: number; admit_cards_recent: number; results: number; results_recent: number; answer_keys: number; answer_keys_recent: number;
  exam_calendar_upcoming: number; exam_calendar_today: number; exam_calendar_this_week: number;
  content_review: number;
}
interface Recent { id: string; title: string; organization: string; status: ContentStatus; updated_at: string; last_date: string | null }

export default async function Dashboard({ searchParams }: Props) {
  const staff = await requireStaff();
  const { notice } = await searchParams;
  const db = await createSupabaseServerClient();
  const [stats, recent, attention, health] = await Promise.all([
    db.rpc("admin_dashboard_stats", { p_today: todayIST() }),
    db.from("jobs_v").select("id,title,organization,status,updated_at,last_date").order("updated_at", { ascending: false }).limit(8),
    db.from("jobs_v").select("id,title,organization,status,updated_at,last_date").eq("status", "review").order("updated_at", { ascending: true }).limit(5),
    db.rpc("content_health_stats", { p_today: todayIST() }),
  ]);
  const h = (health.data ?? {}) as Record<string, number | null>;
  const ops: [string, number | null | undefined, string][] = [
    ["Discoveries awaiting review", h.awaiting_review, "/admin/review"], ["Sources failing", h.sources_failing, "/admin/health"],
    ["Needs source verification", h.needs_verification, "/admin/health"], ["Broken official links", h.broken_links, "/admin/health"],
  ];
  const s = stats.data as Stats | null;
  const cards: [string, number | undefined, string][] = [
    ["Published jobs", s?.published, "/admin/jobs?status=live"], ["Drafts", s?.draft, "/admin/jobs?status=draft"], ["Awaiting review", s?.review, "/admin/jobs?status=review"],
    ["Closing in 7 days", s?.closing_soon, "/admin/jobs?status=live&sort=last_date"], ["Expired", s?.expired, "/admin/jobs?status=expired"], ["Needs attention", s?.needs_review, "/admin/jobs?status=review"],
  ];
  const examCalendarCards: [string, number | undefined, string][] = [
    ["Upcoming", s?.exam_calendar_upcoming, "/admin/exam-calendar"], ["Today", s?.exam_calendar_today, "/admin/exam-calendar"], ["This week", s?.exam_calendar_this_week, "/admin/exam-calendar"],
  ];
  const govCards: [string, number | undefined, number | undefined, string][] = [
    ["Admit cards", s?.admit_cards, s?.admit_cards_recent, "/admin/admit-cards"], ["Results", s?.results, s?.results_recent, "/admin/results"], ["Answer keys", s?.answer_keys, s?.answer_keys_recent, "/admin/answer-keys"],
  ];
  const reviewLinks: [string, string][] = [["Recruitments", "/admin/recruitments"], ["Exams", "/admin/exams"], ["Admit cards", "/admin/admit-cards"], ["Results", "/admin/results"], ["Answer keys", "/admin/answer-keys"], ["Exam calendar", "/admin/exam-calendar"]];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Dashboard</h1><p className="text-sm text-ink-muted">Server date (IST): {todayIST()}</p></div>
        {can(staff.role, "job:create") && <Link href="/admin/jobs/new" className="btn btn-accent">New job</Link>}
      </div>

      {notice === "forbidden" && <p role="alert" className="rounded-md border border-warning-700/30 bg-warning-50 px-3 py-2 text-sm text-warning-700">You do not have permission to open that page.</p>}
      {stats.error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">Could not load statistics: {stats.error.message}</p>}

      <section aria-label="Job statistics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([k, v, href]) => (
          <Link key={k} href={href} className="card card-hover p-4"><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{k}</p><p className="mt-1 text-3xl font-extrabold text-brand-900">{v ?? "—"}</p></Link>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="att-h">
          <h2 id="att-h" className="section-title mb-2">Waiting for review</h2>
          {attention.data?.length ? (
            <ul className="card divide-y divide-line">{(attention.data as Recent[]).map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 p-3"><div className="min-w-0"><Link className="font-semibold text-brand-700 underline" href={`/admin/jobs/${j.id}`}>{j.title}</Link><p className="truncate text-sm text-ink-muted">{j.organization} · updated {formatDateTimeIST(j.updated_at)}</p></div><StatusBadge status={j.status} /></li>
            ))}</ul>
          ) : <p className="card p-4 text-sm text-ink-muted">Nothing is waiting for review.</p>}
        </section>
        <section aria-labelledby="rec-h">
          <h2 id="rec-h" className="section-title mb-2">Recently changed</h2>
          {recent.data?.length ? (
            <ul className="card divide-y divide-line">{(recent.data as Recent[]).map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 p-3"><div className="min-w-0"><Link className="font-semibold text-brand-700 underline" href={`/admin/jobs/${j.id}`}>{j.title}</Link><p className="truncate text-sm text-ink-muted">{j.organization} · {formatDateTimeIST(j.updated_at)}</p></div><StatusBadge status={j.status} /></li>
            ))}</ul>
          ) : <p className="card p-4 text-sm text-ink-muted">No jobs yet. {can(staff.role, "job:create") ? <Link className="underline" href="/admin/jobs/new">Create the first one.</Link> : null}</p>}
        </section>
      </div>

      {can(staff.role, "job:expire") && (
        <section aria-labelledby="exp-h" className="card p-4">
          <h2 id="exp-h" className="font-bold">Expire overdue jobs</h2>
          <p className="mt-1 text-sm text-ink-muted">Jobs whose official last date has passed are expired automatically every day by the scheduled task, and are hidden from open listings immediately even before it runs. You can run it now.</p>
          <form action={runExpiryAction} className="mt-3"><button type="submit" className="btn btn-outline btn-sm">Run expiry now</button></form>
        </section>
      )}

      <section aria-labelledby="ops-h">
        <h2 id="ops-h" className="section-title mb-2">Content operations <Link href="/admin/health" className="ml-2 text-sm font-normal text-brand-700 underline">Content health →</Link></h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{ops.map(([k, v, href]) => (
          <Link key={k} href={href} className="card card-hover p-4"><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{k}</p><p className="mt-1 text-2xl font-extrabold text-brand-900">{v ?? "—"}</p></Link>
        ))}</div>
      </section>

      <section aria-labelledby="exam-cal-h">
        <h2 id="exam-cal-h" className="section-title mb-2">Exam Calendar</h2>
        <div className="grid grid-cols-3 gap-3">{examCalendarCards.map(([k, v, href]) => (
          <Link key={k} href={href} className="card card-hover p-4"><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{k}</p><p className="mt-1 text-2xl font-extrabold text-brand-900">{v ?? "—"}</p></Link>
        ))}</div>
      </section>

      <section aria-labelledby="gov-h">
        <h2 id="gov-h" className="section-title mb-2">Admit Cards, Results &amp; Answer Keys</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{govCards.map(([k, total, recent, href]) => (
          <Link key={k} href={href} className="card card-hover p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{k}</p>
            <p className="mt-1 text-2xl font-extrabold text-brand-900">{total ?? "—"}</p>
            <p className="mt-0.5 text-xs text-ink-muted">{recent ?? 0} released in the last 7 days</p>
          </Link>
        ))}</div>
      </section>

      <section aria-labelledby="review-h" className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="review-h" className="font-bold">Content Review</h2>
          <p className="text-sm text-ink-muted">{s?.content_review ?? 0} item{s?.content_review === 1 ? "" : "s"} waiting on an editor (recruitments, exams, admit cards, results, answer keys, exam calendar)</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">{reviewLinks.map(([label, href]) => <Link key={label} href={`${href}?status=review`} className="badge badge-neutral hover:bg-brand-50">{label}</Link>)}</div>
      </section>

      <section aria-labelledby="wf-h">
        <h2 id="wf-h" className="section-title mb-2">Workflow</h2>
        <p className="mb-2 text-sm text-ink-muted">Draft → In review → Published → Expired. Jobs cannot be published without an official source (source name, last-checked time, and a notification or website link). These rules are enforced by the database, not only by this screen.</p>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="data-table"><thead><tr><th>From</th><th>To</th><th>Needs permission</th><th>Your role</th></tr></thead>
          <tbody>{workflow.filter((w) => w.kind === "job").map((w) => <tr key={w.from + w.to}><td>{w.from}</td><td>{w.to}</td><td><code>{w.action}</code></td><td>{can(staff.role, w.action) ? "Yes" : "No"}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
