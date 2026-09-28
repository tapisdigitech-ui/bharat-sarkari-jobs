/** Environment safety rules (src/lib/env-rules.ts): data source, demo-in-production refusal, indexing, secret exposure. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoInProductionError, indexingAllowed, jwtRole, resolveDataSource, validateEnv } from "../src/lib/env-rules";

const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString("base64url")}.sig`;
const ANON = jwt("anon"), SERVICE = jwt("service_role");
const PROD_OK = {
  NODE_ENV: "production", VERCEL_ENV: "production", DATA_SOURCE: "supabase",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  CRON_SECRET: "c".repeat(32), PREVIEW_SECRET: "p".repeat(32), NEXT_PUBLIC_SITE_URL: "https://example.in",
};

test("data source: development defaults to demo, a built app defaults to supabase", () => {
  assert.equal(resolveDataSource({}), "demo");
  assert.equal(resolveDataSource({ NODE_ENV: "development" }), "demo");
  assert.equal(resolveDataSource({ NODE_ENV: "production" }), "supabase");
  assert.equal(resolveDataSource({ NODE_ENV: "development", DATA_SOURCE: "supabase" }), "supabase");
  assert.equal(resolveDataSource({ NODE_ENV: "production", DATA_SOURCE: "nonsense" }), "supabase");
});

test("production refuses demo data unless explicitly enabled", () => {
  assert.throws(() => resolveDataSource({ NODE_ENV: "production", DATA_SOURCE: "demo" }), DemoInProductionError);
  assert.throws(() => resolveDataSource({ NODE_ENV: "production", DATA_SOURCE: "demo", ALLOW_DEMO_IN_PRODUCTION: "1" }), DemoInProductionError);
  assert.throws(() => resolveDataSource({ NODE_ENV: "production", DATA_SOURCE: "demo", ALLOW_DEMO_IN_PRODUCTION: "false" }), DemoInProductionError);
  assert.equal(resolveDataSource({ NODE_ENV: "production", DATA_SOURCE: "demo", ALLOW_DEMO_IN_PRODUCTION: "true" }), "demo");
  // …and even with the switch, the live production site is refused at start-up.
  const r = validateEnv({ ...PROD_OK, DATA_SOURCE: "demo", ALLOW_DEMO_IN_PRODUCTION: "true" });
  assert.ok(r.errors.some((e) => e.includes("ALLOW_DEMO_IN_PRODUCTION")), r.errors.join("\n"));
});

test("indexing is off by default and forced off for demo data and preview deployments", () => {
  assert.equal(indexingAllowed({}), false);
  assert.equal(indexingAllowed({ ...PROD_OK }), false);                                   // ALLOW_INDEXING unset
  assert.equal(indexingAllowed({ ...PROD_OK, ALLOW_INDEXING: "1" }), false);               // only exactly "true"
  assert.equal(indexingAllowed({ ...PROD_OK, ALLOW_INDEXING: "true" }), true);
  assert.equal(indexingAllowed({ ALLOW_INDEXING: "true" }), false);                        // dev → demo
  assert.equal(indexingAllowed({ ALLOW_INDEXING: "true", DATA_SOURCE: "demo" }), false);
  assert.equal(indexingAllowed({ ...PROD_OK, ALLOW_INDEXING: "true", DATA_SOURCE: "demo", ALLOW_DEMO_IN_PRODUCTION: "true" }), false);
  assert.equal(indexingAllowed({ ...PROD_OK, ALLOW_INDEXING: "true", VERCEL_ENV: "preview" }), false);
  assert.equal(indexingAllowed({ NODE_ENV: "production", DATA_SOURCE: "demo", ALLOW_INDEXING: "true" }), false); // refused config → off
});

test("a correct production configuration has no errors", () => {
  assert.deepEqual(validateEnv(PROD_OK).errors, []);
});

test("service-role key exposed through NEXT_PUBLIC_* is an error", () => {
  assert.equal(jwtRole(SERVICE), "service_role");
  assert.equal(jwtRole(ANON), "anon");
  assert.equal(jwtRole("not-a-jwt"), null);
  const swapped = validateEnv({ ...PROD_OK, NEXT_PUBLIC_SUPABASE_ANON_KEY: SERVICE });
  assert.ok(swapped.errors.some((e) => e.startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY")), swapped.errors.join("\n"));
  const newFormat = validateEnv({ ...PROD_OK, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_" + "secret_abcdefghijklmnop" });
  assert.ok(newFormat.errors.length > 0);
  const named = validateEnv({ ...PROD_OK, NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "whatever" });
  assert.ok(named.errors.some((e) => e.startsWith("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")));
  const copy = validateEnv({ ...PROD_OK, NEXT_PUBLIC_DEBUG: PROD_OK.CRON_SECRET });
  assert.ok(copy.errors.some((e) => e.includes("same value as CRON_SECRET")));
  const wrongKey = validateEnv({ ...PROD_OK, SUPABASE_SERVICE_ROLE_KEY: ANON });
  assert.ok(wrongKey.errors.some((e) => e.includes('"anon" key')));
});

test("error messages never contain secret values", () => {
  const r = validateEnv({ ...PROD_OK, NEXT_PUBLIC_SUPABASE_ANON_KEY: SERVICE, NEXT_PUBLIC_X: PROD_OK.CRON_SECRET, CRON_SECRET: PROD_OK.CRON_SECRET });
  const all = [...r.errors, ...r.warnings].join("\n");
  for (const secret of [SERVICE, PROD_OK.CRON_SECRET, PROD_OK.PREVIEW_SECRET]) assert.equal(all.includes(secret), false);
});

test("production needs CRON_SECRET, PREVIEW_SECRET, site URL and Supabase URL/key", () => {
  for (const k of ["CRON_SECRET", "PREVIEW_SECRET", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) {
    const e: Record<string, string | undefined> = { ...PROD_OK }; delete e[k];
    assert.ok(validateEnv(e).errors.length > 0, `missing ${k} should be an error`);
  }
  assert.ok(validateEnv({ ...PROD_OK, CRON_SECRET: "short" }).errors.length > 0);
  // development: the same gaps are warnings at most (local work is not blocked)
  assert.deepEqual(validateEnv({ NODE_ENV: "development", DATA_SOURCE: "supabase" }).errors, []);
});

test("test-only switches are errors on the live site", () => {
  for (const k of ["ALLOW_PRIVATE_SOURCE_HOSTS", "SOURCE_MIN_DELAY_MS"]) {
    assert.ok(validateEnv({ ...PROD_OK, [k]: "1" }).errors.some((e) => e.startsWith(k)), k);
    assert.deepEqual(validateEnv({ ...PROD_OK, VERCEL_ENV: "preview", [k]: "1" }).errors, [], `${k} allowed on preview`);
  }
});

test("indexing on the live site requires an https site URL", () => {
  assert.ok(validateEnv({ ...PROD_OK, ALLOW_INDEXING: "true", NEXT_PUBLIC_SITE_URL: "http://example.in" }).errors.length > 0);
  assert.deepEqual(validateEnv({ ...PROD_OK, ALLOW_INDEXING: "true" }).errors, []);
});
