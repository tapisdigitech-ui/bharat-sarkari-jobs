import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { JsonLd } from "@/components/seo/JsonLd";
import { FilterDrawer } from "@/components/jobs/FilterDrawer";
import { itemListSchema } from "@/lib/seo/schema";
import { getRef } from "@/lib/data/ref";
import { govFacets, govTypes, listGov } from "@/lib/data/gov-items";
import { govPaths, type GovKind } from "@/lib/gov-types";
import { GOV_VIEWS, govQuery, parseGovParams, type RawParams } from "@/lib/gov-params";
import { GovCard } from "./GovCard";

const Select = ({ name, label, value, children }: { name: string; label: string; value?: string; children: React.ReactNode }) => (
  <div><label htmlFor={`g-${name}`} className="mb-1 block text-sm font-semibold text-ink-soft">{label}</label><select id={`g-${name}`} name={name} defaultValue={value ?? ""} className="input">{children}</select></div>
);

const COPY: Record<GovKind, { title: string; intro: string; recent: string; noun: string }> = {
  admit_card: { title: "Admit Card", intro: "Hall ticket releases for government exams. Downloads happen on the official website — every card links to it directly. Dates marked “Expected” are our estimate, not an official announcement.", recent: "Released within", noun: "admit card" },
  result: { title: "Results", intro: "Latest government exam results, merit lists and cut-offs. The official result link comes first; we never host result files.", recent: "Result date within", noun: "result" },
  answer_key: { title: "Answer Key", intro: "Provisional and final answer keys, response sheets and objection windows — with the official links up front.", recent: "Released within", noun: "answer key" },
};

/** Shared server-rendered listing for admit cards, results and answer keys. Filters live in the URL. */
export async function GovListPage({ kind, params }: { kind: GovKind; params: RawParams }) {
  const { filters, page: want } = parseGovParams(kind, params);
  const path = govPaths[kind].list, copy = COPY[kind];
  const [res, facets, ref, types] = await Promise.all([listGov(kind, filters, { page: want, pageSize: 12 }), govFacets(kind), getRef(), govTypes(kind)]);
  const views = GOV_VIEWS[kind];
  const activeCount = Object.entries(filters).filter(([k, v]) => v !== undefined && k !== "q" && k !== "view").length;

  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: copy.title, href: path }]} />
      <h1 className="mb-1 mt-3 text-2xl font-extrabold md:text-3xl">{copy.title}</h1>
      <p className="mb-4 max-w-3xl text-ink-muted">{copy.intro}</p>

      {views.length > 0 && (
        <nav aria-label={`${copy.title} views`} className="mb-4 flex flex-wrap gap-2">
          {views.map((v) => {
            const active = (filters.view ?? "") === v.value;
            return <Link key={v.value || "latest"} href={`${path}${govQuery(kind, filters, 1, { view: v.value || undefined })}`} aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${active ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white hover:border-brand-300"}`}>{v.label}</Link>;
          })}
        </nav>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[18rem_1fr]">
        <aside aria-label="Filters"><div className="lg:sticky lg:top-40">
          <FilterDrawer activeCount={activeCount}>
            <form action={path} method="get" className="card space-y-4 p-4" aria-label={`Filter ${copy.title.toLowerCase()}`}>
              {filters.view && <input type="hidden" name="view" value={filters.view} />}
              <div><label htmlFor="g-q" className="mb-1 block text-sm font-semibold text-ink-soft">Search</label><input id="g-q" name="q" defaultValue={filters.q ?? ""} className="input" placeholder="e.g. constable, tier-1" /></div>
              <Select name="organization" label="Organization" value={filters.organization}><option value="">All organizations</option>{facets.organizations.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}</Select>
              <Select name="exam" label="Exam" value={filters.exam}><option value="">All exams</option>{facets.exams.map((e) => <option key={e.slug} value={e.slug}>{e.name}</option>)}</Select>
              <Select name="state" label="State / UT" value={filters.state}><option value="">All locations</option><option value="all-india">All India</option>{ref.states.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</Select>
              <Select name="department" label="Department" value={filters.department}><option value="">All departments</option>{ref.departments.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}</Select>
              {types.length > 0 && <Select name="type" label={kind === "result" ? "Result type" : "Answer key type"} value={filters.type}><option value="">All types</option>{types.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</Select>}
              {kind === "admit_card" && <Select name="availability" label="Admit card status" value={filters.availability}><option value="">Any</option><option value="released">Released</option><option value="upcoming">Not released yet</option></Select>}
              <Select name="within" label={copy.recent} value={filters.within?.toString()}><option value="">Any time</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></Select>
              <Select name="exam_when" label="Exam date (official dates only)" value={filters.examWhen}><option value="">Any</option><option value="upcoming">Upcoming</option><option value="next30">Next 30 days</option><option value="past">Already held</option></Select>
              <div className="flex gap-2 pt-1"><button type="submit" className="btn btn-primary flex-1">Apply filters</button><Link href={path} className="btn btn-outline">Reset</Link></div>
            </form>
          </FilterDrawer>
        </div></aside>

        <section aria-label={`${copy.title} list`} aria-live="polite">
          <p className="mb-3 text-sm text-ink-muted" role="status">
            {res.total === 0 ? `No ${copy.noun}s match` : `${res.total} ${res.total === 1 ? copy.noun : `${copy.noun}s`}`}
            {res.pageCount > 1 ? ` · page ${res.page} of ${res.pageCount}` : ""}
          </p>
          {res.items.length === 0 ? (
            <EmptyState title={activeCount || filters.q || filters.view ? `No ${copy.noun}s match these filters` : `No ${copy.noun}s published yet`} body="Try removing a filter, or browse open government jobs." actionHref={activeCount || filters.q || filters.view ? path : "/jobs"} actionLabel={activeCount || filters.q || filters.view ? "Clear filters" : "Browse jobs"} />
          ) : (
            <>
              <JsonLd data={itemListSchema(`${copy.title} listings`, res.items.map((i) => ({ name: i.title, href: govPaths[kind].detail(i.slug) })))} />
              <ul className="grid gap-3">{res.items.map((i) => <li key={i.id}><GovCard item={i} /></li>)}</ul>
              <Pagination page={res.page} pageCount={res.pageCount} hrefFor={(p) => `${path}${govQuery(kind, filters, p)}`} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
