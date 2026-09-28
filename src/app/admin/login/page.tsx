import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth/staff";
import { supabaseConfigured } from "@/lib/env";
import { site } from "@/config/site";
import { LoginForm } from "./LoginForm";
import { safeNext } from "@/lib/auth/safe-next";

export const metadata: Metadata = { title: "Staff sign in" };
type Props = { searchParams: Promise<{ next?: string }> };

export default async function AdminLogin({ searchParams }: Props) {
  const next = safeNext((await searchParams).next);
  if (supabaseConfigured() && (await getStaff())) redirect(next);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="card p-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">{site.name}</p>
        <h1 className="mt-1 text-2xl font-extrabold">Staff sign in</h1>
        <p className="mt-1 mb-5 text-sm text-ink-muted">Restricted to authorised editors. Accounts are created by an administrator.</p>
        {supabaseConfigured()
          ? <LoginForm next={next} />
          : <p role="alert" className="rounded-md border border-warning-700/30 bg-warning-50 px-3 py-2 text-sm text-warning-700">Supabase is not configured. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then reload.</p>}
      </div>
    </main>
  );
}
