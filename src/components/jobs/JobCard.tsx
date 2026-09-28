import Link from "next/link";
import type { Job } from "@/lib/types";
import { Badge, DemoBadge } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/ui/Icon";
import { formatDate } from "@/lib/dates";
import { isNew, locationLabel, qualificationLabel, vacancyLabel } from "@/lib/format";
import { DeadlineBadge } from "./DeadlineBadge";

function Meta({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon name={icon} size={16} className="mt-0.5 shrink-0 text-brand-500" />
      <div className="min-w-0"><span className="sr-only">{label}: </span><span className="text-ink-soft">{children}</span></div>
    </div>
  );
}

export function JobCard({ job, headingAs: H = "h3" }: { job: Job; headingAs?: "h2" | "h3" }) {
  const href = `/jobs/${job.slug}`;
  return (
    <article className="card card-hover p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {isNew(job) && <Badge tone="new">New</Badge>}
        {job.status === "updated" && <Badge tone="updated">Updated</Badge>}
        <DeadlineBadge lastDate={job.lastDate} />
        {job.isDemo && <DemoBadge />}
      </div>
      <H className="mt-2 text-lg font-bold leading-snug"><Link href={href} className="text-brand-900 hover:text-brand-600 hover:underline">{job.title}</Link></H>
      <p className="text-sm font-medium text-ink-muted">{job.organization}</p>

      <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        <Meta icon="pin" label="Location">{locationLabel(job)}</Meta>
        <Meta icon="cap" label="Qualification">{qualificationLabel(job)}</Meta>
        <Meta icon="users" label="Vacancies">{vacancyLabel(job.vacancies)}</Meta>
        <Meta icon="clock" label="Last date">Last Date: <strong className="text-ink">{job.lastDate ? formatDate(job.lastDate, { short: true }) : "Not announced"}</strong></Meta>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
        <p className="text-xs text-ink-muted">Posted: {formatDate(job.postedAt, { short: true })}</p>
        <Link href={href} className="btn btn-primary btn-sm" aria-label={`View details: ${job.title}`}>View Details</Link>
      </div>
    </article>
  );
}
