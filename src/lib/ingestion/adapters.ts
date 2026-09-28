/**
 * The registered source adapters (contract: source-adapter.ts). Each is STRUCTURAL — it describes a KIND of page, not a
 * website. Website specifics live in the source's `adapter_config`. Adding a genuinely new structure = one new entry here.
 *
 *   generic-listing   a page listing notices as links
 *   pdf-index         a notice board where every notice is a PDF
 *   table-listing     notices in table rows with weak link text ("Click here")
 *   table-columns     a table whose column headers carry the facts (Advt No · Start · Last date · Fee last date …)
 *   detail-page       listing → an HTML notice page → the PDF (two hops)
 *   json-feed         a JSON listing — only after a person confirms the site's terms permit automated reading (gated)
 */
import { parse } from "node-html-parser";
import type { ContentKind } from "@/lib/admin/permissions";
import { findDates } from "./fields";
import type { DocText, PageLink } from "./text";
import {
  defineAdapter, hostAllowed, pluck, type AdapterConfig, type AdapterContext, type Candidate, type SourceAdapter,
} from "./source-adapter";

export { hostAllowed } from "./source-adapter";
export type { AdapterConfig, AdapterContext, Candidate, SourceAdapter } from "./source-adapter";
/** @deprecated use SourceAdapter */
export type Adapter = SourceAdapter;

const RELEVANT = /\b(recruit|notification|advertisement|advt|vacanc|post(?:s)?\s+of|examination|exam\b|admit\s*card|hall\s*ticket|call\s*letter|result|merit\s*list|answer\s*key|calendar|schedule|corrigendum|addendum|walk[\s-]?in|apprentice|bharti|भर्ती|परीक्षा|परिणाम|प्रवेश\s*पत्र)/i;
const NAV = /^(home|about(\s+us)?|contact(\s+us)?|sitemap|site\s*map|login|sign\s*in|register(?!\s+for)|faq|help|feedback|screen\s*reader|skip\s+to|hindi|english|हिंदी|a\+|a-|a|rti|tenders?|archives?|more|view\s+all|read\s+more)$/i;
const WEAK = /^(click\s+here|download|view|pdf|here|link|new|details?|open|see|\d+(\.\d+)?\s*[km]b|\(\s*\d+(\.\d+)?\s*[km]b\s*\))$/i;
const BAD_EXT = /\.(jpg|jpeg|png|gif|zip|rar|docx?|xlsx?|pptx?|mp4|mp3)(\?|$)/i;
const isPdf = (u: string) => /\.pdf($|\?)/i.test(u);

function kindHintOf(text: string, listingKind?: ContentKind): ContentKind | undefined {
  if (/answer\s*key/i.test(text)) return "answer_key";
  if (/admit\s*card|hall\s*ticket|call\s*letter/i.test(text)) return "admit_card";
  if (/\bresult|merit\s*list|cut[\s-]?off/i.test(text)) return "result";
  if (/calendar|schedule\s+of\s+exam/i.test(text)) return "exam_calendar";
  return listingKind;
}

function linksWithin(rawHtml: string | null, selector: string | undefined, base: string, fallback: PageLink[]): PageLink[] {
  if (!rawHtml || !selector) return fallback;
  try {
    const root = parse(rawHtml);
    const area = root.querySelectorAll(selector);
    if (!area.length) return fallback;
    const hrefs = new Set(area.flatMap((n) => n.querySelectorAll("a[href]").map((a) => { try { return new URL(a.getAttribute("href")!, base).toString(); } catch { return ""; } })));
    return fallback.filter((l) => hrefs.has(l.href));
  } catch { return fallback; }
}

