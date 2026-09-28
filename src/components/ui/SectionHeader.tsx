import Link from "next/link";
import type { ReactNode } from "react";

export function SectionHeader({ title, subtitle, href, hrefLabel = "View all", id, action }: { title: string; subtitle?: string; href?: string; hrefLabel?: string; id?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1">
        <h2 id={id} className="section-title">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {action}
      {href && <Link href={href} className="shrink-0 rounded-md px-1 py-2 text-sm font-semibold text-brand-700 hover:underline">{hrefLabel} →</Link>}
    </div>
  );
}
