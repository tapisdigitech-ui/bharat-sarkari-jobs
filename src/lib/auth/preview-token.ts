import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomBytes } from "node:crypto";

/**
 * Draft-preview links are signed, short-lived and bound to (kind, record id, staff user id).
 * They ADD to — never replace — the staff session check: a leaked link is useless to anyone who is not
 * that same signed-in staff member, and it expires. The record id is also a random UUID (not guessable).
 */
const TTL_SECONDS = 30 * 60;

let devSecret: string | null = null;
function secret(): string {
  const s = process.env.PREVIEW_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new Error("PREVIEW_SECRET (16+ chars) is required in production for draft previews.");
  return (devSecret ??= randomBytes(32).toString("hex"));   // development only: per-process, so links die on restart
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function makePreviewToken(kind: string, id: string, userId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  const payload = `${kind}.${id}.${userId}.${exp}`;
  return `${exp}.${sign(payload)}`;
}

export function verifyPreviewToken(token: string | undefined, kind: string, id: string, userId: string, now = Date.now()): boolean {
  if (!token) return false;
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!sig || !Number.isInteger(exp) || exp * 1000 < now) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(`${kind}.${id}.${userId}.${exp}`));
  return a.length === b.length && timingSafeEqual(a, b);
}
