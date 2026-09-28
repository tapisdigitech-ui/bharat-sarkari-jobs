/**
 * LOCAL SUPABASE API STAND-IN — TEST HARNESS ONLY.
 *
 * Purpose: let us run the real Next.js app and real browsers against the real migrations in a sandbox with no Supabase project.
 * It is NOT Supabase. It re-implements the small slice of two HTTP APIs the app uses:
 *   - GoTrue  (/auth/v1): password + refresh-token grants, /user, /logout, /admin/users
 *   - PostgREST (/rest/v1): table/view reads with filters/order/pagination/count, insert/upsert/patch/delete, /rpc/*
 * The important part is faithful: every REST request runs in one transaction as the `authenticator` login role, does
 * `SET LOCAL ROLE anon|authenticated|service_role` and sets `request.jwt.claims`, exactly how PostgREST does — so the
 * database's RLS policies, triggers and SECURITY DEFINER logic are what decide every request, not this file.
 * What is NOT covered: real GoTrue behaviours (rate limits, email flows, MFA), real PostgREST quirks beyond the subset below.
 *
 *   tsx tests/harness/supabase-stub.ts            # listens on :54321
 */
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";
import { ANON_KEY, SERVICE_KEY, signJwt, verifyJwt } from "./keys";

const PORT = Number(process.env.STUB_PORT ?? 54321);
const TTL = Number(process.env.STUB_TOKEN_TTL ?? 3600);
const DB = { host: process.env.PGTEST_DIR ?? "/home/claude/.pgtest", port: Number(process.env.PGTEST_PORT ?? 5544), database: "app_test", options: "-c timezone=UTC" };

// Return values the way PostgREST does (dates as YYYY-MM-DD, timestamps as ISO-8601, bigint as number).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1184, (v) => v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
pg.types.setTypeParser(1114, (v) => v.replace(" ", "T"));

const restPool = new pg.Pool({ ...DB, user: "authenticator", password: "authenticator", max: 8 });   // like PostgREST
const authPool = new pg.Pool({ ...DB, user: "postgres", max: 3 });                                    // GoTrue owns auth.users

/* ───────────── helpers ───────────── */
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const q = (id: string) => { if (!IDENT.test(id)) throw new HttpError(400, "PGRST100", `invalid identifier "${id}"`); return `"${id}"`; };
class HttpError extends Error { constructor(public status: number, public code: string, message: string, public details?: string) { super(message); } }

const send = (res: http.ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) => {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers, ...(payload ? { "content-length": String(Buffer.byteLength(payload)) } : {}) });
  res.end(payload);
};
const readBody = (req: http.IncomingMessage) => new Promise<string>((ok, bad) => { const c: Buffer[] = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c).toString())); req.on("error", bad); });

/* ───────────── GoTrue subset ───────────── */
const scryptHash = (pw: string) => { const salt = crypto.randomBytes(16); return `scrypt$${salt.toString("hex")}$${crypto.scryptSync(pw, salt, 32).toString("hex")}`; };
const scryptOk = (pw: string, stored: string | null) => {
  if (!stored?.startsWith("scrypt$")) return false;
  const [, salt, hash] = stored.split("$"); const got = crypto.scryptSync(pw, Buffer.from(salt, "hex"), 32); const want = Buffer.from(hash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};
const refreshTokens = new Map<string, { userId: string; sessionId: string }>();
const revokedSessions = new Set<string>();

interface UserRow { id: string; email: string; raw_user_meta_data: Record<string, unknown>; email_confirmed_at: string | null; created_at: string; banned_until: string | null }
const userJson = (u: UserRow) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.email_confirmed_at, phone: "", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data ?? {}, identities: [], created_at: u.created_at, updated_at: u.created_at, is_anonymous: false });

