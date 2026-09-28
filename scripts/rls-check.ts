/**
 * Direct security check against a Supabase project's REST/Auth APIs — NOT through the website.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/rls-check.ts
 *
 * Run it against STAGING (it creates three throw-away accounts — a plain user, an editor and a super admin — plus one draft
 * job, and removes them at the end). The service-role key is used ONLY for that setup/cleanup; every check below runs with the
 * anon key and the accounts' own sign-in tokens, exactly like an attacker or a staff member would call the API.
 * Exit code 0 = every expectation held. Paste the printed table into docs/SUPABASE_SMOKE_TEST.md §12b.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const URL_ = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) { console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (staging project)."); process.exit(2); }
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(URL_, SERVICE, opts);
const rows: { who: string; action: string; expected: "allowed" | "denied"; got: string; pass: boolean }[] = [];
const tag = `rls-check-${Date.now()}`;

/** "denied" = an error, or a write that touched 0 rows / a read that returned 0 rows (RLS filters silently). */
async function expect(who: string, action: string, expected: "allowed" | "denied", fn: () => Promise<{ error: unknown; data?: unknown; count?: number | null }>) {
  let got: string;
  try {
    const r = await fn();
    const n = Array.isArray(r.data) ? r.data.length : r.data == null ? 0 : 1;
    got = r.error ? `error: ${String((r.error as { message?: string }).message ?? r.error).slice(0, 70)}` : `ok (${n} row${n === 1 ? "" : "s"})`;
    const allowed = !r.error && n > 0;
    rows.push({ who, action, expected, got, pass: expected === "allowed" ? allowed : !allowed });
  } catch (e) { got = `threw: ${(e as Error).message.slice(0, 70)}`; rows.push({ who, action, expected, got, pass: expected === "denied" }); }
}

async function account(role: string | null) {
  const email = `${tag}-${role ?? "plain"}@example.invalid`, password = randomBytes(18).toString("base64url");
  const u = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (u.error) throw new Error(`createUser: ${u.error.message}`);
  if (role) { const r = await svc.from("admin_users").insert({ user_id: u.data.user!.id, role }); if (r.error) throw new Error(`admin_users: ${r.error.message}`); }
  const c = createClient(URL_!, ANON!, opts);
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(`sign-in ${role}: ${s.error.message}`);
  return { id: u.data.user!.id, c };
}

