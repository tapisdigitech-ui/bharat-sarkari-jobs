import Link from "next/link";
import { buildFooterColumns, legalLinks } from "@/config/nav";
import { getRefSafe } from "@/lib/data/ref";
import { site } from "@/config/site";
import { Logo } from "./Logo";

export async function Footer() {
  const footerColumns = buildFooterColumns(await getRefSafe());
  const socials = Object.entries(site.social).filter(([, url]) => url);
  return (
    <footer className="mt-16 border-t border-line bg-brand-900 text-brand-100">
      <div className="container-page py-10">
        <div className="grid gap-8 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <div className="[&_*]:!text-white"><Logo /></div>
            <p className="mt-3 max-w-xs text-sm text-brand-200">{site.positioning}</p>
            {socials.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-3 text-sm">
                {socials.map(([name, url]) => <li key={name}><a href={url} rel="noopener noreferrer" target="_blank" className="underline capitalize">{name}</a></li>)}
              </ul>
            )}
          </div>
          {footerColumns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="mb-3 text-sm font-bold text-white">{col.title}</p>
              <ul className="space-y-1">
                {col.links.map((l) => <li key={l.label}><Link href={l.href} className="inline-block py-1 text-sm text-brand-200 hover:text-white hover:underline">{l.label}</Link></li>)}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-brand-700 bg-brand-800/60 p-4 text-sm text-brand-100">
          <p><strong className="text-white">Independent information platform.</strong> {site.name} {site.independenceStatement} We do not use government emblems and are not a government website.</p>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-brand-700 pt-5 text-sm text-brand-200 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} {site.name}. All rights reserved.</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {legalLinks.map((l) => <li key={l.href}><Link href={l.href} className="py-1 hover:text-white hover:underline">{l.label}</Link></li>)}
          </ul>
        </div>
      </div>
    </footer>
  );
}