function issue(u: UserRow, sessionId: string = crypto.randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const access = signJwt({ iss: "supabase-stub/auth/v1", aud: "authenticated", sub: u.id, role: "authenticated", email: u.email, aal: "aal1", session_id: sessionId, iat: now, exp: now + TTL, app_metadata: { provider: "email" }, user_metadata: u.raw_user_meta_data ?? {}, is_anonymous: false });
  const refresh = crypto.randomBytes(9).toString("base64url");
  refreshTokens.set(refresh, { userId: u.id, sessionId });
  return { access_token: access, token_type: "bearer", expires_in: TTL, expires_at: now + TTL, refresh_token: refresh, user: userJson(u) };
}
const authErr = (res: http.ServerResponse, status: number, error_code: string, msg: string) => send(res, status, { code: status, error_code, msg });
const bearer = (req: http.IncomingMessage) => (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
const findUser = async (where: string, v: string) => (await authPool.query<UserRow>(`select id, email, raw_user_meta_data, email_confirmed_at, created_at, banned_until from auth.users where ${where}`, [v])).rows[0];

async function handleAuth(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  const body = req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req);
  const json = body ? JSON.parse(body) : {};

  if (path === "/health" && req.method === "GET") return send(res, 200, { version: "stand-in", name: "GoTrue (local stand-in)", description: "NOT Supabase" });

  if (path === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const email = String(json.email ?? "").trim().toLowerCase();
      const row = (await authPool.query(`select id, email, encrypted_password, raw_user_meta_data, email_confirmed_at, created_at, banned_until from auth.users where lower(email) = $1`, [email])).rows[0];
      if (!row || !scryptOk(String(json.password ?? ""), row.encrypted_password)) return authErr(res, 400, "invalid_credentials", "Invalid login credentials");
      if (row.banned_until && new Date(row.banned_until) > new Date()) return authErr(res, 400, "user_banned", "User is banned");
      return send(res, 200, issue(row));
    }
    if (grant === "refresh_token") {
      const rec = refreshTokens.get(String(json.refresh_token ?? ""));
      if (!rec || revokedSessions.has(rec.sessionId)) return authErr(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      const u = await findUser("id = $1", rec.userId);
      if (!u) return authErr(res, 400, "user_not_found", "User not found");
      refreshTokens.delete(String(json.refresh_token));
      return send(res, 200, issue(u, rec.sessionId));
    }
    return authErr(res, 400, "unsupported_grant_type", "Unsupported grant_type");
  }

  if (path === "/user" && req.method === "GET") {
    const claims = verifyJwt(bearer(req));
    if (!claims || claims.role !== "authenticated" || !claims.sub) return authErr(res, 401, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    if (revokedSessions.has(claims.session_id)) return authErr(res, 403, "session_not_found", "Session from session_id claim in JWT does not exist");
    const u = await findUser("id = $1", claims.sub);
    if (!u) return authErr(res, 403, "user_not_found", "User from sub claim in JWT does not exist");
    return send(res, 200, userJson(u));
  }

  if (path === "/user" && req.method === "PUT") {
    // Only user_metadata ("data") is supported — enough to prove a user cannot grant itself a role by editing its own profile.
    const claims = verifyJwt(bearer(req));
    if (!claims || claims.role !== "authenticated" || !claims.sub || revokedSessions.has(claims.session_id)) return authErr(res, 401, "bad_jwt", "invalid JWT");
    if (json.data) await authPool.query(`update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || $2::jsonb where id = $1`, [claims.sub, JSON.stringify(json.data)]);
    const u = await findUser("id = $1", claims.sub);
    return send(res, 200, userJson(u!));
  }

  if (path === "/logout" && req.method === "POST") {
    const claims = verifyJwt(bearer(req));
    if (claims?.session_id) {
      revokedSessions.add(claims.session_id);
      for (const [t, r] of refreshTokens) if (r.sessionId === claims.session_id) refreshTokens.delete(t);
    }
    res.writeHead(204); return res.end();
  }

  // Admin API: service-role key only
  if (path.startsWith("/admin/")) {
    if (verifyJwt(bearer(req))?.role !== "service_role") return authErr(res, 403, "not_admin", "User not allowed");
    if (path === "/admin/users" && req.method === "POST") {
      const email = String(json.email ?? "").trim().toLowerCase(), password = String(json.password ?? "");
      if (!email || password.length < 6) return authErr(res, 422, "validation_failed", "email and a password of 6+ characters are required");
      if (await findUser("lower(email) = $1", email)) return authErr(res, 422, "email_exists", "A user with this email address has already been registered");
      const r = await authPool.query<UserRow>(`insert into auth.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3, case when $4 then now() end) returning id, email, raw_user_meta_data, email_confirmed_at, created_at, banned_until`,
        [email, scryptHash(password), json.user_metadata ?? {}, !!json.email_confirm]);
      return send(res, 200, userJson(r.rows[0]));
    }
    if (path === "/admin/users" && req.method === "GET") {
      const r = await authPool.query<UserRow>(`select id, email, raw_user_meta_data, email_confirmed_at, created_at, banned_until from auth.users order by created_at`);
      return send(res, 200, { users: r.rows.map(userJson), aud: "authenticated" });
    }
    const m = path.match(/^\/admin\/users\/([0-9a-f-]{36})$/);
    if (m && req.method === "PUT") {
      if (json.password) await authPool.query(`update auth.users set encrypted_password = $2 where id = $1`, [m[1], scryptHash(String(json.password))]);
      if (json.email_confirm) await authPool.query(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1`, [m[1]]);
      const u = await findUser("id = $1", m[1]);
      return u ? send(res, 200, userJson(u)) : authErr(res, 404, "user_not_found", "User not found");
    }
    if (m && req.method === "DELETE") {
      const r = await authPool.query(`delete from auth.users where id = $1`, [m[1]]);
      return r.rowCount ? send(res, 200, {}) : authErr(res, 404, "user_not_found", "User not found");
    }
  }
  return authErr(res, 404, "not_found", `no such auth endpoint: ${req.method} ${path}`);
}

/* ───────────── PostgREST subset ───────────── */
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "and", "or"]);
type Params = unknown[];

function splitTop(s: string): string[] {            // split on commas not inside (), {}, or double quotes
  const out: string[] = []; let depth = 0, inQ = false, cur = "";
  for (const ch of s) {
    if (ch === '"') inQ = !inQ;
    if (!inQ) { if (ch === "(" || ch === "{") depth++; if (ch === ")" || ch === "}") depth--; if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; } }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v);

function condition(col: string, opv: string, params: Params): string {
  let negate = false;
  if (opv.startsWith("not.")) { negate = true; opv = opv.slice(4); }
  const dot = opv.indexOf("."); const op = dot < 0 ? opv : opv.slice(0, dot); const raw = dot < 0 ? "" : opv.slice(dot + 1);
  const c = q(col); const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  let sql: string;
  switch (op) {
    case "eq": sql = `${c} = ${p(unquote(raw))}`; break;
    case "neq": sql = `${c} <> ${p(unquote(raw))}`; break;
    case "gt": sql = `${c} > ${p(unquote(raw))}`; break;
    case "gte": sql = `${c} >= ${p(unquote(raw))}`; break;
    case "lt": sql = `${c} < ${p(unquote(raw))}`; break;
    case "lte": sql = `${c} <= ${p(unquote(raw))}`; break;
    case "like": sql = `${c} like ${p(unquote(raw).replace(/\*/g, "%"))}`; break;
    case "ilike": sql = `${c} ilike ${p(unquote(raw).replace(/\*/g, "%"))}`; break;
    case "is": { const v = raw.toLowerCase(); sql = v === "null" ? `${c} is null` : v === "true" ? `${c} is true` : v === "false" ? `${c} is false` : (() => { throw new HttpError(400, "PGRST100", `bad is value ${raw}`); })(); break; }
    case "in": { const inner = raw.replace(/^\(/, "").replace(/\)$/, ""); sql = `${c} = any(${p(splitTop(inner).map((x) => unquote(x.trim())))})`; break; }
    case "cs": sql = `${c} @> ${p(raw)}`; break;
    case "cd": sql = `${c} <@ ${p(raw)}`; break;
    case "ov": sql = `${c} && ${p(raw)}`; break;
    default: throw new HttpError(400, "PGRST100", `unsupported operator "${op}"`);
  }
  return negate ? `not (${sql})` : sql;
}

function logicTree(expr: string, joiner: "and" | "or", params: Params): string {
  const inner = expr.replace(/^\(/, "").replace(/\)$/, "");
  const parts = splitTop(inner).map((item) => {
    item = item.trim();
    const g = item.match(/^(not\.)?(and|or)\((.*)\)$/s);
    if (g) return `${g[1] ? "not " : ""}(${logicTree(`(${g[3]})`, g[2] as "and" | "or", params)})`;
    const d = item.indexOf("."); if (d < 0) throw new HttpError(400, "PGRST100", `bad filter "${item}"`);
    return condition(item.slice(0, d), item.slice(d + 1), params);
  });
  return parts.join(` ${joiner} `);
}

function whereOf(sp: URLSearchParams, params: Params): string {
  const conds: string[] = [];
  for (const [k, v] of sp.entries()) {
    if (k === "or") conds.push(`(${logicTree(v, "or", params)})`);
    else if (k === "and") conds.push(`(${logicTree(v, "and", params)})`);
    else if (!RESERVED.has(k)) conds.push(condition(k, v, params));
  }
  return conds.length ? ` where ${conds.join(" and ")}` : "";
}

function selectList(sel: string | null): string {
  if (!sel || sel === "*") return "*";
  if (/[()!:]/.test(sel.replace(/"[^"]*"/g, ""))) throw new HttpError(400, "PGRST100", "embedded resources / casts / aliases are not supported by the stand-in");
  return sel.split(",").map((c) => (c.trim() === "*" ? "*" : q(c.trim()))).join(", ");
}
function orderBy(o: string | null): string {
  if (!o) return "";
  return " order by " + o.split(",").map((t) => {
    const [col, ...mods] = t.split("."); let s = q(col);
    for (const m of mods) { if (m === "asc" || m === "desc") s += ` ${m}`; else if (m === "nullsfirst") s += " nulls first"; else if (m === "nullslast") s += " nulls last"; else throw new HttpError(400, "PGRST100", `bad order modifier ${m}`); }
    return s;
  }).join(", ");
}
const prefer = (req: http.IncomingMessage) => String(req.headers.prefer ?? "").split(",").map((s) => s.trim());
const preferHas = (req: http.IncomingMessage, kv: string) => prefer(req).includes(kv);

const fnMeta = new Map<string, { set: boolean; ret: string }>();
async function fnInfo(name: string) {
  if (fnMeta.has(name)) return fnMeta.get(name)!;
  const r = await authPool.query(`select p.proretset as set, format_type(p.prorettype, null) as ret from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 limit 1`, [name]);
  if (!r.rows[0]) throw new HttpError(404, "PGRST202", `Could not find the function public.${name} in the schema cache`);
  fnMeta.set(name, r.rows[0]); return r.rows[0];
}

async function handleRest(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  // Authenticate like PostgREST: verify the JWT signature, then take its `role`.
  const token = bearer(req) || String(req.headers.apikey ?? "");
  const claims = verifyJwt(token);
  if (!claims) return send(res, 401, { code: "PGRST301", message: "JWT invalid or expired", details: null, hint: null });
  const role = claims.role as string;
  if (!["anon", "authenticated", "service_role"].includes(role)) return send(res, 401, { code: "PGRST302", message: "Role claim invalid", details: null, hint: null });

  const rel = decodeURIComponent(url.pathname.replace(/^\/rest\/v1\//, ""));
  const sp = url.searchParams; const params: Params = [];
  const raw = ["POST", "PATCH", "PUT"].includes(req.method!) ? await readBody(req) : "";
  const body = raw ? JSON.parse(raw) : undefined;
  const wantObject = String(req.headers.accept ?? "").includes("application/vnd.pgrst.object+json");
  const wantCount = preferHas(req, "count=exact");
  const returning = preferHas(req, "return=representation");
  const limit = sp.get("limit") != null ? Math.max(0, Number(sp.get("limit"))) : null, offset = sp.get("offset") != null ? Math.max(0, Number(sp.get("offset"))) : 0;

  const client = await restPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)", [JSON.stringify(claims), claims.sub ?? "", role]);
    await client.query(`set local role ${role}`);

    let rows: any[] = []; let total: number | null = null; let status = 200; let scalar: { v: unknown } | null = null;
    if (rel.startsWith("rpc/")) {
      const fn = rel.slice(4); const meta = await fnInfo(fn);
      const args: Record<string, unknown> = req.method === "GET" ? Object.fromEntries(sp.entries()) : (body ?? {});
      const names = Object.keys(args);
      const call = `${q(fn)}(${names.map((n, i) => `${q(n)} := $${i + 1}`).join(", ")})`;
      // JS arrays go to Postgres array parameters (text[] etc.), like PostgREST; objects go to json/jsonb.
      const vals = names.map((n) => { const v = args[n]; return v === null || typeof v === "string" || Array.isArray(v) ? v : JSON.stringify(v); });
      if (meta.ret === "void") { await client.query(`select ${call}`, vals); status = 204; }
      else if (meta.set) rows = (await client.query(`select * from ${call}`, vals)).rows;
      else { const r = await client.query(`select ${call} as r`, vals); scalar = { v: r.rows[0].r }; }
    } else {
      const t = q(rel);
      if (req.method === "GET" || req.method === "HEAD") {
        const where = whereOf(sp, params);
        if (wantCount) total = (await client.query(`select count(*)::int as n from ${t}${where}`, params)).rows[0].n;
        let sql = `select ${selectList(sp.get("select"))} from ${t}${where}${orderBy(sp.get("order"))}`;
        if (limit != null) sql += ` limit ${limit}`; if (offset) sql += ` offset ${offset}`;
        rows = (await client.query(sql, params)).rows;
        if (total != null && offset > 0 && rows.length === 0 && offset >= total) throw new HttpError(416, "PGRST103", "Requested range not satisfiable", `An offset of ${offset} was requested, but there are only ${total} rows.`);
      } else if (req.method === "POST") {
        const list = Array.isArray(body) ? body : [body];
        const cols = [...new Set(list.flatMap((o) => Object.keys(o)))];
        if (!cols.length) throw new HttpError(400, "PGRST102", "Empty or invalid json");
        let sql = `insert into ${t} (${cols.map(q).join(", ")}) select ${cols.map(q).join(", ")} from jsonb_populate_recordset(null::${t}, $1::jsonb)`;
        const conflict = sp.get("on_conflict");
        if (conflict) {
          const target = conflict.split(",").map(q).join(", ");
          if (preferHas(req, "resolution=merge-duplicates")) sql += ` on conflict (${target}) do update set ${cols.filter((c) => !conflict.split(",").includes(c)).map((c) => `${q(c)} = excluded.${q(c)}`).join(", ") || `${q(cols[0])} = excluded.${q(cols[0])}`}`;
          else if (preferHas(req, "resolution=ignore-duplicates")) sql += ` on conflict (${target}) do nothing`;
        }
        if (returning) sql += ` returning ${selectList(sp.get("select"))}`;
        const r = await client.query(sql, [JSON.stringify(list)]);
        rows = returning ? r.rows : []; status = returning ? 201 : 201;
      } else if (req.method === "PATCH") {
        const cols = Object.keys(body ?? {}); if (!cols.length) throw new HttpError(400, "PGRST102", "Empty or invalid json");
        params.push(JSON.stringify(body));
        const where = whereOf(sp, params);
        let sql = `update ${t} set ${cols.map((c) => `${q(c)} = (jsonb_populate_record(null::${t}, $1::jsonb)).${q(c)}`).join(", ")}${where}`;
        if (returning) sql += ` returning ${selectList(sp.get("select"))}`;
        const r = await client.query(sql, params); rows = returning ? r.rows : []; status = returning ? 200 : 204;
      } else if (req.method === "DELETE") {
        const where = whereOf(sp, params);
        let sql = `delete from ${t}${where}`; if (returning) sql += ` returning ${selectList(sp.get("select"))}`;
        const r = await client.query(sql, params); rows = returning ? r.rows : []; status = returning ? 200 : 204;
      } else throw new HttpError(405, "PGRST117", "Unsupported HTTP method");
    }
    await client.query("commit");

    const headers: Record<string, string> = {};
    if ((req.method === "GET" || req.method === "HEAD") && !rel.startsWith("rpc/")) headers["content-range"] = `${rows.length ? `${offset}-${offset + rows.length - 1}` : "*"}/${total ?? "*"}`;
    if (req.method === "HEAD") { res.writeHead(status === 204 ? 200 : status, headers); return res.end(); }
    if (status === 204 || (!returning && ["POST", "PATCH", "DELETE"].includes(req.method!) && !rel.startsWith("rpc/"))) { res.writeHead(status === 200 ? 204 : status, headers); return res.end(); }
    if (scalar) return send(res, 200, scalar.v, headers);
    if (wantObject) {
      if (rows.length !== 1) throw new HttpError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${rows.length} rows`);
      return send(res, 200, rows[0], headers);
    }
    return send(res, status, rows, headers);
  } catch (e: any) {
    await client.query("rollback").catch(() => {});
    if (e instanceof HttpError) return send(res, e.status, { code: e.code, message: e.message, details: e.details ?? null, hint: null });
    const code: string = e.code ?? "XX000";
    const status = code === "42501" ? (role === "anon" ? 401 : 403) : code === "23505" || code === "23503" ? 409 : code === "42P01" ? 404 : code.startsWith("XX") ? 500 : 400;
    return send(res, status, { code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
  } finally { client.release(); }
}

/* ───────────── server ───────────── */
// Request counters for the local performance audit (how many database round-trips one page render makes).
const stats = new Map<string, number>();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/__stub/health") return send(res, 200, { ok: true, stub: true });
    if (url.pathname === "/__stub/stats") { const out = Object.fromEntries(stats); if (url.searchParams.has("reset")) stats.clear(); return send(res, 200, out); }
    if (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/auth/v1/")) { const k = `${req.method} ${url.pathname}`; stats.set(k, (stats.get(k) ?? 0) + 1); }
    if (url.pathname === "/__stub/keys") return send(res, 200, { anon: ANON_KEY, service_role: SERVICE_KEY });
    if (url.pathname.startsWith("/auth/v1/")) return await handleAuth(req, res, url);
    if (url.pathname.startsWith("/rest/v1/")) return await handleRest(req, res, url);
    send(res, 404, { message: "not found" });
  } catch (e: any) {
    console.error("[stub] unhandled", e);
    send(res, 500, { message: String(e?.message ?? e) });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`supabase stand-in (TEST ONLY) listening on http://127.0.0.1:${PORT}`));
