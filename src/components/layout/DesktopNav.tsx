"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { NavGroup, NavLink } from "@/config/nav";

const isGroup = (i: NavLink | NavGroup): i is NavGroup => "columns" in i || "links" in i;

export function DesktopNav({ items }: { items: (NavLink | NavGroup)[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLUListElement>(null);
  const pathname = usePathname();

  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) { setPrevPath(pathname); setOpen(null); } // close on navigation
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);

  const linkCls = "flex min-h-11 items-center whitespace-nowrap rounded-md px-2.5 text-sm font-semibold text-ink-soft hover:bg-brand-50 hover:text-brand-800 xl:px-3";

  return (
    <ul ref={ref} className="flex items-center gap-0.5">
      {items.map((item) => {
        if (!isGroup(item)) {
          const active = item.href === "/" ? pathname === "/" : pathname === item.href;
          return <li key={item.label} className={item.xlOnly ? "hidden xl:block" : undefined}><Link href={item.href} aria-current={active ? "page" : undefined} className={`${linkCls} ${active ? "bg-brand-50 text-brand-800" : ""}`}>{item.label}</Link></li>;
        }
        const isOpen = open === item.label;
        const panelId = `menu-${item.label.replace(/\W+/g, "-").toLowerCase()}`;
        return (
          <li key={item.label} className="relative">
            <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => setOpen(isOpen ? null : item.label)} className={`${linkCls} gap-1 ${isOpen ? "bg-brand-50 text-brand-800" : ""}`}>
              {item.label}<Icon name="down" size={16} className={isOpen ? "rotate-180" : ""} />
            </button>
            {isOpen && (
              <div id={panelId} className={`card absolute left-0 top-full z-50 mt-1 p-4 shadow-pop ${item.columns ? "w-[min(46rem,90vw)]" : "w-56"}`}>
                {item.columns ? (
                  <div className="grid grid-cols-3 gap-6">
                    {item.columns.map((col) => (
                      <div key={col.title}>
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">{col.title}</p>
                        <ul>{col.links.map((l) => <li key={l.href}><Link href={l.href} className="block rounded px-2 py-1.5 text-sm text-ink-soft hover:bg-brand-50 hover:text-brand-800">{l.label}</Link></li>)}</ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul>{item.links!.map((l) => <li key={l.href} className={l.xlOnly ? "xl:hidden" : undefined}><Link href={l.href} className="block rounded px-2 py-2 text-sm text-ink-soft hover:bg-brand-50 hover:text-brand-800">{l.label}</Link></li>)}</ul>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
