/** Pure URL checks (no network): safe to use anywhere, unit-tested. */
/* ───────── URL validation for editors (warnings, not errors) ───────── */
const SHORTENERS = /^(bit\.ly|tinyurl\.com|goo\.gl|t\.co|ow\.ly|is\.gd|rb\.gy|cutt\.ly|shorturl\.at)$/i;
export const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };

/**
 * Checks an official URL against the organization's registered official domains. Returns warnings for the editor —
 * a different government sub-domain is allowed (it is common) but called out for a human to confirm.
 */
export function officialUrlWarnings(url: string, registeredDomains: string[]): string[] {
  const w: string[] = [];
  let u: URL;
  try { u = new URL(url); } catch { return ["Not a valid URL"]; }
  if (!["http:", "https:"].includes(u.protocol)) return ["Only http(s) links can be official links"];
  if (u.protocol === "http:") w.push("Uses http:// — prefer the https:// address if the site supports it");
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) w.push("Points to a bare IP address, not an official domain name");
  if (SHORTENERS.test(h)) w.push("A link shortener hides the real destination — use the full official URL");
  const domains = registeredDomains.map((d) => d.toLowerCase().replace(/^www\./, "")).filter(Boolean);
  if (domains.length && !domains.some((d) => h === d || h.endsWith("." + d))) {
    w.push(/\.(gov|nic)\.in$/.test(h)
      ? `On ${h}, a government domain but not one registered for this organization (${domains.join(", ")}) — confirm it is the right office`
      : `On ${h}, which does not match this organization's registered official domain (${domains.join(", ")}) — make sure this is an official source`);
  } else if (!domains.length && !/\.(gov|nic|ac|edu|res)\.in$|\.gov$/.test(h)) {
    w.push(`No official domain is registered for this organization yet, and ${h} is not a gov.in / nic.in address — confirm it is official`);
  }
  return w;
}

