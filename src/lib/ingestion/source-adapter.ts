/**
 * SOURCE ADAPTER CONTRACT (Phase 3.6 item 9).
 *
 * The pipeline (pipeline.ts) is generic: it knows the ORDER of the steps and how to record them, never how a particular
 * website is laid out. Everything that can differ between official websites goes through this interface:
 *
 *   listings(source)            which pages to read for this source
 *   fetch(url, purpose)         polite, robots-respecting fetch (the shared PoliteFetcher; adapters only choose limits)
 *   parse(response)             bytes → text/links (HTML, PDF) or JSON
 *   discover(parsed)            candidate notices on a listing page
 *   identifyNotification(c)     resolve a candidate to the actual notice document (e.g. detail page → PDF)
 *   extractFields(doc, c)       notice text → structured fields
 *   identifyAmendment(title)    corrigendum / addendum / postponement / extension / cancellation … or null
 *   identifyUpdate(old, new)    which fields changed (never a silent overwrite: the result goes to the review queue)
 *   identifyApplicationLink()   the official application link, flagged when it leaves the official domain
 *   checkNotice(doc)            source-specific sanity checks expressed as CONFIG (e.g. "must name this organization")
 *
 * Adapters are STRUCTURAL (a link list, a PDF board, a table with column headers, a detail page that links a PDF, a JSON
 * feed). Anything specific to one website is data in the source's `adapter_config`, validated by `validateConfig`.
 * `defineAdapter` fills every step an adapter does not override with the shared default, so there is exactly one copy of
 * each rule. No adapter may bypass robots.txt, authentication or anti-bot measures: all fetching goes through the shared
 * fetcher, which enforces robots.txt, rate limits and the official-domain rule.
 */
import type { ContentKind } from "@/lib/admin/permissions";
import type { FetchResult, Fetcher } from "./http";
import { AMENDMENT, extractFields, findDates, type Extraction } from "./fields";
import { diffFields, type FieldChange } from "./normalize";
import { toDoc, type DocText } from "./text";

export interface AdapterConfig {
  // listing discovery
  include?: string; exclude?: string; selector?: string; maxItems?: number; delayMs?: number; allowDomains?: string[]; pdfOnly?: boolean;
  // detail-page (two-hop): which links on a detail page are the notice document
  detailPdfInclude?: string;
  // table-columns: CSS selector of the table (default: every table)
  tableSelector?: string;
  // json-feed: a documented/permitted JSON listing. Field names are paths into each item ("attachments[].path" = every path).
  feed?: { url: string; itemsPath?: string; title: string; link: string; date?: string; id?: string; group?: string; linkPrefix?: string };
  /** json-feed only: a person confirmed that the site's terms permit automated reading of the feed. Off by default. */
  termsReviewed?: boolean;
  // checks
  /** Pattern the notice must mention near its start (e.g. the organization's name). A miss is flagged, never auto-rejected. */
  expectOrganization?: string;
  /** Extra domains the official application link may legitimately use (e.g. an exam agency's portal named in the notice). */
  applyDomains?: string[];
}

export interface Candidate { url: string; anchorText: string; context: string; dateHint?: string; kindHint?: ContentKind; externalId?: string; group?: string }
export interface AdapterContext { officialDomain: string; listingUrl: string; listingKind?: ContentKind; config: AdapterConfig; organizationName?: string | null }
export interface Listing { url: string; kind?: ContentKind }
export interface ListingSource { base_url: string; recruitment_url?: string | null; admit_card_url?: string | null; results_url?: string | null; answer_key_url?: string | null; exam_url?: string | null }
export interface Parsed { doc: DocText; raw: string | null; json?: unknown }
export type FetchPurpose = "listing" | "notice" | "detail";
export interface AdapterIO { fetch(url: string, purpose: FetchPurpose): Promise<FetchResult>; parse(res: FetchResult): Promise<Parsed> }
export interface Resolved { candidate: Candidate; res: FetchResult; parsed: Parsed; hops: string[] }

export type AmendmentType =
  | "corrigendum" | "addendum" | "errata" | "clarification" | "postponement" | "extension" | "cancellation" | "revival"
  | "revised_schedule" | "vacancy_revision" | "change_notice";

