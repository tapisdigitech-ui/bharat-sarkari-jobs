import { Icon } from "@/components/ui/Icon";

/** Plain GET form: works without JavaScript. Results are server-rendered at /search — one place that covers
 * jobs, recruitments, exams, admit cards, results, answer keys and organizations (the site's global search). */
export function SearchBar({ defaultValue = "", size = "md", placeholder = "Search by job title, department, qualification or state…", autoFocus = false, id = "site-search" }: { defaultValue?: string; size?: "md" | "lg"; placeholder?: string; autoFocus?: boolean; id?: string }) {
  const lg = size === "lg";
  return (
    <form role="search" action="/search" method="get" className="w-full">
      <label htmlFor={id} className="sr-only">Search government jobs</label>
      <div className={`flex w-full items-stretch overflow-hidden rounded-xl border-2 border-brand-200 bg-white focus-within:border-brand-500 ${lg ? "shadow-pop" : ""}`}>
        <span className="grid place-items-center pl-3 text-ink-muted"><Icon name="search" size={lg ? 22 : 18} /></span>
        <input id={id} name="q" type="search" defaultValue={defaultValue} placeholder={placeholder} autoComplete="off" enterKeyHint="search" autoFocus={autoFocus}
          className={`min-w-0 flex-1 bg-transparent px-3 text-ink outline-none placeholder:text-ink-muted ${lg ? "min-h-14 text-base md:text-lg" : "min-h-11 text-[15px]"}`} />
        {/* accent-700 (not -600): white text on -600 falls short of WCAG AA contrast for the visible "Search Jobs" label at the lg size. */}
        <button type="submit" aria-label="Search jobs" className={`shrink-0 bg-accent-700 px-4 font-semibold text-white hover:opacity-90 ${lg ? "md:px-8" : ""}`}>
          <span className={lg ? "hidden md:inline" : "sr-only"}>Search Jobs</span>
          <Icon name="search" size={20} className={lg ? "md:hidden" : ""} />
        </button>
      </div>
    </form>
  );
}
