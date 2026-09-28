import { Breadcrumbs, type Crumb } from "@/components/ui/Breadcrumbs";
import Link from "next/link";

export function LandingIntro({ crumbs, title, intro, total, links }: { crumbs: Crumb[]; title: string; intro: string; total: number; links?: { label: string; href: string; count?: number }[] }) {
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <h1 className="mb-1 mt-3 text-2xl font-extrabold md:text-3xl">{title}</h1>
      <p className="max-w-3xl text-ink-muted">{intro}</p>
      <p className="mt-2 text-sm font-semibold text-brand-800">{total} open {total === 1 ? "job" : "jobs"} right now</p>
      {links && links.length > 0 && (
        <nav aria-label="Related pages" className="mb-5 mt-3 flex flex-wrap gap-2">
          {links.map((l) => <Link key={l.href} href={l.href} className="inline-flex min-h-9 items-center rounded-full border border-line bg-white px-3 text-sm font-medium text-ink-soft hover:border-brand-300 hover:text-brand-800">{l.label}{l.count ? <span className="ml-1.5 text-ink-muted">({l.count})</span> : null}</Link>)}
        </nav>
      )}
    </>
  );
}
