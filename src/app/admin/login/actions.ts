"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { log } from "@/lib/log";
import { clientIp, rateLimit, underLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { safeNext } from "@/lib/auth/safe-next";

export interface LoginState { error?: string }

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) });

export async function signInAction(_prev: LoginState, fd: FormData): Promise<LoginState> {
  if (!supabaseConfigured()) return { error: "The server is not connected to Supabase yet. See the setup guide in the README." };
  const parsed = schema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { error: "Enter a valid email address and your password." };

  const ip = clientIp(await headers());
  // Only FAILED attempts count, so staff signing in normally are never slowed down.
  const [byIp, byAccount] = [await underLimit("loginIp", ip), await underLimit("loginAccount", parsed.data.email)];
  if (!byIp.ok || !byAccount.ok) {
    log("warn", "auth.failed", { reason: "rate limited", email: parsed.data.email });
    return { error: `Too many sign-in attempts. Please wait ${Math.ceil(Math.max(byIp.retryAfterSec, byAccount.retryAfterSec) / 60)} minute(s) and try again.` };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One generic message for every credential problem: never reveal whether the email exists.
  if (error) {
    await rateLimit("loginIp", ip); await rateLimit("loginAccount", parsed.data.email);
    log("warn", "auth.failed", { reason: "credentials", email: parsed.data.email });
    return { error: "Incorrect email or password." };
  }

  // Being able to sign in is not enough: the account must be ACTIVE staff (checked under RLS, on the server).
  const { data: { user } } = await supabase.auth.getUser();
  const { data: staff } = user ? await supabase.from("admin_users").select("role, active").eq("user_id", user.id).maybeSingle() : { data: null };
  if (!staff || !staff.active) {
    log("warn", "auth.denied", { reason: staff ? "inactive staff" : "not staff", email: parsed.data.email });
    await supabase.auth.signOut();
    return { error: "This account does not have access to the admin area." };
  }
  redirect(safeNext(fd.get("next")));
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
