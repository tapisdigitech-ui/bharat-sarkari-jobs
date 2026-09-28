/**
 * Structured, redacted operational logging (Phase 3.6 item 30). One JSON line per event on the platform log.
 * Never logs passwords, tokens, keys, cookies or raw emails: keys that look sensitive are replaced by "[redacted]",
 * JWT-shaped and secret-key-shaped values are redacted wherever they appear, and emails are reduced to their domain.
 * The authoritative record of content changes stays in the database (audit_logs, content_versions); these lines are for
 * operators watching failures.
 */
export type LogLevel = "info" | "warn" | "error";
export type LogEvent =
  | "source.check_failed" | "source.blocked" | "ingestion.failed" | "extraction.failed" | "content.published" | "content.unpublished"
  | "admin.change" | "cron.ok" | "cron.failed" | "auth.failed" | "auth.denied" | "rate_limited" | "env.invalid";

const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|service[-_]?role|authorization|cookie|jwt|session|otp/i;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const SB_SECRET = /sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const EMAIL = /\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

export function redact(v: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (typeof v === "string") return v.replace(JWT, "[redacted-jwt]").replace(SB_SECRET, "[redacted-key]").replace(BEARER, "Bearer [redacted]").replace(EMAIL, "***@$2").slice(0, 2000);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (v && typeof v === "object") {
    if (v instanceof Error) return { name: v.name, message: redact(v.message, depth + 1) };
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 50).map(([k, x]) => [k, SENSITIVE_KEY.test(k) ? "[redacted]" : redact(x, depth + 1)]));
  }
  return v;
}

export function log(level: LogLevel, event: LogEvent, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as Record<string, unknown>) });
  if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.info(line);
}
