/** Same computation on the server (tsx) and in a browser copy of the probe; equal digests ⇒ the copy behaves identically. */
import { getAdapter } from "@/lib/ingestion/adapters";
import { extractFields, pickTitle } from "@/lib/ingestion/fields";
import { classify, normalize, hashOf } from "@/lib/ingestion/normalize";
import { htmlToDoc } from "@/lib/ingestion/text";
export function selftest(html: string, text: string) {
  const doc = htmlToDoc(html, "https://example.gov.in/notices");
  const cands = getAdapter("table-listing").discover(doc, html, { officialDomain: "example.gov.in", listingUrl: "https://example.gov.in/notices", config: {} });
  const d2 = { type: "pdf" as const, text, headings: text.split("\n").slice(0, 12), links: [] };
  const t = pickTitle("", d2)!; const k = classify(t.value, text)!;
  const n = normalize(k, t, extractFields(text, []), { id: null, name: "T", organizationId: "o1", organizationName: "Org", organizationLevel: "central", departmentSlug: null, stateId: null, stateSlug: null, isAllIndia: true, officialDomain: "example.gov.in", baseUrl: "https://example.gov.in", isSynthetic: false }, "https://example.gov.in/pdf/advt-05-2026.pdf");
  return { digest: hashOf({ cands, n, links: doc.links, text: doc.text }), cands: cands.length, kind: k, conf: n.confidence, fields: Object.keys(n.extracted).length };
}