async function main() {
  const anon = createClient(URL_!, ANON!, opts);
  const plain = await account(null), editor = await account("editor"), sa = await account("super_admin");
  const org = (await svc.from("organizations").select("id").limit(1)).data?.[0]?.id ?? null;
  const payload = { title: `RLS check draft ${tag}`, organization_name: "RLS check", level: "central", job_type: "permanent", state_slug: "all-india",
    qualification_slugs: ["graduate"], total_vacancies: 1, source_name: "RLS check", source_type: "official_notification", source_url: "https://example.invalid/n",
    notification_url: "https://example.invalid/n.pdf", official_website_url: "https://example.invalid", organization_id: org,
    last_date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), mark_source_checked: true };

  // ── anonymous ──
  await expect("anon", "create a job (insert)", "denied", async () => anon.from("jobs").insert({ title: "x", slug: tag }).select());
  await expect("anon", "create a job (save_job RPC)", "denied", async () => anon.rpc("save_job", { p_id: null, p: payload }));
  // editor creates the draft used below
  const draft = await editor.c.rpc("save_job", { p_id: null, p: payload });
  const draftId = draft.data as string | null;
  await expect("editor", "create a draft job", "allowed", async () => ({ error: draft.error, data: draftId }));
  await expect("anon", "read a draft", "denied", async () => anon.from("jobs").select("id").eq("id", draftId ?? ""));
  await expect("anon", "edit a job", "denied", async () => anon.from("jobs").update({ title: "hacked" }).eq("id", draftId ?? "").select());
  await expect("anon", "publish (transition_job)", "denied", async () => anon.rpc("transition_job", { p_id: draftId, p_to: "published" }));
  await expect("anon", "delete a job", "denied", async () => anon.from("jobs").delete().eq("id", draftId ?? "").select());
  await expect("anon", "read government sources", "denied", async () => anon.from("government_sources").select("id").limit(1));
  await expect("anon", "modify government sources", "denied", async () => anon.from("government_sources").insert({ name: tag, source_type: "RECRUITMENT_BOARD", official_domain: "example.invalid", base_url: "https://example.invalid" }).select());
  await expect("anon", "read staff (admin_users)", "denied", async () => anon.from("admin_users").select("user_id").limit(1));
  await expect("anon", "modify staff (grant itself admin)", "denied", async () => anon.from("admin_users").insert({ user_id: plain.id, role: "super_admin" }).select());
  await expect("anon", "read audit logs", "denied", async () => anon.from("audit_logs").select("id").limit(1));
  await expect("anon", "modify audit logs", "denied", async () => anon.from("audit_logs").delete().neq("id", 0).select());
  await expect("anon", "read review queue", "denied", async () => anon.from("discovered_items").select("id").limit(1));

  // ── signed-in user who is not staff ──
  await expect("plain user", "read staff list", "denied", async () => plain.c.from("admin_users").select("user_id"));
  await expect("plain user", "grant itself a role", "denied", async () => plain.c.from("admin_users").insert({ user_id: plain.id, role: "super_admin" }).select());
  await expect("plain user", "create a job", "denied", async () => plain.c.rpc("save_job", { p_id: null, p: payload }));
  await expect("plain user", "read a draft", "denied", async () => plain.c.from("jobs").select("id").eq("id", draftId ?? ""));
  await expect("plain user", "read review queue / sources", "denied", async () => plain.c.from("government_sources").select("id").limit(1));

  // ── editor: editorial yes, administration no ──
  await expect("editor", "read its draft", "allowed", async () => editor.c.from("jobs").select("id").eq("id", draftId ?? ""));
  await expect("editor", "manage sources", "denied", async () => editor.c.from("government_sources").insert({ name: tag, source_type: "RECRUITMENT_BOARD", official_domain: "example.invalid", base_url: "https://example.invalid" }).select());
  await expect("editor", "manage staff", "denied", async () => editor.c.from("admin_users").insert({ user_id: plain.id, role: "editor" }).select());
  await expect("editor", "change its own role", "denied", async () => editor.c.from("admin_users").update({ role: "super_admin" }).eq("user_id", editor.id).select());
  await expect("editor", "delete audit logs", "denied", async () => editor.c.from("audit_logs").delete().neq("id", 0).select());
  await expect("editor", "read audit logs", "denied", async () => editor.c.from("audit_logs").select("id").limit(1));

  // ── super admin ──
  await expect("super admin", "read staff list", "allowed", async () => sa.c.from("admin_users").select("user_id"));
  await expect("super admin", "read audit logs", "allowed", async () => sa.c.from("audit_logs").select("id").limit(1));
  await expect("super admin", "move draft to review", "allowed", async () => sa.c.rpc("transition_job", { p_id: draftId, p_to: "review" }).then((r) => ({ error: r.error, data: r.error ? null : 1 })));
  const tr = (to: string) => async () => sa.c.rpc("transition_job", { p_id: draftId, p_to: to }).then((r) => ({ error: r.error, data: r.error ? null : 1 }));
  await expect("super admin", "publish", "allowed", tr("published"));
  await expect("anon", "read the published job", "allowed", async () => anon.from("jobs").select("id").eq("id", draftId ?? ""));
  await expect("anon", "edit the published job", "denied", async () => anon.from("jobs").update({ title: "hacked" }).eq("id", draftId ?? "").select());
  await expect("super admin", "unpublish (back to draft)", "allowed", tr("draft"));
  await expect("anon", "read it after unpublish", "denied", async () => anon.from("jobs").select("id").eq("id", draftId ?? ""));
  await expect("super admin", "archive the test job", "allowed", async () => sa.c.rpc("transition_job", { p_id: draftId, p_to: "archived" }).then((r) => ({ error: r.error, data: r.error ? null : 1 })));
  await expect("super admin", "delete audit logs (append-only even for admins)", "denied", async () => sa.c.from("audit_logs").delete().neq("id", 0).select());

  // cleanup (service role): test accounts; the test job stays ARCHIVED (never public) as an audit trail of the run
  for (const u of [plain, editor, sa]) { await svc.from("admin_users").delete().eq("user_id", u.id); await svc.auth.admin.deleteUser(u.id).catch(() => {}); }

  const w = (s: string, n: number) => s.padEnd(n).slice(0, n);
  console.log(`\nRLS check against ${new URL(URL_!).host} — ${new Date().toISOString()}\n`);
  console.log(`| Who | Action | Expected | Got | Result |\n|---|---|---|---|---|`);
  for (const r of rows) console.log(`| ${r.who} | ${r.action} | ${r.expected} | ${r.got} | ${r.pass ? "PASS" : "**FAIL**"} |`);
  const failed = rows.filter((r) => !r.pass).length;
  console.log(`\n${rows.length - failed}/${rows.length} passed`);
  void w; process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
