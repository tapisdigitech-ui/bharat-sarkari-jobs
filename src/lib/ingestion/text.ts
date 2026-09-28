/** Turn a fetched HTML page or PDF into plain text + links. Deterministic; no AI. */
import { createHash } from "node:crypto";
import { parse, type HTMLElement } from "node-html-parser";

export const PARSER_VERSION = "p3-2026.09";

export interface PageLink { href: string; text: string; context: string }
export interface DocText { type: "html" | "pdf" | "other"; text: string; title?: string; headings: string[]; links: PageLink[]; pages?: number }

export const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

export function docType(contentType: string | null, url: string, body: Uint8Array | null): DocText["type"] {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf") || /\.pdf($|\?)/i.test(url) || (body && body.length > 4 && String.fromCharCode(...body.slice(0, 4)) === "%PDF")) return "pdf";
  if (ct.includes("html") || ct.includes("xml") || ct === "" || /\.(s?html?|aspx?|php|jsp)($|\?)/i.test(url)) return "html";
  return "other";
}

const collapse = (s: string) => s.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function decodeHtml(body: Uint8Array): string {
  // Most official sites are UTF-8; fall back to latin1 when the bytes are not valid UTF-8.
  try { return new TextDecoder("utf-8", { fatal: true }).decode(body); } catch { return new TextDecoder("latin1").decode(body); }
}

export function htmlToDoc(body: Uint8Array | string, baseUrl: string): DocText {
  const html = typeof body === "string" ? body : decodeHtml(body);
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  root.querySelectorAll("script,style,noscript,svg,iframe").forEach((n) => n.remove());
  const title = collapse(root.querySelector("title")?.text ?? "") || undefined;
  const headings = root.querySelectorAll("h1,h2,h3").map((h) => collapse(h.text)).filter((t) => t.length > 2).slice(0, 30);
  const links: PageLink[] = [];
  for (const a of root.querySelectorAll("a[href]")) {
    const raw = (a.getAttribute("href") ?? "").trim();
    if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel):/i.test(raw)) continue;
    let href: string;
    try { href = new URL(raw, baseUrl).toString(); } catch { continue; }
    const text = collapse(a.text || a.getAttribute("title") || "");
    links.push({ href, text, context: spacedText(rowOf(a)).slice(0, 400) });
  }
  // Block-ish elements become line breaks so labels and values stay on one line each.
  const text = collapse(root.structuredText ?? root.text);
  return { type: "html", text, title, headings, links };
}

/** Text of an element with a space at every tag boundary (table cells must not run together: "2026" + "24/09/2026"). */
function spacedText(n: HTMLElement): string {
  return collapse(parse(n.innerHTML.replace(/</g, " <")).text.replace(/\s+/g, " "));
}

/** The table row / list item / paragraph a link lives in: its dates and labels usually sit there. */
function rowOf(a: HTMLElement): HTMLElement {
  let n: HTMLElement | null = a;
  for (let i = 0; i < 5 && n; i++) {
    if (["TR", "LI", "P", "DIV"].includes(n.tagName)) return n;
    n = n.parentNode as HTMLElement | null;
  }
  return a;
}

export async function pdfToDoc(body: Uint8Array): Promise<DocText> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(body));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const t = collapse(Array.isArray(text) ? text.join("\n") : text);
  const links: PageLink[] = [];
  for (const m of t.matchAll(/https?:\/\/[^\s)<>"']+/g)) links.push({ href: m[0].replace(/[.,;]+$/, ""), text: m[0], context: "" });
  return { type: "pdf", text: t, headings: t.split("\n").slice(0, 12).map((l) => l.trim()).filter(Boolean), links, pages: totalPages };
}

export async function toDoc(body: Uint8Array, contentType: string | null, url: string): Promise<DocText> {
  const type = docType(contentType, url, body);
  if (type === "pdf") return pdfToDoc(body);
  if (type === "html") return htmlToDoc(body, url);
  return { type: "other", text: "", headings: [], links: [] };
}
