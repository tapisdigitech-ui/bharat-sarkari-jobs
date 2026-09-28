"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

export interface NavItem { label: string; href?: string; soon?: boolean }

/** Sidebar + mobile top bar. Purely presentational: authorisation happens on the server (layout, pages, actions, RLS). */
export function AdminShell({ items, who, roleLabel, signOut, children }: { items: NavItem[]; who: string; roleLabel: string; signOut: () => Promise<void>; children: React.ReactNode }) {
  const pathname = usePathname();
  const [prev, setPrev] = useState(pathname);
  const [open, setOpen] = useState(false);
  if (prev !== pathname) { setPrev(pathname); setOpen(false); }

  const active = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/"));
  const nav = (
    <nav aria-label="Admin sections" className="flex flex-col gap-0.5">
      {items.map((it) => it.soon || !it.href ? (
        <span key={it.label} aria-disabled="true" className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-ink-muted">
          {it.label}<span className="badge badge-neutral">Soon</span>
        </span>
      ) : (
        <Link key={it.label} href={it.href} aria-current={active(it.href) ? "page" : undefined}
          className={`rounded-md px-3 py-2 text-sm font-medium ${active(it.href) ? "bg-brand-600 text-white" : "text-ink-soft hover:bg-brand-50"}`}>{it.label}</Link>
      ))}
    </nav>
  );
  const account = (
    <div className="border-t border-line pt-3 text-sm">
      <p className="truncate font-semibold" title={who}>{who}</p>
      <p className="text-ink-muted">{roleLabel}</p>
      <form action={signOut} className="mt-2"><button type="submit" className="btn btn-outline btn-sm w-full">Sign out</button></form>
      <Link href="/" className="mt-2 block text-center text-xs text-ink-muted underline">View public site</Link>
    </div>
  );

  return (
    <div className="lg:grid lg:grid-cols-[15rem_1fr]">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-white px-4 py-2 lg:hidden">
        <span className="font-bold text-brand-900">Admin</span>
        <button type="button" className="btn btn-outline btn-sm" aria-expanded={open} aria-controls="admin-drawer" onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? "close" : "menu"} size={18} /> Menu
        </button>
      </header>
      {open && (
        <div id="admin-drawer" className="fixed inset-x-0 top-[53px] bottom-0 z-30 flex flex-col gap-3 overflow-y-auto bg-white p-4 lg:hidden">{nav}{account}</div>
      )}
      <aside className="sticky top-0 hidden h-screen flex-col gap-3 overflow-y-auto border-r border-line bg-white p-4 lg:flex">
        <p className="px-3 text-lg font-extrabold text-brand-900">Admin</p>
        {nav}
        <div className="mt-auto">{account}</div>
      </aside>
      <div id="main" className="min-w-0 p-4 md:p-6">{children}</div>
    </div>
  );
}
