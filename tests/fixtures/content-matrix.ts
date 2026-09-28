/**
 * CONTENT MATRIX fixture (synthetic, local PostgreSQL only). For every public content kind it creates one record in each
 * lifecycle state, through the real workflow functions as an editor — so the database's own publish gates and triggers run.
 *
 *   listed:    published, updated                 — in listings, search, sitemap, structured data
 *   reachable: expired                            — detail page still opens (clearly marked closed) but is never listed,
 *                                                   never in the sitemap and never carries JobPosting data
 *   hidden:   draft, review, unpublished (published → back to draft), expired, archived (published → expired → archived)
 *
 * Every title carries a unique marker (e.g. "CMXHIDDEN-draft-job") so tests can search rendered HTML, sitemap XML,
 * JSON-LD and search results for anything that must never be public. Used by tests/data-contract.test.ts and
 * tests/e2e/content_safety.ts.
 */
import { Session, U, admin, jobPayload, user, addDays } from "../db";

export type Kind = "job" | "recruitment" | "exam" | "admit_card" | "result" | "answer_key" | "calendar";
export type State = "published" | "updated" | "draft" | "review" | "unpublished" | "archived" | "expired";
export type Visibility = "listed" | "reachable" | "hidden";
export interface Row { kind: Kind; state: State; id: string; slug: string; title: string; visibility: Visibility }

export const VISIBLE_STATES: State[] = ["published", "updated"];
export const visibilityOf = (state: State): Visibility => (VISIBLE_STATES.includes(state) ? "listed" : state === "expired" ? "reachable" : "hidden");
export const marker = (kind: Kind, state: State) => `CMX${{ listed: "PUBLIC", reachable: "CLOSED", hidden: "HIDDEN" }[visibilityOf(state)]}-${state}-${kind.replace("_", "")}`;

const TABLE: Record<Exclude<Kind, "job">, string> = { recruitment: "recruitments", exam: "exams", admit_card: "admit_cards", result: "results", answer_key: "answer_keys", calendar: "exam_calendar" };
const SRC = { source_name: "Official website (synthetic fixture)", official_website_url: "https://cmx.example.gov.in", source_checked_at: new Date().toISOString() };

async function ins(s: Session, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const r = await s.q(`insert into ${table} (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id, slug`, cols.map((c) => row[c]));
  return r[0] as { id: string; slug: string };
}

