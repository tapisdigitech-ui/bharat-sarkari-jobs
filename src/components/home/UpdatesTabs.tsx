"use client";
import { useState } from "react";
import Link from "next/link";
import type { SiteUpdate, UpdateKind } from "@/lib/types";
import { formatDate } from "@/lib/dates";

/** Compact, tabbed "Latest Government Updates" — Jobs / Admit Cards / Results / Answer Keys — one panel at a
 * time so the homepage stays short even though four content types feed it. All data is fetched server-side
 * (see HomePage); this component only switches which already-loaded list is visible. */
const TABS: { kind: UpdateKind; label: string; empty: string }[] = [
  { kind: "job", label: "Jobs", empty: "No new job notifications yet." },
  { kind: "admit-card", label: "Admit Cards", empty: "No admit cards released yet." },
  { kind: "result", label: "Results", empty: "No results published yet." },
  { kind: "answer-key", label: "Answer Keys", empty: "No answer keys released yet." },
];

export function UpdatesTabs({ groups }: { groups: Record<UpdateKind, SiteUpdate[]> }) {
  const [active, setActive] = useState<UpdateKind>("job");
  const items = groups[active] ?? [];
  return (
    <div className="card overflow-hidden">
      <div role="tablist" aria-label="Latest government updates" className="flex flex-wrap gap-1 border-b border-line bg-[#f8fafc] p-1.5">
        {TABS.map((t) => (
          <button key={t.kind} type="button" role="tab" id={`tab-${t.kind}`} aria-selected={active === t.kind} aria-controls={`panel-${t.kind}`}
            onClick={() => setActive(t.kind)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${active === t.kind ? "bg-white text-brand-800 shadow-sm" : "text-ink-muted hover:text-ink-soft"}`}>
            {t.label}{groups[t.kind]?.length ? <span className="ml-1 text-xs text-ink-muted">({groups[t.kind].length})</span> : null}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t.kind} role="tabpanel" id={`panel-${t.kind}`} aria-labelledby={`tab-${t.kind}`} hidden={active !== t.kind}>
          {(groups[t.kind]?.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-ink-muted">{t.empty}</p>
          ) : (
            <ul className="divide-y divide-line">
              {(active === t.kind ? items : []).map((u) => (
                <li key={u.id}>
                  <Link href={u.href} className="flex items-center gap-3 p-3 hover:bg-brand-50">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{u.title}</span>
                    <span className="shrink-0 text-xs text-ink-muted">{formatDate(u.date, { short: true })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
