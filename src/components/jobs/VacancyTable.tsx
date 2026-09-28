import type { VacancyRow } from "@/lib/types";

/** Table on ≥sm, stacked label/value list on phones (no horizontal scrolling). */
export function VacancyTable({ rows }: { rows: VacancyRow[] }) {
  const total = rows.every((r) => r.count !== null) ? rows.reduce((s, r) => s + (r.count ?? 0), 0) : null;
  return (
    <>
      <div className="table-wrap hidden sm:block" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="data-table">
          <caption className="sr-only">Vacancy details</caption>
          <thead><tr><th scope="col">Post</th><th scope="col">Category</th><th scope="col" className="text-right">Vacancies</th></tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i}><td>{r.post}</td><td>{r.category ?? "—"}</td><td className="text-right font-semibold">{r.count === null ? "Not specified" : r.count.toLocaleString("en-IN")}</td></tr>)}
            {total !== null && rows.length > 1 && <tr><td colSpan={2} className="font-semibold">Total</td><td className="text-right font-bold">{total.toLocaleString("en-IN")}</td></tr>}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 sm:hidden">
        {rows.map((r, i) => (
          <li key={i} className="rounded-md border border-line p-3 text-sm">
            <p className="font-semibold">{r.post}</p>
            <p className="text-ink-muted">{r.category ? `${r.category} · ` : ""}{r.count === null ? "Vacancies not specified" : `${r.count.toLocaleString("en-IN")} posts`}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