export async function seedContentMatrix(): Promise<{ rows: Row[]; orgSlug: string; examSlug: string }> {
  const c = await admin();
  const orgName = "CMX Synthetic Recruitment Board";
  await c.query("insert into organizations (name, slug, level, official_website) values ($1, 'cmx-synthetic-recruitment-board', 'central', 'https://cmx.example.gov.in') on conflict (slug) do nothing", [orgName]);
  const orgId: string = (await c.query("select id from organizations where slug='cmx-synthetic-recruitment-board'")).rows[0].id;
  const resultType: number = (await c.query("select id from result_types order by sort_order limit 1")).rows[0].id;
  const akType: number = (await c.query("select id from answer_key_types order by sort_order limit 1")).rows[0].id;
  await c.end();

  const s = await Session.open(); await s.as(user(U.ed));
  const rows: Row[] = [];
  const states: State[] = ["published", "updated", "draft", "review", "unpublished", "expired", "archived"];

  // Exams first (others link to the visible exam).
  const base: Record<Exclude<Kind, "job">, (t: string) => Record<string, unknown>> = {
    exam: (t) => ({ name: t, organization_id: orgId, level: "central", is_all_india: true, ...SRC }),
    recruitment: (t) => ({ title: t, organization_id: orgId, level: "central", is_all_india: true, ...SRC, official_notification_url: "https://cmx.example.gov.in/n.pdf" }),
    admit_card: (t) => ({ title: t, organization_id: orgId, is_all_india: true, ...SRC }),
    result: (t) => ({ title: t, organization_id: orgId, is_all_india: true, result_date: addDays(-3), result_date_status: "official", result_type_id: resultType, ...SRC, official_result_url: "https://cmx.example.gov.in/result" }),
    answer_key: (t) => ({ title: t, organization_id: orgId, is_all_india: true, answer_key_type_id: akType, release_date: addDays(-2), release_date_status: "official", ...SRC, official_answer_key_url: "https://cmx.example.gov.in/key" }),
    calendar: (t) => ({ title: t, organization_id: orgId, is_all_india: true, exam_type: "recruitment", exam_date: addDays(60), exam_date_status: "official", ...SRC }),
  };
  const tr = (kind: string, id: string, to: string) => s.q("select transition_content($1,$2,$3::content_status,null)", [kind === "calendar" ? "exam_calendar" : kind, id, to]);

  for (const kind of ["exam", "recruitment", "admit_card", "result", "answer_key", "calendar"] as const) {
    for (const state of states) {
      const title = `${marker(kind, state)} ${kind.replace("_", " ")} 2026`;
      const r = await ins(s, TABLE[kind], base[kind](title));
      if (state !== "draft") await tr(kind, r.id, "review");
      if (["published", "updated", "unpublished", "expired", "archived"].includes(state)) await tr(kind, r.id, "published");
      if (state === "updated") await s.q(`update ${TABLE[kind]} set ${kind === "exam" ? "overview" : kind === "recruitment" ? "summary" : "description"} = 'Revised by the fixture' where id = $1`, [r.id]);
      if (state === "unpublished") await tr(kind, r.id, "draft");
      if (state === "expired" || state === "archived") await tr(kind, r.id, "expired");
      if (state === "archived") await tr(kind, r.id, "archived");
      const slug = (await s.q(`select slug from ${TABLE[kind]} where id=$1`, [r.id]))[0].slug;
      rows.push({ kind, state, id: r.id, slug, title, visibility: visibilityOf(state) });
    }
  }

  // Jobs through save_job/transition_job (the job-specific workflow).
  for (const state of states) {
    const title = `${marker("job", state)} Assistant Recruitment 2026`;
    const payload = jobPayload({ title, organization_name: orgName, last_date: addDays(45), start_date: addDays(-5) });
    const id = (await s.q<{ save_job: string }>("select save_job(null, $1::jsonb)", [JSON.stringify(payload)]))[0].save_job;
    const tj = (to: string, newLast: string | null = null) => s.q("select transition_job($1,$2::content_status,null,$3::date)", [id, to, newLast]);
    if (state !== "draft") await tj("review");
    if (["published", "updated", "unpublished", "archived", "expired"].includes(state)) await tj("published");
    if (state === "updated") await s.q("select save_job($1, $2::jsonb)", [id, JSON.stringify({ ...payload, summary: "Revised by the fixture" })]);
    if (state === "unpublished") await tj("draft");
    if (state === "expired" || state === "archived") await tj("expired");
    if (state === "archived") await tj("archived");
    const got = (await s.q("select slug, status from jobs where id=$1", [id]))[0];
    rows.push({ kind: "job", state, id, slug: got.slug, title, visibility: visibilityOf(state) });
  }

  // Sanity: the database agrees with the intended state of every row.
  const expected: Record<State, string[]> = { published: ["published"], updated: ["updated", "published"], draft: ["draft"], review: ["review"], unpublished: ["draft"], archived: ["archived"], expired: ["expired"] };
  for (const r of rows) {
    const t = r.kind === "job" ? "jobs" : TABLE[r.kind];
    const st = (await s.peek(`select status::text from ${t} where id=$1`, [r.id]))[0].status;
    if (!expected[r.state].includes(st)) throw new Error(`content matrix: ${r.kind}/${r.state} ended as ${st}`);
  }
  await s.c.query("commit"); await s.c.query("begin");
  await s.close();
  const examSlug = rows.find((r) => r.kind === "exam" && r.state === "published")!.slug;
  return { rows, orgSlug: "cmx-synthetic-recruitment-board", examSlug };
}

if (require.main === module) {
  seedContentMatrix().then((m) => { console.log(JSON.stringify(m.rows.map((r) => ({ k: r.kind, s: r.state, slug: r.slug })), null, 0)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
