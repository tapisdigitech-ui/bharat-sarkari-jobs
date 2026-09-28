/**
 * Browser stand-in for `unpdf` used ONLY by the live-pilot probe bundle. It drives pdf.js 6.1.200 (the exact version
 * unpdf 1.8.1 bundles) and copies unpdf's getPageText + normalizeMergedText so the text matches what the server sees.
 */
type PdfJs = { getDocument: (o: object) => { promise: Promise<Pdf> }; GlobalWorkerOptions: { workerSrc: string } };
type Pdf = { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string; hasEOL?: boolean }[] }> }> };
const CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.1.200/build/";
let lib: PdfJs | null = null;
async function pdfjs(): Promise<PdfJs> {
  if (lib) return lib;
  lib = (await import(/* @vite-ignore */ CDN + "pdf.min.mjs")) as PdfJs;
  lib.GlobalWorkerOptions.workerSrc = CDN + "pdf.worker.min.mjs";
  return lib;
}
export async function getDocumentProxy(data: Uint8Array): Promise<Pdf> {
  const p = await pdfjs();
  return p.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
}
async function getPageText(pdf: Pdf, n: number) {
  return (await (await pdf.getPage(n)).getTextContent()).items.filter((i) => i.str != null).map((i) => i.str + (i.hasEOL ? "\n" : "")).join("");
}
function normalizeMergedText(texts: string[]) {
  return texts.join("\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
}
export async function extractText(pdf: Pdf, o: { mergePages?: boolean } = {}) {
  const texts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) texts.push(await getPageText(pdf, i));
  return { totalPages: pdf.numPages, text: o.mergePages ? normalizeMergedText(texts) : texts };
}
