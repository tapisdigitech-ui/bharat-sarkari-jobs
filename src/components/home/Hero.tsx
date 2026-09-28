import Link from "next/link";
import { SearchBar } from "@/components/layout/SearchBar";
import { popularSearches } from "@/config/nav";
import { Icon } from "@/components/ui/Icon";

export function Hero() {
  return (
    <section aria-labelledby="hero-h" className="bg-brand-800 text-white">
      <div className="container-page py-10 md:py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h1 id="hero-h" className="text-[1.75rem] font-extrabold leading-tight md:text-5xl">Find Government Jobs Across India</h1>
          <p className="mx-auto mt-3 max-w-2xl text-[15px] text-brand-100 md:text-lg">
            Central • State • District • PSU • Police • Teaching • Defence • Anganwadi • Banking • Railways &amp; More
          </p>
          <div className="mt-6 md:mt-8"><SearchBar size="lg" id="hero-search" placeholder="Search by job title, department, qualification or state…" /></div>
          <div className="mt-4 flex flex-col items-center gap-3">
            <Link href="#alerts" className="btn btn-outline border-white/60 bg-transparent text-white hover:bg-white/10 hover:text-white"><Icon name="bell" size={18} /> Get Job Alerts</Link>
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
              <span className="text-brand-200">Popular:</span>
              {popularSearches.map((s) => (
                <Link key={s} href={`/jobs?q=${encodeURIComponent(s)}`} className="inline-flex min-h-9 items-center rounded-full border border-white/30 bg-white/10 px-3 py-1 text-white hover:bg-white/20">{s}</Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
