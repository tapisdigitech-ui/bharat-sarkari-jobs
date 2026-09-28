"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

/** Desktop: static sidebar. Mobile: bottom-sheet drawer opened by a "Filters" button. */
export function FilterDrawer({ children, activeCount = 0 }: { children: React.ReactNode; activeCount?: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="filters-panel" className="btn btn-outline w-full lg:hidden">
        <Icon name="filter" size={18} /> Filters{activeCount > 0 ? ` (${activeCount})` : ""}
      </button>
      <div id="filters-panel" role={open ? "dialog" : undefined} aria-modal={open || undefined} aria-label="Filters"
        className={`${open ? "fixed inset-0 z-[60] block" : "hidden"} lg:static lg:z-auto lg:block`}>
        <div className="absolute inset-0 bg-ink/50 lg:hidden" onClick={() => setOpen(false)} />
        <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-pop lg:static lg:max-h-none lg:overflow-visible lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none">
          <div className="mb-3 flex items-center justify-between lg:hidden">
            <p className="text-lg font-bold">Filters</p>
            <button type="button" aria-label="Close filters" className="grid h-11 w-11 place-items-center rounded-lg hover:bg-brand-50" onClick={() => setOpen(false)}><Icon name="close" /></button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}
