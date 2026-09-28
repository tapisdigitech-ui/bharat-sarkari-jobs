/**
 * The Phase 3.7 source-by-source table, built from the latest source_probes row per source plus the editorial counts
 * (source_record_counts). Pure: used by the admin page, its Markdown export and scripts/staging.
 *
 * Column states: PASS / PASS WITH ADAPTER / MANUAL / BLOCKED / FAILED / UNKNOWN. UNKNOWN always means "no evidence yet",
 * never "probably fine". A probe that did not run on a deployment is labelled as such in Notes and never counts as the
 * server-side result the pilot asks for.
 */
export type State = "PASS" | "PASS WITH ADAPTER" | "MANUAL" | "BLOCKED" | "FAILED" | "UNKNOWN";
export interface ProbeLike {
  source_id: string; probed_at?: string | null; runtime: string; robots_outcome: string; robots_status: number | null; http_status: number | null;
  fetch_outcome: string | null; final_url?: string | null; redirected: boolean | null; content_type: string | null; duration_ms: number | null;
  discovered: number | null; notice_url: string | null; notice_status?: number | null; verdict: State; notes: string | null; error: string | null;
  extraction?: Record<string, unknown> | null;
}
export interface Counts { discovered?: number | string | null; pending?: number | string | null; published?: number | string | null }
export interface TableRow { source: string; server: State; robots: State; discovery: State; extraction: State; review: State; publish: State; notes: string; deployed: boolean }

export const isDeployment = (runtime: string) => /^vercel /.test(runtime);

export function tableRow(source: string, p: ProbeLike | null, c: Counts | undefined): TableRow {
  const n = (v: unknown) => Number(v ?? 0);
  const reviewed = n(c?.discovered) - n(c?.pending);
  const review: State = n(c?.discovered) === 0 ? "UNKNOWN" : reviewed > 0 ? "PASS" : "UNKNOWN";
  const publish: State = n(c?.published) > 0 ? "PASS" : "UNKNOWN";
  const edNote = `${n(c?.discovered)} discovered, ${reviewed} reviewed, ${n(c?.published)} published`;
  if (!p) return { source, server: "UNKNOWN", robots: "UNKNOWN", discovery: "UNKNOWN", extraction: "UNKNOWN", review, publish, notes: `Not probed yet. ${edNote}.`, deployed: false };

  const robots: State = ["allowed", "no_file"].includes(p.robots_outcome) ? "PASS" : ["disallowed", "refused"].includes(p.robots_outcome) ? "BLOCKED"
    : p.robots_outcome === "unreachable" ? "FAILED" : "UNKNOWN";
  let server: State = "UNKNOWN";
  if (p.http_status && [401, 403, 429].includes(p.http_status)) server = "BLOCKED";
  else if (p.verdict === "BLOCKED" && p.http_status && p.http_status < 300) server = "BLOCKED";      // challenge page served with 200
  else if (p.http_status && p.http_status >= 200 && p.http_status < 300) server = "PASS";
  else if (p.fetch_outcome || p.http_status) server = "FAILED";
  else if (robots === "FAILED") server = "FAILED";
  if (p.robots_status && [401, 403, 429].includes(p.robots_status)) server = "BLOCKED";

  const discovery: State = p.discovered == null ? "UNKNOWN" : p.discovered > 0 ? (p.verdict === "PASS WITH ADAPTER" ? "PASS WITH ADAPTER" : "PASS") : "MANUAL";
  let extraction: State = "UNKNOWN";
  if (p.notice_url) extraction = ["PASS", "PASS WITH ADAPTER", "MANUAL", "FAILED", "BLOCKED"].includes(p.verdict) ? p.verdict : "UNKNOWN";
  else if (discovery === "MANUAL") extraction = "MANUAL";

  const deployed = isDeployment(p.runtime);
  const where = deployed ? p.runtime : `${p.runtime} — NOT the deployed server`;
  const http = p.http_status ? `HTTP ${p.http_status}${p.redirected ? " after redirect" : ""}${p.content_type ? `, ${p.content_type.split(";")[0]}` : ""}${p.duration_ms != null ? `, ${p.duration_ms} ms` : ""}` : p.fetch_outcome ?? "no listing request";
  const notes = [`${p.verdict}: ${p.notes ?? ""}`.trim(), http, p.error ? `error: ${p.error}` : "", `${edNote}`, `probed ${p.probed_at ? p.probed_at.slice(0, 16).replace("T", " ") : "?"} from ${where}`].filter(Boolean).join(" · ");
  return { source, server, robots, discovery, extraction, review, publish, notes, deployed };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

export function markdownTable(rows: TableRow[]): string {
  const head = "| Source | Server Access | Robots | Discovery | Extraction | Review | Publish | Notes |\n|---|---|---|---|---|---|---|---|";
  const body = rows.map((r) => `| ${cell(r.source)} | ${r.server} | ${r.robots} | ${r.discovery} | ${r.extraction} | ${r.review} | ${r.publish} | ${cell(r.notes)} |`);
  const local = rows.filter((r) => r.notes && !r.deployed && !/^Not probed/.test(r.notes)).length;
  const foot = local ? `\n\n> ${local} of ${rows.length} probe result(s) did not come from a deployment. They do not answer "can the deployed server reach this source".` : "";
  return [head, ...body].join("\n") + foot + "\n";
}
