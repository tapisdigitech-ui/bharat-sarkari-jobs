/** Deterministic JWT secret + API keys for the LOCAL TEST STAND-IN only. Not secrets: they only ever work against the stand-in. */
import crypto from "node:crypto";

export const JWT_SECRET = process.env.STUB_JWT_SECRET ?? "local-test-stub-jwt-secret-please-do-not-use-anywhere-real";
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signJwt(claims: Record<string, unknown>, secret = JWT_SECRET): string {
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64(JSON.stringify(claims));
  return `${h}.${p}.${b64(crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest())}`;
}

export function verifyJwt(token: string, secret = JWT_SECRET): Record<string, any> | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const want = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, "base64url");
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(p, "base64url").toString());
    if (typeof c.exp === "number" && c.exp * 1000 < Date.now()) return null;
    return c;
  } catch { return null; }
}

const FAR = 4102444800; // 2100-01-01
export const ANON_KEY = signJwt({ iss: "supabase-stub", role: "anon", iat: 1700000000, exp: FAR });
export const SERVICE_KEY = signJwt({ iss: "supabase-stub", role: "service_role", iat: 1700000000, exp: FAR });
