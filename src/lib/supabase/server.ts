import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "@/lib/env";

/**
 * Session-aware client for Server Components, Server Actions and Route Handlers.
 * It carries the signed-in user's JWT, so every query runs under that user's RLS policies.
 */
export async function createSupabaseServerClient() {
  const { url, anon } = supabaseEnv();
  const store = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, { ...options, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" })); }
        catch { /* called from a Server Component: cookies are refreshed by proxy.ts instead */ }
      },
    },
  });
}
