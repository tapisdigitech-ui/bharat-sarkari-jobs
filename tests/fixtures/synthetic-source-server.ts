/**
 * A SYNTHETIC "official source" for browser tests (http://127.0.0.1:5566). Every page says it is synthetic test data.
 * It is not a copy of any real government website. GET /__variant?v=2 switches to the "corrigendum" version (extended last
 * date, revised vacancies); GET /__down?on=1 makes the notices return 503 (to exercise failure handling).
 */
import http from "node:http";
import { makePdf } from "./pdf";
import { CLERK_V1, CLERK_V2, admitCardHtml, aeNoticeHtml, clerkNoticeLines, listingHtml } from "./synthetic-notices";

const PORT = Number(process.env.SYNTH_PORT ?? 5566);
const BASE = `http://127.0.0.1:${PORT}`;
let variant = 1; let down = false;
const hits: string[] = [];

http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", BASE);
  hits.push(url.pathname);
  const send = (status: number, type: string, body: string | Uint8Array) => { res.writeHead(status, { "content-type": type }); res.end(body); };
  if (url.pathname === "/__variant") { variant = Number(url.searchParams.get("v")) || 1; return send(200, "text/plain", `variant ${variant}`); }
  if (url.pathname === "/__down") { down = url.searchParams.get("on") === "1"; return send(200, "text/plain", `down ${down}`); }
  if (url.pathname === "/__hits") return send(200, "application/json", JSON.stringify(hits));
  if (url.pathname === "/robots.txt") return send(200, "text/plain", "User-agent: *\nDisallow: /private/\n");
  if (down && url.pathname !== "/") return send(503, "text/plain", "Service unavailable (synthetic outage)");
  switch (url.pathname) {
    case "/": return send(200, "text/html", `<html><head><title>E2E Synthetic Selection Board</title></head><body><p>SYNTHETIC TEST SOURCE - NOT A REAL GOVERNMENT WEBSITE</p><a href="${BASE}/recruitment.html">Recruitment</a></body></html>`);
    case "/recruitment.html": return send(200, "text/html", listingHtml(BASE, variant === 2));
    case "/notices/clerk-2026.pdf": return send(200, "application/pdf", makePdf(clerkNoticeLines(variant === 2 ? CLERK_V2 : CLERK_V1, BASE)));
    case "/notices/ae-2026.html": return send(200, "text/html", aeNoticeHtml(BASE));
    case "/notices/ae-2026-detailed-notification.pdf": return send(200, "application/pdf", makePdf(["SYNTHETIC TEST NOTICE - NOT A REAL GOVERNMENT RECRUITMENT", "Assistant Engineer (Civil) 2026 - detailed notification"]));
    case "/notices/clerk-admit-card.html": return send(200, "text/html", admitCardHtml(BASE));
    case "/notices/tender-stationery.pdf": return send(200, "application/pdf", makePdf(["SYNTHETIC TEST DOCUMENT", "Tender for supply of stationery items"]));
    case "/notices/scanned-recruitment.pdf": return send(200, "application/pdf", makePdf(["Recruitment 2026"]));   // almost no text layer, like a scan
    case "/apply/clerk-2026": case "/apply/ae-2026": case "/admit/clerk-2026":
      return send(200, "text/html", "<html><body><p>SYNTHETIC TEST PAGE</p><h1>Online application (synthetic)</h1></body></html>");
    default: return send(404, "text/plain", "Not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`synthetic source on ${BASE}`));
