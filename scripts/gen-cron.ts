/** Writes vercel.json "crons" from src/config/cron.ts (or prints a crontab with --crontab). */
import { readFileSync, writeFileSync } from "node:fs";
import { CRON_JOBS } from "../src/config/cron";

if (process.argv.includes("--crontab")) {
  console.log("# UTC. Replace SITE and SECRET; every call needs the Authorization header.");
  for (const j of CRON_JOBS) console.log(`${j.schedule} curl -fsS -H "Authorization: Bearer $SECRET" "$SITE${j.path}"   # ${j.name}: ${j.description}`);
} else {
  const cur = JSON.parse(readFileSync("vercel.json", "utf8"));
  cur.crons = CRON_JOBS.map((j) => ({ path: j.path, schedule: j.schedule }));
  writeFileSync("vercel.json", JSON.stringify(cur, null, 2) + "\n");
  console.log(`vercel.json: ${CRON_JOBS.length} cron jobs`);
}
