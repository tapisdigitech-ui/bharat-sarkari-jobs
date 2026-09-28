import Link from "next/link";
import type { Job } from "@/lib/types";
import { deadlineStatus } from "@/lib/dates";
import { locationLabel, qualificationLabel } from "@/lib/format";
import { EmptyState } from "@/components/ui/EmptyState";

export function ClosingSoonList({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) return <EmptyState title="Nothing closing in the next 7 days" body="Check the latest jobs for open applications." actionHref="/jobs" actionLabel="Browse latest jobs" />;
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {jobs.map((j) => {
        const d = deadlineStatus(j.lastDate);
        const urgent = d.state === "today" || d.state === "tomorrow" || (d.daysLeft !== null && d.daysLeft <= 3);
        return (
          <li key={j.id}>
            <Link href={`/jobs/${j.slug}`} className="flex items-center gap-3 p-3.5 hover:bg-brand-50">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-brand-900">{j.title}</p>
                <p className="truncate text-xs text-ink-muted">{locationLabel(j)} · {qualificationLabel(j)}</p>
              </div>
              <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold ${urgent ? "bg-danger-50 text-danger-700" : "bg-accent-50 text-accent-700"}`}>{d.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
