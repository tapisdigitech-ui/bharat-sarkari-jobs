import type { Job } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";
import { linkHost } from "@/lib/trust";

/** External, official destinations — visually distinct from internal site navigation. */
export function OfficialLinks({ job, compact = false }: { job: Job; compact?: boolean }) {
  const items = [
    { label: "Apply Online", url: job.source.applyUrl, cls: "btn-accent" },
    { label: "Official Notification", url: job.source.notificationUrl, cls: "btn-primary" },
    { label: "Official Website", url: job.source.websiteUrl, cls: "btn-outline" },
  ];
  return (
    <div className={compact ? "" : "rounded-lg border-2 border-dashed border-brand-200 bg-brand-50/50 p-3"}>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-800"><Icon name="external" size={14} /> Official links · open on external sites</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {items.map((it) => it.url ? (
          <div key={it.label} className="flex flex-col">
            <a href={it.url} target="_blank" rel="noopener noreferrer" className={`btn ${it.cls}`}>{it.label}<Icon name="external" size={16} /></a>
            {!compact && linkHost(it.url) && <span className="mt-0.5 text-center text-xs text-ink-muted">{linkHost(it.url)}</span>}
          </div>
        ) : (
          <span key={it.label} aria-disabled="true" className="btn cursor-not-allowed border border-line bg-white text-ink-muted" title="No official link has been recorded for this item">{it.label}<span className="text-xs font-normal">(not available)</span></span>
        ))}
      </div>
    </div>
  );
}
