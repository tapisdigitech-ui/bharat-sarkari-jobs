/** Test helpers: connect to the local harness Postgres and impersonate Supabase roles the way PostgREST does. */
import pg from "pg";

export const PGCONF = { host: process.env.PGTEST_DIR ?? "/home/claude/.pgtest", port: Number(process.env.PGTEST_PORT ?? 5544), user: "postgres", database: "app_test" };

export type Actor = { role: "anon" | "authenticated" | "service_role"; uid?: string };
export const ANON: Actor = { role: "anon" };
export const SERVICE: Actor = { role: "service_role" };
export const user = (uid: string): Actor => ({ role: "authenticated", uid });

export class Session {
  constructor(public c: pg.Client) {}
  private static open_: Session[] = [];
  static async open() { const c = new pg.Client(PGCONF); await c.connect(); await c.query("begin"); const s = new Session(c); Session.open_.push(s); return s; }
  /** Safety net: called after every test so a failed assertion can never leave a transaction (and its locks) open. */
  static async closeAll() { for (const s of Session.open_.splice(0)) await s.close().catch(() => {}); }
  /** Switch identity inside the open transaction (PostgREST: SET LOCAL ROLE + JWT claims GUCs). */
  actor: Actor = { role: "anon" };
  async as(a: Actor) {
    this.actor = a;
    await this.c.query("reset role");
    const claims = JSON.stringify({ role: a.role, ...(a.uid ? { sub: a.uid } : {}) });
    await this.c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [claims, a.uid ?? ""]);
    await this.c.query(`set local role ${a.role}`);
    return this;
  }
  async su() { await this.c.query("reset role"); return this; }
  /** Run a read as superuser (to inspect ground truth) and then RESTORE the current identity. */
  async peek<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const prev = this.actor; await this.su(); const r = await this.q<T>(sql, params); await this.as(prev); return r;
  }
  async q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> { return (await this.c.query(sql, params)).rows as T[]; }
  /** Run a statement expected to fail; returns the error message (or null if it unexpectedly succeeded). */
  async fails(sql: string, params: unknown[] = []): Promise<string | null> {
    await this.c.query("savepoint expect_fail");
    try { await this.c.query(sql, params); await this.c.query("release savepoint expect_fail"); return null; }
    catch (e: any) { await this.c.query("rollback to savepoint expect_fail"); return `${e.code ?? ""} ${e.message}`; }
  }
  async close() { try { await this.c.query("rollback"); } catch {} finally { await this.c.end().catch(() => {}); } }
}

export async function admin() { const c = new pg.Client(PGCONF); await c.connect(); return c; }

/** Fixed test identities. */
export const U = {
  sa: "00000000-0000-0000-0000-00000000000a", adm: "00000000-0000-0000-0000-00000000000b", ed: "00000000-0000-0000-0000-00000000000c",
  cm: "00000000-0000-0000-0000-00000000000d", seo: "00000000-0000-0000-0000-00000000000e", mod: "00000000-0000-0000-0000-00000000000f",
  plain: "00000000-0000-0000-0000-000000000010", sa2: "00000000-0000-0000-0000-000000000011",
} as const;

export async function seedUsers() {
  const c = await admin();
  await c.query("truncate audit_logs, admin_users, jobs, organizations, field_verifications, official_updates cascade");
  await c.query("delete from auth.users");
  const rows: [string, string, string | null][] = [
    [U.sa, "sa@test.dev", "super_admin"], [U.adm, "adm@test.dev", "admin"], [U.ed, "ed@test.dev", "editor"],
    [U.cm, "cm@test.dev", "content_manager"], [U.seo, "seo@test.dev", "seo_manager"], [U.mod, "mod@test.dev", "moderator"],
    [U.plain, "plain@test.dev", null], [U.sa2, "sa2@test.dev", "super_admin"],
  ];
  for (const [id, email, role] of rows) {
    await c.query("insert into auth.users (id, email) values ($1,$2)", [id, email]);
    if (role) await c.query("insert into admin_users (user_id, role) values ($1,$2)", [id, role]); // trusted (superuser) insert
  }
  await c.end();
}

export const jobPayload = (o: Record<string, unknown> = {}) => ({
  title: "Junior Assistant Recruitment 2026", organization_name: "Test Recruitment Board", department_slug: "ssc", level: "central",
  job_type: "permanent", state_slug: "delhi", qualification_slugs: ["graduate"], total_vacancies: 100,
  vacancies: [{ post_name: "Junior Assistant", category: "General", count: 60 }, { post_name: "Junior Assistant", category: "OBC", count: 40 }],
  source_name: "Test Recruitment Board website", source_type: "official_notification", source_url: "https://example.gov.in/notice",
  notification_url: "https://example.gov.in/notice.pdf", official_website_url: "https://example.gov.in", official_apply_url: "https://example.gov.in/apply",
  mark_source_checked: true, mark_verified: true, editorial_notes: "INTERNAL-ONLY note", summary: "Plain-language summary.",
  ...o,
});

export const addDays = (n: number) => new Date(Date.now() + n * 864e5 + 5.5 * 36e5).toISOString().slice(0, 10);