export interface AdapterCapabilities { twoHop: boolean; tableColumns: boolean; jsonFeed: boolean; needsTermsReview: boolean }

export interface SourceAdapter {
  key: string; label: string; description: string; capabilities: AdapterCapabilities;
  /** Settings this adapter reads (others are rejected by validateConfig). */
  configKeys: readonly (keyof AdapterConfig)[];
  validateConfig(cfg: AdapterConfig): string | null;
  /** A reason the adapter must not run for this configuration (e.g. terms not yet reviewed), or null. */
  refuse(cfg: AdapterConfig): string | null;
  listings(src: ListingSource, cfg: AdapterConfig): Listing[];
  fetch(fetcher: Fetcher, url: string, purpose: FetchPurpose): Promise<FetchResult>;
  parse(res: FetchResult): Promise<Parsed>;
  discover(doc: DocText, raw: string | null, ctx: AdapterContext, parsed?: Parsed): Candidate[];
  identifyNotification(c: Candidate, first: { res: FetchResult; parsed: Parsed }, ctx: AdapterContext, io: AdapterIO): Promise<Resolved | { skip: string }>;
  extractFields(doc: DocText, c: Candidate): Extraction;
  identifyAmendment(title: string, text: string): AmendmentType | null;
  identifyUpdate(existing: Record<string, unknown>, extracted: Record<string, unknown>, amendment: boolean): Record<string, FieldChange>;
  identifyApplicationLink(doc: DocText, x: Extraction, ctx: AdapterContext): { url: string; offDomain: boolean } | null;
  checkNotice(doc: DocText, ctx: AdapterContext): string[];
}

/* ───────────────────────── shared defaults (one copy of every rule) ───────────────────────── */

export function hostAllowed(href: string, officialDomain: string, extra: string[] = []): boolean {
  let h: string;
  try { h = new URL(href).hostname.toLowerCase().replace(/^www\./, ""); } catch { return false; }
  return [officialDomain, ...extra].some((d) => h === d.toLowerCase() || h.endsWith("." + d.toLowerCase()));
}

const LIMITS: Record<FetchPurpose, number> = { listing: 3_000_000, detail: 3_000_000, notice: 15_000_000 };

/** Ordered: the first matching rule names the amendment. Postponement/extension before the generic "corrigendum". */
const AMENDMENT_TYPES: [AmendmentType, RegExp][] = [
  ["cancellation", /\bcancell?(?:ation|ed)\b|\bwithdrawn\b|\bwithdrawal\s+of\b/i],
  ["revival", /\brevival\b|\brevived\b/i],
  ["postponement", /\bpostpone(?:d|ment)\b|\bdeferred\b/i],
  ["extension", /\bextension\s+of\s+(?:the\s+)?(?:last\s+)?date\b|\b(?:last\s+)?date\s+(?:is\s+|has\s+been\s+)?extended\b|\bextended\s+(?:up\s*to|till|until)\b/i],
  ["revised_schedule", /\brevised\s+(?:dates?|schedule|programme)\b|\bre-?schedul(?:ed|ing)\b|\bchange\s+in\s+(?:the\s+)?(?:date|schedule|exam)\b/i],
  ["vacancy_revision", /\brevision\s+of\s+vacanc|\b(?:increase|decrease|change)\s+in\s+(?:the\s+)?(?:number\s+of\s+)?vacanc/i],
  ["addendum", /\baddend(?:um|a)\b/i],
  ["errata", /\berrat(?:um|a)\b/i],
  ["clarification", /\bclarification\b/i],
  ["corrigendum", /\bcorrigend(?:um|a)\b/i],
  ["change_notice", /\bnotice\s+regarding\s+change\b/i],
];
export function amendmentType(title: string, text = ""): AmendmentType | null {
  const head = `${title}\n${text.split("\n").slice(0, 8).join("\n")}`;
  if (!AMENDMENT.test(title) && !AMENDMENT.test(head)) return null;
  for (const [t, re] of AMENDMENT_TYPES) if (re.test(title)) return t;
  for (const [t, re] of AMENDMENT_TYPES) if (re.test(head)) return t;
  return "change_notice";
}

