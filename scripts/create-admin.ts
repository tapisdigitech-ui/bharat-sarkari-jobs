/**
 * Create (or promote) a staff account. Run on YOUR machine or CI: it uses the service-role key, which must never be
 * exposed to a browser or committed.
 *
 *   npm run admin:create -- --email you@example.com --name "Your Name" [--role super_admin]
 *
 * The password is read from ADMIN_PASSWORD or, if unset, prompted for (hidden). Requires in the environment
 * (or .env.local): NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline";
import { ROLES, type Role } from "../src/lib/admin/permissions";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("No terminal available: set ADMIN_PASSWORD in the environment instead.");
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
     
    const w = rl as any; const orig = w._writeToOutput;
    w._writeToOutput = (s: string) => { if (s.includes(question)) orig.call(w, s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
  });
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (for example in .env.local).");
  const email = (arg("email") ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const role = (arg("role") ?? "super_admin") as Role;
  const name = arg("name") ?? email.split("@")[0];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Provide --email you@example.com");
  if (!ROLES.includes(role)) throw new Error(`Unknown role "${role}". One of: ${ROLES.join(", ")}`);
  const password = process.env.ADMIN_PASSWORD ?? (await promptHidden("Password (min 12 characters): "));
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let userId: string | undefined;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (created.error) {
    if (!/already|registered|exists/i.test(created.error.message)) throw new Error(`Could not create the user: ${created.error.message}`);
    // Existing account: find it, set the new password, and (re)grant the role.
    for (let page = 1; page <= 50 && !userId; page++) {
      const list = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (list.error) throw new Error(list.error.message);
      userId = list.data.users.find((u) => u.email?.toLowerCase() === email)?.id;
      if (list.data.users.length < 200) break;
    }
    if (!userId) throw new Error("The email is registered but could not be found via the admin API.");
    const upd = await db.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (upd.error) throw new Error(`Could not update the existing user: ${upd.error.message}`);
  } else userId = created.data.user.id;

  const up = await db.from("admin_users").upsert({ user_id: userId, role, active: true }, { onConflict: "user_id" });
  if (up.error) throw new Error(`Could not grant the role: ${up.error.message}`);
  console.log(`Done. ${email} is now an active ${role}. Sign in at /admin/login.`);
}

main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
