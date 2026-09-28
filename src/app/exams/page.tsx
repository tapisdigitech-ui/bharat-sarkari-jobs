import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { JsonLd } from "@/components/seo/JsonLd";
import { examFacets, listExamHubs } from "@/lib/data/gov-exams";
import { buildMetadata } from "@/lib/seo/metadata";
import { itemListSchema } from "@/lib/seo/schema";
import { EXAM_TYPE_LABEL, type ExamType } from "@/lib/gov-types";
import type { RawParams } from "@/lib/gov-params";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<RawParams> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parse(p: RawParams) {
  const q = one(p.q).trim().slice(0, 80).replace(/\s+/g, " ");
  const org = SLUG.test(one(p.organization)) ? one(p.organization) : "";
  const t = one(p.type) as ExamType;
  const type = t in EXAM_TYPE_LABEL ? t : undefined;
  return { f: { q: q || undefined, organization: org || undefined, type }, page: Math.max(1, Math.min(500, Number.parseInt(one(p.page), 10) || 1)) };
}
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { f, page } = parse(await searchParams);
  return buildMetadata({ title: "Government Exams — Jobs, Dates, Admit Card & Result", description: "Exam hubs: latest jobs, important dates, admit card, answer key and result for each government exam, with official links.", path: "/exams", noindex: !!(f.q || f.organization || f.type || page > 1) });
}

export default async function ExamsPage({ searchParams }: Props) {
  const { f, page: want } = parse(await searchParams);
  const [res, facets] = await Promise.all([listExamHubs(f, { page: want, pageSize: 24 }), examFacets()]);
  const q = (over: Record<string, string | undefined>) => { const u = new URLSearchParams(); const m = { q: f.q, organization: f.organization, type: f.type, ...over }; for (const [k, v] of Object.entries(m)) if (v) u.set(k, v); const s = u.toString(); return s ? `?${s}` : ""; };
  const filtered = !!(f.q || f.organization || f.type);
  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: "Exams", href: "/exams" }]} />
      <h1 className="mb-1 mt-3 text-2xl font-extrabold md:text-3xl">Government Exams</h1>
      <p className="mb-4 max-w-3xl text-ink-muted">One hub per exam — latest jobs, important dates, admit card, answer key and result in one place, each linking to the official website.</p>
      <form action="/exams" method="get" role="search" aria-label="Filter exams" className="card mb-5 grid grid-cols-1 gap-3 p-3 md:grid-cols-[1fr_14rem_14rem_auto]">
        <div><label htmlFor="ex-q" className="mb-1 block text-sm font-semibold text-ink-soft">Search</label><input id="ex-q" name="q" defaultValue={f.q ?? ""} className="input" placeholder="e.g. constable" /></div>
        <div><label htmlFor="ex-org" className="mb-1 block text-sm font-semibold text-ink-soft">Organization</label><select id="ex-org" name="organization" defaultValue={f.organization ?? ""} className="input"><option value="">All organizations</option>{facets.organizations.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}</select></div>
        <div><label htmlFor="ex-type" className="mb-1 block text-sm font-semibold text-ink-soft">Exam type</label><select id="ex-type" name="type" defaultValue={f.type ?? ""} className="input"><option value="">All types</option>{Object.entries(EXAM_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="flex items-end gap-2"><button type="submit" className="btn btn-primary">Apply</button><Link href="/exams" className="btn btn-outline">Reset</Link></div>
      </form>
      <p className="mb-3 text-sm text-ink-muted" role="status">{res.total === 0 ? "No exams match" : `${res.total} ${res.total === 1 ? "exam" : "exams"}`}{res.pageCount > 1 ? ` · page ${res.page} of ${res.pageCount}` : ""}</p>
      {res.items.length === 0 ? <EmptyState title={filtered ? "No exams match these filters" : "No exam hubs published yet"} body="Exam hubs appear once they are published from an official source." actionHref={filtered ? "/exams" : "/jobs"} actionLabel={filtered ? "Clear filters" : "Browse jobs"} /> : (
        <>
          <JsonLd data={itemListSchema("Government exams", res.items.map((e) => ({ name: e.name, href: `/exams/${e.slug}` })))} />
          <ul className="grid gap-3 md:grid-cols-2">
            {res.items.map((e) => (
              <li key={e.id}><Link href={`/exams/${e.slug}`} className="card card-hover block p-4" data-testid="exam-card">
                <span className="flex flex-wrap items-center gap-1.5"><Badge tone="neutral">{EXAM_TYPE_LABEL[e.examType]}</Badge>{e.isDemo && <DemoBadge />}</span>
                <span className="mt-1 block font-bold text-brand-900">{e.name}</span><span className="block text-sm text-ink-muted">{e.organization}</span></Link></li>
            ))}
          </ul>
          <Pagination page={res.page} pageCount={res.pageCount} hrefFor={(p) => `/exams${q({ page: p > 1 ? String(p) : undefined })}`} />
        </>
      )}
    </div>
  );
}
