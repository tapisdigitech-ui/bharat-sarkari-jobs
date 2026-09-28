import Link from "next/link";
import type { Department, Qualification, State } from "@/lib/types";
import { Icon, type IconName } from "@/components/ui/Icon";

export function StateCard({ state, count }: { state: State; count?: number }) {
  return (
    <Link href={`/state/${state.slug}/jobs`} className="card card-hover flex min-h-14 items-center justify-between gap-2 px-3.5 py-3">
      <span className="min-w-0"><span className="block truncate font-semibold text-brand-900">{state.name}</span>
        <span className="block text-xs text-ink-muted">{count ? `${count} open ${count === 1 ? "job" : "jobs"}` : state.kind === "ut" ? "Union Territory" : "State"}</span></span>
      <Icon name="right" size={16} className="shrink-0 text-ink-muted" />
    </Link>
  );
}

export function DepartmentCard({ dept, count }: { dept: Department; count?: number }) {
  return (
    <Link href={`/department/${dept.slug}`} className="card card-hover flex min-h-14 items-center gap-3 px-3.5 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon name="building" size={18} /></span>
      <span className="min-w-0"><span className="block truncate font-semibold text-brand-900">{dept.name}</span>
        {count !== undefined && <span className="block text-xs text-ink-muted">{count ? `${count} open` : "No open jobs"}</span>}</span>
    </Link>
  );
}

export function QualificationCard({ q, count }: { q: Qualification; count?: number }) {
  return (
    <Link href={`/qualification/${q.slug}`} className="card card-hover flex min-h-14 items-center gap-3 px-3.5 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-600"><Icon name="cap" size={18} /></span>
      <span className="min-w-0"><span className="block truncate font-semibold text-brand-900">{q.name}</span>
        {count !== undefined && <span className="block text-xs text-ink-muted">{count ? `${count} open` : "No open jobs"}</span>}</span>
    </Link>
  );
}

export function TileLink({ href, icon, title, desc, tone = "brand" }: { href: string; icon: IconName; title: string; desc?: string; tone?: "brand" | "accent" | "danger" }) {
  const tones = { brand: "bg-brand-50 text-brand-700", accent: "bg-accent-50 text-accent-600", danger: "bg-danger-50 text-danger-600" };
  return (
    <Link href={href} className="card card-hover flex h-full min-h-24 flex-col items-start gap-2 p-4">
      <span className={`grid h-10 w-10 place-items-center rounded-xl ${tones[tone]}`}><Icon name={icon} size={22} /></span>
      <span className="font-bold text-brand-900">{title}</span>
      {desc && <span className="text-sm text-ink-muted">{desc}</span>}
    </Link>
  );
}
