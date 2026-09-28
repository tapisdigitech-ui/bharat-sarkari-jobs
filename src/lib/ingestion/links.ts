/**
 * Official-link monitoring + URL validation.
 * A failing government link is FLAGGED (verification status SOURCE_UNAVAILABLE after repeated failures), never removed:
 * official sites go down temporarily all the time, and a person decides what to do.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentKind } from "@/lib/admin/permissions";
import { PoliteFetcher, type Fetcher, type FetchOutcome } from "./http";

export const LINK_FIELDS: Record<ContentKind, string[]> = {
  job: ["notification_url", "official_apply_url", "official_website_url", "source_url"],
  recruitment: ["official_notification_url", "official_website_url", "source_url"],
  exam: ["official_website_url", "source_url"],
  admit_card: ["official_admit_card_url", "official_notification_url", "official_website_url", "source_url"],
  result: ["official_result_url", "official_cutoff_url", "official_website_url", "source_url"],
  answer_key: ["official_answer_key_url", "official_objection_url", "official_website_url", "source_url"],
  exam_calendar: ["official_notification_url", "official_website_url", "source_url"],
};
const TABLE: Record<ContentKind, string> = { job: "jobs", recruitment: "recruitments", exam: "exams", admit_card: "admit_cards", result: "results", answer_key: "answer_keys", exam_calendar: "exam_calendar" };
const BROKEN: FetchOutcome[] = ["not_found", "gone", "client_error", "server_error", "timeout", "invalid", "unreachable"];
export const FLAG_AFTER = 3;   // consecutive failed checks (on different runs) before a record is flagged

export interface LinkTarget { kind: ContentKind; id: string; field: string; url: string }
export interface LinkRunSummary { checked: number; broken: number; flagged: number; recovered: number }

/** Check one URL politely: HEAD first (cheap), GET when the server does not support HEAD. robots.txt is honoured. */
async function probe(f: Fetcher, url: string) {
  let r = await f.fetch(url, { method: "HEAD", timeoutMs: 15_000, retries: 1 });
  if (r.status === 405 || r.status === 501 || (r.status === 403 && r.outcome === "blocked")) r = await f.fetch(url, { method: "GET", timeoutMs: 20_000, retries: 1, maxBytes: 2_000_000 });
  return r;
}

export async function checkLinks(db: SupabaseClient, targets: LinkTarget[], fetcher: Fetcher = new PoliteFetcher({ minDelayMs: 1500 })): Promise<LinkRunSummary> {
  const sum: LinkRunSummary = { checked: 0, broken: 0, flagged: 0, recovered: 0 };
  const cache = new Map<string, Awaited<ReturnType<typeof probe>>>();
  for (const t of targets) {
    const r = cache.get(t.url) ?? await probe(fetcher, t.url);
    cache.set(t.url, r);
    const prev = await db.from("link_checks").select("consecutive_failures,outcome").eq("kind", t.kind).eq("content_id", t.id).eq("field", t.field).order("checked_at", { ascending: false }).limit(1);
    const prevFails = (prev.data?.[0]?.consecutive_failures as number) ?? 0;
    const broken = BROKEN.includes(r.outcome);
    const fails = broken ? prevFails + 1 : 0;
    await db.from("link_checks").insert({ url: t.url, kind: t.kind, content_id: t.id, field: t.field, outcome: r.outcome, http_status: r.status,
      final_url: r.finalUrl !== t.url ? r.finalUrl : null, response_ms: r.ms, error: r.error?.slice(0, 500) ?? null, consecutive_failures: fails });
    sum.checked++;
    if (broken) sum.broken++;
    const rec = await db.from(TABLE[t.kind]).select("verification_status").eq("id", t.id).maybeSingle();
    const vs = rec.data?.verification_status as string | undefined;
    if (broken && fails >= FLAG_AFTER && vs && !["SOURCE_UNAVAILABLE", "EXPIRED", "ARCHIVED"].includes(vs)) {
      await db.from(TABLE[t.kind]).update({ verification_status: "SOURCE_UNAVAILABLE" }).eq("id", t.id); sum.flagged++;
    } else if (!broken && vs === "SOURCE_UNAVAILABLE") {
      // The link works again, but a person must re-confirm the details before it counts as checked.
      const others = await db.from("link_status_latest").select("broken").eq("kind", t.kind).eq("content_id", t.id).eq("broken", true);
      if (!others.data?.length) { await db.from(TABLE[t.kind]).update({ verification_status: "NEEDS_REVIEW" }).eq("id", t.id); sum.recovered++; }
    }
  }
  return sum;
}

/** Official URLs of one record (for the editor's "Check links now"). */
export async function recordTargets(db: SupabaseClient, kind: ContentKind, id: string): Promise<LinkTarget[]> {
  const fields = LINK_FIELDS[kind];
  const { data } = await db.from(TABLE[kind]).select(["id", ...fields].join(",")).eq("id", id).maybeSingle();
  if (!data) return [];
  const row = data as unknown as Record<string, string | null>;
  return fields.filter((f) => row[f]).map((f) => ({ kind, id, field: f, url: row[f]! }));
}

/** Live records' links, least-recently-checked first (never-checked first), capped per run. */
export async function dueLinkTargets(db: SupabaseClient, limit = 40): Promise<LinkTarget[]> {
  const all: LinkTarget[] = [];
  for (const kind of Object.keys(TABLE) as ContentKind[]) {
    const fields = LINK_FIELDS[kind];
    const { data } = await db.from(TABLE[kind]).select(["id", ...fields].join(",")).in("status", ["published", "updated"]).limit(2000);
    for (const row of (data ?? []) as unknown as Record<string, string | null>[]) for (const f of fields) if (row[f]) all.push({ kind, id: row.id!, field: f, url: row[f]! });
  }
  if (!all.length) return [];
  const latest = await db.from("link_status_latest").select("kind,content_id,field,checked_at");
  const at = new Map(((latest.data ?? []) as { kind: string; content_id: string; field: string; checked_at: string }[]).map((r) => [`${r.kind}|${r.content_id}|${r.field}`, r.checked_at]));
  return all.sort((a, b) => (at.get(`${a.kind}|${a.id}|${a.field}`) ?? "").localeCompare(at.get(`${b.kind}|${b.id}|${b.field}`) ?? "")).slice(0, limit);
}

export { officialUrlWarnings } from "./url-checks";
