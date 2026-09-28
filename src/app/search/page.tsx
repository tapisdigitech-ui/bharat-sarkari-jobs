import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchBar } from "@/components/layout/SearchBar";
import { globalSearch, searchable, type SearchKind } from "@/lib/data/search";
import { buildMetadata } from "@/lib/seo/metadata";
import { headers } from "next/headers";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ q?: string }> };

/** A query-driven results page never has a canonical, indexable form — keep it out of the index (same rule the
 * site already applies to every filtered list page: /jobs?q=…, /exam-calendar?q=…, /exams?q=… and so on). */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = (await searchParams).q?.trim().slice(0, 120);
  return buildMetadata({ title: q ? `Search: ${q}` : "Search", description: "Search government jobs, recruitments, exams, admit cards, results, answer keys and organizations on BharatSarkariJobs.", path: "/search", noindex: true });
}

const BADGE: Record<SearchKind, string> = {
  job: "bg-brand-50 text-brand-800", recruitment: "bg-brand-50 text-brand-800", exam: "bg-accent-50 text-accent-800",
  admit_card: "bg-warning-50 text-warning-700", result: "bg-success-50 text-success-700", answer_key: "bg-warning-50 text-warning-700",
  organization: "bg-[#eef2f7] text-ink-soft",
};

export default async function SearchPage({ searchParams }: Props) {
  const raw = (await searchParams).q;
  const q = raw?.trim().slice(0, 120);
  const path = "/search";
  // Generous per-IP limit: stops scripted floods of database searches, never a person searching.
  const limited = q ? !(await rateLimit("search", clientIp(await headers()))).ok : false;
  const sections = q && !limited ? await globalSearch(q) : [];
  const total = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: "Search", href: path }]} />
      <h1 className="mb-1 mt-3 text-2xl font-extrabold md:text-3xl">Search</h1>
      <p className="mb-4 max-w-3xl text-ink-muted">Search across jobs, recruitments, exams, admit cards, results, answer keys and organizations — everything published on this site, in one place.</p>
      <div className="max-w-2xl"><SearchBar defaultValue={q ?? ""} id="search-page-q" autoFocus /></div>

      <section aria-label="Search results" aria-live="polite" className="mt-6">
        {limited ? (
          <p role="alert" className="rounded-md border border-warning-700/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">Too many searches from your connection in the last minute. Please wait a moment and try again.</p>
        ) : !searchable(q) ? (
          q ? <p className="text-sm text-ink-muted" role="status">Type at least 2 characters to search.</p>
            : <p className="text-sm text-ink-muted" role="status">Type a job title, organization, exam name or keyword above.</p>
        ) : total === 0 ? (
          <EmptyState title={`No results for "${q}"`} body="Try a different keyword, or check the spelling of the organization or exam name." actionHref="/jobs" actionLabel="Browse all jobs" />
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-muted" role="status">{total} {total === 1 ? "result" : "results"} for &ldquo;{q}&rdquo;</p>
            <ul className="space-y-2" data-testid="search-results">
              {sections.flatMap((s) => s.items).map((r, i) => (
                <li key={`${r.kind}-${i}-${r.href}`}>
                  <Link href={r.href} className="card flex flex-wrap items-center gap-x-2.5 gap-y-1 p-3.5 hover:border-brand-300" data-testid="search-result" data-kind={r.kind}>
                    <span className={`badge ${BADGE[r.kind]}`}>[{r.label.toUpperCase()}]</span>
                    <span className="font-semibold text-ink">{r.title}</span>
                    {r.subtitle && <span className="text-sm text-ink-muted">— {r.subtitle}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