/** Walk "a.b[].c" through JSON; "[]" flattens arrays. */
export function pluck(obj: unknown, path: string | undefined): unknown[] {
  if (!path) return [obj];
  let cur: unknown[] = [obj];
  for (const part of path.split(".")) {
    const many = part.endsWith("[]"); const key = many ? part.slice(0, -2) : part;
    cur = cur.flatMap((o) => {
      const v = key ? (o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined) : o;
      return many ? (Array.isArray(v) ? v : []) : v === undefined ? [] : [v];
    });
  }
  return cur;
}

const base: Omit<SourceAdapter, "key" | "label" | "description" | "discover"> = {
  capabilities: { twoHop: false, tableColumns: false, jsonFeed: false, needsTermsReview: false },
  configKeys: ["include", "exclude", "selector", "maxItems", "delayMs", "allowDomains", "pdfOnly", "expectOrganization", "applyDomains"],
  validateConfig() { return null; },
  refuse() { return null; },
  listings(src) {
    const l: Listing[] = [
      { url: src.recruitment_url ?? "", kind: "job" }, { url: src.admit_card_url ?? "", kind: "admit_card" }, { url: src.results_url ?? "", kind: "result" },
      { url: src.answer_key_url ?? "", kind: "answer_key" }, { url: src.exam_url ?? "", kind: "exam_calendar" },
    ].filter((x) => x.url) as Listing[];
    if (!l.length) l.push({ url: src.base_url });
    return [...new Map(l.map((x) => [x.url, x])).values()];
  },
  fetch(fetcher, url, purpose) { return fetcher.fetch(url, { maxBytes: LIMITS[purpose] }); },
  async parse(res) {
    const body = res.body!;
    if (/json/i.test(res.contentType ?? "")) {
      const text = new TextDecoder().decode(body);
      let json: unknown = null; try { json = JSON.parse(text); } catch { /* not JSON after all */ }
      return { doc: { type: "other", text: "", headings: [], links: [] }, raw: null, json };
    }
    const doc = await toDoc(body, res.contentType, res.finalUrl);
    return { doc, raw: doc.type === "html" ? new TextDecoder().decode(body) : null };
  },
  async identifyNotification(c, first) { return { candidate: c, res: first.res, parsed: first.parsed, hops: [c.url] }; },
  extractFields(doc, c) { return extractFields(`${doc.text}\n${c.context}`, doc.links); },
  identifyAmendment(title, text) { return amendmentType(title, text); },
  identifyUpdate(existing, extracted, amendment) { return diffFields(existing, extracted, { amendment }); },
  identifyApplicationLink(_doc, x, ctx) {
    if (!x.applyUrl) return null;
    const url = x.applyUrl.value;
    return { url, offDomain: !hostAllowed(url, ctx.officialDomain, [...(ctx.config.allowDomains ?? []), ...(ctx.config.applyDomains ?? [])]) };
  },
  checkNotice(doc, ctx) {
    const issues: string[] = [];
    if (scannedPdf(doc)) issues.push("The PDF has little or no text layer (probably scanned) — enter the details manually from the document");
    if (ctx.config.expectOrganization) {
      let re: RegExp | null = null; try { re = new RegExp(ctx.config.expectOrganization, "i"); } catch { /* validated on save */ }
      if (re && !re.test(doc.text.slice(0, 2500)))
        issues.push(`The notice does not name the expected organization near its start — it may be another body's circular re-posted on this site. Check the organization before approving.`);
    }
    return issues;
  },
};

/** A PDF with (almost) no text layer — a scanned image. Nothing can be extracted reliably; a person enters the fields. */
export const scannedPdf = (doc: DocText) => doc.type === "pdf" && doc.text.replace(/\s/g, "").length < 200;

export function defineAdapter(a: Partial<SourceAdapter> & Pick<SourceAdapter, "key" | "label" | "description" | "discover">): SourceAdapter {
  return { ...base, ...a, capabilities: { ...base.capabilities, ...(a.capabilities ?? {}) } } as SourceAdapter;
}

export const firstDateIn = (s: string) => findDates(s)[0]?.iso;
