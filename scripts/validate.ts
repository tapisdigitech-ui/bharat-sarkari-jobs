/**
 * ONE command for the complete local validation (Phase 3.6 item 36):   npm run validate   [-- --quick] [-- --skip-browser]
 *
 *   lint · typecheck · unit · database (RLS, workflow, RLS matrix, verification) · migrations (fresh + every upgrade path +
 *   legacy data + audit) · data contract (demo vs Supabase adapter on the local stand-in) · source-failure drill · build ·
 *   security (bundle secret scan, refusal to start on unsafe config) · browser (admin, Phase 2B, Phase 3, Phase 3.6) ·
 *   public content safety · SEO safety
 *
 * Needs: PostgreSQL 16 binaries, Node 20+, Python 3 with Playwright + Chromium (see README "Testing"). Everything runs
 * against local PostgreSQL and the local Supabase API stand-in — NOT real Supabase. Prints a PASS/FAIL table; exit code 1
 * if any stage fails. Full log per stage: $VALIDATE_LOG_DIR (default /tmp/bsj-validate).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const quick = process.argv.includes("--quick");
const skipBrowser = process.argv.includes("--skip-browser");
const LOG = process.env.VALIDATE_LOG_DIR ?? "/tmp/bsj-validate";
mkdirSync(LOG, { recursive: true });
const ROOT = join(__dirname, "..");
type Row = { stage: string; ok: boolean; secs: number; detail: string };
const rows: Row[] = [];
const logFile = (stage: string) => join(LOG, `${stage.replace(/\W+/g, "-").replace(/^-|-$/g, "")}.log`);

function run(stage: string, cmd: string, detail: (out: string) => string = () => "", env: Record<string, string> = {}): boolean {
  const t0 = Date.now();
  process.stdout.write(`▶ ${stage} … `);
  const r = spawnSync("bash", ["-lc", cmd], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  writeFileSync(logFile(stage), out);
  const ok = r.status === 0;
  const secs = Math.round((Date.now() - t0) / 1000);
  let d = ""; try { d = detail(out); } catch { d = ""; }
  rows.push({ stage, ok, secs, detail: d });
  console.log(`${ok ? "PASS" : "FAIL"} (${secs}s) ${d}`);
  return ok;
}
const tap = (out: string) => { const p = /# pass (\d+)/.exec(out)?.[1], f = /# fail (\d+)/.exec(out)?.[1]; return p ? `${p} passed, ${f ?? 0} failed` : ""; };
const last = (re: RegExp) => (out: string) => [...out.matchAll(re)].map((m) => m[0]).join(" · ");

// Stand-in environment for build + start (never real keys).
const STUB_ENV = "source tests/harness/env.sh";

run("lint", "npm run lint");
run("typecheck", "npx tsc --noEmit -p .");
run("unit", "npm run test:unit", tap);
run("database", "npm run db:start >/dev/null 2>&1; npm run db:reset >/dev/null && npm run test:db", tap);
run("migrations", `npx tsx tests/harness/migration-check.ts ${quick ? "--quick" : ""}`, last(/MIGRATIONS: .*/g));
run("data contract (demo vs Supabase adapter, local stand-in)", "npm run test:contract", tap);
run("source failure drill", "bash tests/harness/with-stub.sh env NODE_OPTIONS=--conditions=react-server npx tsx tests/live/failure-recovery.ts", last(/FAILURE DRILL: .*/g));
const built = run("build", `npm run db:reset >/dev/null; fuser -k 54321/tcp >/dev/null 2>&1; (nohup npx tsx tests/harness/supabase-stub.ts >${LOG}/stub.log 2>&1 &); for i in $(seq 1 30); do curl -s localhost:54321/__stub/health >/dev/null && break; sleep 0.5; done; ${STUB_ENV} && npx next build`,
  (out) => (/warn/i.test(out.split("\n").filter((l) => /⚠|warn/i.test(l)).join("\n")) ? "warnings — see log" : "no warnings"));
if (built) {
  run("security: no secrets in client bundles", `${STUB_ENV} && npx tsx scripts/check-bundle-secrets.ts`, last(/(PASS|FAIL) .*/g));
  run("security: production refuses demo data / unsafe config", `${STUB_ENV} && fuser -k 3112/tcp >/dev/null 2>&1; (DATA_SOURCE=demo nohup npx next start -p 3112 >${LOG}/refuse.log 2>&1 &); sleep 6; code=$(curl -s -o /dev/null -w '%{http_code}' localhost:3112/jobs); fuser -k 3112/tcp >/dev/null 2>&1; grep -q 'DATA_SOURCE=demo is not allowed' ${LOG}/refuse.log && [ "$code" = "500" ] && echo "demo refused (HTTP $code)"`, last(/demo refused.*/g));
}
if (!skipBrowser && built) {
  const stage = "browser (admin · Phase 2B · Phase 3 · Phase 3.6 · content safety · SEO · audit)";
  run(stage, "E2E_SKIP_BUILD=1 E2E_LOG_DIR=" + LOG + " bash tests/e2e/run.sh", last(/\d+\/\d+ checks passed[^\n]*/g));
  const out = readFileSync(logFile(stage), "utf8");
  for (const [label, re] of [["public content safety", /(\d+)\/(\d+) checks passed \(content safety\)/], ["SEO safety", /(\d+)\/(\d+) checks passed \(SEO safety\)/], ["accessibility + performance audit", /(\d+)\/(\d+) checks passed \(audit\)/]] as const) {
    const m = re.exec(out);
    rows.push({ stage: `  ↳ ${label}`, ok: !!m && m[1] === m[2], secs: 0, detail: m ? `${m[1]}/${m[2]}` : "did not run" });
  }
}

const w = Math.max(...rows.map((r) => r.stage.length));
console.log(`\n${"═".repeat(w + 30)}\nLOCAL VALIDATION — local PostgreSQL + Supabase API stand-in (real Supabase validation pending)\n${"─".repeat(w + 30)}`);
for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.stage.padEnd(w)}  ${r.secs ? `${r.secs}s`.padStart(5) : "     "}  ${r.detail}`);
const failed = rows.filter((r) => !r.ok);
console.log(`${"─".repeat(w + 30)}\n${failed.length ? `FAIL — ${failed.length} of ${rows.length} stages failed (logs: ${LOG})` : `PASS — all ${rows.length} stages passed`}\n${"═".repeat(w + 30)}`);
process.exit(failed.length ? 1 : 0);
