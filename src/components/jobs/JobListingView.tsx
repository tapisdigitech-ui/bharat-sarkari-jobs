import type { JobFilters as F } from "@/lib/types";
import { listJobs } from "@/lib/data";
import { getRef } from "@/lib/data/ref";
import { parseFilters, toQuery, type RawParams } from "@/lib/filters";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { AdSlot } from "@/components/ui/AdSlot";
import { JobFilters } from "./JobFilters";
import { JobList } from "./JobList";
import { JsonLd } from "@/components/seo/JsonLd";
import { itemListSchema } from "@/lib/seo/schema";

type Dim = "state" | "qualification" | "department" | "level";

/**
 * Shared server-rendered listing: URL-driven filters + pagination.
 * `fixed` pins dimensions that the landing page itself represents (e.g. the state on /state/delhi/jobs).
 */
export async function JobListingView({ basePath, params, fixed = {}, hide = [], pageSize = 10 }: { basePath: string; params: RawParams; fixed?: F; hide?: Dim[]; pageSize?: number }) {
  const parsed = parseFilters(params, await getRef());
  const filters: F = { ...parsed.filters, ...fixed };
  const { jobs, total, page, pageCount } = await listJobs(filters, { sort: parsed.sort, page: parsed.page, pageSize });

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[18rem_1fr]">
      <aside aria-label="Filters"><div className="lg:sticky lg:top-40"><JobFilters action={basePath} values={filters} sort={parsed.sort} hide={hide} /></div></aside>
      <section aria-label="Job results" aria-live="polite">
        <p className="mb-3 text-sm text-ink-muted" role="status">
          {total === 0 ? "No open jobs match" : `${total} open ${total === 1 ? "job" : "jobs"}`}{filters.q ? <> for “<strong className="text-ink">{filters.q}</strong>”</> : null}
          {pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}
        </p>
        {jobs.length === 0 ? (
          <EmptyState title="No open jobs match these filters" body="Try removing a filter, searching for a broader term, or browse by state or department." actionHref={basePath} actionLabel="Clear filters" />
        ) : (
          <>
            <JsonLd data={itemListSchema("Government job listings", jobs.map((j) => ({ name: j.title, href: `/jobs/${j.slug}` })))} />
            <JobList jobs={jobs} />
            <Pagination page={page} pageCount={pageCount} hrefFor={(p) => `${basePath}${toQuery(params, { page: p === 1 ? undefined : String(p) })}`} />
          </>
        )}
        <AdSlot placement="list-inline" className="mt-6" />
      </section>
    </div>
  );
}
