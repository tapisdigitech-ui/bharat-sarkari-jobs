/** Application security units (Phase 3.6 items 27–30): redaction, rate limits, redirects, URL safety, cron config. No network. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { redact } from "../src/lib/log";
import { safeNext } from "../src/lib/auth/safe-next";
import { CRON_JOBS } from "../src/config/cron";

describe("logging never leaks secrets", () => {
  test("sensitive keys, JWTs, secret keys, bearer tokens and emails are redacted", () => {
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0", "c2lnbmF0dXJlLXNpZ25hdHVyZQ"].join(".");   // built at runtime: no secret-shaped literal in the repo
    const out = JSON.stringify(redact({
      password: "hunter2", apiKey: "k", SUPABASE_SERVICE_ROLE_KEY: "x", authorization: "Bearer abc", nested: { cookie: "sb=1", note: `token ${jwt} here` },
      msg: "sb_" + "secret_abcdefghijklmnop failed for ravi.kumar@example.in with Bearer abcdefghijklmnop", ok: 3,
    }));
    for (const leak of ["hunter2", jwt, "sb_" + "secret_abcdefghijklmnop", "ravi.kumar", "abcdefghijklmnop\"", "sb=1"]) assert.equal(out.includes(leak), false, leak);
    assert.match(out, /\*\*\*@example\.in/);
    assert.match(out, /"ok":3/);
  });
  test("errors keep their message (redacted) and nothing else", () => {
    assert.deepEqual(redact(new Error("login failed for a@b.gov.in")), { name: "Error", message: "login failed for ***@b.gov.in" });
  });
  test("no source file logs a password, token or key directly", () => {
    const hits: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n)) {
      const t = readFileSync(p, "utf8");
      for (const m of t.matchAll(/console\.(?:log|info|warn|error)\(([^)]*)\)/g)) if (/password|SERVICE_ROLE|CRON_SECRET|PREVIEW_SECRET|access_token|refresh_token/i.test(m[1])) hits.push(`${relative(process.cwd(), p)}: ${m[0].slice(0, 80)}`);
    } } };
    walk(join(__dirname, "../src"));
    assert.deepEqual(hits, []);
  });
});

describe("open redirects", () => {
  test("only same-site admin paths are followed after login", () => {
    for (const bad of ["https://evil.example", "//evil.example/admin", "/admin/login", "/\\evil", "/jobs", "javascript:alert(1)", "/admin\\..\\x", null, 42])
      assert.equal(safeNext(bad), "/admin", String(bad));
    for (const good of ["/admin", "/admin/jobs?view=mine", "/admin/review/123#x"]) assert.equal(safeNext(good), good);
  });
});

describe("rate limiter (in-process store)", () => {
  test("allows up to the limit per window, then refuses; a new window starts fresh; buckets are independent", async () => {
    process.env.RATE_LIMIT_STORE = "memory";
    const { __memoryHitForTests: hit, bucketKey } = await import("../src/lib/rate-limit");
    const t = Date.UTC(2026, 8, 26, 10, 0, 5);
    const b = bucketKey("loginIp", "203.0.113.9");
    const results = Array.from({ length: 21 }, () => hit(b, 20, 900, t));
    assert.equal(results.filter(Boolean).length, 20); assert.equal(results[20], false);
    assert.equal(hit(b, 20, 900, t + 900_000), true, "next window");
    assert.equal(hit(bucketKey("loginIp", "203.0.113.10"), 20, 900, t), true, "another IP is unaffected");
    assert.doesNotMatch(b, /203\.0\.113/, "raw IPs never become keys");
  });
});

describe("cron", () => {
  test("vercel.json is generated from src/config/cron.ts (no drift)", () => {
    const v = JSON.parse(readFileSync(join(__dirname, "../vercel.json"), "utf8"));
    assert.deepEqual(v.crons, CRON_JOBS.map((j) => ({ path: j.path, schedule: j.schedule })));
  });
  test("every cron job has a route that goes through runCron (secret, rate limit, run record)", () => {
    for (const j of CRON_JOBS) {
      const src = readFileSync(join(__dirname, `../src/app${j.path}/route.ts`), "utf8");
      assert.match(src, new RegExp(`runCron\\(req, "${j.name}"`), j.path);
      assert.doesNotMatch(src, /export async function POST/, `${j.path}: GET only`);
    }
    for (const d of readdirSync(join(__dirname, "../src/app/api/cron"))) assert.ok(CRON_JOBS.some((j) => j.path === `/api/cron/${d}`), `route ${d} missing from the schedule config`);
  });
  test("schedules are valid 5-field cron expressions", () => {
    for (const j of CRON_JOBS) assert.match(j.schedule, /^(\S+\s){4}\S+$/, j.name);
  });
});

describe("API surface", () => {
  test("the only API routes are the secret-protected cron endpoints", () => {
    const routes: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n === "route.ts") routes.push(relative(join(__dirname, "../src/app"), p)); } };
    walk(join(__dirname, "../src/app/api"));
    assert.ok(routes.every((r) => r.startsWith("api/cron/")), routes.join(", "));
  });
  test("server actions check permissions before touching data (every exported action calls a guard)", () => {
    const bad: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/actions\.ts$/.test(n)) {
      const t = readFileSync(p, "utf8"); if (!/^"use server"/m.test(t)) continue;
      for (const m of t.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)) {
        if (m[1] === "parseAdapterConfig" || m[1] === "signInAction") continue;       // pure validation / the login itself
        if (!/assertPermission|requireStaff|getStaff|guard\(|staffGuard|requireAnyStaff|signOut/.test(m[2])) bad.push(`${relative(process.cwd(), p)}: ${m[1]}`);
      }
    } } };
    walk(join(__dirname, "../src/app"));
    assert.deepEqual(bad, []);
  });
});
