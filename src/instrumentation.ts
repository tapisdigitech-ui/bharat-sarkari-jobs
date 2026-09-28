/**
 * Runs once when a server instance starts. Checks the environment (src/lib/env-rules.ts) and refuses to serve a
 * production build that is misconfigured — demo data without the explicit switch, a service-role key exposed through a
 * NEXT_PUBLIC_ variable, missing CRON/PREVIEW secrets, test switches on the live site. Messages name variables, never values.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv, isBuilt } = await import("./lib/env-rules");
  const { errors, warnings } = validateEnv(process.env);
  for (const w of warnings) console.warn(`[env] warning: ${w}`);
  if (!errors.length) return;
  if (!isBuilt(process.env)) { for (const e of errors) console.warn(`[env] (would refuse in production) ${e}`); return; }
  for (const e of errors) console.error(`[env] error: ${e}`);
  throw new Error(`Refusing to start: ${errors.length} environment error(s). See the log lines above and .env.example.`);
}
