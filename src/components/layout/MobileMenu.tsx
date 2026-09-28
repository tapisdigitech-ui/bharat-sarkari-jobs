"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { SearchBar } from "./SearchBar";
import type { NavGroup, NavLink } from "@/config/nav";

/** Flat, de-duplicated link list for the phone drawer (groups are expanded; mega-menu columns are replaced by directory pages). */
function flatten(items: (NavLink | NavGroup)[]): NavLink[] {
  const out: NavLink[] = [];
  const seen = new Set<string>();
  const add = (l: NavLink) => { if (!seen.has(l.href)) { seen.add(l.href); out.push({ label: l.label, href: l.href }); } };
  for (const i of items) {
    if ("columns" in i && i.columns) { add({ label: "Latest Jobs", href: "/jobs" }); add({ label: "Jobs by Department", href: "/department" }); add({ label: "Jobs by Qualification", href: "/qualification" }); }
    else if ("links" in i && i.links) i.links.forEach(add);
    else if (i.href) add({ label: i.label, href: i.href });
  }
  return out;
}

/** Mobile: search toggle + hamburger drawer. Kept deliberately flat and simple. */
export function MobileMenu({ items }: { items: (NavLink | NavGroup)[] }) {
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const pathname = usePathname();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) { setPrevPath(pathname); setMenu(false); setSearch(false); } // close on navigation
  useEffect(() => {
    if (!menu) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [menu]);

  const links = flatten(items);
  const iconBtn = "grid h-11 w-11 place-items-center rounded-lg text-ink-soft hover:bg-brand-50";

  return (
    <div className="flex items-center lg:hidden">
      <button type="button" className={iconBtn} aria-label="Search" aria-expanded={search} aria-controls="mobile-search" onClick={() => setSearch((s) => !s)}><Icon name="search" size={22} /></button>
      <button type="button" className={iconBtn} aria-label="Open menu" aria-expanded={menu} aria-controls="mobile-drawer" onClick={() => setMenu(true)}><Icon name="menu" size={24} /></button>

      {search && (
        <div id="mobile-search" className="absolute inset-x-0 top-full border-b border-line bg-white px-4 py-3 shadow-card">
          <SearchBar id="mobile-site-search" autoFocus placeholder="Search jobs, states, exams…" />
        </div>
      )}

      {menu && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Main menu" id="mobile-drawer">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setMenu(false)} />
          <div className="absolute right-0 top-0 flex h-full w-[86%] max-w-sm flex-col bg-white shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <span className="font-bold text-brand-900">Menu</span>
              <button ref={closeRef} type="button" className={iconBtn} aria-label="Close menu" onClick={() => setMenu(false)}><Icon name="close" size={22} /></button>
            </div>
            <nav aria-label="Mobile" className="flex-1 overflow-y-auto p-2">
              <ul>
                {links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className={`flex min-h-12 items-center justify-between rounded-lg px-3 font-medium hover:bg-brand-50 ${pathname === l.href ? "bg-brand-50 text-brand-800" : "text-ink"}`}>
                      {l.label}<Icon name="right" size={18} className="text-ink-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
              <Link href="/login" className="btn btn-outline">Login</Link>
              <Link href="/register" className="btn btn-primary">Register</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
