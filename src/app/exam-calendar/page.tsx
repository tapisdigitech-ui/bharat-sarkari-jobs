import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { JsonLd } from "@/components/seo/JsonLd";
import { FilterDrawer } from "@/components/jobs/FilterDrawer";
import { CalendarCard, CalendarTable } from "@/components/gov/CalendarView";
import { calendarFacets, listCalendar } from "@/lib/data/gov-calendar";
import { getRef } from "@/lib/data/ref";
import { itemListSchema } from "@/lib/seo/schema";
import { buildMetadata } from "@/lib/seo/metadata";
import { CALENDAR_VIEWS, calendarQuery, parseCalendarParams, type RawParams } from "@/lib/gov-params";
import { EXAM_TYPE_LABEL } from "@/lib/gov-types";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<RawParams> };
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { filters, page } = parseCalendarParams(await searchParams);
  const filtered = Object.keys(filters).length > 0 || page > 1;
  return buildMetadata({ title: "Government Exam Calendar", description: "Upcoming government exam dates, application last dates, admit card and result dates — every date marked Official or Expected.", path: "/exam-calendar", noindex: filtered });
}

const Select = ({ name, label, value, children }: { name: string; label: string; value?: string; children: React.ReactNode }) => (
  <div><label htmlFor={`c-${name}`} className="mb-1 block text-sm font-semibold text-ink-soft">{label}</label><select id={`c-${name}`} name={name} defaultValue={value ?? ""} className="input">{children}</select></div>
);

export default async function ExamCalendarPage({ searchParams }: Props) {
  const { filters, page: want } = parseCalendarParams(await searchParams);
  const [res, facets, ref] = await Promise.all([listCalendar(filters, { page: want, pageSize: 20 }), calendarFacets(), getRef()]);
  const path = "/exam-calendar";
  const activeCount = Object.entries(filters).filter(([k, v]) => v !== undefined && k !== "q" && k !== "view").length;
  const narrowed = activeCount > 0 || !!filters.q;
  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: "Exam Calendar", href: path }]} />
      <h1 className="mb-1 mt-3 text-2xl font-extrabold md:text-3xl">Government Exam Calendar</h1>
      <p className="mb-4 max-w-3xl text-ink-muted">Every date is marked <strong>Official</strong> (confirmed by the organization) or <strong>Expected</strong> (our estimate — never shown as an exact day). Always confirm dates on the official website.</p>

      <nav aria-label="Calendar views" className="mb-4 flex flex-wrap gap-2">
        {CALENDAR_VIEWS.map((v) => { const active = (filters.view ?? "") === v.value;
          return <Link key={v.value || "upcoming"} href={`${path}${calendarQuery(filters, 1, { view: v.value || undefined })}`} aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${active ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white hover:border-brand-300"}`}>{v.label}</Link>; })}
      </nav>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[18rem_1fr]">
        <aside aria-label="Filters"><div className="lg:sticky lg:top-40">
          <FilterDrawer activeCount={activeCount}>
            <form action={path} method="get" className="card space-y-4 p-4" aria-label="Filter exam calendar">
              {filters.view && <input type="hidden" name="view" value={filters.view} />}
              <div><label htmlFor="c-q" className="mb-1 block text-sm font-semibold text-ink-soft">Search</label><input id="c-q" name="q" defaultValue={filters.q ?? ""} className="input" placeholder="e.g. constable" /></div>
              <Select name="organization" label="Organization" value={filters.organization}><option value="">All organizations</option>{facets.organizations.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}</Select>
              <Select name="exam_type" label="Exam type" value={filters.examType}><option value="">All types</option>{Object.entries(EXAM_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
              <Select name="state" label="State / UT" value={filters.state}><option value="">All locations</option><option value="all-india">All India</option>{ref.states.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</Select>
              <div className="flex gap-2 pt-1"><button type="submit" className="btn btn-primary flex-1">Apply filters</button><Link href={path} className="btn btn-outline">Reset</Link></div>
            </form>
          </FilterDrawer>
        </div></aside>

        <section aria-label="Exam calendar list" aria-live="polite">
          <p className="mb-3 text-sm text-ink-muted" role="status">{res.total === 0 ? "No exams match" : `${res.total} ${res.total === 1 ? "exam" : "exams"}`}{res.pageCount > 1 ? ` · page ${res.page} of ${res.pageCount}` : ""}</p>
          {res.items.length === 0 ? (
            <EmptyState title={narrowed ? "No exams match these filters" : filters.view === "past" ? "No past exams listed" : "No exam dates published yet"} body="Dates appear here once they are published from an official source." actionHref={narrowed ? path : "/jobs"} actionLabel={narrowed ? "Clear filters" : "Browse jobs"} />
          ) : (
            <>
              <JsonLd data={itemListSchema("Government exam calendar", res.items.map((i) => ({ name: i.title, href: i.examSlug ? `/exams/${i.examSlug}` : path })))} />
              <CalendarTable items={res.items} />
              <ul className="grid gap-3 md:hidden">{res.items.map((c) => <li key={c.id}><CalendarCard c={c} /></li>)}</ul>
              <Pagination page={res.page} pageCount={res.pageCount} hrefFor={(p) => `${path}${calendarQuery(filters, p)}`} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
