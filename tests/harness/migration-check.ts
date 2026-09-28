/**
 * MIGRATION CHECK (local PostgreSQL 16 + tests/harness/bootstrap.sql — a stand-in for the Supabase roles/auth schema).
 *
 *  1. order      — file names have unique, strictly increasing numeric prefixes
 *  2. fresh      — every migration applies in order to an empty database (errors are fatal)
 *  3. stepwise   — for EVERY prefix 0001..k: apply the prefix, then the rest (simulates a project created at any earlier phase)
 *  4. legacy     — tests/harness/upgrade-test.sh: Phase 2A schema WITH legacy rows, then everything after (data must survive)
 *  5. equivalent — the schema after the legacy upgrade is identical to the fresh schema (pg_dump --schema-only, normalised)
 *  6. re-run     — which migrations can safely be applied a second time (report; 0020/0021 must be re-runnable)
 *  7. audit      — RLS on every table, SECURITY DEFINER search_path, security_invoker views, FK indexes, no TRUNCATE for
 *                  API roles, SECURITY DEFINER functions callable by anon limited to an allowlist
 *  8. seed       — the staging synthetic seed refuses to run without its flag, is idempotent and publishes nothing
 *
 * Usage: npx tsx tests/harness/migration-check.ts [--quick]   (--quick skips the stepwise matrix)
 * Exit code 0 only if every check passes. Not a test of real Supabase (see docs/SUPABASE_SETUP.md).
 */
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const ROOT = resolve(__dirname, "../..");
const DIR = process.env.PGTEST_DIR ?? "/home/claude/.pgtest", PORT = process.env.PGTEST_PORT ?? "5544";
const MIG = join(ROOT, "supabase/migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const quick = process.argv.includes("--quick");
const results: { name: string; ok: boolean; detail: string }[] = [];
const rec = (name: string, ok: boolean, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const sh = (cmd: string) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
const psql = (db: string, args: string) => sh(`psql -h ${DIR} -p ${PORT} -U postgres -v ON_ERROR_STOP=1 -q -d ${db} ${args}`);
function createDb(db: string) {
  psql("postgres", `-c "drop database if exists ${db} with (force)" -c "create database ${db} owner postgres"`);
  psql(db, `-f ${join(ROOT, "tests/harness/bootstrap.sql")}`);
}
const dropDb = (db: string) => psql("postgres", `-c "drop database if exists ${db} with (force)"`);
function apply(db: string, list: string[]): string | null {
  for (const f of list) {
    try { psql(db, `-f ${join(MIG, f)}`); } catch (e) { return `${f}: ${String((e as { stderr?: string }).stderr ?? e).split("\n").find((l) => /ERROR/.test(l)) ?? e}`; }
  }
  return null;
}
function schemaDump(db: string) {
  return sh(`pg_dump -h ${DIR} -p ${PORT} -U postgres --schema-only --no-owner --no-privileges -n public ${db}`)
    .split("\n").filter((l) => !/^--|^SET |^SELECT pg_catalog|^\\(un)?restrict/.test(l) && l.trim()).join("\n");
}

async function main() {
  // 1. order
  const nums = files.map((f) => Number(f.slice(0, 4)));
  const ordered = files.every((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)) && nums.every((n, i) => i === 0 || n > nums[i - 1]);
  rec("order: unique increasing prefixes", ordered, files.join(" → "));

  // 2. fresh
  createDb("mig_fresh");
  const fresh = apply("mig_fresh", files);
  rec("fresh: all migrations apply to an empty database", !fresh, fresh ?? `${files.length} files`);

  // 3. stepwise upgrade matrix
  if (!quick) {
    const failed: string[] = [];
    for (let k = 1; k < files.length; k++) {
      createDb("mig_step");
      const a = apply("mig_step", files.slice(0, k));
      const b = a ?? apply("mig_step", files.slice(k));
      if (a || b) failed.push(`after ${files[k - 1]}: ${a ?? b}`);
    }
    dropDb("mig_step");
    rec("stepwise: prefix 0001..k then the rest, for every k", failed.length === 0, failed.length ? failed.join("; ") : `${files.length - 1} upgrade paths`);
  }

  // 4. legacy data upgrade (keeps its database for step 5)
  let legacyOk = false;
  try { const out = sh(`KEEP_DB=1 bash ${join(ROOT, "tests/harness/upgrade-test.sh")}`); legacyOk = /UPGRADE OK/.test(out); rec("legacy: Phase 2A data survives the upgrade", legacyOk, out.trim().split("\n").pop()); }
  catch (e) { rec("legacy: Phase 2A data survives the upgrade", false, String((e as { stdout?: string }).stdout ?? e).slice(-400)); }

  // 5. equivalence
  if (legacyOk) {
    const a = schemaDump("mig_fresh"), b = schemaDump("app_upgrade");
    const al = new Set(a.split("\n")), bl = new Set(b.split("\n"));
    const onlyFresh = [...al].filter((l) => !bl.has(l)), onlyUp = [...bl].filter((l) => !al.has(l));
    rec("equivalent: upgraded schema == fresh schema", a === b, a === b ? "identical" : `only in fresh: ${onlyFresh.slice(0, 5).join(" | ")}; only in upgraded: ${onlyUp.slice(0, 5).join(" | ")}`);
    dropDb("app_upgrade");
  }

  // 6. re-run safety (report)
  const rerunnable: string[] = [], notRerunnable: string[] = [];
  for (const f of files) {
    createDb("mig_rerun"); apply("mig_rerun", files);
    (apply("mig_rerun", [f]) ? notRerunnable : rerunnable).push(f.slice(0, 4));
  }
  dropDb("mig_rerun");
  const mustRerun = files.filter((f) => /^(0020|0021)_/.test(f)).map((f) => f.slice(0, 4));
  rec("re-run: permissions seed + hardening are re-runnable", mustRerun.every((n) => rerunnable.includes(n)), `re-runnable: ${rerunnable.join(",") || "none"}; one-shot (tracked by the migration table): ${notRerunnable.join(",") || "none"}`);

  // 7. audit (fresh database)
  const c = new pg.Client({ host: DIR, port: Number(PORT), user: "postgres", database: "mig_fresh" }); await c.connect();
  const q = async (sql: string) => (await c.query(sql)).rows.map((r) => Object.values(r).join(" "));
  const noRls = await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity`);
  rec("audit: RLS enabled on every table", noRls.length === 0, noRls.join(", "));
  const denyAll = await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity and not exists(select 1 from pg_policy p where p.polrelid=c.oid)`);
  rec("audit: tables with RLS but no policy (deny-all, reported)", true, denyAll.join(", ") || "none");
  const noPath = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) x where x like 'search_path=%')`);
  rec("audit: every SECURITY DEFINER function pins search_path", noPath.length === 0, noPath.join(", "));
  // Phase 3.7 (restore drill): pg_restore runs with an empty search_path, so functions used by constraints/indexes/defaults must pin it.
  const unsafe = await q(`select fn::text from restore_unsafe_functions()`);
  rec("audit: functions used by constraints/indexes/defaults pin search_path (restorable with pg_restore)", unsafe.length === 0, unsafe.join(", "));
  const views = await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and not coalesce(c.reloptions::text[] @> array['security_invoker=true'],false)`);
  rec("audit: every view is security_invoker (RLS applies through views)", views.length === 0, views.join(", "));
  const fk = await q(`select c.conrelid::regclass||'('||string_agg(a.attname,',')||')' from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum = any(c.conkey) join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and n.nspname='public' and not exists (select 1 from pg_index i where i.indrelid=c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] @> c.conkey and c.conkey @> (i.indkey::int2[])[0:array_length(c.conkey,1)-1]) group by c.oid, c.conrelid`);
  rec("audit: every foreign key has an index", fk.length === 0, fk.join(", "));
  const trunc = await q(`select table_name||':'||grantee||':'||privilege_type from information_schema.role_table_grants where grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')`);
  rec("audit: API roles hold no TRUNCATE/REFERENCES/TRIGGER", trunc.length === 0, trunc.slice(0, 10).join(", "));
  const ANON_DEFINER_OK = ["can_modify_job", "current_staff_role", "has_permission", "is_staff", "content_is_public"];   // read-only yes/no questions (about the caller, or whether a record is public)
  const anonDef = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'execute')`);   // trigger functions cannot be called directly
  const unexpected = anonDef.filter((f) => !ANON_DEFINER_OK.includes(f));
  rec("audit: SECURITY DEFINER functions callable by anon are allow-listed", unexpected.length === 0, unexpected.length ? `unexpected: ${unexpected.join(", ")}` : anonDef.join(", "));
  const writeRpc = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute') and p.proname ~ '^(save_|transition_|approve_|apply_|merge_|insert_|record_|mark_|expire_|delete_|annotate_|reject_)'`);
  rec("audit: anon cannot execute any write RPC", writeRpc.length === 0, writeRpc.join(", "));
  await c.end();

  // 8. staging synthetic seed: refuses without the explicit flag; loads twice without duplicates; publishes nothing
  const seed = join(ROOT, "supabase/seed/staging_synthetic.sql");
  let refused = false; try { psql("mig_fresh", `-f ${seed}`); } catch { refused = true; }
  const withFlag = () => sh(`(echo "set bsj.seed_target = 'staging';"; cat ${seed}) | psql -h ${DIR} -p ${PORT} -U postgres -v ON_ERROR_STOP=1 -q -d mig_fresh`);
  let loaded = true; try { withFlag(); withFlag(); } catch { loaded = false; }
  const counts = loaded ? psql("mig_fresh", `-At -c "select (select count(*) from jobs)||'/'||(select count(*) from jobs where status <> 'draft')||'/'||(select count(*) from discovered_items where is_synthetic)"`).trim() : "";
  rec("staging seed: refused without bsj.seed_target=staging; idempotent; nothing published", refused && loaded && counts === "2/0/2", `refused=${refused} loaded=${loaded} jobs/non-draft/discoveries=${counts}`);
  dropDb("mig_fresh");

  const failed = results.filter((r) => !r.ok);
  console.log(`\nMIGRATIONS: ${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join("; ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
