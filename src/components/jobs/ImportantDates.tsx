import type { ImportantDate } from "@/lib/types";
import { formatDate } from "@/lib/dates";

export function ImportantDates({ dates }: { dates: ImportantDate[] }) {
  return (
    <dl className="divide-y divide-line rounded-md border border-line">
      {dates.map((d) => (
        <div key={d.label} className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-baseline sm:justify-between">
          <dt className="text-sm text-ink-soft">{d.label}</dt>
          <dd className="font-semibold">
            {d.status === "expected" ? <><span className="mr-2 inline-flex rounded-full bg-warning-50 px-2 py-0.5 text-xs font-bold text-warning-700">Expected</span><span>{d.expectedText ?? "to be announced"}</span></>
              : d.date ? <>{d.status === "official" && <span className="mr-2 inline-flex rounded-full bg-success-50 px-2 py-0.5 text-xs font-bold text-success-700">Official</span>}{formatDate(d.date)}</>
              : <span className="font-medium text-ink-muted">{d.note ?? "To be announced"}</span>}
            {d.date && d.note ? <span className="ml-2 text-sm font-normal text-ink-muted">({d.note})</span> : null}</dd>
        </div>
      ))}
    </dl>
  );
}
