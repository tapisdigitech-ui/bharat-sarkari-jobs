/**
 * Scheduled jobs — the ONE place schedules are defined (Phase 3.6 item 29).
 * `npm run gen:cron` writes vercel.json from this list (a test fails if they drift apart); `npm run gen:cron -- --crontab`
 * prints the same schedule for any other scheduler (system cron, GitHub Actions, pg_cron + pg_net). Times are UTC.
 * Each job is an authenticated GET endpoint: `Authorization: Bearer $CRON_SECRET`.
 * To add a future ingestion job: add an entry here and a route under src/app/api/cron/<name>/route.ts using runCron().
 */
export interface CronJob { name: string; path: string; schedule: string; description: string; batchEnv?: string; defaultBatch?: number }

export const CRON_JOBS: CronJob[] = [
  { name: "expire", path: "/api/cron/expire", schedule: "30 18 * * *", description: "Mark jobs whose official last date has passed as expired (00:00 IST)." },
  { name: "sources", path: "/api/cron/sources", schedule: "15 */3 * * *", description: "Check up to N due official sources, one after another; findings go to the review queue.", batchEnv: "SOURCE_CHECKS_PER_RUN", defaultBatch: 3 },
  { name: "links", path: "/api/cron/links", schedule: "0 21 * * *", description: "Check the least-recently-checked official links; flag (never delete) broken ones; mark stale content for re-verification.", batchEnv: "LINK_CHECKS_PER_RUN", defaultBatch: 40 },
  { name: "cleanup", path: "/api/cron/cleanup", schedule: "40 21 * * *", description: "Purge stored notice text past its retention date, old rate-limit windows and old cron-run records." },
];

export const batchSize = (job: CronJob) => {
  const v = job.batchEnv ? Number(process.env[job.batchEnv]) : NaN;
  return Number.isInteger(v) && v > 0 && v <= 100 ? v : job.defaultBatch ?? 0;
};
