import Link from "next/link";

/** Server-rendered pagination. `hrefFor` builds the URL for a page number so filters are preserved. */
export function Pagination({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (p: number) => string }) {
  if (pageCount <= 1) return null;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1);
  const items: (number | "gap")[] = [];
  pages.forEach((p, i) => { if (i > 0 && p - pages[i - 1] > 1) items.push("gap"); items.push(p); });
  const cell = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm font-medium";
  return (
    <nav aria-label="Pagination" className="mt-6 flex flex-wrap items-center justify-center gap-2">
      {page > 1 && <Link rel="prev" href={hrefFor(page - 1)} className={`${cell} border-line bg-white hover:border-brand-300`}>← Prev</Link>}
      {items.map((it, i) => it === "gap" ? <span key={`g${i}`} aria-hidden="true" className="px-1 text-ink-muted">…</span> : (
        <Link key={it} href={hrefFor(it)} aria-current={it === page ? "page" : undefined} className={`${cell} ${it === page ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white hover:border-brand-300"}`}>{it}</Link>
      ))}
      {page < pageCount && <Link rel="next" href={hrefFor(page + 1)} className={`${cell} border-line bg-white hover:border-brand-300`}>Next →</Link>}
    </nav>
  );
}
