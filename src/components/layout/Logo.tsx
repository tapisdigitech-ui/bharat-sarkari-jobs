import Link from "next/link";
import { site } from "@/config/site";

/** Text/monogram logo driven by site config — no government emblem or imagery is used. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 ${className}`} aria-label={`${site.name} home`}>
      <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-lg bg-brand-700 text-lg font-extrabold text-white">
        {site.name.charAt(0)}
        <span className="sr-only">{site.name}</span>
      </span>
      <span className="leading-tight">
        <span className="block text-[1.05rem] font-extrabold tracking-tight text-brand-900">{site.name}</span>
        <span className="hidden text-[11px] font-medium text-ink-muted sm:block">{site.tagline}</span>
      </span>
    </Link>
  );
}
