import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the Supabase session fresh for /admin and does an OPTIMISTIC redirect for signed-out visitors.
 * This is a convenience, not the security boundary: every admin page/action re-verifies the user
 * (auth.getUser) and role, and the database enforces RLS regardless.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname } = request.nextUrl;
  if (!url || !anon) return NextResponse.next();   // Supabase not configured: pages render their own setup notice

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" }));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();

  const isLogin = pathname === "/admin/login";
  if (!user && !isLogin) {
    const login = new URL("/admin/login", request.url);
    login.searchParams.set("next", pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return response;
}

export const config = { matcher: ["/admin/:path*"] };
