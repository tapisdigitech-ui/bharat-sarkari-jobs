/**
 * PHASE 3.7 STAGING VALIDATION — database, authentication, RLS attack, audit log, cron lock, demo isolation, effort, probes.
 *
 *   npx tsx scripts/staging/validate.ts                                    # against the real staging project (env: see common.ts)
 *   npx tsx scripts/staging/validate.ts --rehearsal                       # against the local stand-in (proves the script, not staging)
 *   npx tsx scripts/staging/validate.ts --rehearsal --write-baseline      # (re)establish docs/staging/local-schema-baseline.json from a CLEAN
 *                                                                         # local rehearsal — the ONLY way that file is written; a plain
 *                                                                         # --rehearsal run never touches it, so a broken/test scenario can't
 *                                                                         # silently become the canonical baseline.
 *   npx tsx scripts/staging/validate.ts --rehearsal --scenario=<name>     # a labelled, non-canonical rehearsal (e.g. negative-control): writes
 *                                                                         # its own docs/staging/validate-rehearsal-local-stand-in-<name>.md|json
 *                                                                         # instead of the canonical report, and cannot be combined with
 *                                                                         # --write-baseline (refused at startup — see common.ts).
 *   options: --only=connection,schema,auth,rls,public,audit,cron-lock,demo,effort,probes   --keep (keep throw-away users)
 *            --wait-expiry (wait for one access token to expire and prove it is refused; takes the JWT lifetime, ~1 h)
 *
 * Every attack runs over the public HTTP APIs (PostgREST /rest/v1 and GoTrue /auth/v1) with the anon key and real sign-in
 * tokens — exactly what a browser, a script or an attacker can send. The service-role key is used only to create/remove the
 * throw-away accounts and fixtures and to read the diagnostics. Nothing is published: publish attempts stop at the
 * database's publish gate (the fixtures have no trusted official URL), and reaching that gate is what proves the role was
 * authorised (SQLSTATE 23514), while a refusal is SQLSTATE 42501 / an RLS-hidden row.
 *
 * Fixtures are tagged "stgchk-<run>" and removed at the end (fixture jobs are drafts/review only and never public).
 * Output: docs/staging/validate-<project-ref>.md|json.
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { can, type Action, type Role } from "../../src/lib/admin/permissions";
import { ENV, REHEARSAL, Recorder, SCENARIO, WRITE_BASELINE, anonClient, argValue, args, errText, guard, service, sleep, tokenClient, writeReport, type Result, type SupabaseClient } from "./common";

const target = guard();
const only = argValue("only")?.split(",");
const on = (s: string) => !only || only.includes(s);
const RUN = `stgchk-${Date.now().toString(36)}`;
const svc = service();
const anon = anonClient();
const all: Result[] = [];
const MIGRATIONS = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();

type Who = "anon" | "authenticated" | Role;
const WHO: Who[] = ["anon", "authenticated", "moderator", "editor", "seo_manager", "content_manager", "admin", "super_admin"];
interface Account { who: Who; id: string; email: string; password: string; token: string; refresh: string; c: SupabaseClient }
const accounts = new Map<string, Account>();
const createdUsers: string[] = [];

async function makeAccount(label: string, role: Role | null): Promise<Account> {
  const email = `${RUN}-${label}@example.invalid`, password = randomBytes(18).toString("base64url");
  const u = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (u.error) throw new Error(`createUser ${label}: ${u.error.message}`);
  createdUsers.push(u.data.user!.id);
  if (role) { const r = await svc.from("admin_users").insert({ user_id: u.data.user!.id, role }); if (r.error) throw new Error(`admin_users ${label}: ${r.error.message}`); }
  const c = anonClient();
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(`sign-in ${label}: ${s.error.message}`);
  const acc = { who: (role ?? "authenticated") as Who, id: u.data.user!.id, email, password, token: s.data.session!.access_token, refresh: s.data.session!.refresh_token, c: tokenClient(s.data.session!.access_token) };
  accounts.set(label, acc);
  return acc;
}
const clientOf = (w: Who) => (w === "anon" ? anon : accounts.get(w)!.c);

// ─────────────────────────── 1. connection ───────────────────────────
async function connection() {
  const r = new Recorder("1. Connection");
  const h = await fetch(`${ENV.url}/auth/v1/health`, { headers: { apikey: ENV.anon } }).then((x) => `${x.status}`).catch((e) => `error ${errText(e)}`);
  r.pass("Auth API reachable (/auth/v1/health)", "200", h, h === "200");
  const rest = await anon.from("states").select("id", { count: "exact", head: true });
  r.pass("REST API reachable with the anon key (states)", "no error, rows > 0", rest.error ? errText(rest.error) : `${rest.count} states`, !rest.error && (rest.count ?? 0) > 0);
  const t0 = Date.now(); await anon.from("states").select("id").limit(1); r.info("Round-trip time from this machine (one REST read)", `${Date.now() - t0} ms`);
  return r.results;
}

// ─────────────────────────── 2. schema / migrations ───────────────────────────
async function schema() {
  const r = new Recorder("2. Database schema (ops_schema_audit)");
  const { data, error } = await svc.rpc("ops_schema_audit");
  if (error) { r.pass("ops_schema_audit() callable with the service role", "a report", errText(error), false); r.notRun("Everything else in this section", "migration 0026 missing?"); return r.results; }
  const a = data as Record<string, any>;
  for (const k of ["tables_without_rls", "definer_functions_without_search_path", "views_not_security_invoker", "foreign_keys_without_index", "api_role_dangerous_grants", "write_functions_callable_by_anon", "restore_unsafe_functions"])
    r.pass(k.replace(/_/g, " "), "none", JSON.stringify(a[k] ?? null), Array.isArray(a[k]) && a[k].length === 0);
  // Read-only helpers that RLS policies call while evaluating anon requests — anon must be able to execute them.
  const ANON_HELPERS = ["can_modify_job", "content_is_public", "current_staff_role", "has_permission", "is_staff"];
  const extraDefiner = ((a.definer_functions_callable_by_anon ?? []) as string[]).filter((f) => !ANON_HELPERS.includes(f));
  r.pass("SECURITY DEFINER functions anon can execute", `only the read-only RLS helpers (${ANON_HELPERS.join(", ")})`, JSON.stringify(a.definer_functions_callable_by_anon), extraDefiner.length === 0);
  r.pass("RLS tables with no policy", `["rate_limits"] (deny-all by design)`, JSON.stringify(a.rls_tables_without_policy), JSON.stringify(a.rls_tables_without_policy) === '["rate_limits"]');
  r.info("PostgreSQL server version", String(a.server_version));
  r.info("Extensions", JSON.stringify(a.extensions));
  r.info("Object counts", JSON.stringify(a.counts));
  if (Array.isArray(a.applied_migrations)) {
    const applied = (a.applied_migrations as string[]).map(String);
    const want = MIGRATIONS.map((f) => f.split("_")[0]);
    const missing = want.filter((v) => !applied.some((x) => x === v || x.startsWith(v)));
    r.pass(`Applied migrations (supabase_migrations.schema_migrations) vs ${MIGRATIONS.length} files`, `all ${want.length}`, `${applied.length} recorded; missing: ${missing.join(", ") || "none"}`, missing.length === 0);
  } else r.add("Applied migrations recorded by the Supabase CLI", `${MIGRATIONS.length} rows`, "no supabase_migrations table — applied outside `supabase db push`?", REHEARSAL ? "INFO" : "FAIL");
  // Difference from local PostgreSQL: compare with the baseline written by a rehearsal run.
  const basePath = join(process.cwd(), "docs", "staging", "local-schema-baseline.json");
  if (WRITE_BASELINE) {
    writeFileSync(basePath, JSON.stringify({ note: "ops_schema_audit() counts from a CLEAN local PostgreSQL rehearsal (--write-baseline) — compared by the real staging run. Never written by a plain --rehearsal run or by any --scenario=<name> run (see scripts/staging/common.ts).", at: new Date().toISOString(), counts: a.counts, extensions: a.extensions, migrations: MIGRATIONS.length }, null, 2) + "\n");
    r.info("Local baseline written", "docs/staging/local-schema-baseline.json");
  } else if (REHEARSAL) {
    r.info("Local baseline NOT written", `this is a plain --rehearsal run${SCENARIO ? ` (scenario: ${SCENARIO})` : ""}; pass --write-baseline on a clean run to (re)establish docs/staging/local-schema-baseline.json`);
  } else if (existsSync(basePath)) {
    const base = JSON.parse(readFileSync(basePath, "utf8")).counts as Record<string, number>;
    const diff = Object.keys(base).filter((k) => !["states", "districts"].includes(k) && Number(base[k]) !== Number(a.counts?.[k])).map((k) => `${k}: local ${base[k]} vs staging ${a.counts?.[k]}`);
    r.pass("Object counts equal to local PostgreSQL (tables, policies, triggers, functions, indexes, FKs, permissions, transitions)", "identical", diff.join("; ") || "identical", diff.length === 0);
    r.info("Reference data (states / districts)", `local ${base.states}/${base.districts} vs staging ${a.counts?.states}/${a.counts?.districts}`);
  } else r.notRun("Comparison with local PostgreSQL", "no docs/staging/local-schema-baseline.json (run once with --rehearsal --write-baseline)");
  return r.results;
}

// ─────────────────────────── 3. authentication ───────────────────────────
async function auth() {
  const r = new Recorder("3. Authentication");
  const ed = accounts.get("editor")!;
  // valid / invalid / unknown
  r.pass("Staff sign-in with the right password", "session", "session issued", !!ed.token);
  const bad = await anonClient().auth.signInWithPassword({ email: ed.email, password: "wrong-" + randomBytes(6).toString("hex") });
  const unk = await anonClient().auth.signInWithPassword({ email: `${RUN}-nobody@example.invalid`, password: "wrong-" + randomBytes(6).toString("hex") });
  r.pass("Wrong password is refused", "error", errText(bad.error) || "SESSION ISSUED", !!bad.error && !bad.data.session);
  r.pass("Unknown email is refused", "error", errText(unk.error) || "SESSION ISSUED", !!unk.error && !unk.data.session);
  r.pass("Same message for wrong password and unknown email (no account enumeration)", "identical", `${errText(bad.error)} / ${errText(unk.error)}`, errText(bad.error) === errText(unk.error));
  // token lifetime
  const claims = JSON.parse(Buffer.from(ed.token.split(".")[1], "base64url").toString());
  r.info("Access-token lifetime (exp − iat)", `${claims.exp - claims.iat} s`);
  // forged tokens
  const [h, p] = ed.token.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ ...claims, role: "service_role" })).toString("base64url");
  const forged = await tokenClient(`${h}.${forgedPayload}.${ed.token.split(".")[2]}`).from("admin_users").select("user_id").limit(1);
  r.pass("Token edited to role=service_role (signature no longer matches) is refused by the REST API", "401 / error", forged.error ? `${forged.status} ${errText(forged.error)}` : `ACCEPTED (${forged.data?.length} rows)`, !!forged.error);
  const unsigned = await tokenClient(`${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${p}.`).from("jobs").select("id").limit(1);
  r.pass('alg "none" token is refused', "error", unsigned.error ? `${unsigned.status} ${errText(unsigned.error)}` : "ACCEPTED", !!unsigned.error);
  const garbage = await tokenClient("not-a-token").from("jobs").select("id").limit(1);
  r.pass("Garbage bearer token is refused", "error", garbage.error ? `${garbage.status}` : "ACCEPTED", !!garbage.error);
  // self-escalation through the profile the browser controls
  const plain = accounts.get("authenticated")!;
  const self = anonClient();
  await self.auth.setSession({ access_token: plain.token, refresh_token: plain.refresh });
  const up = await self.auth.updateUser({ data: { role: "super_admin", staff_role: "super_admin", is_admin: true } });
  r.info("Plain user edits its own user_metadata to claim super_admin", up.error ? `refused: ${errText(up.error)}` : "accepted by the Auth server (expected: metadata is user-controlled and must never grant anything)");
  const fresh = await anonClient().auth.signInWithPassword({ email: plain.email, password: plain.password });
  const escal = await tokenClient(fresh.data.session?.access_token ?? "x").from("admin_users").select("user_id").limit(1);
  const staffNow = await tokenClient(fresh.data.session?.access_token ?? "x").rpc("is_staff");
  r.pass("A plain user who writes role=super_admin into its own user_metadata is still not staff", "is_staff() = false, admin_users hidden",
    `is_staff=${JSON.stringify(staffNow.data)}${staffNow.error ? ` (${errText(staffNow.error)})` : ""}, admin_users rows=${escal.data?.length ?? 0}`, staffNow.data !== true && (escal.data?.length ?? 0) === 0);
  // logout
  const lo = await makeAccount("logout", "editor");
  const loClient = anonClient(); await loClient.auth.setSession({ access_token: lo.token, refresh_token: lo.refresh });
  const out = await loClient.auth.signOut({ scope: "global" });
  r.pass("Sign-out succeeds", "no error", errText(out.error) || "ok", !out.error);
  const ref = await anonClient().auth.refreshSession({ refresh_token: lo.refresh });
  r.pass("After sign-out the refresh token is revoked", "error", ref.error ? errText(ref.error) : "NEW SESSION ISSUED", !!ref.error);
  const gu = await anonClient().auth.getUser(lo.token);
  r.pass("After sign-out the Auth server rejects the old access token (the app checks every admin request with getUser)", "error", gu.error ? errText(gu.error) : "STILL VALID", !!gu.error);
  const stillRest = await tokenClient(lo.token).from("jobs").select("id").eq("status", "draft").limit(1);
  r.info("After sign-out, the old access token at the REST API directly", stillRest.error ? `refused: ${errText(stillRest.error)}` :
    `still accepted until it expires (stateless JWT; ${stillRest.data?.length ?? 0} draft rows visible). Bounded by the token lifetime above; the app itself rejects it via getUser.`);
  // disabled staff and role change take effect immediately (the database reads admin_users on every request)
  const dis = await makeAccount("disabled", "editor");
  const draftId = fixtures.jobs.get("disabled-draft")!;
  const before = await dis.c.from("jobs").select("id").eq("id", draftId);
  await svc.from("admin_users").update({ active: false }).eq("user_id", dis.id);
  const after = await dis.c.from("jobs").select("id").eq("id", draftId);
  const edit = await dis.c.from("jobs").update({ summary: "disabled edit" }).eq("id", draftId).select("id");
  r.pass("Disabled staff: the same, still-valid token loses access at once", "draft visible before; hidden and not editable after",
    `before ${before.data?.length ?? 0} row, after ${after.data?.length ?? 0} row, edit ${edit.error ? "refused" : `${edit.data?.length ?? 0} row`}`, (before.data?.length ?? 0) === 1 && (after.data?.length ?? 0) === 0 && (edit.error != null || (edit.data?.length ?? 0) === 0));
  const rc = await makeAccount("demoted", "editor");
  const e1 = await rc.c.from("jobs").update({ summary: "before demotion" }).eq("id", fixtures.jobs.get("demoted-draft")!).select("id");
  await svc.from("admin_users").update({ role: "moderator" }).eq("user_id", rc.id);
  const e2 = await rc.c.from("jobs").update({ summary: "after demotion" }).eq("id", fixtures.jobs.get("demoted-draft")!).select("id");
  r.pass("Role change (editor → moderator) applies to the existing token immediately", "edit allowed before, refused after",
    `before ${e1.error ? errText(e1.error) : `${e1.data?.length} row`}, after ${e2.error ? errText(e2.error) : `${e2.data?.length} row`}`, !e1.error && (e1.data?.length ?? 0) === 1 && (!!e2.error || (e2.data?.length ?? 0) === 0));
  // expiry
  if (args.has("--wait-expiry")) {
    const wait = claims.exp * 1000 - Date.now() + 5000;
    console.log(`Waiting ${Math.round(wait / 1000)} s for the editor's access token to expire…`);
    await sleep(Math.max(wait, 0));
    const exp = await ed.c.from("jobs").select("id").limit(1);
    r.pass("Expired access token is refused by the REST API", "401", exp.error ? `${exp.status} ${errText(exp.error)}` : "ACCEPTED", !!exp.error);
  } else r.notRun("Expired access token is refused", `needs --wait-expiry (waits ${claims.exp - claims.iat} s); the app-level expiry redirect is covered by the browser check`);
  return r.results;
}

// ─────────────────────────── 4. RLS attack matrix over the API ───────────────────────────
const fixtures = { org: "", jobs: new Map<string, string>(), recruitmentDraft: "", source: "", item: "", victim: "", cronRun: 0 };
async function setupFixtures() {
  const org = await svc.from("organizations").insert({ name: `${RUN} Staging Check Organization`, slug: `${RUN}-org`, level: "central" }).select("id").single();
  if (org.error) throw new Error(`fixture organization: ${org.error.message}`);
  fixtures.org = org.data.id;
  const job = async (key: string, status: "draft" | "review") => {
    const j = await svc.from("jobs").insert({ slug: `${RUN}-${key.replace(/_/g, "-")}`, title: `${RUN} fixture job ${key} (never published)`, organization_id: fixtures.org, level: "central", status }).select("id").single();
    if (j.error) throw new Error(`fixture job ${key}: ${j.error.message}`);
    fixtures.jobs.set(key, j.data.id);
  };
  for (const w of WHO) for (const k of ["draft", "edit", "del", "review"]) await job(`${w}-${k}`, k === "review" ? "review" : "draft");
  for (const k of ["disabled-draft", "demoted-draft", "audit-draft"]) await job(k, "draft");
  const rec = await svc.from("recruitments").insert({ title: `${RUN} fixture recruitment`, organization_id: fixtures.org, is_all_india: true }).select("id").single();
  if (rec.error) throw new Error(`fixture recruitment: ${rec.error.message}`);
  fixtures.recruitmentDraft = rec.data.id;
  const src = await svc.from("government_sources").insert({ name: `${RUN} fixture source`, slug: `${RUN}-src`, source_type: "RECRUITMENT_BOARD", official_domain: "stgchk.example.invalid", base_url: "https://stgchk.example.invalid/", is_synthetic: true, status: "PAUSED" }).select("id").single();
  if (src.error) throw new Error(`fixture source: ${src.error.message}`);
  fixtures.source = src.data.id;
  const it = await svc.from("discovered_items").insert({ source_id: fixtures.source, suggested_kind: "job", title: `${RUN} fixture discovery`, extracted: {}, confidence: "LOW", confidence_score: 0.1, content_hash: `${RUN}-h`, is_synthetic: true }).select("id").single();
  if (it.error) throw new Error(`fixture discovery: ${it.error.message}`);
  fixtures.item = it.data.id;
  const cr = await svc.from("cron_runs").insert({ job: "cleanup", ok: true, finished_at: new Date().toISOString(), summary: { note: RUN } }).select("id").single();
  if (cr.error) throw new Error(`fixture cron run: ${cr.error.message}`);
  fixtures.cronRun = cr.data.id;
  const pr = await svc.from("source_probes").insert({ source_id: fixtures.source, runtime: "staging check fixture", request_url: "https://stgchk.example.invalid/", robots_outcome: "not_checked", verdict: "UNKNOWN", notes: RUN });
  if (pr.error) throw new Error(`fixture probe: ${pr.error.message}`);
}

type Outcome = "allowed" | "gated" | "denied";
const outcomeOf = (r: { error: any; data: any; status?: number }): [Outcome, string] => {
  if (r.error) {
    const code = r.error.code ?? "";
    if (code === "23514") return ["gated", `reached the publish gate (23514): ${errText(r.error).slice(0, 80)}`];
    return ["denied", `${r.status ?? ""} ${code} ${errText(r.error).slice(0, 80)}`.trim()];
  }
  const n = Array.isArray(r.data) ? r.data.length : r.data == null ? 0 : 1;
  return n > 0 ? ["allowed", `${n} row(s)`] : ["denied", "0 rows (hidden by RLS)"];
};
const has = (a: Action) => (w: Who) => w !== "anon" && w !== "authenticated" && can(w as Role, a);
const isStaff = (w: Who) => w !== "anon" && w !== "authenticated";
const nobody = () => false, everyone = () => true;

async function rls() {
  const r = new Recorder("4. RLS attack (direct API, 8 identities)");
  const J = (w: Who, k: string) => fixtures.jobs.get(`${w}-${k}`)!;
  const cases: { what: string; allow: (w: Who) => boolean; run: (c: SupabaseClient, w: Who) => PromiseLike<any>; after?: (w: Who) => PromiseLike<unknown> }[] = [
    { what: "jobs SELECT a draft", allow: isStaff, run: (c, w) => c.from("jobs").select("id").eq("id", J(w, "draft")) },
    { what: "jobs INSERT a draft", allow: has("job:create"), run: (c) => c.from("jobs").insert({ slug: `${RUN}-ins-${randomBytes(3).toString("hex")}`, title: `${RUN} inserted draft`, organization_id: fixtures.org, level: "central" }).select("id") },
    { what: "jobs INSERT already published", allow: nobody, run: (c) => c.from("jobs").insert({ slug: `${RUN}-pub-${randomBytes(3).toString("hex")}`, title: `${RUN} forged published`, organization_id: fixtures.org, level: "central", status: "published" }).select("id") },
    { what: "jobs UPDATE a draft", allow: has("job:edit"), run: (c, w) => c.from("jobs").update({ summary: "rls edit" }).eq("id", J(w, "edit")).select("id") },
    { what: "jobs UPDATE status draft → published directly", allow: nobody, run: (c, w) => c.from("jobs").update({ status: "published" }).eq("id", J(w, "draft")).select("id") },
    { what: "transition_job review → published (RPC)", allow: has("job:publish"), run: (c, w) => c.rpc("transition_job", { p_id: J(w, "review"), p_to: "published" }).then((x) => ({ ...x, data: x.error ? null : 1 })) },
    { what: "jobs DELETE a draft", allow: has("job:delete"), run: (c, w) => c.from("jobs").delete().eq("id", J(w, "del")).select("id") },
    { what: "recruitments SELECT a draft", allow: isStaff, run: (c) => c.from("recruitments").select("id").eq("id", fixtures.recruitmentDraft) },
    { what: "recruitments UPDATE a draft", allow: has("recruitment:edit"), run: (c) => c.from("recruitments").update({ summary: "rls edit" }).eq("id", fixtures.recruitmentDraft).select("id") },
    { what: "organizations INSERT", allow: (w) => has("reference:manage")(w) || has("job:create")(w), run: (c) => c.from("organizations").insert({ name: `${RUN} org ${randomBytes(3).toString("hex")}`, slug: `${RUN}-org-${randomBytes(3).toString("hex")}`, level: "central" }).select("id") },
    { what: "states UPDATE (no-op rename)", allow: has("reference:manage"), run: async (c) => { const s = (await svc.from("states").select("id,name").order("id").limit(1)).data![0]; return c.from("states").update({ name: s.name }).eq("id", s.id).select("id"); } },
    { what: "government_sources SELECT", allow: isStaff, run: (c) => c.from("government_sources").select("id").eq("id", fixtures.source) },
    { what: "government_sources UPDATE", allow: has("source:manage"), run: (c) => c.from("government_sources").update({ notes: "rls" }).eq("id", fixtures.source).select("id") },
    { what: "discovered_items SELECT", allow: isStaff, run: (c) => c.from("discovered_items").select("id").eq("id", fixtures.item) },
    { what: "discovered_items INSERT (forged discovery)", allow: nobody, run: (c) => c.from("discovered_items").insert({ suggested_kind: "job", title: "forged", extracted: {}, confidence: "HIGH", confidence_score: 1, content_hash: `${RUN}-${randomBytes(3).toString("hex")}` }).select("id") },
    { what: "discovered_items UPDATE review note", allow: has("ingestion:review"), run: (c) => c.from("discovered_items").update({ review_note: "rls" }).eq("id", fixtures.item).select("id") },
    { what: "source_probes SELECT", allow: isStaff, run: (c) => c.from("source_probes").select("id").eq("source_id", fixtures.source) },
    { what: "source_probes INSERT (forged PASS)", allow: nobody, run: (c) => c.from("source_probes").insert({ source_id: fixtures.source, runtime: "forged", request_url: "https://x.invalid", verdict: "PASS" }).select("id") },
    { what: "source_probes UPDATE verdict", allow: nobody, run: (c) => c.from("source_probes").update({ verdict: "PASS" }).eq("source_id", fixtures.source).select("id") },
    { what: "admin_users SELECT the victim's row", allow: has("users:manage"), run: (c) => c.from("admin_users").select("user_id").eq("user_id", fixtures.victim) },
    { what: "admin_users UPDATE promote victim → super_admin", allow: (w) => w === "super_admin", run: (c) => c.from("admin_users").update({ role: "super_admin" }).eq("user_id", fixtures.victim).select("user_id"),
      after: () => svc.from("admin_users").update({ role: "moderator" }).eq("user_id", fixtures.victim) },
    { what: "admin_users UPSERT own row as super_admin", allow: (w) => w === "super_admin", run: (c, w) => c.from("admin_users").upsert({ user_id: w === "anon" ? fixtures.victim : accounts.get(w)!.id, role: "super_admin" }, { onConflict: "user_id" }).select("user_id"),
      after: async (w) => { if (w === "authenticated") await svc.from("admin_users").delete().eq("user_id", accounts.get(w)!.id); else if (isStaff(w)) await svc.from("admin_users").update({ role: w, active: true }).eq("user_id", accounts.get(w)!.id); } },
    { what: "role_permissions INSERT (self-grant)", allow: nobody, run: (c) => c.from("role_permissions").insert({ role: "moderator", action: "job:publish" }).select("role") },
    { what: "audit_logs SELECT", allow: has("audit:view"), run: (c) => c.from("audit_logs").select("id").limit(1) },
    { what: "audit_logs INSERT (forged entry)", allow: nobody, run: (c) => c.from("audit_logs").insert({ action: "forged", entity: "jobs" }).select("id") },
    { what: "audit_logs DELETE", allow: nobody, run: (c) => c.from("audit_logs").delete().eq("entity", "jobs").select("id") },
    { what: "content_versions UPDATE (rewrite history)", allow: nobody, run: (c) => c.from("content_versions").update({ reason: "forged" }).gt("id", 0).select("id") },
    { what: "rate_limits SELECT", allow: nobody, run: (c) => c.from("rate_limits").select("bucket").limit(1) },
    { what: "cron_runs SELECT", allow: isStaff, run: (c) => c.from("cron_runs").select("id").eq("id", fixtures.cronRun) },
    { what: "cron_runs INSERT (forged run)", allow: nobody, run: (c) => c.from("cron_runs").insert({ job: "expire" }).select("id") },
    { what: "RPC ops_schema_audit", allow: nobody, run: (c) => c.rpc("ops_schema_audit") },
    { what: "RPC ops_demo_scan", allow: nobody, run: (c) => c.rpc("ops_demo_scan") },
    { what: "RPC cron_begin (take the cron lock)", allow: nobody, run: (c) => c.rpc("cron_begin", { p_job: "cleanup", p_stale_minutes: 15 }) },
    { what: "RPC rate_limit_hit (burn a bucket)", allow: nobody, run: (c) => c.rpc("rate_limit_hit", { p_bucket: `${RUN}:bucket`, p_limit: 1, p_window_seconds: 60 }) },
    { what: "RPC cleanup_operational_data", allow: nobody, run: (c) => c.rpc("cleanup_operational_data", { p_keep_cron_days: 7 }) },
  ];
  const matrix: string[] = [];
  let cells = 0, bad = 0;
  for (const c of cases) {
    const row: string[] = [];
    for (const w of WHO) {
      let out: Outcome, got: string;
      try { [out, got] = outcomeOf(await c.run(clientOf(w), w)); } catch (e) { out = "denied"; got = `threw ${errText(e).slice(0, 80)}`; }
      if (c.after) await c.after(w);
      const want = c.allow(w);
      const ok = want ? out !== "denied" : out === "denied";
      cells++; if (!ok) { bad++; r.pass(`${c.what} as ${w}`, want ? "allowed" : "refused", got, false); }
      row.push(ok ? (out === "allowed" ? "✓" : out === "gated" ? "✓g" : "·") : "✗");
    }
    matrix.push(`| ${c.what} | ${row.join(" | ")} |`);
  }
  r.pass(`RLS attack matrix: ${cases.length} cases × ${WHO.length} identities`, "every cell matches the permission model", `${cells - bad}/${cells} match`, bad === 0);
  const table = `\n### RLS attack matrix (✓ allowed · ✓g authorised, stopped by the publish gate · · refused · ✗ MISMATCH)\n\n| Case | ${WHO.join(" | ")} |\n|---|${WHO.map(() => "---").join("|")}|\n${matrix.join("\n")}\n`;
  return { results: r.results, table };
}

// ─────────────────────────── 5. public read ───────────────────────────
async function publicRead() {
  const r = new Recorder("5. Public read (anon)");
  for (const [t, f] of [["jobs", "published"], ["recruitments", "published"], ["exams", "published"], ["results", "published"]] as const) {
    const all_ = await svc.from(t).select("id", { count: "exact", head: true }).eq("status", f);
    const pub = await anon.from(t).select("id", { count: "exact", head: true }).eq("status", f);
    r.pass(`${t}: anon sees every published row`, `${all_.count}`, pub.error ? errText(pub.error) : `${pub.count}`, !pub.error && pub.count === all_.count);
    let leaked = 0; const errs: string[] = [];
    for (const st of ["draft", "review", "archived"]) {
      const h = await anon.from(t).select("id", { count: "exact", head: true }).eq("status", st);
      if (h.error) errs.push(`${st}: ${h.status} ${errText(h.error)}`); else leaked += h.count ?? 0;
    }
    r.pass(`${t}: anon sees no draft/review/archived row`, "0 (queries succeed)", errs.length ? `query error — ${errs.join("; ")}` : `${leaked}`, !errs.length && leaked === 0);
  }
  for (const t of ["job_internal", "content_internal", "government_sources", "discovered_items", "audit_logs", "admin_users", "field_evidence", "source_probes", "editorial_effort", "cron_runs"]) {
    const x = await anon.from(t).select("*").limit(1);
    r.pass(`${t}: nothing readable by anon`, "error or 0 rows", x.error ? `refused (${x.status})` : `${x.data?.length} rows`, !!x.error || x.data?.length === 0);
  }
  return r.results;
}

// ─────────────────────────── 6. audit log ───────────────────────────
async function audit() {
  const r = new Recorder("6. Audit log");
  const ed = accounts.get("editor")!, sa = accounts.get("super_admin")!;
  const id = fixtures.jobs.get("audit-draft")!;
  const t0 = new Date(Date.now() - 2000).toISOString();
  await ed.c.from("jobs").update({ summary: `audited edit ${RUN}` }).eq("id", id);
  const rows = await svc.from("audit_logs").select("actor_id,action,entity,entity_id,at").eq("entity_id", id).gte("at", t0);
  const mine = (rows.data ?? []).find((x) => x.actor_id === ed.id);
  r.pass("An editor's change writes an audit row with the editor as actor", "1+ row, actor = editor", rows.error ? errText(rows.error) : `${rows.data?.length} row(s), actor match: ${!!mine}`, !!mine);
  const del = await sa.c.from("audit_logs").delete().eq("entity_id", id).select("id");
  const upd = await sa.c.from("audit_logs").update({ action: "rewritten" }).eq("entity_id", id).select("id");
  r.pass("Super admin cannot delete audit rows", "refused", del.error ? "refused" : `${del.data?.length} deleted`, !!del.error || del.data?.length === 0);
  r.pass("Super admin cannot rewrite audit rows", "refused", upd.error ? "refused" : `${upd.data?.length} changed`, !!upd.error || upd.data?.length === 0);
  r.info("Service role and audit rows", "not attempted: the service role bypasses RLS by design, so append-only is enforced for every API role but not for the key itself — the key never reaches the browser (bundle scan in site.ts)");
  const staffChange = await svc.from("audit_logs").select("id").eq("entity", "admin_users").gte("at", t0).limit(50);
  r.pass("Staff role changes made during this run were audited", "1+ row", `${staffChange.data?.length ?? 0} row(s)`, (staffChange.data?.length ?? 0) > 0);
  return r.results;
}

// ─────────────────────────── 7. cron lock (database side) ───────────────────────────
async function cronLock() {
  const r = new Recorder("7. Cron single-run lock (database)");
  const job = "cleanup";
  const open = await svc.from("cron_runs").select("id").eq("job", job).is("finished_at", null);
  if ((open.data?.length ?? 0) > 0) { r.notRun("cron_begin lock", "a real cleanup run is in progress right now — try again later"); return r.results; }
  const a = await svc.rpc("cron_begin", { p_job: job, p_stale_minutes: 15 });
  const b = await svc.rpc("cron_begin", { p_job: job, p_stale_minutes: 15 });
  r.pass("First cron_begin takes the lock", "a run id", a.error ? errText(a.error) : String(a.data), !a.error && a.data != null);
  r.pass("Second cron_begin while the first is unfinished is refused", "null", b.error ? errText(b.error) : String(b.data), !b.error && b.data == null);
  if (a.data != null) await svc.from("cron_runs").update({ finished_at: new Date().toISOString(), ok: true, summary: { note: `${RUN} lock check` } }).eq("id", a.data);
  const c = await svc.rpc("cron_begin", { p_job: job, p_stale_minutes: 15 });
  r.pass("After the first run finishes, the lock is free again", "a run id", c.error ? errText(c.error) : String(c.data), !c.error && c.data != null);
  if (c.data != null) await svc.from("cron_runs").update({ finished_at: new Date().toISOString(), ok: true, summary: { note: `${RUN} lock check` } }).eq("id", c.data);
  const recent = await svc.from("cron_runs").select("job,started_at,finished_at,ok,error,summary").order("started_at", { ascending: false }).limit(20);
  const real = (recent.data ?? []).filter((x) => !JSON.stringify(x).includes(RUN));
  r.info("Latest cron runs recorded on this project (scheduler evidence)", real.length ? real.slice(0, 8).map((x) => `${x.job} ${x.started_at?.slice(0, 16)} ${x.ok === true ? "ok" : x.ok === false ? `FAILED ${x.error ?? ""}` : "unfinished"}`).join("; ") : "none — the Vercel cron has not run against this database yet");
  return r.results;
}

// ─────────────────────────── 8. demo isolation ───────────────────────────
async function demo() {
  const r = new Recorder("8. Demo isolation (database)");
  const { data, error } = await svc.rpc("ops_demo_scan");
  if (error) { r.pass("ops_demo_scan()", "a report", errText(error), false); return r.results; }
  const d = data as Record<string, any[]>;
  for (const [k, v] of Object.entries(d)) {
    if (!Array.isArray(v)) { r.info(k.replace(/_/g, " "), JSON.stringify(v)); continue; }
    const list = v.filter((x) => !JSON.stringify(x).includes(RUN));
    if (k === "synthetic_sources" || k === "synthetic_discoveries_open") r.pass(k.replace(/_/g, " "), "none on staging", JSON.stringify(list).slice(0, 250), list.length === 0);
    else r.pass(`${k}: live/expired rows whose title or URL looks like demo/synthetic/test/placeholder`, "none", JSON.stringify(list).slice(0, 250), list.length === 0);
  }
  return r.results;
}

// ─────────────────────────── 9. human effort ───────────────────────────
async function effort() {
  const r = new Recorder("9. Human review effort (editorial_effort)");
  const { data, error } = await svc.from("editorial_effort").select("*").eq("is_synthetic", false).limit(5000);
  if (error) { r.pass("editorial_effort readable", "rows", errText(error), false); return { results: r.results, summary: null }; }
  const rows = (data ?? []) as Record<string, any>[];
  const mins = (a?: string | null, b?: string | null) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 60000 : null);
  const med = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null && x >= 0).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const reviewed = rows.filter((x) => x.reviewed_at);
  const s = {
    discoveries: rows.length, reviewed: reviewed.length, published: rows.filter((x) => x.published_at).length,
    median_wait_to_start_min: med(rows.map((x) => mins(x.discovered_at, x.review_started_at))),
    median_review_min: med(reviewed.map((x) => mins(x.review_started_at, x.reviewed_at))),
    median_review_to_publish_min: med(rows.map((x) => mins(x.reviewed_at, x.published_at))),
    median_corrections: med(reviewed.map((x) => Number(x.corrections))), median_fields_verified: med(reviewed.map((x) => Number(x.fields_verified))),
  };
  r.info("Real (non-synthetic) discoveries measured", JSON.stringify(s));
  if (reviewed.length < 20) r.add("Enough reviewed records for an effort estimate", "≥ 20", `${reviewed.length}`, "NOT RUN");
  else r.info("Editor-minutes per published record (median review time)", `${s.median_review_min?.toFixed(1)} min`);
  return { results: r.results, summary: s };
}

// ─────────────────────────── 10. source probes ───────────────────────────
async function probes() {
  const r = new Recorder("10. Server-side source probes");
  const { loadSourceTable } = await import("../../src/lib/ingestion/probe");
  const { markdownTable } = await import("../../src/lib/ingestion/probe-report");
  const rows = await loadSourceTable(svc);
  const deployed = rows.filter((x) => x.row.deployed).length;
  r.info("Official sources registered (not synthetic)", String(rows.length));
  r.pass("Sources probed from a deployment", "all", `${deployed}/${rows.length}`, rows.length > 0 && deployed === rows.length);
  return { results: r.results, table: `\n### Source-by-source table\n\n${markdownTable(rows.map((x) => x.row))}` };
}

// ─────────────────────────── cleanup ───────────────────────────
async function cleanup() {
  const r = new Recorder("Cleanup");
  if (args.has("--keep")) { r.info("Throw-away accounts kept (--keep)", accounts.size + " accounts"); return r.results; }
  const errs: string[] = [];
  const note = async (p: PromiseLike<{ error: any }>, what: string) => { const x = await p; if (x.error) errs.push(`${what}: ${errText(x.error)}`); };
  await note(svc.from("discovered_items").delete().like("content_hash", `${RUN}%`), "discoveries");
  await note(svc.from("government_sources").delete().like("slug", `${RUN}%`), "sources");
  await note(svc.from("job_internal").delete().in("job_id", [...fixtures.jobs.values()]), "job_internal");
  await note(svc.from("jobs").delete().like("slug", `${RUN}%`), "jobs");
  await note(svc.from("recruitments").delete().like("title", `${RUN}%`), "recruitments");
  await note(svc.from("organizations").delete().like("slug", `${RUN}%`), "organizations");
  await note(svc.from("rate_limits").delete().like("bucket", `${RUN}%`), "rate limits");
  if (fixtures.cronRun) await note(svc.from("cron_runs").delete().eq("id", fixtures.cronRun), "cron run fixture");
  for (const id of createdUsers) {
    await svc.from("admin_users").delete().eq("user_id", id);
    const d = await svc.auth.admin.deleteUser(id);
    if (d.error) { errs.push(`user ${id.slice(0, 8)}: ${errText(d.error)} — banned instead`); await svc.auth.admin.updateUserById(id, { ban_duration: "876000h" }).catch(() => {}); }
  }
  const left = await svc.from("jobs").select("id,status").like("slug", `${RUN}%`);
  r.pass("Fixtures and throw-away accounts removed", "nothing left", errs.length ? errs.join("; ") : `jobs left: ${left.data?.length ?? 0}`, !errs.length && (left.data?.length ?? 0) === 0);
  r.info("Kept on purpose", "audit_logs rows written by this run (append-only) and the cron_runs rows of the lock check");
  return r.results;
}

async function main() {
  console.log(`Staging validation — ${target.label} — run ${RUN}`);
  let extra = "";
  let fatal = "";
  try {
    if (on("connection")) all.push(...(await connection()));
    if (on("schema")) all.push(...(await schema()));
    const needAccounts = ["auth", "rls", "audit"].some(on);
    if (needAccounts) {
      await setupFixtures();
      await makeAccount("authenticated", null);
      for (const role of ["moderator", "editor", "seo_manager", "content_manager", "admin", "super_admin"] as Role[]) await makeAccount(role, role);
      const victim = await makeAccount("victim", "moderator"); fixtures.victim = victim.id;
    }
    if (on("auth")) all.push(...(await auth()));
    if (on("rls")) { const x = await rls(); all.push(...x.results); extra += x.table; }
    if (on("public")) all.push(...(await publicRead()));
    if (on("audit")) all.push(...(await audit()));
    if (on("cron-lock")) all.push(...(await cronLock()));
    if (on("demo")) all.push(...(await demo()));
    if (on("effort")) { const x = await effort(); all.push(...x.results); }
    if (on("probes")) { const x = await probes(); all.push(...x.results); extra += x.table; }
  } catch (e) {
    fatal = (e as Error).stack ?? String(e);
    all.push({ section: "Run", check: "Validation run completed", expected: "no exception", got: errText(e), status: "FAIL" });
  } finally {
    all.push(...(await cleanup().catch((e) => [{ section: "Cleanup", check: "cleanup", expected: "ok", got: errText(e), status: "FAIL" as const }])));
  }
  const out = writeReport("validate", target, all, extra);
  console.log(`\n${all.filter((x) => x.status === "PASS").length} PASS, ${out.failed} FAIL, ${all.filter((x) => x.status === "NOT RUN").length} NOT RUN → ${out.md}`);
  for (const f of all.filter((x) => x.status === "FAIL")) console.log(`  FAIL ${f.section} — ${f.check}: ${f.got}`);
  if (fatal) console.error(fatal);
  process.exit(out.failed ? 1 : 0);
}
main();