function genericDiscover(doc: DocText, rawHtml: string | null, ctx: AdapterContext, opts: { pdfOnly?: boolean; rowTitles?: boolean } = {}): Candidate[] {
  const c = ctx.config;
  const include = c.include ? new RegExp(c.include, "i") : RELEVANT;
  const exclude = c.exclude ? new RegExp(c.exclude, "i") : null;
  const max = Math.min(Math.max(c.maxItems ?? 10, 1), 25);
  const seen = new Set<string>(); const out: Candidate[] = [];
  for (const l of linksWithin(rawHtml, c.selector, ctx.listingUrl, doc.links)) {
    const href = l.href.split("#")[0];
    if (seen.has(href) || href === ctx.listingUrl.split("#")[0]) continue;
    if (!hostAllowed(href, ctx.officialDomain, c.allowDomains)) continue;       // never follow links off the official domain
    if (BAD_EXT.test(href)) continue;
    if ((opts.pdfOnly || c.pdfOnly) && !isPdf(href)) continue;
    const text = l.text.trim();
    if (NAV.test(text)) continue;
    const useRow = (opts.rowTitles || WEAK.test(text) || text.length < 6) && l.context.length > text.length;
    const rowTitle = l.context.replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ").replace(/\b(?:download|click here|view|pdf|new)\b/gi, " ").replace(/^\s*\d{1,3}[.)]?\s+/, "").replace(/\s+/g, " ").trim();
    const title = (useRow && rowTitle.length >= 6 ? rowTitle : text).slice(0, 300);
    const hay = `${title} ${href}`;
    if (!include.test(hay) || (exclude && exclude.test(hay))) continue;
    seen.add(href);
    const d = findDates(l.context)[0];
    out.push({ url: href, anchorText: title, context: l.context, dateHint: d?.iso, kindHint: kindHintOf(hay, ctx.listingKind) });
    if (out.length >= max) break;
  }
  return out;
}

/** Tables whose header row names the columns: each row with a link becomes a candidate whose context is "Header: value" lines. */
function tableColumnsDiscover(rawHtml: string | null, ctx: AdapterContext): Candidate[] {
  if (!rawHtml) return [];
  const c = ctx.config;
  const include = c.include ? new RegExp(c.include, "i") : null;
  const exclude = c.exclude ? new RegExp(c.exclude, "i") : null;
  const max = Math.min(Math.max(c.maxItems ?? 10, 1), 25);
  const out: Candidate[] = []; const seen = new Set<string>();
  const root = parse(rawHtml);
  const tables = root.querySelectorAll(c.tableSelector || "table");
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  for (const t of tables) {
    const rows = t.querySelectorAll("tr");
    if (rows.length < 2) continue;
    const headerRow = rows.find((r) => r.querySelectorAll("th").length > 0) ?? rows[0];
    const headers = headerRow.querySelectorAll("th,td").map((h) => clean(h.text));
    for (const r of rows) {
      if (r === headerRow) continue;
      const cells = r.querySelectorAll("td");
      if (!cells.length) continue;
      const a = r.querySelectorAll("a[href]").map((x) => { try { return { href: new URL(x.getAttribute("href")!, ctx.listingUrl).toString(), text: clean(x.text) }; } catch { return null; } }).find((x) => x && hostAllowed(x.href, ctx.officialDomain, c.allowDomains) && !BAD_EXT.test(x.href));
      if (!a || seen.has(a.href)) continue;
      const lines = cells.map((cell, i) => { const v = clean(cell.text); const h = headers[i] ?? ""; return v ? (h && !/^(s\.?\s*no\.?|sr\.?\s*no\.?|#)$/i.test(h) ? `${h}: ${v}` : v) : ""; }).filter(Boolean);
      const context = lines.join("\n");
      const titleCell = lines.map((l) => l.replace(/^[^:]{1,40}:\s*/, "")).sort((x, y) => y.length - x.length)[0] ?? a.text;
      const title = (a.text && !WEAK.test(a.text) && a.text.length >= 12 ? a.text : titleCell).slice(0, 300);
      const hay = `${title} ${context} ${a.href}`;
      if ((include && !include.test(hay)) || (exclude && exclude.test(hay))) continue;
      seen.add(a.href);
      out.push({ url: a.href, anchorText: title, context, dateHint: findDates(context)[0]?.iso, kindHint: kindHintOf(hay, ctx.listingKind) });
      if (out.length >= max) return out;
    }
  }
  return out;
}

const regexOk = (s: unknown, max = 300) => typeof s === "string" && s.length <= max && (() => { try { new RegExp(s, "i"); return true; } catch { return false; } })();

const adapters: SourceAdapter[] = [
  defineAdapter({ key: "generic-listing", label: "Generic notice listing",
    description: "Any page listing notices as links (HTML or PDF). Keeps links on the official domain whose text looks like a recruitment / exam / result notice.",
    discover: (doc, raw, ctx) => genericDiscover(doc, raw, ctx) }),
  defineAdapter({ key: "pdf-index", label: "PDF notice board",
    description: "Notice boards where every notice is a PDF (common on NIC-hosted sites). Only PDF links are followed.",
    discover: (doc, raw, ctx) => genericDiscover(doc, raw, ctx, { pdfOnly: true }) }),
  defineAdapter({ key: "table-listing", label: "Table of notices",
    description: "Notices in table rows (serial no. · title · date · 'Download'). The row text becomes the title, so weak link text like 'Click here' is not a problem.",
    discover: (doc, raw, ctx) => genericDiscover(doc, raw, ctx, { rowTitles: true }) }),
  defineAdapter({ key: "table-columns", label: "Table with named columns",
    description: "A table whose headers name the facts (Advt No · Start date · Last date · Fee last date). Each row's cells are read with their column names, so dates come from the table, not from a hard-to-read PDF.",
    capabilities: { twoHop: false, tableColumns: true, jsonFeed: false, needsTermsReview: false },
    configKeys: ["include", "exclude", "tableSelector", "maxItems", "delayMs", "allowDomains", "expectOrganization", "applyDomains"],
    validateConfig: (c) => (c.tableSelector !== undefined && (typeof c.tableSelector !== "string" || c.tableSelector.length > 200) ? "tableSelector must be a short CSS selector" : null),
    discover: (_doc, raw, ctx) => tableColumnsDiscover(raw, ctx) }),
  defineAdapter({ key: "detail-page", label: "Notice page → PDF (two steps)",
    description: "The listing links to an HTML page for each notice, and that page links the official PDF. The PDF is read; the page's own text is kept as context.",
    capabilities: { twoHop: true, tableColumns: false, jsonFeed: false, needsTermsReview: false },
    configKeys: ["include", "exclude", "selector", "maxItems", "delayMs", "allowDomains", "detailPdfInclude", "expectOrganization", "applyDomains"],
    validateConfig: (c) => (c.detailPdfInclude !== undefined && !regexOk(c.detailPdfInclude) ? "detailPdfInclude must be a valid short pattern" : null),
    discover: (doc, raw, ctx) => genericDiscover(doc, raw, ctx),
    async identifyNotification(c, first, ctx, io) {
      if (first.parsed.doc.type !== "html") return { candidate: c, res: first.res, parsed: first.parsed, hops: [c.url] };
      const want = ctx.config.detailPdfInclude ? new RegExp(ctx.config.detailPdfInclude, "i") : /notice|notification|advt|advertisement|corrigendum|addendum|\bkb\b|\bmb\b|download/i;
      const pdfs = first.parsed.doc.links.filter((l) => isPdf(l.href) && hostAllowed(l.href, ctx.officialDomain, ctx.config.allowDomains));
      const pick = pdfs.find((l) => want.test(`${l.text} ${l.href}`)) ?? (pdfs.length === 1 ? pdfs[0] : undefined);
      if (!pick) return { skip: pdfs.length ? `The notice page links ${pdfs.length} PDFs and none matches detailPdfInclude` : "The notice page links no PDF on the official domain" };
      const res = await io.fetch(pick.href, "notice");
      if (!res.ok || !res.body) return { skip: `Notice PDF ${pick.href}: ${res.error ?? res.outcome}` };
      const parsed = await io.parse(res);
      const pageText = first.parsed.doc.text.slice(0, 1500);
      return { candidate: { ...c, url: pick.href, context: `${c.context}\n${pageText}`.trim() }, res, parsed, hops: [c.url, pick.href] };
    } }),
  defineAdapter({ key: "json-feed", label: "JSON notice feed (terms review required)",
    description: "A JSON listing (e.g. a site's own notice-board API). Refuses to run until a person has confirmed the site's terms permit automated reading and set termsReviewed=true. Never used to get around a page that blocks crawlers.",
    capabilities: { twoHop: false, tableColumns: false, jsonFeed: true, needsTermsReview: true },
    configKeys: ["feed", "termsReviewed", "maxItems", "delayMs", "allowDomains", "include", "exclude", "expectOrganization", "applyDomains"],
    validateConfig(c) {
      const f = c.feed;
      if (!f) return "json-feed needs a feed: {url, title, link, …}";
      if (typeof f.url !== "string" || !/^https:\/\//.test(f.url) || f.url.length > 500) return "feed.url must be an https URL";
      for (const k of ["itemsPath", "title", "link", "date", "id", "group"] as const) if (f[k] !== undefined && (typeof f[k] !== "string" || !/^[A-Za-z0-9_.\[\]]{1,80}$/.test(f[k]!))) return `feed.${k} must be a field path like "attachments[].path"`;
      if (!f.title || !f.link) return "feed.title and feed.link are required";
      if (f.linkPrefix !== undefined && (typeof f.linkPrefix !== "string" || !/^https:\/\//.test(f.linkPrefix))) return "feed.linkPrefix must be an https URL";
      if (c.termsReviewed !== undefined && typeof c.termsReviewed !== "boolean") return "termsReviewed must be true or false";
      return null;
    },
    refuse: (c) => (c.termsReviewed === true ? null : "JSON feed not enabled: nobody has yet confirmed that this site's terms permit automated reading of the feed (set termsReviewed only after checking)."),
    listings: (_src, c) => (c.feed?.url ? [{ url: c.feed.url, kind: "job" }] : []),
    discover(_doc, _raw, ctx, parsed) {
      const f = ctx.config.feed; if (!f || !parsed?.json) return [];
      const items = f.itemsPath ? pluck(parsed.json, f.itemsPath) : (Array.isArray(parsed.json) ? parsed.json : (Object.values(parsed.json as object).find((v) => Array.isArray(v) && v.some((x) => x && typeof x === "object")) as unknown[] | undefined) ?? []);
      const max = Math.min(Math.max(ctx.config.maxItems ?? 10, 1), 25);
      const include = ctx.config.include ? new RegExp(ctx.config.include, "i") : null, exclude = ctx.config.exclude ? new RegExp(ctx.config.exclude, "i") : null;
      const out: Candidate[] = [];
      for (const it of (Array.isArray(items) ? items : []).flat()) {
        const title = String(pluck(it, f.title)[0] ?? "").replace(/\s+/g, " ").trim();
        const date = f.date ? String(pluck(it, f.date)[0] ?? "") : "";
        for (const p of pluck(it, f.link)) {
          if (typeof p !== "string" || !p) continue;
          let url: string; try { url = new URL(p, f.linkPrefix ?? ctx.listingUrl).toString(); } catch { continue; }
          if (!hostAllowed(url, ctx.officialDomain, ctx.config.allowDomains)) continue;
          if ((include && !include.test(title)) || (exclude && exclude.test(title))) continue;
          out.push({ url, anchorText: title.slice(0, 300), context: [title, date].filter(Boolean).join("\n"), dateHint: findDates(date)[0]?.iso ?? (/^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : undefined),
            kindHint: kindHintOf(title, ctx.listingKind), externalId: f.id ? String(pluck(it, f.id)[0] ?? "") || undefined : undefined, group: f.group ? String(pluck(it, f.group)[0] ?? "") || undefined : undefined });
          if (out.length >= max) return out;
        }
      }
      return out;
    } }),
];

export const ADAPTERS = adapters.map(({ key, label, description, capabilities, configKeys }) => ({ key, label, description, capabilities, configKeys }));
export function getAdapter(key: string): SourceAdapter { return adapters.find((a) => a.key === key) ?? adapters[0]; }
export const hasAdapter = (key: string) => adapters.some((a) => a.key === key);

/** Full validation of a source's adapter settings: known keys for THIS adapter, sizes, patterns, then the adapter's own rules. */
export function validateAdapterConfig(adapterKey: string, c: AdapterConfig): string | null {
  const a = getAdapter(adapterKey);
  for (const k of Object.keys(c)) if (!(a.configKeys as readonly string[]).includes(k)) return `Unknown setting “${k}” for ${a.label} (allowed: ${a.configKeys.join(", ")})`;
  for (const k of ["include", "exclude", "expectOrganization"] as const) if (c[k] !== undefined && !regexOk(c[k])) return `${k} must be a valid short text pattern`;
  if (c.selector !== undefined && (typeof c.selector !== "string" || c.selector.length > 200)) return "selector must be a short CSS selector";
  if (c.maxItems !== undefined && (!Number.isInteger(c.maxItems) || c.maxItems < 1 || c.maxItems > 25)) return "maxItems must be a whole number from 1 to 25";
  if (c.delayMs !== undefined && (!Number.isInteger(c.delayMs) || c.delayMs < 1000 || c.delayMs > 60000)) return "delayMs must be between 1000 and 60000 (be gentle with government sites)";
  for (const k of ["allowDomains", "applyDomains"] as const) if (c[k] !== undefined && (!Array.isArray(c[k]) || c[k]!.length > 5 || c[k]!.some((d) => typeof d !== "string" || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)))) return `${k} must be a list of up to 5 domain names`;
  if (c.pdfOnly !== undefined && typeof c.pdfOnly !== "boolean") return "pdfOnly must be true or false";
  return a.validateConfig(c);
}
